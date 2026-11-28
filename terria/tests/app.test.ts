import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiError, Api, type Transport } from '../src/app/api.ts';
import { duration, num, plural } from '../src/app/dom.ts';
import { Store } from '../src/app/store.ts';
import { BUILDINGS } from '../src/game/config.ts';
import { applyBatch, decodeMask, newCity, placementError, type RegionMask } from '../src/game/rules.ts';
import type { Action, CityState, RegionMaskDTO } from '../src/game/types.ts';

const haveMasks = existsSync('public/regions/0.json');
const dto = (): RegionMaskDTO => JSON.parse(readFileSync('public/regions/0.json', 'utf8')) as RegionMaskDTO;

/** A server that applies batches with the shared rules, can drop the network once, and counts calls. */
class FakeServer implements Transport {
  city: CityState;
  mask: RegionMask;
  calls: { op: string; actions: Action[] }[] = [];
  failNext = 0;
  constructor() {
    this.mask = decodeMask(dto());
    this.city = newCity(0, 'Тест', this.mask, Date.now());
  }
  async region(): Promise<RegionMaskDTO> {
    return dto();
  }
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (path === '/api/me') return { user: { id: 1, name: 'T' }, city: structuredClone(this.city), serverTime: Date.now(), full: false, freeRegions: 1 } as T;
    if (path === '/api/city/actions') {
      const b = body as { op: string; actions: Action[] };
      this.calls.push(b);
      if (this.failNext > 0) {
        this.failNext--;
        throw new TypeError('network down');
      }
      if (this.city.ops.includes(b.op)) return { city: structuredClone(this.city), serverTime: Date.now(), results: [] } as T;
      const results = applyBatch(this.city, b.actions, this.mask, Date.now());
      this.city.ops.push(b.op);
      return { city: structuredClone(this.city), serverTime: Date.now(), results } as T;
    }
    throw new ApiError(404, 'bad_request', `${method} ${path}`);
  }
}

function freeSpot(c: CityState, m: RegionMask, t: keyof typeof BUILDINGS): { x: number; y: number } {
  for (let y = m.y0; y < m.y0 + m.h; y++)
    for (let x = m.x0; x < m.x0 + m.w; x++) if (!placementError(c, m, t, x, y)) return { x, y };
  throw new Error('no spot');
}

describe('formatting', () => {
  it('formats numbers and plurals in Russian', () => {
    expect(num(19392)).toMatch(/19,4\s?тыс\./);
    expect(plural(1, 'клетка', 'клетки', 'клеток')).toBe('клетка');
    expect(plural(3, 'клетка', 'клетки', 'клеток')).toBe('клетки');
    expect(plural(12, 'клетка', 'клетки', 'клеток')).toBe('клеток');
    expect(duration(90 * 60_000)).toBe('1 ч 30 мин');
  });
});

describe.skipIf(!haveMasks)('store', () => {
  it('predicts locally and sends one batch for several actions', async () => {
    const server = new FakeServer();
    const store = new Store(new Api(server, true));
    await store.refresh();
    const c = store.city!;
    const p = freeSpot(c, store.mask!, 'sawmill');
    expect(store.act({ type: 'build', t: 'sawmill', ...p }).ok).toBe(true);
    // the prediction already shows it
    expect(store.city!.buildings.length).toBe(2);
    const q = freeSpot(store.city!, store.mask!, 'quarry');
    expect(store.act({ type: 'build', t: 'quarry', ...q }).ok).toBe(true);
    await store.flush();
    expect(server.calls.length).toBe(1);
    expect(server.calls[0].actions.length).toBe(2);
    expect(store.city!.buildings.length).toBe(3);
    expect(server.city.buildings.length).toBe(3);
  });

  it('refuses what the rules refuse without calling the server', async () => {
    const server = new FakeServer();
    const store = new Store(new Api(server, true));
    await store.refresh();
    const r = store.act({ type: 'build', t: 'mine', x: 0, y: 0 });
    expect(r.ok).toBe(false);
    await store.flush();
    expect(server.calls.length).toBe(0);
  });

  it('retries a lost batch with the same op and applies it once', async () => {
    const server = new FakeServer();
    const store = new Store(new Api(server, true));
    await store.refresh();
    server.failNext = 1;
    const p = freeSpot(store.city!, store.mask!, 'sawmill');
    store.act({ type: 'build', t: 'sawmill', ...p });
    await store.flush(); // first attempt fails, a retry is scheduled
    await new Promise((r) => setTimeout(r, 1700));
    expect(server.calls.length).toBe(2);
    expect(server.calls[0].op).toBe(server.calls[1].op);
    expect(server.city.buildings.filter((b) => b.t === 'sawmill').length).toBe(1);
    expect(store.pending).toBe(false);
  });
});
