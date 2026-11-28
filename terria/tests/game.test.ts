import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromB64, getBit, toB64 } from '../src/game/bits.ts';
import { BUILDINGS } from '../src/game/config.ts';
import { driftRef, partialTotal } from '../src/game/market.ts';
import {
  advance,
  applyAction,
  builderCount,
  cityStats,
  decodeMask,
  landCost,
  newCity,
  ownedBits,
  placementError,
  type RegionMask,
} from '../src/game/rules.ts';
import type { RegionMaskDTO } from '../src/game/types.ts';

const HOUR = 3_600_000;
const maskPath = 'public/regions/0.json';
const haveMasks = existsSync(maskPath);

function mask(id = 0): RegionMask {
  return decodeMask(JSON.parse(readFileSync(`public/regions/${id}.json`, 'utf8')) as RegionMaskDTO);
}

/** First free owned spot for a building of type t. */
function spot(c: ReturnType<typeof newCity>, m: RegionMask, t: keyof typeof BUILDINGS): { x: number; y: number } | null {
  for (let y = m.y0; y < m.y0 + m.h; y++)
    for (let x = m.x0; x < m.x0 + m.w; x++) if (!placementError(c, m, t, x, y)) return { x, y };
  return null;
}

describe('bits', () => {
  it('round-trips base64', () => {
    const b = new Uint8Array([0, 1, 2, 250, 255, 7, 9]);
    for (let n = 0; n <= b.length; n++) expect([...fromB64(toB64(b.slice(0, n)))]).toEqual([...b.slice(0, n)]);
  });
});

describe.skipIf(!haveMasks)('city rules', () => {
  it('starts with ~1 % of the region and a town hall', () => {
    const m = mask();
    const c = newCity(0, 'Тест', m, 0);
    expect(c.ownedCount / m.cells).toBeGreaterThan(0.007);
    expect(c.ownedCount / m.cells).toBeLessThan(0.015);
    const owned = ownedBits(c, m);
    const hall = c.buildings[0];
    for (let y = hall.y; y < hall.y + 4; y++) for (let x = hall.x; x < hall.x + 4; x++) expect(getBit(owned, (y - m.y0) * m.w + (x - m.x0))).toBe(true);
  });

  it('builds, finishes on time and produces', () => {
    const m = mask();
    const c = newCity(0, 'Тест', m, 0);
    const p = spot(c, m, 'sawmill')!;
    expect(applyAction(c, { type: 'build', t: 'sawmill', ...p }, m, 0)).toEqual({ ok: true });
    expect(applyAction(c, { type: 'build', t: 'sawmill', ...p }, m, 0)).toEqual({ ok: false, error: 'occupied' });
    const wood0 = c.res.wood;
    advance(c, 3 * HOUR, m);
    expect(c.buildings[1].lvl).toBe(1);
    expect(c.res.wood).toBeGreaterThan(wood0);
  });

  it('respects builders and money', () => {
    const m = mask();
    const c = newCity(0, 'Тест', m, 0);
    let ok = 0;
    for (let i = 0; i < 5; i++) {
      const p = spot(c, m, 'house');
      if (p && applyAction(c, { type: 'build', t: 'house', ...p }, m, 0).ok) ok++;
    }
    expect(ok).toBe(builderCount(c));
  });

  it('caps offline production at 12 hours and never kills the city', () => {
    const m = mask();
    const c = newCity(0, 'Тест', m, 0);
    c.res.coins = 0;
    c.res.food = 0;
    advance(c, 30 * 24 * HOUR, m);
    expect(c.pop).toBeGreaterThanOrEqual(10);
    const s = cityStats(c, m);
    expect(c.res.coins).toBeLessThanOrEqual(s.income.net * 12 + 1);
  });

  it('sells land only next to the city', () => {
    const m = mask();
    const c = newCity(0, 'Тест', m, 0);
    const owned = ownedBits(c, m);
    // a free buildable cell touching the plot
    let edge = -1;
    let far = -1;
    for (let i = 0; i < m.w * m.h && (edge < 0 || far < 0); i++) {
      if (!getBit(m.build, i) || getBit(owned, i)) continue;
      const x = i % m.w;
      const touch = (x > 0 && getBit(owned, i - 1)) || (x < m.w - 1 && getBit(owned, i + 1)) || getBit(owned, i - m.w) || getBit(owned, i + m.w);
      if (touch && edge < 0) edge = i;
      if (!touch && far < 0 && Math.abs((i - (i % m.w)) / m.w - (m.hall.y - m.y0)) > 20) far = i;
    }
    expect(applyAction(c, { type: 'land', cells: [far], pay: 'coins' }, m, 0)).toEqual({ ok: false, error: 'not_adjacent' });
    const before = c.res.coins;
    expect(applyAction(c, { type: 'land', cells: [edge], pay: 'coins' }, m, 0)).toEqual({ ok: true });
    expect(before - c.res.coins).toBe(landCost(c.ownedCount - 1, m.cells, 1));
  });
});

describe('market maths', () => {
  it('never lets one trade move the price far', () => {
    expect(driftRef('wood', 1, 0.0002, 5000)).toBeGreaterThan(0.75);
    expect(driftRef('wood', 1, 1000, 5000)).toBeLessThan(1.35);
  });
  it('splits escrow without creating coins', () => {
    let left = 1;
    let paid = 0;
    for (let i = 0; i < 5000; i += 1000) paid += partialTotal(1, 5000, 1000);
    left -= paid;
    expect(left).toBeGreaterThanOrEqual(0);
  });
});
