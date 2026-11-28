/**
 * Dev-only in-browser stand-in for the Worker (`?mock`, `?mock=demo` for a
 * grown city, `?mock=reset` to start over). Implements the same endpoints on
 * top of the shared rules and keeps state in localStorage. Never used in
 * production builds unless the URL asks for it.
 */
import { BUILDINGS, CRYSTAL_PACKS, GOODS, MARKET, type BuildingType, type Good } from '../game/config.ts';
import { getBit, setBit, toB64 } from '../game/bits.ts';
import { driftRef, driftSystem, partialTotal, quote, systemQuota } from '../game/market.ts';
import {
  advance,
  applyBatch,
  decodeMask,
  newCity,
  ownedBits,
  placementError,
  type RegionMask,
} from '../game/rules.ts';
import type {
  Action,
  CityState,
  MarketResponse,
  MeResponse,
  Order,
  PublicCity,
  RegionMaskDTO,
  Trade,
  WorldCitySummary,
} from '../game/types.ts';
import { ApiError, type Transport } from './api.ts';

const KEY = 'terria-mock-v1';
const HOUR = 3_600_000;
const NPC_NAMES = [
  'Каменный Брод', 'Новоград', 'Тихая Гавань', 'Ольховка', 'Сосновый Мыс', 'Белые Пески', 'Ясная Поляна', 'Медовка',
  'Северный Кряж', 'Ветряки', 'Озёрный', 'Зелёный Дол', 'Красный Берег', 'Липецкий Хутор', 'Солнечный', 'Дубрава',
  'Рыбачий', 'Горный Ключ', 'Полынь', 'Светлояр', 'Камышин', 'Верхние Луга', 'Ковыль', 'Росток',
];

interface MockDb {
  city: CityState | null;
  crystals: number;
  orders: Order[];
  trades: Trade[];
  prices: Record<Good, number>;
  nextOrder: number;
  npc: { r: number; n: string; th: number; pop: number }[];
}

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class MockTransport implements Transport {
  private db: MockDb;
  private readonly masks = new Map<number, RegionMask>();
  private readonly dtos = new Map<number, RegionMaskDTO>();
  private readonly mode: string;
  private readonly regionId: number;
  private npcCities = new Map<number, PublicCity>();

  constructor(mode: string) {
    this.mode = mode;
    const q = new URLSearchParams(location.search);
    this.regionId = Number(q.get('region') ?? 412);
    let saved: MockDb | null = null;
    try {
      if (mode !== 'reset' && mode !== 'demo' && mode !== 'new') saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      saved = null;
    }
    this.db = saved ?? this.freshDb();
  }

  private freshDb(): MockDb {
    const prices = {} as Record<Good, number>;
    for (const g of GOODS) prices[g] = MARKET.base[g];
    const npc: MockDb['npc'] = [];
    for (let i = 0; i < 160; i++) {
      const r = Math.floor(hash(i * 7 + 3) * 1000);
      if (r === this.regionId || npc.some((c) => c.r === r)) continue;
      const th = 1 + Math.floor(hash(i * 13 + 1) * 5);
      npc.push({ r, n: NPC_NAMES[i % NPC_NAMES.length], th, pop: Math.round(20 + th * th * 90 * hash(i + 99)) });
    }
    // neighbours of the player's region, so the map around it feels alive
    for (const d of [-1, 1, -2, 2, 3]) {
      const r = this.regionId + d;
      if (!npc.some((c) => c.r === r)) npc.push({ r, n: NPC_NAMES[(r * 7) % NPC_NAMES.length], th: 2 + (r % 3), pop: 300 + (r % 7) * 90 });
    }
    const now = Date.now();
    const orders: Order[] = [];
    let id = 1;
    for (const g of GOODS) {
      for (let k = 0; k < 5; k++) {
        const side = k % 2 === 0 ? 'buy' : 'sell';
        const qty = [500, 1200, 5000, 300, 2500][k];
        const unit = MARKET.base[g] * (side === 'buy' ? 0.8 + 0.08 * k : 1.05 + 0.1 * k);
        const c = npc[(k * 5 + g.length) % npc.length];
        orders.push({
          id: id++, regionId: c.r, cityName: c.n, side, res: g, qty, remaining: qty, total: Math.round(qty * unit),
          createdAt: now - k * 5 * HOUR, expiresAt: now + (72 - k * 5) * HOUR, status: 'open',
        });
      }
    }
    orders.push({ id: id++, regionId: npc[0].r, cityName: npc[0].n, side: 'buy', res: 'wood', qty: 5000, remaining: 5000, total: 1, createdAt: now - HOUR, expiresAt: now + 71 * HOUR, status: 'open' });
    const trades: Trade[] = [];
    for (let i = 0; i < 12; i++) {
      const g = GOODS[i % GOODS.length];
      trades.push({ id: i + 1, res: g, qty: 100 + i * 70, unit: MARKET.base[g] * (0.9 + hash(i) * 0.3), at: now - i * 37 * 60_000, kind: i % 3 ? 'exchange' : 'system' });
    }
    return { city: null, crystals: 0, orders, trades, prices, nextOrder: id, npc };
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch {
      /* storage may be unavailable */
    }
  }

  async region(id: number): Promise<RegionMaskDTO> {
    const hit = this.dtos.get(id);
    if (hit) return hit;
    const res = await fetch(`./regions/${id}.json`);
    if (!res.ok) throw new ApiError(res.status, 'region', 'Нет файла участка: запустите npm run regions');
    const dto = (await res.json()) as RegionMaskDTO;
    this.dtos.set(id, dto);
    this.masks.set(id, decodeMask(dto));
    return dto;
  }

  private async mask(id: number): Promise<RegionMask> {
    await this.region(id);
    return this.masks.get(id)!;
  }

  private me(): MeResponse {
    const c = this.db.city;
    if (c) {
      advance(c, Date.now(), this.masks.get(c.regionId) ?? null);
      c.crystals = this.db.crystals;
    }
    return { user: { id: 1, name: 'Мэр' }, city: c, serverTime: Date.now(), full: false, freeRegions: 1000 - this.db.npc.length - (c ? 1 : 0) };
  }

  private city(): CityState {
    const c = this.db.city;
    if (!c) throw new ApiError(404, 'no_city', 'У вас ещё нет города');
    advance(c, Date.now(), this.masks.get(c.regionId) ?? null);
    return c;
  }

  private done(): { city: CityState; serverTime: number } {
    const c = this.db.city!;
    c.crystals = this.db.crystals;
    this.save();
    return { city: structuredClone(c), serverTime: Date.now() };
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 90)); // network-ish
    const b = (body ?? {}) as Record<string, unknown>;
    const url = new URL(path, location.origin);
    const p = url.pathname;
    const now = Date.now();
    if (this.db.city && !this.masks.has(this.db.city.regionId)) await this.mask(this.db.city.regionId);

    if (method === 'GET' && p === '/api/me') {
      if (this.mode === 'demo' && !this.db.city) await this.seedDemo();
      return structuredClone(this.me()) as T;
    }
    if (method === 'POST' && p === '/api/city') {
      if (!this.db.city) {
        const m = await this.mask(this.regionId);
        this.db.city = newCity(this.regionId, String(b.name ?? ''), m, now);
        this.save();
      }
      return structuredClone(this.me()) as T;
    }
    if (method === 'POST' && p === '/api/city/actions') {
      const c = this.city();
      const op = String(b.op);
      if (c.ops.includes(op)) return { ...this.done(), results: [] } as T;
      c.crystals = this.db.crystals;
      const results = applyBatch(c, b.actions as Action[], this.masks.get(c.regionId)!, now);
      this.db.crystals = c.crystals;
      c.ops = [...c.ops.slice(-31), op];
      return { ...this.done(), results } as T;
    }
    if (method === 'GET' && p === '/api/world') {
      const cities: WorldCitySummary[] = this.db.npc.map((c) => ({ r: c.r, n: c.n, th: c.th, pop: c.pop, s: c.th === 1 && c.r % 5 === 0 ? 'abandoned' : 'active' }));
      const me = this.db.city;
      if (me) cities.push({ r: me.regionId, n: me.name, th: me.th, pop: Math.floor(me.pop), s: 'active' });
      return { cities } as T;
    }
    const pc = /^\/api\/city\/(\d+)$/.exec(p);
    if (method === 'GET' && pc) return (await this.publicCity(Number(pc[1]))) as T;
    if (method === 'GET' && p === '/api/market') return this.marketResponse() as T;
    if (method === 'GET' && p === '/api/market/orders') {
      const res = url.searchParams.get('res') as Good;
      const side = url.searchParams.get('side');
      const list = this.db.orders
        .filter((o) => o.status === 'open' && o.res === res && o.side === side)
        .sort((x, y) => (side === 'buy' ? y.total / y.qty - x.total / x.qty : x.total / x.qty - y.total / y.qty))
        .slice(0, 50);
      return { orders: structuredClone(list) } as T;
    }
    if (method === 'GET' && p === '/api/market/trades') {
      const res = url.searchParams.get('res');
      return { trades: this.db.trades.filter((t) => t.res === res).slice(0, 30) } as T;
    }
    if (method === 'POST' && p === '/api/market/system') return this.system(b) as T;
    if (method === 'POST' && p === '/api/market/orders') return this.createOrder(b) as T;
    const fo = /^\/api\/market\/orders\/(\d+)\/(fill|cancel)$/.exec(p);
    if (method === 'POST' && fo) return (fo[2] === 'fill' ? this.fill(Number(fo[1]), b) : this.cancel(Number(fo[1]))) as T;
    if (method === 'GET' && p === '/api/shop') return { packs: CRYSTAL_PACKS, crystals: this.db.crystals } as T;
    if (method === 'POST' && p === '/api/shop/invoice') return { link: `mock-invoice:${String(b.pack)}` } as T;
    throw new ApiError(404, 'bad_request', `mock: нет маршрута ${method} ${p}`);
  }

  /** Mock-only: pretend Telegram charged the stars. */
  pay(pack: string): void {
    const p = CRYSTAL_PACKS.find((x) => x.id === pack);
    if (p) this.db.crystals += p.crystals;
    if (this.db.city) this.db.city.crystals = this.db.crystals;
    this.save();
  }

  private marketResponse(): MarketResponse {
    const c = this.db.city ? this.city() : null;
    const prices = {} as MarketResponse['prices'];
    for (const g of GOODS) prices[g] = quote(this.db.prices[g]);
    const now = Date.now();
    for (const o of this.db.orders) if (o.status === 'open' && o.expiresAt < now) this.expire(o);
    return {
      prices,
      quota: c ? systemQuota(c) : ({ wood: 0, stone: 0, iron: 0, food: 0, goods: 0 } as Record<Good, number>),
      myOrders: this.db.orders.filter((o) => c && o.regionId === c.regionId && o.status === 'open'),
      serverTime: now,
    };
  }

  private expire(o: Order): void {
    const c = this.db.city;
    o.status = 'expired';
    if (c && o.regionId === c.regionId) this.refund(c, o);
  }

  private refund(c: CityState, o: Order): void {
    if (o.side === 'buy') c.res.coins += partialTotal(o.total, o.qty, o.remaining);
    else c.res[o.res] += o.remaining;
  }

  private system(b: Record<string, unknown>): unknown {
    const c = this.city();
    const res = b.res as Good;
    const qty = Math.floor(Number(b.qty));
    if (!GOODS.includes(res) || !(qty > 0)) throw new ApiError(400, 'bad_request', 'Неверный запрос');
    const q = quote(this.db.prices[res]);
    if (b.side === 'buy') {
      const cost = Math.ceil(q.buy * qty * 100) / 100;
      if (c.res.coins < cost) throw new ApiError(409, 'no_money', 'Не хватает монет');
      c.res.coins -= cost;
      c.res[res] += qty;
    } else {
      if (c.res[res] < qty) throw new ApiError(409, 'no_goods', 'Не хватает товара');
      if (systemQuota(c)[res] < qty) throw new ApiError(409, 'quota', 'Дневной лимит продажи системе исчерпан');
      c.res[res] -= qty;
      c.res.coins += Math.floor(q.sell * qty * 100) / 100;
      c.soldToday[res] = (c.soldToday[res] ?? 0) + qty;
    }
    this.db.prices[res] = driftSystem(res, this.db.prices[res], qty, b.side as 'buy' | 'sell');
    this.db.trades.unshift({ id: Date.now(), res, qty, unit: b.side === 'buy' ? q.buy : q.sell, at: Date.now(), kind: 'system' });
    return this.done();
  }

  private createOrder(b: Record<string, unknown>): unknown {
    const c = this.city();
    if (c.th < MARKET.exchangeTh) throw new ApiError(403, 'exchange_locked', 'Биржа откроется на ратуше 2 уровня');
    const res = b.res as Good;
    const qty = Math.floor(Number(b.qty));
    const total = Math.round(Number(b.total) * 100) / 100;
    if (!GOODS.includes(res) || !(qty > 0) || !(total >= 1)) throw new ApiError(400, 'bad_request', 'Неверный запрос');
    if (this.db.orders.filter((o) => o.regionId === c.regionId && o.status === 'open').length >= MARKET.maxOrdersPerCity)
      throw new ApiError(409, 'too_many_orders', 'Не больше 10 заявок одновременно');
    if (b.side === 'buy') {
      if (c.res.coins < total) throw new ApiError(409, 'no_money', 'Не хватает монет');
      c.res.coins -= total;
    } else {
      if (c.res[res] < qty) throw new ApiError(409, 'no_goods', 'Не хватает товара');
      c.res[res] -= qty;
    }
    const now = Date.now();
    const order: Order = {
      id: this.db.nextOrder++, regionId: c.regionId, cityName: c.name, side: b.side as 'buy' | 'sell', res, qty, remaining: qty, total,
      createdAt: now, expiresAt: now + MARKET.orderTtlHours * HOUR, status: 'open',
    };
    this.db.orders.push(order);
    return { ...this.done(), order };
  }

  private fill(id: number, b: Record<string, unknown>): unknown {
    const c = this.city();
    const o = this.db.orders.find((x) => x.id === id);
    if (!o || o.status !== 'open') throw new ApiError(409, 'expired', 'Заявка уже закрыта');
    if (o.regionId === c.regionId) throw new ApiError(409, 'own_order', 'Это ваша заявка');
    const k = Math.min(o.remaining, Math.floor(Number(b.qty)));
    if (!(k > 0)) throw new ApiError(400, 'bad_request', 'Неверный запрос');
    const coins = partialTotal(o.total, o.qty, k);
    if (o.side === 'buy') {
      // we sell to them
      if (c.res[o.res] < k) throw new ApiError(409, 'no_goods', 'Не хватает товара');
      c.res[o.res] -= k;
      c.res.coins += coins * (1 - MARKET.fee);
    } else {
      if (c.res.coins < coins) throw new ApiError(409, 'no_money', 'Не хватает монет');
      c.res.coins -= coins;
      c.res[o.res] += k;
    }
    o.remaining -= k;
    if (o.remaining === 0) o.status = 'filled';
    this.db.prices[o.res] = driftRef(o.res, this.db.prices[o.res], coins / k, k);
    this.db.trades.unshift({ id: Date.now(), res: o.res, qty: k, unit: coins / k, at: Date.now(), kind: 'exchange' });
    return this.done();
  }

  private cancel(id: number): unknown {
    const c = this.city();
    const o = this.db.orders.find((x) => x.id === id && x.regionId === c.regionId && x.status === 'open');
    if (!o) throw new ApiError(409, 'expired', 'Заявка уже закрыта');
    o.status = 'cancelled';
    this.refund(c, o);
    return this.done();
  }

  private async publicCity(id: number): Promise<PublicCity> {
    const me = this.db.city;
    if (me && me.regionId === id)
      return { regionId: id, name: me.name, owner: 'Мэр', th: me.th, pop: Math.floor(me.pop), status: 'active', buildings: me.buildings, owned: me.owned };
    const hit = this.npcCities.get(id);
    if (hit) return hit;
    const npc = this.db.npc.find((c) => c.r === id);
    if (!npc) throw new ApiError(404, 'not_found', 'Город не найден');
    const m = await this.mask(id);
    const c = grow(newCity(id, npc.n, m, 0), m, npc.th, id);
    const pub: PublicCity = { regionId: id, name: npc.n, owner: 'Игрок', th: npc.th, pop: npc.pop, status: 'active', buildings: c.buildings, owned: c.owned };
    this.npcCities.set(id, pub);
    return pub;
  }

  private async seedDemo(): Promise<void> {
    const m = await this.mask(this.regionId);
    const now = Date.now();
    const c = grow(newCity(this.regionId, 'Новый Берег', m, now - 30 * HOUR), m, 4, 7);
    c.tick = now - 2 * HOUR;
    c.res = { coins: 18450, wood: 2310, stone: 1860, iron: 420, food: 940, goods: 35 };
    c.pop = 640;
    c.crystals = 120;
    c.actions = 300;
    // a couple of jobs in progress
    const busy = c.buildings.filter((b) => b.t !== 'townhall').slice(2, 4);
    busy[0].until = now + 38 * 60_000;
    if (busy[1]) {
      busy[1].lvl = 0;
      busy[1].until = now + 9 * 60_000;
    }
    this.db.city = c;
    this.db.crystals = 120;
    this.save();
  }
}

/** Grow a plausible city around the town hall (mock / demo only). */
function grow(c: CityState, m: RegionMask, th: number, seed: number): CityState {
  c.th = th;
  c.buildings[0].lvl = th;
  const owned = ownedBits(c, m);
  const radius = [0, 7, 12, 17, 22, 26][th - 1];
  const hx = c.buildings[0].x + 2;
  const hy = c.buildings[0].y + 2;
  let count = c.ownedCount;
  for (let y = hy - radius; y <= hy + radius; y++)
    for (let x = hx - radius; x <= hx + radius; x++) {
      const dx = x - hx;
      const dy = y - hy;
      const wob = 1 + 0.18 * Math.sin((Math.atan2(dy, dx) * 3 + seed) * 1.3);
      if (dx * dx + dy * dy > radius * radius * wob * wob) continue;
      const lx = x - m.x0;
      const ly = y - m.y0;
      if (lx < 0 || ly < 0 || lx >= m.w || ly >= m.h) continue;
      const i = ly * m.w + lx;
      if (getBit(m.build, i) && !getBit(owned, i)) {
        setBit(owned, i);
        count++;
      }
    }
  c.owned = toB64(owned);
  c.ownedCount = count;
  const plan: BuildingType[] = ['house', 'farm', 'sawmill', 'house', 'quarry', 'shop', 'house', 'warehouse', 'park', 'house', 'mine', 'hospital', 'house', 'factory', 'farm', 'park', 'house', 'shop'];
  let k = 0;
  let guard = 0;
  // ring search outward from the hall so the city is compact
  for (let r = 0; r < radius + 4 && guard < 4000; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        guard++;
        const t = plan[k % plan.length];
        const d = BUILDINGS[t];
        if (d.th > th) {
          k++;
          continue;
        }
        const x = hx + dx - (d.size >> 1);
        const y = hy + dy - (d.size >> 1);
        if (placementError(c, m, t, x, y)) continue;
        const lvl = Math.max(1, Math.min(d.maxLevel, th, 1 + Math.floor(hash(seed * 131 + k) * th)));
        c.buildings.push({ id: c.nextId++, t, x, y, lvl, until: 0 });
        k++;
      }
  return c;
}
