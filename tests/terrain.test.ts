import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_NODES, LODS, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld } from '../src/world/generation/generateWorld.ts';
import type { WorldFields } from '../src/world/generation/WorldFields.ts';
import { DEFAULT_WORLD_PARAMS } from '../src/world/generation/WorldParams.ts';
import { bakeChunk, bakeChunkSteps } from '../src/world/terrain/chunkBaker.ts';
import { placeTrees, TREE_STRIDE } from '../src/world/trees/treePlacement.ts';
import { createWorldQuery } from '../src/world/WorldQuery.ts';

const N = CHUNK_NODES;

describe('terrain chunks', () => {
  let world: WorldFields;
  let coast: { x: number; y: number };
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
    // a point on the west coast
    const y = world.meta.landBounds.y + world.meta.landBounds.height * 0.42;
    let x = 0;
    while (x < WORLD_SIZE && world.e.sample(x, y) <= 0) x += 4;
    coast = { x, y };
  });

  it('LOD table is consistent', () => {
    for (const lod of LODS) {
      expect(lod.chunkSize / lod.texel).toBe(N - 1);
      expect(WORLD_SIZE % lod.chunkSize).toBe(0);
    }
  });

  it('bakes deterministically', () => {
    const a = bakeChunk(world, 2, 6, 8);
    const b = bakeChunk(world, 2, 6, 8);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('time-sliced bake equals the direct one', () => {
    const direct = bakeChunk(world, 3, Math.floor(coast.x / 512), Math.floor(coast.y / 512));
    const it = bakeChunkSteps(world, 3, Math.floor(coast.x / 512), Math.floor(coast.y / 512));
    let r = it.next();
    let steps = 0;
    while (!r.done) {
      steps++;
      r = it.next();
    }
    expect(steps).toBeGreaterThan(4);
    expect(Buffer.from(r.value).equals(Buffer.from(direct))).toBe(true);
  });

  it('neighbouring chunks agree exactly along their shared edge (no seams)', () => {
    for (const level of [0, 1, 2, 3]) {
      const size = LODS[level].chunkSize;
      const cx = Math.floor(coast.x / size);
      const cy = Math.floor(coast.y / size);
      const left = bakeChunk(world, level, cx, cy);
      const right = bakeChunk(world, level, cx + 1, cy);
      const below = bakeChunk(world, level, cx, cy + 1);
      for (let j = 0; j < N; j++) {
        for (let c = 0; c < 4; c++) {
          expect(left[(j * N + (N - 1)) * 4 + c], `L${level} vertical edge`).toBe(right[j * N * 4 + c]);
          expect(left[((N - 1) * N + j) * 4 + c], `L${level} horizontal edge`).toBe(below[j * 4 + c]);
        }
      }
    }
  });

  it('stores the waterline in alpha: land > 127, water < 128', () => {
    const size = LODS[3].chunkSize;
    const cx = Math.floor(coast.x / size);
    const cy = Math.floor(coast.y / size);
    const px = bakeChunk(world, 3, cx, cy);
    let land = 0;
    let water = 0;
    for (let k = 0; k < N * N; k++) {
      if (px[k * 4 + 3] > 127) land++;
      else water++;
    }
    expect(land).toBeGreaterThan(500);
    expect(water).toBeGreaterThan(500);
  });

  it('open ocean is blue, open land is green', () => {
    const ocean = bakeChunk(world, 0, 0, 0);
    expect(ocean[2]).toBeGreaterThan(ocean[0] + 60);
    const b = world.meta.landBounds;
    const size = LODS[0].chunkSize;
    const mx = b.x + b.width / 2;
    const my = b.y + b.height / 2;
    const land = bakeChunk(world, 0, Math.floor(mx / size), Math.floor(my / size));
    const i = Math.round((mx % size) / LODS[0].texel);
    const j = Math.round((my % size) / LODS[0].texel);
    const o = (j * N + i) * 4;
    expect(land[o + 1]).toBeGreaterThan(land[o + 2]);
    expect(land[o + 3]).toBe(255);
  });
});

describe('world query and trees', () => {
  let world: WorldFields;
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
  });

  it('answers land / buildable questions', () => {
    const q = createWorldQuery(world);
    const b = world.meta.landBounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    expect(q.isLand(cx, cy)).toBe(true);
    expect(q.isBuildable(cx, cy)).toBe(true);
    expect(q.isAreaBuildable({ x: cx - 64, y: cy - 64, width: 128, height: 128 })).toBe(true);
    expect(q.isLand(100, 100)).toBe(false);
    expect(q.isLand(-5, 100)).toBe(false);
    expect(q.isAreaBuildable({ x: b.x - 200, y: cy, width: 400, height: 32 })).toBe(false);
  });

  it('places trees deterministically, on land, sorted by y', () => {
    let total = 0;
    for (let cy = 0; cy < 16; cy++) {
      for (let cx = 0; cx < 16; cx++) {
        const t = placeTrees(world, cx, cy);
        total += t.length / TREE_STRIDE;
        for (let i = 0; i < t.length; i += TREE_STRIDE) {
          expect(world.e.sample(t[i], t[i + 1])).toBeGreaterThan(0);
          if (i > 0) expect(t[i + 1]).toBeGreaterThanOrEqual(t[i + 1 - TREE_STRIDE]);
        }
      }
    }
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(40000);
    const a = placeTrees(world, 6, 8);
    const b = placeTrees(world, 6, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
