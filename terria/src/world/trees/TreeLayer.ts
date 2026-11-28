/**
 * Draws trees as sprites, but only the tree chunks that are on screen and
 * only when zoomed in far enough to tell trees apart (further out the terrain
 * texture already has the woods painted in).
 *
 * Positions come from the world backend (worker), one request at a time. Each
 * tree chunk becomes one static ParticleContainer: the GPU buffer is filled
 * once, so a chunk costs one draw call and no per-frame CPU work regardless of
 * how many trees it holds.
 */
import { Container, Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { BASE_SPACING, TREES, WORLD_SIZE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { WorldBackend } from '../generation/WorldBackend.ts';
import type { WorldFields } from '../generation/WorldFields.ts';
import { createTreeAtlas, type TreeAtlas } from './treeAtlas.ts';
import { TREE_STRIDE } from './treePlacement.ts';

interface TreeChunk {
  key: number;
  particles: ParticleContainer | null;
  count: number;
  lastUsed: number;
}

const STATIC = { vertex: false, position: false, rotation: false, uvs: false, color: false } as const;

export class TreeLayer {
  /** Add to the scene's object layer. */
  readonly container = new Container({ label: 'trees' });

  private readonly atlas: TreeAtlas;
  private readonly chunks = new Map<number, TreeChunk>();
  private readonly world: WorldFields;
  private readonly backend: WorldBackend;
  private inFlight = -1;
  private frame = 0;
  private visibleTrees = 0;
  private visibleChunks = 0;
  private destroyed = false;

  constructor(world: WorldFields, backend: WorldBackend) {
    this.world = world;
    this.backend = backend;
    this.atlas = createTreeAtlas(world.params.seed);
    this.container.interactiveChildren = false;
  }

  /** @returns true while more tree chunks are still on their way */
  update(bounds: Rect, deviceScale: number): boolean {
    this.frame++;
    const alpha = smoothstep(TREES.showFrom, TREES.fullAt, deviceScale);
    const show = alpha > 0.001;
    this.container.visible = show;
    this.visibleTrees = 0;
    this.visibleChunks = 0;
    if (!show) return false;
    this.container.alpha = alpha;

    for (const c of this.chunks.values()) {
      if (c.particles) c.particles.visible = false;
    }

    const size = TREES.chunkSize;
    const per = WORLD_SIZE / size;
    const pad = 40; // crowns and shadows overhang their chunk a little
    const x0 = Math.max(0, Math.floor((bounds.x - pad) / size));
    const x1 = Math.min(per - 1, Math.floor((bounds.x + bounds.width + pad) / size));
    const y0 = Math.max(0, Math.floor((bounds.y - pad) / size));
    const y1 = Math.min(per - 1, Math.floor((bounds.y + bounds.height + pad) / size));
    const cxm = (bounds.x + bounds.width / 2) / size - 0.5;
    const cym = (bounds.y + bounds.height / 2) / size - 0.5;

    let missing = false;
    let want = -1;
    let wantD = Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cy * per + cx;
        let chunk = this.chunks.get(key);
        if (!chunk) {
          if (!this.hasLand(cx, cy)) {
            chunk = { key, particles: null, count: 0, lastUsed: this.frame };
            this.chunks.set(key, chunk);
          } else {
            missing = true;
            const d = (cx - cxm) * (cx - cxm) + (cy - cym) * (cy - cym);
            if (d < wantD) {
              wantD = d;
              want = key;
            }
            continue;
          }
        }
        chunk.lastUsed = this.frame;
        if (chunk.particles) {
          chunk.particles.visible = true;
          this.visibleTrees += chunk.count;
          this.visibleChunks++;
        }
      }
    }
    if (want >= 0 && this.inFlight < 0) this.request(want, want % per, Math.floor(want / per));
    this.evict();
    return missing;
  }

  stats(): { chunks: number; visibleChunks: number; visibleTrees: number } {
    return { chunks: this.chunks.size, visibleChunks: this.visibleChunks, visibleTrees: this.visibleTrees };
  }

  destroy(): void {
    this.destroyed = true;
    for (const c of this.chunks.values()) c.particles?.destroy();
    this.chunks.clear();
    this.container.destroy({ children: true });
    this.atlas.destroy();
  }

  /** Cheap test on the base grid: a chunk with no land has no trees. */
  private hasLand(cx: number, cy: number): boolean {
    const e = this.world.e;
    const size = TREES.chunkSize;
    const n = e.nodes;
    const i0 = Math.max(0, Math.floor((cx * size) / BASE_SPACING) - 1);
    const i1 = Math.min(n - 1, Math.ceil(((cx + 1) * size) / BASE_SPACING) + 1);
    const j0 = Math.max(0, Math.floor((cy * size) / BASE_SPACING) - 1);
    const j1 = Math.min(n - 1, Math.ceil(((cy + 1) * size) / BASE_SPACING) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (e.data[j * n + i] > 0) return true;
      }
    }
    return false;
  }

  private request(key: number, cx: number, cy: number): void {
    this.inFlight = key;
    this.backend
      .trees(cx, cy)
      .then((trees) => {
        this.inFlight = -1;
        if (!this.destroyed && !this.chunks.has(key)) this.build(key, cx, cy, trees);
      })
      .catch((err) => {
        this.inFlight = -1;
        this.chunks.set(key, { key, particles: null, count: 0, lastUsed: this.frame });
        console.error('[trees] placement failed', cx, cy, err);
      });
  }

  private build(key: number, cx: number, cy: number, trees: Float32Array): void {
    const count = trees.length / TREE_STRIDE;
    const chunk: TreeChunk = { key, particles: null, count, lastUsed: this.frame };
    this.chunks.set(key, chunk);
    if (count === 0) return;

    const size = TREES.chunkSize;
    const atlas = this.atlas;
    const particles = new ParticleContainer({
      texture: atlas.canopies[0],
      dynamicProperties: STATIC,
      boundsArea: new Rectangle(cx * size - 48, cy * size - 48, size + 96, size + 96),
    });
    const list: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const o = i * TREE_STRIDE;
      const k = trees[o + 2] / atlas.canopyPx;
      const tint = Math.round(255 * trees[o + 4]);
      list.push(
        new Particle({
          texture: atlas.canopies[trees[o + 3]],
          x: trees[o],
          y: trees[o + 1],
          scaleX: k,
          scaleY: k,
          anchorX: atlas.anchorX,
          anchorY: atlas.anchorY,
          tint: (tint << 16) | (tint << 8) | tint,
        }),
      );
    }
    for (let i = 0; i < list.length; i += 4000) particles.addParticle(...list.slice(i, i + 4000));
    particles.visible = false;
    this.container.addChild(particles);
    chunk.particles = particles;
  }

  private evict(): void {
    let extra = this.chunks.size - TREES.cacheChunks;
    if (extra <= 0) return;
    const old: TreeChunk[] = [];
    for (const c of this.chunks.values()) if (c.lastUsed < this.frame) old.push(c);
    old.sort((a, b) => a.lastUsed - b.lastUsed);
    extra = Math.min(extra, 2, old.length);
    for (let i = 0; i < extra; i++) {
      this.chunks.delete(old[i].key);
      old[i].particles?.destroy();
    }
  }
}
