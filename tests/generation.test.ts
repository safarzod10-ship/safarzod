import { beforeAll, describe, expect, it } from 'vitest';
import { FOG, GRID_NODES, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld, generateWorldSteps } from '../src/world/generation/generateWorld.ts';
import { COARSE_NODES, type WorldFields } from '../src/world/generation/WorldFields.ts';
import { DEFAULT_WORLD_PARAMS, normalizeWorldParams } from '../src/world/generation/WorldParams.ts';

function fnv(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function landComponents(world: WorldFields): { land: number; water: number } {
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

describe('world generation', () => {
  let world: WorldFields;
  beforeAll(() => {
    world = generateWorld(DEFAULT_WORLD_PARAMS);
  });

  it('is deterministic: the same seed gives bit-identical fields', () => {
    const again = generateWorld(DEFAULT_WORLD_PARAMS);
    expect(fnv(again.e.data)).toBe(fnv(world.e.data));
    expect(fnv(again.relief.data)).toBe(fnv(world.relief.data));
    expect(fnv(again.forest.data)).toBe(fnv(world.forest.data));
    expect(fnv(again.coastDist.data)).toBe(fnv(world.coastDist.data));
    expect(again.meta.landBounds).toEqual(world.meta.landBounds);
  });

  it('matches the pinned fingerprint of the canonical world', () => {
    // If this fails the generator changed and every existing map changes with
    // it. Only update the snapshot together with GENERATOR_VERSION.
    expect({
      e: fnv(world.e.data),
      relief: fnv(world.relief.data),
      forest: fnv(world.forest.data),
      landBounds: world.meta.landBounds,
    }).toMatchSnapshot();
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
    expect(fnv(result!.e.data)).toBe(fnv(world.e.data));
  });

  it('produces exactly one landmass and no inland water', () => {
    expect(landComponents(world)).toEqual({ land: 1, water: 1 });
  });

  it('keeps the continent away from the edge of the world', () => {
    const b = world.meta.landBounds;
    const margin = Math.min(b.x, b.y, WORLD_SIZE - (b.x + b.width), WORLD_SIZE - (b.y + b.height));
    expect(margin).toBeGreaterThan(FOG.end);
  });

  it('is fully fogged along the border of the world', () => {
    const n = COARSE_NODES;
    const d = world.coastDist.data;
    for (let i = 0; i < n; i++) {
      for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
        expect(d[k]).toBeGreaterThanOrEqual(FOG.range);
      }
    }
  });

  it('leaves most of the land open for building', () => {
    expect(world.meta.buildableFraction).toBeGreaterThan(0.85);
    expect(world.meta.forestFraction).toBeLessThan(0.1);
    expect(world.meta.landFraction).toBeGreaterThan(0.08);
  });

  it('holds the same guarantees for other seeds', () => {
    for (const seed of [1, 7, 424242, 0xdeadbeef]) {
      const w = generateWorld({ ...DEFAULT_WORLD_PARAMS, seed });
      expect(landComponents(w), `seed ${seed}`).toEqual({ land: 1, water: 1 });
      const b = w.meta.landBounds;
      const margin = Math.min(b.x, b.y, WORLD_SIZE - (b.x + b.width), WORLD_SIZE - (b.y + b.height));
      expect(margin, `seed ${seed}`).toBeGreaterThan(FOG.end);
      expect(w.meta.buildableFraction, `seed ${seed}`).toBeGreaterThan(0.8);
    }
  });
});

describe('world params', () => {
  it('falls back to defaults on bad or outdated input', () => {
    expect(normalizeWorldParams(null)).toEqual(DEFAULT_WORLD_PARAMS);
    expect(normalizeWorldParams({ version: 99 as never, seed: 5 })).toEqual(DEFAULT_WORLD_PARAMS);
  });

  it('keeps valid stored values and clamps the rest', () => {
    const p = normalizeWorldParams({ ...DEFAULT_WORLD_PARAMS, seed: 77, radiusX: 99999 });
    expect(p.seed).toBe(77);
    expect(p.radiusX).toBeLessThanOrEqual(4600);
  });
});
