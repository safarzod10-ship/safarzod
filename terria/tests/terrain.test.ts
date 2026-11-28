import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_NODES, FINEST_LEVEL, LODS, TREES, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld } from '../src/world/generation/generateWorld.ts';
import type { WorldFields } from '../src/world/generation/WorldFields.ts';
import { DEFAULT_WORLD_PARAMS } from '../src/world/generation/WorldParams.ts';
import { RegionIndex } from '../src/world/regions/regions.ts';
import { bakeChunk, bakeChunkSteps } from '../src/world/terrain/chunkBaker.ts';
import { placeTrees, TREE_STRIDE } from '../src/world/trees/treePlacement.ts';
import { createWorldQuery } from '../src/world/WorldQuery.ts';

const N = CHUNK_NODES;

describe('terrain chunks', () => {
  let world: WorldFields;
  let coast: { x: number; y: number };
  let river: { x: number; y: number };
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
    // a point on the west coast
    const y = world.meta.landBounds.y + world.meta.landBounds.height * 0.42;
    let x = 0;
    while (x < WORLD_SIZE && world.e.sample(x, y) <= 0) x += 32;
    coast = { x, y };
    // a point on a wide river well inland
    const s = world.rivers.segments;
    let best = 0;
    for (let i = 0; i < world.rivers.count; i++) {
      if (s[i * 6 + 2] > s[best * 6 + 2] && world.e.sample(s[i * 6], s[i * 6 + 1]) > 0.1) best = i;
    }
    river = { x: s[best * 6], y: s[best * 6 + 1] };
  });

  it('LOD table is consistent', () => {
    for (const lod of LODS) {
      expect(lod.chunkSize / lod.texel).toBe(N - 1);
      expect(WORLD_SIZE % lod.chunkSize).toBe(0);
    }
    expect(LODS[0].chunkSize * 4).toBe(WORLD_SIZE);
  });

  it('bakes deterministically', () => {
    const a = bakeChunk(world, 3, Math.floor(river.x / 4096), Math.floor(river.y / 4096));
    const b = bakeChunk(world, 3, Math.floor(river.x / 4096), Math.floor(river.y / 4096));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('time-sliced bake equals the direct one', () => {
    const size = LODS[FINEST_LEVEL].chunkSize;
    const cx = Math.floor(river.x / size);
    const cy = Math.floor(river.y / size);
    const direct = bakeChunk(world, FINEST_LEVEL, cx, cy);
    const it = bakeChunkSteps(world, FINEST_LEVEL, cx, cy);
    let r = it.next();
    let steps = 0;
    while (!r.done) {
      steps++;
      r = it.next();
    }
    expect(steps).toBeGreaterThan(4);
    expect(Buffer.from(r.value).equals(Buffer.from(direct))).toBe(true);
  });

  it('neighbouring chunks agree exactly along their shared edge (no seams), coast and river', () => {
    for (const point of [coast, river]) {
      for (let level = 0; level < LODS.length; level++) {
        const size = LODS[level].chunkSize;
        const cx = Math.floor(point.x / size);
        const cy = Math.floor(point.y / size);
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
    }
  });

  it('stores the waterline in alpha: land > 127, water < 128', () => {
    const size = LODS[FINEST_LEVEL].chunkSize;
    for (const point of [coast, river]) {
      const px = bakeChunk(world, FINEST_LEVEL, Math.floor(point.x / size), Math.floor(point.y / size));
      let land = 0;
      let water = 0;
      for (let k = 0; k < N * N; k++) {
        if (px[k * 4 + 3] > 127) land++;
        else water++;
      }
      expect(land).toBeGreaterThan(300);
      expect(water).toBeGreaterThan(300);
    }
  });

  it('the baked waterline agrees with WorldQuery.isLand', () => {
    const q = createWorldQuery(world);
    const lod = LODS[FINEST_LEVEL];
    const cx = Math.floor(river.x / lod.chunkSize);
    const cy = Math.floor(river.y / lod.chunkSize);
    const px = bakeChunk(world, FINEST_LEVEL, cx, cy);
    let agree = 0;
    let total = 0;
    for (let j = 0; j < N; j += 3) {
      for (let i = 0; i < N; i += 3) {
        const baked = px[(j * N + i) * 4 + 3] > 127;
        const asked = q.isLand(cx * lod.chunkSize + i * lod.texel, cy * lod.chunkSize + j * lod.texel);
        if (baked === asked) agree++;
        total++;
      }
    }
    expect(agree / total).toBeGreaterThan(0.995);
  });

  it('open ocean is blue, a region home is green dry land', () => {
    const ocean = bakeChunk(world, 0, 0, 0);
    expect(ocean[2]).toBeGreaterThan(ocean[0] + 60);
    const home = new RegionIndex(world.regions).info(0);
    const lod = LODS[FINEST_LEVEL];
    const cx = Math.floor(home.x / lod.chunkSize);
    const cy = Math.floor(home.y / lod.chunkSize);
    const land = bakeChunk(world, FINEST_LEVEL, cx, cy);
    const i = Math.round((home.x - cx * lod.chunkSize) / lod.texel);
    const j = Math.round((home.y - cy * lod.chunkSize) / lod.texel);
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

  it('answers land / buildable / region questions', () => {
    const q = createWorldQuery(world);
    const home = q.regions.info(123);
    expect(q.isLand(home.x, home.y)).toBe(true);
    expect(q.isBuildable(home.x, home.y)).toBe(true);
    expect(q.regionAt(home.x, home.y)?.id).toBe(123);
    expect(q.isLand(100, 100)).toBe(false);
    expect(q.isLand(-5, 100)).toBe(false);
    expect(q.regionAt(100, 100)).toBeNull();
    const b = world.meta.landBounds;
    expect(q.isAreaBuildable({ x: b.x - 2000, y: b.y + b.height / 2, width: 4000, height: 32 })).toBe(false);
  });

  it('places trees deterministically, on dry land, sorted by y, denser in forests', () => {
    const q = createWorldQuery(world);
    const size = TREES.chunkSize;
    let forestChunk: [number, number] | null = null;
    let openChunk: [number, number] | null = null;
    for (let id = 0; id < q.regions.count && !(forestChunk && openChunk); id++) {
      const h = q.regions.info(id);
      const cx = Math.floor(h.x / size);
      const cy = Math.floor(h.y / size);
      const f = q.forestDensity((cx + 0.5) * size, (cy + 0.5) * size);
      if (f > 0.9 && !forestChunk) forestChunk = [cx, cy];
      if (f < 0.05 && !openChunk) openChunk = [cx, cy];
    }
    expect(forestChunk).not.toBeNull();
    expect(openChunk).not.toBeNull();
    const forest = placeTrees(world, forestChunk![0], forestChunk![1]);
    const open = placeTrees(world, openChunk![0], openChunk![1]);
    expect(forest.length / TREE_STRIDE).toBeGreaterThan(1500);
    expect(open.length / TREE_STRIDE).toBeLessThan(forest.length / TREE_STRIDE / 5);
    for (const t of [forest, open]) {
      for (let i = 0; i < t.length; i += TREE_STRIDE) {
        expect(q.isLand(t[i], t[i + 1])).toBe(true);
        if (i > 0) expect(t[i + 1]).toBeGreaterThanOrEqual(t[i + 1 - TREE_STRIDE]);
      }
    }
    expect(Array.from(placeTrees(world, forestChunk![0], forestChunk![1]))).toEqual(Array.from(forest));
  });
});
