/**
 * Terrain renderer: a quadtree-like set of baked chunks with levels of detail.
 *
 *  - Level 0 (16 chunks) covers the whole world and is always resident, so
 *    there is always something correct to draw.
 *  - Finer levels are baked on demand for the visible area only, cached (LRU)
 *    and faded in. While a fine chunk is missing, its coarser parent shows.
 *  - One draw call per visible chunk; nothing is generated per frame.
 */
import { BufferImageSource, Container, Mesh, MeshGeometry, type TextureSource } from 'pixi.js';
import { CHUNK_NODES, LODS, TERRAIN, WORLD_SIZE } from '../../core/config.ts';
import { chunkKey, chunksPerSide } from '../../core/coords.ts';
import type { Rect } from '../../core/math.ts';
import type { WorldBackend } from '../generation/WorldBackend.ts';
import type { DetailTextures } from './detailTextures.ts';
import {
  classifyChunk,
  createChunkShader,
  createTerrainGlobals,
  type ChunkShader,
  type TerrainGlobals,
} from './terrainShader.ts';

export interface TerrainView {
  /** Visible world rectangle. */
  bounds: Rect;
  /** Device pixels per world unit. */
  deviceScale: number;
}

export interface TerrainStats {
  residentChunks: number;
  drawnChunks: number;
  pendingBakes: number;
  targetLevel: number;
  textureBytes: number;
  bakes: number;
  avgBakeMs: number;
  maxBakeMs: number;
}

interface Chunk {
  key: number;
  level: number;
  cx: number;
  cy: number;
  mesh: Mesh<MeshGeometry, ChunkShader['shader']>;
  source: BufferImageSource;
  shader: ChunkShader;
  /** performance.now() when the chunk became drawable. */
  bornAt: number;
  lastUsed: number;
  opaque: boolean;
}

const FINEST = LODS.length - 1;

export class TerrainLayer {
  readonly container = new Container({ label: 'terrain' });

  private readonly geometry: MeshGeometry;
  private readonly globals: TerrainGlobals;
  private readonly chunks = new Map<number, Chunk>();
  private readonly inFlight = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly maxCached: number;
  private frame = 0;
  private bakeCount = 0;
  private bakeMsTotal = 0;
  private bakeMsMax = 0;
  private drawn = 0;
  private targetLevel = 0;
  private wanted: { key: number; level: number; cx: number; cy: number; priority: number }[] = [];
  private destroyed = false;
  /** Called whenever new terrain became visible (lets the app keep rendering). */
  onChunkReady: (() => void) | null = null;
  /**
   * Optional occlusion test: return true for a world rectangle that something
   * above the terrain (the fog) hides completely. Such chunks are neither
   * drawn nor baked. Results are cached per chunk.
   */
  isHidden: ((rect: Rect) => boolean) | null = null;
  private readonly hiddenCache = new Map<number, boolean>();
  private readonly backend: WorldBackend;
  private readonly textures: DetailTextures;
  private readonly coast: TextureSource;

  constructor(
    backend: WorldBackend,
    textures: DetailTextures,
    coast: TextureSource,
    options: { lowMemory?: boolean } = {},
  ) {
    this.backend = backend;
    this.textures = textures;
    this.coast = coast;
    this.maxCached = options.lowMemory ? TERRAIN.cacheChunksLowMemory : TERRAIN.cacheChunks;
    this.globals = createTerrainGlobals();
    this.geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.container.sortableChildren = true;
    this.container.interactiveChildren = false;
  }

  /** Bake and upload every level-0 chunk. Must finish before the first frame. */
  async preloadBase(onProgress?: (p: number) => void): Promise<void> {
    const n = chunksPerSide(0);
    let done = 0;
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const result = await this.backend.bake(0, cx, cy);
        if (this.destroyed) return;
        this.recordBake(result.ms);
        this.addChunk(0, cx, cy, result.pixels, -1e9);
        onProgress?.(++done / (n * n));
      }
    }
  }

  /**
   * Compile all three shader variants during loading. Otherwise the first
   * inland / open-sea chunk met while zooming would compile its program in
   * the middle of a gesture and drop a frame.
   *
   * The programs link when the layer is next drawn, so call this when the map
   * is (about to be) rendered: `MapApp.warmUp()` does, right before the
   * loading splash opens.
   */
  warmUpShaders(): void {
    if (this.destroyed) return;
    const pixels = new Uint8Array(CHUNK_NODES * CHUNK_NODES * 4);
    const meshes: { mesh: Chunk['mesh']; shader: ChunkShader; source: BufferImageSource }[] = [];
    for (const kind of ['mixed', 'land', 'sea'] as const) {
      const source = new BufferImageSource({
        resource: pixels,
        width: CHUNK_NODES,
        height: CHUNK_NODES,
        format: 'rgba8unorm',
        alphaMode: 'no-premultiply-alpha',
      });
      const shader = createChunkShader(
        source,
        this.textures.grass,
        this.textures.noise,
        this.coast,
        this.globals,
        { x: 0, y: 0, size: 1, band: 1 },
        kind,
      );
      // a sub-pixel quad: drawn (so the program links) but never visible
      const mesh = new Mesh({ geometry: this.geometry, shader: shader.shader });
      mesh.scale.set(1e-3);
      mesh.zIndex = -1;
      this.container.addChild(mesh);
      meshes.push({ mesh, shader, source });
    }
    let frames = 0;
    const cleanup = (): void => {
      if (++frames < 3 && !this.destroyed) {
        requestAnimationFrame(cleanup);
        return;
      }
      for (const m of meshes) {
        m.mesh.removeFromParent();
        m.mesh.destroy();
        m.shader.shader.destroy();
        m.source.destroy();
      }
    };
    requestAnimationFrame(cleanup);
  }

  /** Level of detail appropriate for a zoom level. */
  static levelFor(deviceScale: number): number {
    for (let level = 0; level < FINEST; level++) {
      if (LODS[level].texel * deviceScale <= TERRAIN.maxTexelPx) return level;
    }
    return FINEST;
  }

  update(view: TerrainView, timeSec: number, detailStrength = 1): void {
    if (this.destroyed) return;
    const now = performance.now();
    this.frame++;
    this.globals.set(timeSec, 1 / view.deviceScale, detailStrength);

    const target = TerrainLayer.levelFor(view.deviceScale);
    this.targetLevel = target;
    const b = view.bounds;
    const cxm = b.x + b.width / 2;
    const cym = b.y + b.height / 2;

    // Hide everything, then switch on what this frame needs.
    for (const c of this.chunks.values()) c.mesh.visible = false;
    this.wanted.length = 0;
    this.drawn = 0;

    const size = LODS[target].chunkSize;
    const per = chunksPerSide(target);
    const x0 = clampInt(Math.floor(b.x / size), 0, per - 1);
    const x1 = clampInt(Math.floor((b.x + b.width) / size), 0, per - 1);
    const y0 = clampInt(Math.floor(b.y / size), 0, per - 1);
    const y1 = clampInt(Math.floor((b.y + b.height) / size), 0, per - 1);
    const outside = b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= WORLD_SIZE || b.y >= WORLD_SIZE;

    if (!outside) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = chunkKey(target, cx, cy);
          if (this.hidden(key, cx * size, cy * size, size)) continue;
          const chunk = this.chunks.get(key);
          let covered = false;
          if (chunk) {
            covered = this.show(chunk, now);
          } else if (!this.failed.has(key)) {
            const dx = (cx + 0.5) * size - cxm;
            const dy = (cy + 0.5) * size - cym;
            this.wanted.push({ key, level: target, cx, cy, priority: dx * dx + dy * dy });
          }
          if (!covered) this.showFallback(target, cx, cy, now);
        }
      }
    }

    this.pump();
    this.evict();
  }

  stats(): TerrainStats {
    return {
      residentChunks: this.chunks.size,
      drawnChunks: this.drawn,
      pendingBakes: this.wanted.length + this.inFlight.size,
      targetLevel: this.targetLevel,
      textureBytes: this.chunks.size * CHUNK_NODES * CHUNK_NODES * 4,
      bakes: this.bakeCount,
      avgBakeMs: this.bakeCount ? this.bakeMsTotal / this.bakeCount : 0,
      maxBakeMs: this.bakeMsMax,
    };
  }

  /** True while chunks are fading in or still being baked. */
  get busy(): boolean {
    if (this.wanted.length > 0 || this.inFlight.size > 0) return true;
    for (const c of this.chunks.values()) if (c.mesh.visible && !c.opaque) return true;
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.geometry.destroy();
    this.container.destroy({ children: true });
  }

  // ------------------------------------------------------------------------

  /** Make a chunk visible; returns true once it fully hides what is below. */
  private show(chunk: Chunk, now: number): boolean {
    chunk.lastUsed = this.frame;
    if (!chunk.mesh.visible) {
      chunk.mesh.visible = true;
      this.drawn++;
    }
    if (chunk.opaque) return true;
    const fade = (now - chunk.bornAt) / TERRAIN.fadeMs;
    if (fade >= 1) {
      chunk.opaque = true;
      chunk.shader.setFade(1);
      chunk.mesh.state.blend = false;
      return true;
    }
    chunk.shader.setFade(fade < 0 ? 0 : fade);
    return false;
  }

  /** Show the nearest resident, fully faded-in ancestor of a chunk. */
  private showFallback(level: number, cx: number, cy: number, now: number): void {
    for (let l = level - 1; l >= 0; l--) {
      const ratio = LODS[l].chunkSize / LODS[level].chunkSize;
      const chunk = this.chunks.get(chunkKey(l, Math.floor(cx / ratio), Math.floor(cy / ratio)));
      if (chunk && this.show(chunk, now)) return;
    }
  }

  private hidden(key: number, x: number, y: number, size: number): boolean {
    if (!this.isHidden) return false;
    let h = this.hiddenCache.get(key);
    if (h === undefined) {
      h = this.isHidden({ x, y, width: size, height: size });
      this.hiddenCache.set(key, h);
    }
    return h;
  }

  private pump(): void {
    if (this.inFlight.size >= 1 || this.wanted.length === 0) return;
    let best = this.wanted[0];
    for (let i = 1; i < this.wanted.length; i++) {
      if (this.wanted[i].priority < best.priority) best = this.wanted[i];
    }
    const { key, level, cx, cy } = best;
    this.inFlight.add(key);
    this.backend
      .bake(level, cx, cy)
      .then((result) => {
        this.inFlight.delete(key);
        if (this.destroyed) return;
        this.recordBake(result.ms);
        this.addChunk(level, cx, cy, result.pixels, performance.now());
        this.onChunkReady?.();
      })
      .catch((err) => {
        this.inFlight.delete(key);
        this.failed.add(key);
        console.error('[terrain] bake failed', level, cx, cy, err);
      });
  }

  private addChunk(level: number, cx: number, cy: number, pixels: Uint8Array, bornAt: number): void {
    const lod = LODS[level];
    const key = chunkKey(level, cx, cy);
    if (this.chunks.has(key)) return;
    const source = new BufferImageSource({
      resource: pixels,
      width: CHUNK_NODES,
      height: CHUNK_NODES,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      addressMode: 'clamp-to-edge',
      scaleMode: 'linear',
      autoGenerateMipmaps: false,
    });
    const shader = createChunkShader(
      source,
      this.textures.grass,
      this.textures.noise,
      this.coast,
      this.globals,
      { x: cx * lod.chunkSize, y: cy * lod.chunkSize, size: lod.chunkSize, band: lod.band },
      classifyChunk(pixels),
    );
    const mesh = new Mesh({ geometry: this.geometry, shader: shader.shader });
    mesh.position.set(cx * lod.chunkSize, cy * lod.chunkSize);
    mesh.scale.set(lod.chunkSize);
    mesh.zIndex = level;
    mesh.visible = false;
    const opaque = level === 0;
    mesh.state.blend = !opaque;
    shader.setFade(opaque ? 1 : 0);
    this.container.addChild(mesh);
    this.chunks.set(key, { key, level, cx, cy, mesh, source, shader, bornAt, lastUsed: this.frame, opaque });
  }

  private evict(): void {
    const base = chunksPerSide(0) ** 2;
    let extra = this.chunks.size - base - this.maxCached;
    if (extra <= 0) return;
    const candidates: Chunk[] = [];
    for (const c of this.chunks.values()) {
      if (c.level > 0 && c.lastUsed < this.frame) candidates.push(c);
    }
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    // Spread destruction over frames to avoid a hitch.
    extra = Math.min(extra, 4, candidates.length);
    for (let i = 0; i < extra; i++) {
      const c = candidates[i];
      this.chunks.delete(c.key);
      this.disposeChunk(c);
    }
  }

  private disposeChunk(c: Chunk): void {
    c.mesh.removeFromParent();
    c.mesh.destroy();
    c.shader.shader.destroy();
    c.source.destroy();
  }

  private recordBake(ms: number): void {
    this.bakeCount++;
    this.bakeMsTotal += ms;
    if (ms > this.bakeMsMax) this.bakeMsMax = ms;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
