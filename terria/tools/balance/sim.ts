// @ts-nocheck -- research script, kept as it was used to tune src/game/config.ts
// TERRIA balance simulator: a bot plays one city from the 1% starter plot to a
// fully bought, fully built, fully upgraded region. Hourly ticks, actions only
// during sessions. Usage: node sim.ts [profile] [json-overrides]
type R = 'coins' | 'wood' | 'stone' | 'iron' | 'food' | 'goods';
type Cost = Partial<Record<R, number>>;
const RES: R[] = ['coins', 'wood', 'stone', 'iron', 'food', 'goods'];

export const CFG = {
  regionCells: 8500, // buildable 16 m cells in a region (median 8549)
  starterCells: 81, // 9x9 = 1 % of the region
  fillTarget: 0.9, // "full city" = 90 % of the region covered
  costScale: 1.0,
  landBase: 12, // coins per cell at 1 %
  landGrowth: 1.6, // price = landBase * (1 + landK * share^landGrowth)
  landK: 30,
  parkCellCost: 30, // coins per park cell (fills the rest of the land)
  levelCost: [1, 2.6, 6.5, 16, 38], // cost to reach level n relative to build cost
  levelOut: [1, 1.7, 2.7, 4.2, 6.3], // output multiplier at level n
  levelJobs: [1, 1.5, 2.2, 3.1, 4.3],
  levelTime: [0.25, 1, 3, 7, 14], // hours (x sqrt(footprint/9))
  thCost: [0, 400, 2500, 12000, 50000, 160000], // coins to reach TH level n+1 (plus materials)
  thPop: [0, 60, 300, 1200, 3500, 8000],
  thLand: [0, 0.03, 0.1, 0.25, 0.45, 0.7],
  taxPerWorker: 0.5,
  thIncome: 10, // coins/h per TH level
  foodPerCitizen: 1 / 6,
  startRes: { coins: 600, wood: 120, stone: 100, iron: 0, food: 60, goods: 0 } as Record<R, number>,
  baseStorage: 600,
  offlineCap: 12,
  builders: [2, 2, 3, 3, 4, 4], // by TH level
};

interface Def {
  fp: number; cost: Cost; th: number; jobs?: number; out?: Cost; housing?: number;
  storage?: number; care?: number; shop?: number; upkeep: number; inp?: Cost;
}
const DEFS: Record<string, Def> = {
  house: { fp: 16, cost: { coins: 120, wood: 80, stone: 40 }, th: 1, housing: 30, upkeep: 1 },
  farm: { fp: 36, cost: { coins: 140, wood: 20 }, th: 1, jobs: 8, out: { food: 18 }, upkeep: 1.2 },
  sawmill: { fp: 16, cost: { coins: 160 }, th: 1, jobs: 8, out: { wood: 20 }, upkeep: 1.2 },
  quarry: { fp: 16, cost: { coins: 180 }, th: 1, jobs: 8, out: { stone: 16 }, upkeep: 1.2 },
  shop: { fp: 9, cost: { coins: 300, wood: 100, stone: 80 }, th: 2, jobs: 6, shop: 28, upkeep: 2 },
  warehouse: { fp: 16, cost: { coins: 240, wood: 120, stone: 120 }, th: 2, storage: 3000, upkeep: 1 },
  mine: { fp: 16, cost: { coins: 600, wood: 240, stone: 240 }, th: 3, jobs: 10, out: { iron: 12 }, upkeep: 2.4 },
  hospital: { fp: 16, cost: { coins: 1000, wood: 300, stone: 400, iron: 80 }, th: 3, jobs: 12, care: 300, upkeep: 4 },
  factory: { fp: 36, cost: { coins: 1800, wood: 600, stone: 600, iron: 300 }, th: 4, jobs: 16, inp: { wood: 12, iron: 6 }, out: { goods: 6 }, upkeep: 6 },
};
const FOREST = 1.25; // average forest bonus for an average region (31 % wooded)

interface B { t: string; lvl: number; busyUntil: number }
const S = {
  res: { ...CFG.startRes } as Record<R, number>, pop: 10, th: 1, owned: CFG.starterCells, used: 16, // town hall 4x4
  parks: 0, bs: [] as B[], hour: 0, actions: 0, actionsByDay: [] as number[], thBusy: 0,
};
const lv = (b: B) => b.lvl - 1;
function costOf(def: Def, toLvl: number): Cost {
  const k = CFG.levelCost[toLvl - 1] * CFG.costScale; const c: Cost = {};
  for (const r of RES) if (def.cost[r]) c[r] = Math.round(def.cost[r]! * k);
  if (toLvl >= 4) { c.iron = (c.iron ?? 0) + Math.round(def.cost.coins! * 0.3 * k / 4); }
  if (toLvl >= 5) { c.goods = (c.goods ?? 0) + Math.round(def.cost.coins! * 0.25 * k / 10); }
  return c;
}
const can = (c: Cost) => RES.every((r) => (S.res[r] ?? 0) >= (c[r] ?? 0));
const pay = (c: Cost) => { for (const r of RES) S.res[r] -= c[r] ?? 0; };
const maxLvl = () => Math.min(5, S.th); // building level <= town hall level (TH6 -> 5)
const landPrice = (n: number) => CFG.landBase * CFG.costScale * (1 + CFG.landK * Math.pow(n / CFG.regionCells, CFG.landGrowth));
function storageCap() { let s = CFG.baseStorage * S.th; for (const b of S.bs) if (DEFS[b.t].storage && b.busyUntil <= S.hour) s += DEFS[b.t].storage! * CFG.levelOut[lv(b)]; return s; }
function agg() {
  let housing = 0, jobs = 0, care = 0, shop = 0, upkeep = 0; const out: Record<R, number> = { coins: 0, wood: 0, stone: 0, iron: 0, food: 0, goods: 0 };
  for (const b of S.bs) {
    const d = DEFS[b.t]; const done = b.busyUntil <= S.hour || b.lvl > 1; const l = b.busyUntil > S.hour ? lv(b) - 1 : lv(b);
    if (!done || l < 0) continue;
    upkeep += d.upkeep * CFG.levelOut[l];
    housing += (d.housing ?? 0) * CFG.levelOut[l]; jobs += (d.jobs ?? 0) * CFG.levelJobs[l];
    care += (d.care ?? 0) * CFG.levelOut[l]; shop += (d.shop ?? 0) * CFG.levelOut[l];
    if (d.out) for (const r of RES) out[r] += (d.out[r] ?? 0) * CFG.levelOut[l] * (r === 'wood' ? FOREST : 1);
  }
  return { housing: housing + 20 /* town hall */, jobs, care, shop, upkeep, out };
}
function tick() {
  const a = agg(); const cap = storageCap();
  const workers = Math.min(S.pop, a.jobs); const eff = a.jobs ? workers / a.jobs : 0;
  const parksJoy = Math.min(15, (S.parks / Math.max(1, S.pop)) * 40);
  const fed = S.res.food > 0 || S.res.coins > S.pop;
  const happy = Math.max(0, Math.min(100, 55 + (fed ? 10 : -30) + Math.min(20, (a.care / Math.max(1, S.pop)) * 20) + parksJoy - (S.pop > 300 && a.care < S.pop * 0.5 ? 15 : 0)));
  const hf = 0.5 + happy / 100;
  for (const r of ['wood', 'stone', 'iron', 'food'] as R[]) S.res[r] += a.out[r] * eff;
  // factories
  const fac = S.bs.filter((b) => b.t === 'factory' && b.busyUntil <= S.hour);
  for (const b of fac) { const m = CFG.levelOut[lv(b)] * eff; if (S.res.wood >= 12 * m && S.res.iron >= 6 * m) { S.res.wood -= 12 * m; S.res.iron -= 6 * m; S.res.goods += 6 * m; } }
  S.res.food -= S.pop * CFG.foodPerCitizen;
  if (S.res.food < 0) { const imp = Math.min(-S.res.food, Math.max(0, S.res.coins) / (SYS_PRICE.food! * CFG.costScale)); S.res.coins -= imp * SYS_PRICE.food! * CFG.costScale; SYS_SPENT += imp * SYS_PRICE.food! * CFG.costScale; S.res.food += imp; if (S.res.food < 0) S.res.food = 0; }
  S.res.coins += CFG.thIncome * S.th + workers * CFG.taxPerWorker * hf + Math.min(a.shop, S.pop * 0.3) * hf - a.upkeep;
  for (const r of ['wood', 'stone', 'iron', 'food', 'goods'] as R[]) S.res[r] = Math.min(S.res[r], cap);
  const free = a.housing - S.pop;
  if (free > 0 && fed && happy >= 40) S.pop += Math.min(free, Math.max(1, free * 0.12));
  if (!fed || happy < 25) S.pop = Math.max(10, S.pop * 0.995);
  S.hour++;
}
const busy = () => S.bs.filter((b) => b.busyUntil > S.hour).length + (S.thBusy > S.hour ? 1 : 0);
const builders = () => CFG.builders[S.th - 1];
function thCost(): Cost { const k = CFG.thCost[S.th] * CFG.costScale; return { coins: k, wood: k * 0.3, stone: k * 0.3, iron: S.th >= 3 ? k * 0.1 : 0, goods: S.th >= 5 ? k * 0.02 : 0 }; }
let reserve: Cost = {}; let lastCost: Cost = {};
const addRes = (c: Cost) => { for (const r of RES) reserve[r] = (reserve[r] ?? 0) + (c[r] ?? 0); };
const canR = (c: Cost) => RES.every((r) => !(c[r] ?? 0) || (S.res[r] ?? 0) - (reserve[r] ?? 0) >= c[r]!);
export const BLOCK: Record<string, number> = {};
let why = '';
function act(): boolean {
  why = 'nothing';
  if (busy() >= builders()) { why = 'builders'; return false; }
  const a = agg(); const cap = storageCap(); reserve = {};
  // 1. town hall
  if (S.th < 6 && S.thBusy <= S.hour) {
    const c = thCost(); const matMax = Math.max(c.wood!, c.stone!, c.iron!, c.goods!);
    const reqOk = S.pop >= CFG.thPop[S.th] && S.owned / CFG.regionCells >= CFG.thLand[S.th];
    if (reqOk && matMax <= cap) { if (can(c) || buyMissing(c)) { pay(c); S.thBusy = S.hour + 6 * S.th; S.th++; S.actions++; return true; } addRes(c); }
    if (reqOk && matMax > cap) { const r = buildOrUpgrade('warehouse'); if (r !== 'none') return r === 'done'; }
    if (!reqOk && S.owned / CFG.regionCells < CFG.thLand[S.th]) { if (buyLand(Math.min(64, Math.ceil(CFG.thLand[S.th] * CFG.regionCells - S.owned)))) return true; }
  }
  const want: string[] = [];
  const thPopTarget = S.th < 6 ? CFG.thPop[S.th] * 1.1 : 0;
  if (a.out.food - a.housing * CFG.foodPerCitizen < 1) want.push('farm');
  if (S.th >= 3 && a.care < a.housing * 0.8) want.push('hospital');
  if (a.housing < a.jobs * 1.05 + 4 || a.housing < thPopTarget) want.push('house');
  if (S.pop > a.jobs * 0.95) {
    const need: [string, number][] = [['sawmill', S.res.wood / (a.out.wood + 1)], ['quarry', S.res.stone / (a.out.stone + 1)]];
    if (S.th >= 3) need.push(['mine', S.res.iron / (a.out.iron + 1)]);
    if (S.th >= 4) need.push(['factory', (S.res.goods / (a.out.goods + 1)) * 0.7]);
    if (S.th >= 2 && a.shop < S.pop * 0.3) need.push(['shop', 0]);
    need.sort((x, y) => x[1] - y[1]); const piling: Record<string, R> = { sawmill: 'wood', quarry: 'stone', mine: 'iron', factory: 'goods' }; want.push(...need.filter((n) => !piling[n[0]] || S.res[piling[n[0]]] < cap * 0.6).map((n) => n[0]));
  }
  if (S.th >= 2 && RES.some((r) => r !== 'coins' && S.res[r] >= cap * 0.97)) want.push('warehouse');
  for (const t of want) { const r = buildOrUpgrade(t); if (r === 'done') return true; if (r === 'wait') { const lack = (['wood', 'stone', 'iron', 'goods'] as R[]).find((x) => (lastCost[x] ?? 0) > S.res[x] - (reserve[x] ?? 0)); addRes(lastCost); const prod = lack === 'wood' ? 'sawmill' : lack === 'stone' ? 'quarry' : lack === 'iron' ? 'mine' : lack === 'goods' ? 'factory' : null; if (prod && !want.includes(prod)) want.push(prod); } }
  // 2. nothing urgent: upgrade the lowest building
  const up = S.bs.filter((b) => b.busyUntil <= S.hour && b.lvl < maxLvl() && b.t !== 'warehouse').sort((x, y) => x.lvl - y.lvl)[0];
  if (up) { const c = costOf(DEFS[up.t], up.lvl + 1); if ((canR(c) || buyMissing(c)) && maxCost(c) <= cap) { pay(c); up.lvl++; up.busyUntil = S.hour + time(up.t, up.lvl); S.actions++; return true; } if (maxCost(c) > cap) return buildOrUpgrade('warehouse') === 'done'; return false; }
  // 3. grow: new production + houses on free land
  if (S.used + S.parks < CFG.regionCells * CFG.fillTarget - 40 && S.th < 6) { for (const t of ['house', 'shop']) { const r = buildOrUpgrade(t); if (r === 'done') return true; } }
  if (S.th === 6 && S.bs.every((b) => b.lvl === 5 || b.t === 'warehouse')) { const w = S.bs.find((b) => b.t === 'warehouse' && b.lvl < 5 && b.busyUntil <= S.hour); if (w) { const c = costOf(DEFS.warehouse, w.lvl + 1); if (can(c)) { pay(c); w.lvl++; w.busyUntil = S.hour + time('warehouse', w.lvl); return true; } return false; } return fillParks(); }
  return false;
}
const SYS_PRICE: Partial<Record<R, number>> = { wood: 4, stone: 5, iron: 10, goods: 30, food: 3 };
export let SYS_SPENT = 0;
function buyMissing(c: Cost): boolean {
  let coins = 0; const miss: Cost = {};
  for (const r of ['wood', 'stone', 'iron', 'goods', 'food'] as R[]) { const m = (c[r] ?? 0) - (S.res[r] - (reserve[r] ?? 0)); if (m > 0) { miss[r] = m; coins += m * SYS_PRICE[r]! * CFG.costScale; } }
  if (coins === 0) return S.res.coins - (reserve.coins ?? 0) >= (c.coins ?? 0);
  if (S.res.coins - (reserve.coins ?? 0) < coins + (c.coins ?? 0)) return false;
  S.res.coins -= coins; SYS_SPENT += coins; for (const r of RES) S.res[r] += miss[r] ?? 0; return true;
}
const lackOf = (c: Cost) => RES.find((r) => (c[r] ?? 0) > 0 && S.res[r] - (reserve[r] ?? 0) < c[r]!) ?? 'reserve';
const maxCost = (c: Cost) => Math.max(c.wood ?? 0, c.stone ?? 0, c.iron ?? 0, c.goods ?? 0);
function buyLand(n: number): boolean { if (n <= 0 || S.owned >= CFG.regionCells) return false; n = Math.min(n, CFG.regionCells - S.owned); let c = 0; for (let i = 0; i < n; i++) c += landPrice(S.owned + i); if (!canR({ coins: c })) return false; S.res.coins -= c; S.owned += n; S.actions++; return true; }
function nextBiggestCost() { return S.th < 6 ? CFG.thCost[S.th] * 0.3 * CFG.costScale : 0; }
const time = (t: string, l: number) => CFG.levelTime[l - 1] * Math.sqrt(DEFS[t].fp / 16);
function buildOrUpgrade(t: string): 'done' | 'wait' | 'none' {
  const d = DEFS[t]; if (S.th < d.th) return 'none';
  // cheapest upgrade of that type vs a new building (+ land if needed)
  const cand = S.bs.filter((b) => b.t === t && b.busyUntil <= S.hour && b.lvl < maxLvl()).sort((x, y) => x.lvl - y.lvl)[0];
  const freeCells = S.owned - S.used - S.parks;
  const landNeed = Math.max(0, d.fp - freeCells);
  const roomLeft = CFG.regionCells * CFG.fillTarget - S.used;
  let landCost = 0; for (let i = 0; i < landNeed; i++) landCost += landPrice(S.owned + i);
  const newC = costOf(d, 1); const newTotal = (newC.coins ?? 0) + landCost;
  const upC = cand ? costOf(d, cand.lvl + 1) : null;
  const upGain = cand ? CFG.levelOut[cand.lvl] - CFG.levelOut[cand.lvl - 1] : 0;
  const upTotal = upC ? (upC.coins ?? 0) + (upC.wood ?? 0) * 2 + (upC.stone ?? 0) * 2 + (upC.iron ?? 0) * 4 + (upC.goods ?? 0) * 10 : Infinity;
  const newTot2 = newTotal + (newC.wood ?? 0) * 2 + (newC.stone ?? 0) * 2 + (newC.iron ?? 0) * 4;
  const canNew = roomLeft >= d.fp && S.owned + landNeed <= CFG.regionCells;
  const pickUp = upC && (!canNew || upTotal / upGain < newTot2);
  if (pickUp && upC && cand) { if (maxCost(upC) > storageCap()) return 'none'; if (!canR(upC) && !buyMissing(upC)) { lastCost = upC; why = lackOf(upC); return 'wait'; } pay(upC); S.actions++; cand.lvl++; cand.busyUntil = S.hour + time(t, cand.lvl); return 'done'; }
  if (!canNew) return 'none';
  const all = { ...newC, coins: (newC.coins ?? 0) + landCost };
  if (!canR(all) && !buyMissing(all)) { lastCost = all; why = lackOf(all); return 'wait'; }
  pay(all); S.owned += landNeed; S.used += d.fp; S.bs.push({ t, lvl: 1, busyUntil: S.hour + time(t, 1) }); S.actions += landNeed ? 2 : 1;
  return 'done';
}
function fillParks(): boolean {
  const target = Math.ceil(CFG.regionCells * CFG.fillTarget) - S.used - S.parks; if (target <= 0) {
    if (S.owned < CFG.regionCells) { const p = landPrice(S.owned) * 64; const n = Math.min(64, CFG.regionCells - S.owned); if (S.res.coins >= p) { S.res.coins -= p; S.owned += n; return true; } }
    return false;
  }
  const n = Math.min(target, 50);
  let landCost = 0; const landNeed = Math.max(0, n - (S.owned - S.used - S.parks)); for (let i = 0; i < landNeed; i++) landCost += landPrice(S.owned + i);
  const c = n * CFG.parkCellCost * CFG.costScale + landCost; if (S.res.coins < c) return false;
  S.res.coins -= c; S.parks += n; S.owned += landNeed; S.actions++; return true;
}
function done() { return S.th === 6 && S.owned >= CFG.regionCells && S.used + S.parks >= CFG.regionCells * CFG.fillTarget && S.bs.every((b) => b.lvl === 5 && b.busyUntil <= S.hour); }

const PROFILES: Record<string, number[]> = {
  hardcore: [7, 9, 11, 13, 15, 17, 19, 21, 23],
  diligent: [8, 11, 14, 17, 20, 23],
  normal: [9, 13, 18, 22],
  casual: [9, 21],
};
export function run(profile: string, over: Partial<typeof CFG> = {}, verbose = false) {
  Object.assign(CFG, over);
  const sess = PROFILES[profile]; const marks: Record<string, number> = {};
  const log: string[] = [];
  // the player only "sees" what accumulated since the last session, capped at offlineCap hours
  while (S.hour < 24 * 400 && !done()) {
    const h = S.hour % 24;
    if (sess.includes(h)) { let n = 0; while (n < 80 && act()) n++; BLOCK[why] = (BLOCK[why] ?? 0) + 1; const d = Math.floor(S.hour / 24); S.actionsByDay[d] = (S.actionsByDay[d] ?? 0) + n; }
    tick();
    const day = S.hour / 24; const share = S.owned / CFG.regionCells;
    for (const m of [0.05, 0.1, 0.25, 0.5, 0.75, 1]) if (share >= m && marks['land' + m] === undefined) marks['land' + m] = +day.toFixed(1);
    if (marks['th' + S.th] === undefined) marks['th' + S.th] = +day.toFixed(1);
    if (verbose && S.hour % (24 * 7) === 0) log.push(`d${day} TH${S.th} land ${(share * 100).toFixed(1)}% pop ${S.pop.toFixed(0)} bld ${S.bs.length} avgLvl ${(S.bs.reduce((a, b) => a + b.lvl, 0) / S.bs.length).toFixed(2)} coins ${S.res.coins.toFixed(0)} inc/h ${incomePerHour().toFixed(0)}`);
  }
  return { sysSpent: Math.round(SYS_SPENT), block: BLOCK, days: +(S.hour / 24).toFixed(1), pop: Math.round(S.pop), buildings: S.bs.length, parks: S.parks, actions: S.actions, marks, log, perDay: +(S.actions / (S.hour / 24)).toFixed(0), byType: count() };
}
function count() { const c: Record<string, number> = {}; for (const b of S.bs) c[b.t] = (c[b.t] ?? 0) + 1; return c; }
function incomePerHour() { const a = agg(); const w = Math.min(S.pop, a.jobs); return CFG.thIncome * S.th + w * CFG.taxPerWorker + Math.min(a.shop, S.pop * 0.3) - a.upkeep; }

if (process.argv[1]?.endsWith('sim.ts')) {
  const r = run(process.argv[2] ?? 'diligent', JSON.parse(process.argv[3] ?? '{}'), true);
  console.log(r.log.join('\n')); const { log, ...rest } = r; console.log(JSON.stringify(rest));
}
