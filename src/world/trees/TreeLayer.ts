/**
 * Draws groves as sprites, but only the tree chunks that are on screen and
 * only when zoomed in far enough to tell trees apart (further out the terrain
 * texture already has the groves painted in).
 *
 * Each tree chunk is two static ParticleContainers (ground shadows, canopies):
 * the GPU buffers are filled once, so a chunk costs two draw calls and no
 * per-frame CPU work regardless of how many trees it holds.
 */
import { Container, Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { TREES, WORLD_SIZE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { WorldFields } from '../generation/WorldFields.ts';
import { createTreeAtlas, type TreeAtlas } from './treeAtlas.ts';
import { placeTrees, TREE_STRIDE } from './treePlacement.ts';

interface TreeChunk {
  key: number;
  shadows: ParticleContainer | null;
  canopies: ParticleContainer | null;
  count: number;
  lastUsed: number;
}

const STATIC = { vertex: false, position: false, rotation: false, uvs: false, color: false } as const;
const MAX_BUILDS_PER_FRAME = 1;

export class TreeLayer {
  /** Add to the scene below `objects`: soft ground shadows. */
  readonly shadowContainer = new Container({ label: 'tree-shadows' });
  /** Add to the scene's object layer: canopies. */
  readonly canopyContainer = new Container({ label: 'tree-canopies' });

  private readonly atlas: TreeAtlas;
  private readonly chunks = new Map<number, TreeChunk>();
  private frame = 0;
  private visibleTrees = 0;
  private visibleChunks = 0;
  private readonly world: WorldFields;

  constructor(world: WorldFields) {
    this.world = world;
    this.atlas = createTreeAtlas(world.params.seed);
    this.shadowContainer.interactiveChildren = false;
    this.canopyContainer.interactiveChildren = false;
  }

  /** @returns true while more tree chunks still have to be built */
  update(bounds: Rect, deviceScale: number): boolean {
    this.frame++;
    const alpha = smoothstep(TREES.showFrom, TREES.fullAt, deviceScale);
    const show = alpha > 0.001;
    this.shadowContainer.visible = show;
    this.canopyContainer.visible = show;
    this.visibleTrees = 0;
    this.visibleChunks = 0;
    if (!show) return false;
    this.shadowContainer.alpha = alpha;
    this.canopyContainer.alpha = alpha;

    for (const c of this.chunks.values()) {
      if (c.shadows) c.shadows.visible = false;
      if (c.canopies) c.canopies.visible = false;
    }

    const size = TREES.chunkSize;
    const per = WORLD_SIZE / size;
    const pad = 40; // canopies and shadows overhang their chunk a little
    const x0 = Math.max(0, Math.floor((bounds.x - pad) / size));
    const x1 = Math.min(per - 1, Math.floor((bounds.x + bounds.width + pad) / size));
    const y0 = Math.max(0, Math.floor((bounds.y - pad) / size));
    const y1 = Math.min(per - 1, Math.floor((bounds.y + bounds.height + pad) / size));

    let builds = 0;
    let missing = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cy * per + cx;
        let chunk = this.chunks.get(key);
        if (!chunk) {
          if (builds >= MAX_BUILDS_PER_FRAME) {
            missing = true;
            continue;
          }
          builds++;
          chunk = this.build(key, cx, cy);
        }
        chunk.lastUsed = this.frame;
        if (chunk.count > 0) {
          chunk.shadows!.visible = true;
          chunk.canopies!.visible = true;
          this.visibleTrees += chunk.count;
          this.visibleChunks++;
        }
      }
    }
    this.evict();
    return missing;
  }

  stats(): { chunks: number; visibleChunks: number; visibleTrees: number } {
    return { chunks: this.chunks.size, visibleChunks: this.visibleChunks, visibleTrees: this.visibleTrees };
  }

  destroy(): void {
    for (const c of this.chunks.values()) this.dispose(c);
    this.chunks.clear();
    this.shadowContainer.destroy({ children: true });
    this.canopyContainer.destroy({ children: true });
    this.atlas.destroy();
  }

  private build(key: number, cx: number, cy: number): TreeChunk {
    const trees = placeTrees(this.world, cx, cy);
    const count = trees.length / TREE_STRIDE;
    const chunk: TreeChunk = { key, shadows: null, canopies: null, count, lastUsed: this.frame };
    this.chunks.set(key, chunk);
    if (count === 0) return chunk;

    const size = TREES.chunkSize;
    const area = new Rectangle(cx * size - 48, cy * size - 48, size + 96, size + 96);
    const atlas = this.atlas;
    const shadows = new ParticleContainer({ texture: atlas.shadow, dynamicProperties: STATIC, boundsArea: area });
    const canopies = new ParticleContainer({ texture: atlas.canopies[0], dynamicProperties: STATIC, boundsArea: area });
    const shadowList: Particle[] = [];
    const canopyList: Particle[] = [];
    const cellPx = atlas.shadow.frame.width;
    for (let i = 0; i < count; i++) {
      const o = i * TREE_STRIDE;
      const x = trees[o];
      const y = trees[o + 1];
      const d = trees[o + 2];
      const variant = trees[o + 3];
      const shade = trees[o + 4];
      shadowList.push(
        new Particle({
          texture: atlas.shadow,
          x: x + d * 0.3,
          y: y + d * 0.16,
          scaleX: (d * 1.3) / cellPx,
          scaleY: (d * 0.86) / cellPx,
          anchorX: 0.5,
          anchorY: 0.5,
        }),
      );
      const k = d / atlas.canopyPx;
      const tint = Math.round(255 * shade);
      canopyList.push(
        new Particle({
          texture: atlas.canopies[variant],
          x,
          y,
          scaleX: k,
          scaleY: k,
          anchorX: atlas.anchorX,
          anchorY: atlas.anchorY,
          tint: (tint << 16) | (tint << 8) | tint,
        }),
      );
    }
    shadows.addParticle(...shadowList);
    canopies.addParticle(...canopyList);
    this.shadowContainer.addChild(shadows);
    this.canopyContainer.addChild(canopies);
    chunk.shadows = shadows;
    chunk.canopies = canopies;
    return chunk;
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
      this.dispose(old[i]);
    }
  }

  private dispose(c: TreeChunk): void {
    c.shadows?.destroy();
    c.canopies?.destroy();
  }
}
