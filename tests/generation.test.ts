import { beforeAll, describe, expect, it } from 'vitest';
import { FOG, GRID_NODES, REGION_COUNT, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld, generateWorldSteps } from '../src/world/generation/generateWorld.ts';
import { COARSE_NODES, type WorldFields } from '../src/world/generation/WorldFields.ts';
import { DEFAULT_WORLD_PARAMS, normalizeWorldParams } from '../src/world/generation/WorldParams.ts';
import { RegionIndex } from '../src/world/regions/regions.ts';
import { createWorldQuery } from '../src/world/WorldQuery.ts';

function fnv(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Connected components of land and of water on the base grid. */
function components(world: WorldFields): { land: number; water: number } {
  const n = GRID_NODES;
  const e = world.e.data;
  const seen = new Uint8Array(n * n);
  const stack = new Int32Array(n * n);
  let land = 0;
  let water = 0;
  for (let start = 0; start < n * n; start++) {
    if (seen[start]) continue;
    const isLand = e[start] > 0;
    if (isLand) land++;
    else water++;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const c = stack[--top];
      const x = c % n;
      const y = (c - x) / n;
      const visit = (k: number): void => {
        if (!seen[k] && e[k] > 0 === isLand) {
          seen[k] = 1;
          stack[top++] = k;
        }
      };
      if (x > 0) visit(c - 1);
      if (x < n - 1) visit(c + 1);
      if (y > 0) visit(c - n);
      if (y < n - 1) visit(c + n);
    }
  }
  return { land, water };
}

function fingerprint(w: WorldFields): Record<string, unknown> {
  return {
    e: fnv(w.e.data),
    forest: fnv(w.forest.data),
    rivers: fnv(w.rivers.segments),
    lakes: fnv(w.lakes),
    regionSites: fnv(w.regions.sites),
    regionHomes: fnv(w.regions.homes),
    regionBorders: fnv(w.regions.borders),
    landBounds: w.meta.landBounds,
  };
}

describe('world generation', () => {
  let world: WorldFields;
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
  });

  it('is deterministic: the same seed gives a bit-identical world', () => {
    const again = generateWorld(DEFAULT_WORLD_PARAMS);
    expect(fingerprint(again)).toEqual(fingerprint(world));
    expect(fnv(again.coastDist.data)).toBe(fnv(world.coastDist.data));
  });

  it('matches the pinned fingerprint of the canonical world', () => {
    // If this fails the generator changed and every existing map changes with
    // it. Only update the snapshot together with GENERATOR_VERSION.
    expect(fingerprint(world)).toMatchSnapshot();
  });

  it('gives a different continent for a different seed', () => {
    const other = generateWorld({ ...DEFAULT_WORLD_PARAMS, seed: 12345 });
    expect(fnv(other.e.data)).not.toBe(fnv(world.e.data));
  });

  it('time-sliced generation equals the direct one', () => {
    const it = generateWorldSteps(DEFAULT_WORLD_PARAMS);
    let last = 0;
    let result: WorldFields | undefined;
    for (;;) {
      const r = it.next();
      if (r.done) {
        result = r.value;
        break;
      }
      expect(r.value).toBeGreaterThanOrEqual(last);
      last = r.value;
    }
    expect(fingerprint(result!)).toEqual(fingerprint(world));
  });

  it('produces exactly one landmass (lakes are allowed, islands are not)', () => {
    const c = components(world);
    expect(c.land).toBe(1);
    expect(c.water).toBeGreaterThan(1);
  });

  it('is continent sized', () => {
    const m = world.meta;
    expect(m.landArea / 1e6).toBeGreaterThan(1500); // km^2
    expect(m.landBounds.width).toBeGreaterThan(40000);
    expect(m.landBounds.height).toBeGreaterThan(50000);
  });

  it('keeps the continent away from the edge of the world', () => {
    const b = world.meta.landBounds;
    const margin = Math.min(b.x, b.y, WORLD_SIZE - (b.x + b.width), WORLD_SIZE - (b.y + b.height));
    expect(margin).toBeGreaterThan(FOG.end);
  });

  it('is fully fogged along the border of the world, and never over land or lakes', () => {
    const n = COARSE_NODES;
    const d = world.coastDist.data;
    for (let i = 0; i < n; i++) {
      for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
        expect(d[k]).toBeGreaterThanOrEqual(FOG.range);
      }
    }
    for (let l = 0; l < world.lakes.length; l += 3) {
      expect(world.coastDist.sample(world.lakes[l], world.lakes[l + 1])).toBeLessThan(FOG.start - FOG.wisp / 2);
    }
  });

  it('has rivers and lakes', () => {
    expect(world.meta.lakeCount).toBeGreaterThan(10);
    expect(world.meta.riverLength / 1000).toBeGreaterThan(150); // km
    // lake centres are water, and surrounded by land
    for (let l = 0; l < world.lakes.length; l += 3) {
      expect(world.e.sample(world.lakes[l], world.lakes[l + 1])).toBeLessThan(0);
    }
    // every river segment has a positive width and finite coordinates
    const s = world.rivers.segments;
    for (let o = 0; o < s.length; o += 6) {
      expect(s[o + 2]).toBeGreaterThan(0);
      expect(Number.isFinite(s[o] + s[o + 1] + s[o + 3] + s[o + 4])).toBe(true);
    }
  });

  it('rivers are water for every query', () => {
    const q = createWorldQuery(world);
    const s = world.rivers.segments;
    let checked = 0;
    for (let i = 0; i < world.rivers.count; i += 97) {
      const x = (s[i * 6] + s[i * 6 + 3]) / 2;
      const y = (s[i * 6 + 1] + s[i * 6 + 4]) / 2;
      expect(q.isLand(x, y)).toBe(false);
      expect(q.riverDistance(x, y)).toBeLessThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('is a mix of forest and open country, mostly buildable', () => {
    expect(world.meta.buildableFraction).toBeGreaterThan(0.9);
    expect(world.meta.forestFraction).toBeGreaterThan(0.15);
    expect(world.meta.forestFraction).toBeLessThan(0.45);
  });

  it('holds the same guarantees for other seeds', () => {
    for (const seed of [1, 424242, 0xdeadbeef]) {
      const w = generateWorld({ ...DEFAULT_WORLD_PARAMS, seed });
      expect(components(w).land, `seed ${seed}`).toBe(1);
      const b = w.meta.landBounds;
      const margin = Math.min(b.x, b.y, WORLD_SIZE - (b.x + b.width), WORLD_SIZE - (b.y + b.height));
      expect(margin, `seed ${seed}`).toBeGreaterThan(FOG.end);
      expect(w.meta.regionCount, `seed ${seed}`).toBe(REGION_COUNT);
      expect(w.meta.regionAreaMin, `seed ${seed}`).toBeGreaterThan(0.4 * w.meta.regionAreaAvg);
      expect(w.meta.lakeCount, `seed ${seed}`).toBeGreaterThan(5);
    }
  });
});

describe('player regions', () => {
  let world: WorldFields;
  let index: RegionIndex;
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
    index = new RegionIndex(world.regions);
  });

  it('divides the land into exactly 1000 regions of similar size', () => {
    const m = world.meta;
    expect(index.count).toBe(REGION_COUNT);
    expect(m.regionCount).toBe(1000);
    let sum = 0;
    for (const a of world.regions.areas) sum += a;
    expect(sum).toBeCloseTo(m.landArea, -3); // every land node belongs to one region
    expect(m.regionAreaMin).toBeGreaterThan(0.55 * m.regionAreaAvg);
    expect(m.regionAreaMax).toBeLessThan(1.6 * m.regionAreaAvg);
    expect(m.regionAreaAvg / 1e6).toBeGreaterThan(1.5); // km^2: each region is big
  });

  it('gives every region a dry home inside itself and a buildable starter plot', () => {
    const q = createWorldQuery(world);
    let plotsOk = 0;
    for (let id = 0; id < index.count; id++) {
      const info = index.info(id);
      expect(q.isBuildable(info.x, info.y), `home of region ${id}`).toBe(true);
      expect(index.regionAt(info.x, info.y), `home of region ${id}`).toBe(id);
      const p = info.starterPlot;
      // 1% of the region, as a square
      expect(p.width * p.height).toBeGreaterThan(0.007 * info.area);
      expect(p.width * p.height).toBeLessThan(0.013 * info.area);
      if (q.isAreaBuildable(p)) plotsOk++;
    }
    expect(plotsOk / index.count).toBeGreaterThan(0.97);
  });

  it('exposes outlines and neighbours', () => {
    const poly = index.polygon(417);
    expect(poly.length).toBeGreaterThanOrEqual(8);
    expect(poly[0]).toBe(poly[poly.length - 2]); // closed ring
    const nb = index.neighbors(417);
    expect(nb.length).toBeGreaterThanOrEqual(3);
    expect(nb).not.toContain(417);
  });

  it('keeps borders on land', () => {
    const b = world.regions.borders;
    expect(b.length / 7).toBeGreaterThan(2000);
    for (let o = 0; o < b.length; o += 7 * 13) {
      const mx = (b[o] + b[o + 2]) / 2;
      const my = (b[o + 1] + b[o + 3]) / 2;
      expect(world.e.sample(mx, my)).toBeGreaterThan(-0.01);
    }
  });
});

describe('world params', () => {
  it('falls back to defaults on bad or outdated input', () => {
    expect(normalizeWorldParams(null)).toEqual(DEFAULT_WORLD_PARAMS);
    expect(normalizeWorldParams({ version: 1 as never, seed: 5 })).toEqual(DEFAULT_WORLD_PARAMS);
  });

  it('keeps valid stored values and clamps the rest', () => {
    const p = normalizeWorldParams({ ...DEFAULT_WORLD_PARAMS, seed: 77, radiusX: 9999999 });
    expect(p.seed).toBe(77);
    expect(p.radiusX).toBeLessThanOrEqual(36000);
  });
});
