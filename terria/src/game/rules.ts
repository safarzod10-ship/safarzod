/**
 * The rules of a city: economy over time and every action a mayor can take.
 * Pure and deterministic. The server runs it as the authority; the client runs
 * the same code to predict and to explain (costs, timers, requirements).
 *
 * All functions mutate the CityState they are given; clone first when you
 * need the old one (structuredClone).
 */
import { fromB64, getBit, newBits, setBit, toB64 } from './bits.ts';
import {
  BUILDINGS,
  CRYSTAL_SHOP,
  ECONOMY,
  GOODS,
  LAND,
  LATE_GOODS,
  LATE_IRON,
  LEVEL_COST,
  LEVEL_HOURS,
  LEVEL_JOBS,
  LEVEL_OUT,
  MARKET,
  NAME,
  REFERENCE_REGION_CELLS,
  RESOURCES,
  START,
  TOWNHALL,
  type BuildingType,
  type Res,
} from './config.ts';
import type { Action, ActionResult, Building, CityState, RegionMaskDTO, Stock } from './types.ts';

const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export type Cost = Partial<Record<Res, number>>;

// ---------------------------------------------------------------- region mask

export interface RegionMask {
  id: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  build: Uint8Array;
  wood: Uint8Array;
  cells: number;
  start: RegionMaskDTO['start'];
  hall: RegionMaskDTO['hall'];
}

export function decodeMask(dto: RegionMaskDTO): RegionMask {
  const n = dto.w * dto.h;
  return {
    ...dto,
    build: fromB64(dto.build, (n + 7) >> 3),
    wood: fromB64(dto.wood, (n + 7) >> 3),
  };
}

/** Index of a world cell in the region bbox, or -1 outside it. */
export function cellIndex(m: RegionMask, cx: number, cy: number): number {
  const x = cx - m.x0;
  const y = cy - m.y0;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
  return y * m.w + x;
}
export function isRegionCell(m: RegionMask, cx: number, cy: number): boolean {
  const i = cellIndex(m, cx, cy);
  return i >= 0 && getBit(m.build, i);
}
export function ownedBits(c: CityState, m: RegionMask): Uint8Array {
  return fromB64(c.owned, (m.w * m.h + 7) >> 3);
}
export function isOwned(owned: Uint8Array, m: RegionMask, cx: number, cy: number): boolean {
  const i = cellIndex(m, cx, cy);
  return i >= 0 && getBit(owned, i);
}

/** Balance thresholds scale with the size of the region (bigger region, bigger city). */
export function regionScale(m: RegionMask): number {
  return m.cells / REFERENCE_REGION_CELLS;
}

// ---------------------------------------------------------------- new city

export function newCity(regionId: number, name: string, m: RegionMask, now: number): CityState {
  const owned = newBits(m.w * m.h);
  let count = 0;
  for (let y = m.start.y; y < m.start.y + m.start.h; y++)
    for (let x = m.start.x; x < m.start.x + m.start.w; x++) {
      const i = cellIndex(m, x, y);
      if (i >= 0 && getBit(m.build, i)) {
        setBit(owned, i);
        count++;
      }
    }
  // the town hall footprint is always owned, even if the plot clipped water
  for (let y = m.hall.y; y < m.hall.y + 4; y++)
    for (let x = m.hall.x; x < m.hall.x + 4; x++) {
      const i = cellIndex(m, x, y);
      if (i >= 0 && !getBit(owned, i)) {
        setBit(owned, i);
        count++;
      }
    }
  return {
    v: 1,
    regionId,
    name: cleanName(name) ?? `Город ${regionId + 1}`,
    res: { ...START.res },
    crystals: START.crystals,
    pop: START.pop,
    th: 1,
    thUntil: 0,
    owned: toB64(owned),
    ownedCount: count,
    buildings: [{ id: 1, t: 'townhall', x: m.hall.x, y: m.hall.y, lvl: 1, until: 0 }],
    nextId: 2,
    extraBuilders: 0,
    tick: now,
    day: dayNumber(now),
    soldToday: {},
    crystalCellsToday: 0,
    ops: [],
    createdAt: now,
    actions: 0,
  };
}

export function cleanName(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < NAME.min || s.length > NAME.max) return null;
  return s;
}

export const dayNumber = (ms: number): number => Math.floor(ms / DAY);

// ---------------------------------------------------------------- costs

export function buildingCost(t: BuildingType, toLevel: number): Cost {
  const d = BUILDINGS[t];
  const k = LEVEL_COST[toLevel - 1] ?? 1;
  const c: Cost = {};
  for (const r of RESOURCES) {
    const v = d.cost[r];
    if (v) c[r] = Math.round(v * k);
  }
  const coins = d.cost.coins ?? 0;
  if (toLevel >= 4 && coins) c.iron = (c.iron ?? 0) + Math.round(coins * k * LATE_IRON);
  if (toLevel >= 5 && coins) c.goods = (c.goods ?? 0) + Math.round(coins * k * LATE_GOODS);
  return c;
}

export function buildHours(t: BuildingType, toLevel: number): number {
  if (BUILDINGS[t].category === 'decor') return 0.02;
  const size = BUILDINGS[t].size;
  return (LEVEL_HOURS[toLevel - 1] ?? 1) * Math.sqrt((size * size) / 16);
}

export function townhallCost(th: number): Cost {
  const k = TOWNHALL.cost[th - 1];
  if (k === undefined) return {};
  const c: Cost = { coins: k, wood: Math.round(k * 0.3), stone: Math.round(k * 0.3) };
  if (th >= 3) c.iron = Math.round(k * 0.1);
  if (th >= 5) c.goods = Math.round(k * 0.02);
  return c;
}

export interface Requirement {
  label: string;
  have: number;
  need: number;
  ok: boolean;
}

export function townhallRequirements(c: CityState, m: RegionMask): Requirement[] {
  if (c.th >= TOWNHALL.maxLevel) return [];
  const i = c.th - 1;
  const pop = Math.round(TOWNHALL.pop[i] * regionScale(m));
  const share = c.ownedCount / m.cells;
  return [
    { label: 'Жители', have: Math.floor(c.pop), need: pop, ok: c.pop >= pop },
    { label: 'Земля, %', have: Math.floor(share * 1000) / 10, need: TOWNHALL.land[i] * 100, ok: share >= TOWNHALL.land[i] },
  ];
}

/** Price of the next cell when `owned` cells are already owned. */
export function landPrice(owned: number, total: number): number {
  const f = Math.min(1, owned / total);
  return LAND.base * (1 + LAND.k * Math.pow(f, LAND.g));
}
export function landCost(owned: number, total: number, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += landPrice(owned + i, total);
  return Math.ceil(s);
}
export function landCrystals(owned: number, total: number, n: number): number {
  return Math.ceil(landCost(owned, total, n) / LAND.crystalRate);
}

export function canAfford(c: CityState, cost: Cost): boolean {
  for (const r of RESOURCES) if ((cost[r] ?? 0) > c.res[r] + 1e-9) return false;
  return true;
}
export function missing(c: CityState, cost: Cost): Cost {
  const m: Cost = {};
  for (const r of RESOURCES) {
    const d = (cost[r] ?? 0) - c.res[r];
    if (d > 1e-9) m[r] = Math.ceil(d);
  }
  return m;
}
function pay(c: CityState, cost: Cost): void {
  for (const r of RESOURCES) c.res[r] = Math.max(0, c.res[r] - (cost[r] ?? 0));
}

// ---------------------------------------------------------------- builders

export function builderCount(c: CityState): number {
  return TOWNHALL.builders[c.th - 1] + c.extraBuilders;
}
export function busyBuilders(c: CityState, now: number): number {
  let n = c.thUntil > now ? 1 : 0;
  for (const b of c.buildings) if (b.until > now) n++;
  return n;
}
export function maxBuildingLevel(c: CityState): number {
  return Math.min(5, c.th);
}

// ---------------------------------------------------------------- economy

export interface CityStats {
  housing: number;
  jobs: number;
  workers: number;
  care: number;
  joy: number;
  shopCap: number;
  upkeep: number;
  storage: number;
  /** production per hour (already scaled by worker efficiency) */
  prod: Stock;
  /** consumption per hour */
  use: Stock;
  happiness: number;
  /** coins per hour by source */
  income: { townhall: number; taxes: number; shops: number; upkeep: number; net: number };
  efficiency: number;
}

/** Completed level used for effects at time `now`. */
function liveLevel(b: Building): number {
  return b.lvl;
}

export function cityStats(c: CityState, m: RegionMask | null): CityStats {
  let housing = BUILDINGS.townhall.housing! * c.th;
  let jobs = 0;
  let care = 0;
  let joy = 0;
  let shopCap = 0;
  let upkeep = 0;
  let storage = TOWNHALL.storagePerLevel * c.th;
  const raw: Stock = { coins: 0, wood: 0, stone: 0, iron: 0, food: 0, goods: 0 };
  const inp: Stock = { coins: 0, wood: 0, stone: 0, iron: 0, food: 0, goods: 0 };
  for (const b of c.buildings) {
    const l = liveLevel(b);
    if (l < 1 || b.t === 'townhall') continue;
    const d = BUILDINGS[b.t];
    const k = LEVEL_OUT[l - 1];
    upkeep += d.upkeep * k;
    housing += (d.housing ?? 0) * k;
    jobs += (d.jobs ?? 0) * LEVEL_JOBS[l - 1];
    care += (d.care ?? 0) * k;
    joy += d.joy ?? 0;
    shopCap += (d.shop ?? 0) * k;
    storage += (d.storage ?? 0) * k;
    const bonus = d.forestBonus && m && woodedShare(b, m) >= 0.5 ? d.forestBonus : 1;
    if (d.out) for (const r of RESOURCES) raw[r] += (d.out[r] ?? 0) * k * bonus;
    if (d.inp) for (const r of RESOURCES) inp[r] += (d.inp[r] ?? 0) * k;
  }
  const workers = Math.min(c.pop, jobs);
  const efficiency = jobs > 0 ? workers / jobs : 0;
  const prod: Stock = { coins: 0, wood: 0, stone: 0, iron: 0, food: 0, goods: 0 };
  const use: Stock = { coins: 0, wood: 0, stone: 0, iron: 0, food: 0, goods: 0 };
  for (const r of RESOURCES) {
    prod[r] = raw[r] * efficiency;
    use[r] = inp[r] * efficiency;
  }
  use.food += c.pop * ECONOMY.foodPerCitizen;

  const fed = c.res.food > 0.5 || prod.food >= use.food || c.res.coins > 1;
  const careScore = Math.min(20, (care / Math.max(1, c.pop)) * 20);
  const joyScore = Math.min(20, (joy * 100) / Math.max(100, c.pop));
  const bigWithoutCare = c.pop > 300 * regionScaleOr1(m) && care < c.pop * 0.5 ? 15 : 0;
  const happiness = Math.max(0, Math.min(100, 55 + (fed ? 10 : -30) + careScore + joyScore - bigWithoutCare));
  const hf = 0.5 + happiness / 100;

  const townhall = TOWNHALL.incomePerLevel * c.th;
  const taxes = workers * ECONOMY.taxPerWorker * hf;
  const shops = Math.min(shopCap, c.pop * ECONOMY.shopDemandPerCitizen) * hf;
  const net = townhall + taxes + shops - upkeep;
  return {
    housing, jobs, workers, care, joy, shopCap, upkeep, storage, prod, use, happiness, efficiency,
    income: { townhall, taxes, shops, upkeep, net },
  };
}
const regionScaleOr1 = (m: RegionMask | null): number => (m ? regionScale(m) : 1);

export function woodedShare(b: Building, m: RegionMask): number {
  const s = BUILDINGS[b.t].size;
  let n = 0;
  for (let y = b.y; y < b.y + s; y++)
    for (let x = b.x; x < b.x + s; x++) {
      const i = cellIndex(m, x, y);
      if (i >= 0 && getBit(m.wood, i)) n++;
    }
  return n / (s * s);
}

/** Finish everything that completed by `t`. */
function completeUntil(c: CityState, t: number): void {
  for (const b of c.buildings)
    if (b.until && b.until <= t) {
      b.lvl++;
      b.until = 0;
    }
  if (c.thUntil && c.thUntil <= t) {
    c.th++;
    c.thUntil = 0;
    const hall = c.buildings.find((b) => b.t === 'townhall');
    if (hall) hall.lvl = c.th;
  }
}
function nextCompletion(c: CityState, after: number): number {
  let t = Infinity;
  for (const b of c.buildings) if (b.until > after && b.until < t) t = b.until;
  if (c.thUntil > after && c.thUntil < t) t = c.thUntil;
  return t;
}

/**
 * Simulate the economy from c.tick to `now`. Production is capped at
 * ECONOMY.offlineCapHours; constructions complete on time regardless.
 * The city never dies: hunger lowers happiness and growth, and the
 * population never drops below the starting one.
 */
export function advance(c: CityState, now: number, m: RegionMask | null): void {
  if (now <= c.tick) return;
  const cap = ECONOMY.offlineCapHours * HOUR;
  let t = c.tick;
  if (now - t > cap) {
    // only the last `cap` hours produce; complete what finished before that
    completeUntil(c, now - cap);
    t = now - cap;
  }
  const foodImport = MARKET.base.food * MARKET.systemSellMul;
  while (t < now) {
    completeUntil(c, t);
    const step = Math.min(now, t + HOUR, nextCompletion(c, t));
    const h = (step - t) / HOUR;
    const s = cityStats(c, m);
    // resources: production stops at the storage cap, purchases may exceed it
    for (const r of GOODS) {
      const net = s.prod[r] - s.use[r];
      if (r === 'food') continue;
      if (net > 0) {
        if (c.res[r] < s.storage) c.res[r] = Math.min(s.storage, c.res[r] + net * h);
      } else c.res[r] = Math.max(0, c.res[r] + net * h);
    }
    // factory inputs are consumed only if available
    if (s.use.wood > 0 && c.res.wood <= 0) c.res.goods = Math.max(0, c.res.goods - s.prod.goods * h);
    // food: produce, eat, import the shortfall with coins if possible
    let food = c.res.food + (s.prod.food - s.use.food) * h;
    if (food < 0) {
      const can = Math.min(-food, Math.max(0, c.res.coins) / foodImport);
      c.res.coins -= can * foodImport;
      food += can;
    }
    if (s.prod.food > s.use.food) food = Math.min(food, Math.max(s.storage, c.res.food));
    c.res.food = Math.max(0, food);
    // coins
    c.res.coins = Math.max(0, c.res.coins + s.income.net * h);
    // population
    const free = s.housing - c.pop;
    const fed = c.res.food > 0 || s.prod.food >= s.use.food;
    if (free > 0 && fed && s.happiness >= 40) c.pop = Math.min(s.housing, c.pop + Math.max(h, free * ECONOMY.growthPerHour * h));
    else if (free < 0) c.pop = Math.max(START.pop, s.housing);
    if (!fed || s.happiness < 25) c.pop = Math.max(START.pop, c.pop * Math.pow(0.995, h));
    t = step;
  }
  completeUntil(c, now);
  c.tick = now;
  const d = dayNumber(now);
  if (d !== c.day) {
    c.day = d;
    c.soldToday = {};
    c.crystalCellsToday = 0;
  }
}

// ---------------------------------------------------------------- placement

export function occupancy(c: CityState, m: RegionMask, ignoreId = -1): Uint8Array {
  const occ = newBits(m.w * m.h);
  for (const b of c.buildings) {
    if (b.id === ignoreId) continue;
    const s = BUILDINGS[b.t].size;
    for (let y = b.y; y < b.y + s; y++)
      for (let x = b.x; x < b.x + s; x++) {
        const i = cellIndex(m, x, y);
        if (i >= 0) setBit(occ, i);
      }
  }
  return occ;
}

export function placementError(c: CityState, m: RegionMask, t: BuildingType, x: number, y: number, owned?: Uint8Array, occ?: Uint8Array): string | null {
  const s = BUILDINGS[t].size;
  const own = owned ?? ownedBits(c, m);
  const busy = occ ?? occupancy(c, m);
  for (let yy = y; yy < y + s; yy++)
    for (let xx = x; xx < x + s; xx++) {
      const i = cellIndex(m, xx, yy);
      if (i < 0 || !getBit(own, i)) return 'not_owned';
      if (getBit(busy, i)) return 'occupied';
    }
  return null;
}

// ---------------------------------------------------------------- actions

export const ERRORS: Record<string, string> = {
  unknown: 'Неизвестное действие',
  locked: 'Нужна ратуша выше',
  no_builder: 'Все строители заняты',
  no_money: 'Не хватает ресурсов',
  no_crystals: 'Не хватает кристаллов',
  not_owned: 'Эта земля вам не принадлежит',
  occupied: 'Место занято',
  not_found: 'Здание не найдено',
  max_level: 'Максимальный уровень',
  busy: 'Здание уже строится',
  requirements: 'Не выполнены условия',
  bad_cells: 'Эти клетки нельзя купить',
  not_adjacent: 'Земля должна примыкать к вашей',
  daily_limit: 'Дневной лимит',
  bad_name: 'Название: от 2 до 24 символов',
  already: 'Уже куплено',
  too_many: 'Слишком много за раз',
};

export function applyAction(c: CityState, a: Action, m: RegionMask, now: number): ActionResult {
  advance(c, now, m);
  const fail = (error: string): ActionResult => ({ ok: false, error });
  switch (a.type) {
    case 'build': {
      const d = BUILDINGS[a.t];
      if (!d || a.t === 'townhall') return fail('unknown');
      if (c.th < d.th) return fail('locked');
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return fail('unknown');
      const err = placementError(c, m, a.t, a.x, a.y);
      if (err) return fail(err);
      const decor = d.category === 'decor';
      if (!decor && busyBuilders(c, now) >= builderCount(c)) return fail('no_builder');
      if (d.crystals) {
        if (c.crystals < d.crystals) return fail('no_crystals');
        c.crystals -= d.crystals;
      }
      const cost = buildingCost(a.t, 1);
      if (!canAfford(c, cost)) {
        if (d.crystals) c.crystals += d.crystals;
        return fail('no_money');
      }
      pay(c, cost);
      // clearing forest gives some timber
      const s = d.size;
      let wooded = 0;
      for (let y = a.y; y < a.y + s; y++)
        for (let x = a.x; x < a.x + s; x++) {
          const i = cellIndex(m, x, y);
          if (i >= 0 && getBit(m.wood, i)) wooded++;
        }
      c.res.wood += wooded * 3;
      const ms = buildHours(a.t, 1) * HOUR;
      c.buildings.push({ id: c.nextId++, t: a.t, x: a.x, y: a.y, lvl: 0, until: now + ms });
      break;
    }
    case 'upgrade': {
      const b = c.buildings.find((x) => x.id === a.id);
      if (!b || b.t === 'townhall') return fail('not_found');
      if (b.until) return fail('busy');
      const d = BUILDINGS[b.t];
      if (b.lvl >= d.maxLevel) return fail('max_level');
      if (b.lvl >= maxBuildingLevel(c)) return fail('locked');
      if (busyBuilders(c, now) >= builderCount(c)) return fail('no_builder');
      const cost = buildingCost(b.t, b.lvl + 1);
      if (!canAfford(c, cost)) return fail('no_money');
      pay(c, cost);
      b.until = now + buildHours(b.t, b.lvl + 1) * HOUR;
      break;
    }
    case 'demolish': {
      const idx = c.buildings.findIndex((x) => x.id === a.id);
      if (idx < 0 || c.buildings[idx].t === 'townhall') return fail('not_found');
      const b = c.buildings[idx];
      // a fifth of the last level comes back
      const back = buildingCost(b.t, Math.max(1, b.lvl));
      for (const r of RESOURCES) c.res[r] += Math.floor((back[r] ?? 0) * 0.2);
      c.buildings.splice(idx, 1);
      break;
    }
    case 'townhall': {
      if (c.th >= TOWNHALL.maxLevel) return fail('max_level');
      if (c.thUntil) return fail('busy');
      if (!townhallRequirements(c, m).every((r) => r.ok)) return fail('requirements');
      if (busyBuilders(c, now) >= builderCount(c)) return fail('no_builder');
      const cost = townhallCost(c.th);
      if (!canAfford(c, cost)) return fail('no_money');
      pay(c, cost);
      c.thUntil = now + TOWNHALL.hours[c.th - 1] * HOUR;
      break;
    }
    case 'land': {
      const err = buyLand(c, m, a.cells, a.pay);
      if (err) return fail(err);
      break;
    }
    case 'rename': {
      const n = cleanName(a.name);
      if (!n) return fail('bad_name');
      c.name = n;
      break;
    }
    case 'builder': {
      if (c.extraBuilders >= 1) return fail('already');
      if (c.crystals < CRYSTAL_SHOP.extraBuilder) return fail('no_crystals');
      c.crystals -= CRYSTAL_SHOP.extraBuilder;
      c.extraBuilders++;
      break;
    }
    default:
      return fail('unknown');
  }
  c.actions++;
  return { ok: true };
}

/** Buy region cells. They must be buildable, free, and connected to the city. */
function buyLand(c: CityState, m: RegionMask, cells: number[], payWith: 'coins' | 'crystals'): string | null {
  if (!Array.isArray(cells) || cells.length === 0) return 'bad_cells';
  if (cells.length > 400) return 'too_many';
  const owned = ownedBits(c, m);
  const want = new Set<number>();
  for (const i of cells) {
    if (!Number.isInteger(i) || i < 0 || i >= m.w * m.h) return 'bad_cells';
    if (!getBit(m.build, i) || getBit(owned, i)) return 'bad_cells';
    want.add(i);
  }
  // connectivity: grow from cells that touch owned land
  const reached = new Set<number>();
  const queue: number[] = [];
  const touchesOwned = (i: number): boolean => {
    const x = i % m.w;
    const y = (i - x) / m.w;
    return (
      (x > 0 && getBit(owned, i - 1)) ||
      (x < m.w - 1 && getBit(owned, i + 1)) ||
      (y > 0 && getBit(owned, i - m.w)) ||
      (y < m.h - 1 && getBit(owned, i + m.w))
    );
  };
  for (const i of want) if (touchesOwned(i)) {
    reached.add(i);
    queue.push(i);
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % m.w;
    for (const j of [x > 0 ? i - 1 : -1, x < m.w - 1 ? i + 1 : -1, i - m.w, i + m.w])
      if (j >= 0 && want.has(j) && !reached.has(j)) {
        reached.add(j);
        queue.push(j);
      }
  }
  if (reached.size !== want.size) return 'not_adjacent';
  const n = want.size;
  if (payWith === 'crystals') {
    if (c.crystalCellsToday + n > LAND.crystalCellsPerDay) return 'daily_limit';
    const price = landCrystals(c.ownedCount, m.cells, n);
    if (c.crystals < price) return 'no_crystals';
    c.crystals -= price;
    c.crystalCellsToday += n;
  } else {
    const price = landCost(c.ownedCount, m.cells, n);
    if (c.res.coins < price) return 'no_money';
    c.res.coins -= price;
  }
  for (const i of want) setBit(owned, i);
  c.owned = toB64(owned);
  c.ownedCount += n;
  return null;
}

/** Apply a batch; failed actions are skipped and reported, the rest still apply. */
export function applyBatch(c: CityState, actions: Action[], m: RegionMask, now: number): ActionResult[] {
  return actions.map((a) => applyAction(c, a, m, now));
}

/** A coarse score for the leaderboard / map labels. */
export function cityLevelLabel(th: number): string {
  return ['Поселение', 'Деревня', 'Городок', 'Город', 'Большой город', 'Мегаполис'][th - 1] ?? 'Поселение';
}
