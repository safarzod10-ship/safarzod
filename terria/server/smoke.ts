/**
 * End-to-end smoke test against a local Worker:
 *   npm run server:schema:local
 *   npm run server:dev            (wrangler dev --local --var DEV_AUTH:1 --test-scheduled)
 *   node server/smoke.ts [http://127.0.0.1:8787]
 *
 * Uses dev auth (`Authorization: dev <id>`), a fake clock (`X-Dev-Now`) and
 * `wrangler d1 execute --local` to skip ahead (town hall level) where a real
 * player would need days.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BUILDINGS } from '../src/game/config.ts';
import { getBit } from '../src/game/bits.ts';
import { decodeMask, ownedBits, placementError, type RegionMask } from '../src/game/rules.ts';
import type { CityResponse, CityState, MarketResponse, MeResponse, Order, RegionMaskDTO } from '../src/game/types.ts';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const A = 9001;
const B = 9002;
let now = Date.now();
let opN = 0;
const op = (): string => `smoke-${process.pid}-${++opN}`;
let failures = 0;

function check(cond: unknown, what: string): void {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

async function call<T>(user: number, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `dev ${user} Smoke${user}`, 'content-type': 'application/json', 'x-dev-now': String(now) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

function sql(command: string): void {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'terria', '--local', '--command', command], { stdio: 'pipe' });
}

function mask(id: number): RegionMask {
  return decodeMask(JSON.parse(readFileSync(`dist/regions/${id}.json`, 'utf8')) as RegionMaskDTO);
}

function spot(c: CityState, m: RegionMask, t: keyof typeof BUILDINGS): { x: number; y: number } {
  for (let y = m.y0; y < m.y0 + m.h; y++)
    for (let x = m.x0; x < m.x0 + m.w; x++) if (!placementError(c, m, t, x, y)) return { x, y };
  throw new Error('no spot');
}

function edgeCells(c: CityState, m: RegionMask, n: number): number[] {
  const owned = ownedBits(c, m);
  const out: number[] = [];
  for (let i = 0; i < m.w * m.h && out.length < n; i++) {
    if (!getBit(m.build, i) || getBit(owned, i)) continue;
    const x = i % m.w;
    if ((x > 0 && getBit(owned, i - 1)) || (x < m.w - 1 && getBit(owned, i + 1)) || getBit(owned, i - m.w) || getBit(owned, i + m.w)) out.push(i);
  }
  return out;
}

async function newPlayer(id: number, name: string): Promise<CityState> {
  sql(`DELETE FROM cities WHERE user_id = ${id}; DELETE FROM users WHERE id = ${id};`);
  const me = await call<MeResponse>(id, 'GET', '/api/me');
  check(me.status === 200 && me.data.city === null, `${name}: /api/me without a city`);
  const r = await call<MeResponse>(id, 'POST', '/api/city', { name });
  check(r.status === 200 && r.data.city?.name === name, `${name}: city created in region ${r.data.city?.regionId}`);
  return r.data.city!;
}

async function main(): Promise<void> {
  console.log(`smoke test against ${BASE}`);
  sql("DELETE FROM orders WHERE region_id IN (SELECT region_id FROM cities WHERE user_id IN (9001, 9002))");

  // --- city, build, land, idempotency
  let a = await newPlayer(A, 'Альфа');
  const ma = mask(a.regionId);
  const p = spot(a, ma, 'sawmill');
  const op1 = op();
  const cells = edgeCells(a, ma, 3);
  let r = await call<CityResponse>(A, 'POST', '/api/city/actions', {
    op: op1,
    actions: [
      { type: 'build', t: 'sawmill', ...p },
      { type: 'land', cells, pay: 'coins' },
      { type: 'build', t: 'sawmill', ...p },
    ],
  });
  check(r.status === 200, 'actions accepted');
  check(r.data.results?.[0].ok && r.data.results?.[1].ok, 'build sawmill + buy 3 cells ok');
  check(r.data.results?.[2].ok === false && (r.data.results?.[2] as { error: string }).error === 'occupied', 'second build on the same spot rejected');
  check(r.data.city.ownedCount === a.ownedCount + 3, 'owned cells +3');
  const coinsAfter = r.data.city.res.coins;
  const again = await call<CityResponse>(A, 'POST', '/api/city/actions', { op: op1, actions: [{ type: 'build', t: 'sawmill', ...p }] });
  check(again.status === 200 && again.data.results === undefined && again.data.city.res.coins === coinsAfter && again.data.city.buildings.length === r.data.city.buildings.length, 'repeated op is a no-op');
  const bad = await call<CityResponse>(A, 'POST', '/api/city/actions', { op: op(), actions: [{ type: 'land', cells: [0], pay: 'coins' }] });
  check(bad.status === 200 && bad.data.results?.[0].ok === false, 'buying a far / foreign cell rejected');

  // production over time
  now += 3 * 3_600_000;
  const me = await call<MeResponse>(A, 'GET', '/api/me');
  check(me.data.city!.buildings.find((b) => b.t === 'sawmill')?.lvl === 1, 'sawmill finished after 3 h');
  check(me.data.city!.res.wood > r.data.city.res.wood, 'wood produced');

  // --- system market
  let m = await call<MarketResponse>(A, 'GET', '/api/market');
  check(m.status === 200 && m.data.prices.wood.buy > m.data.prices.wood.sell, 'market prices: buy > sell');
  const wood0 = me.data.city!.res.wood;
  r = await call<CityResponse>(A, 'POST', '/api/market/system', { op: op(), side: 'sell', res: 'wood', qty: 50 });
  check(r.status === 200 && Math.abs(r.data.city.res.wood - (wood0 - 50)) < 1e-6, 'sold 50 wood to the system');
  r = await call<CityResponse>(A, 'POST', '/api/market/system', { op: op(), side: 'buy', res: 'stone', qty: 20 });
  check(r.status === 200, 'bought 20 stone from the system');
  const tooMuch = await call<{ error: string }>(A, 'POST', '/api/market/system', { op: op(), side: 'sell', res: 'iron', qty: 10 });
  check(tooMuch.status === 409 && tooMuch.data.error === 'no_goods', 'cannot sell iron you do not have');
  m = await call<MarketResponse>(A, 'GET', '/api/market');
  check(m.data.quota.wood === 250, `system quota left 250 (got ${m.data.quota.wood})`);

  // --- exchange
  const locked = await call<{ error: string }>(A, 'POST', '/api/market/orders', { op: op(), side: 'buy', res: 'wood', qty: 100, total: 50 });
  check(locked.status === 403 && locked.data.error === 'exchange_locked', 'exchange locked at town hall 1');
  let b = await newPlayer(B, 'Бета');
  // skip a few days of play: town hall 2 for both
  sql(`UPDATE cities SET th = 2, data = json_set(data, '$.th', 2), ver = ver + 1 WHERE user_id IN (${A}, ${B})`);
  const aCoins = (await call<MeResponse>(A, 'GET', '/api/me')).data.city!.res.coins;
  const created = await call<CityResponse & { order?: Order }>(A, 'POST', '/api/market/orders', { op: op(), side: 'buy', res: 'wood', qty: 100, total: 50 });
  check(created.status === 200 && created.data.order?.id, `A: buy order "100 wood for 50 coins" #${created.data.order?.id}`);
  check(Math.abs(created.data.city.res.coins - (aCoins - 50)) < 0.01, '50 coins went to escrow');
  const orderId = created.data.order!.id;
  const book = await call<{ orders: Order[] }>(B, 'GET', '/api/market/orders?res=wood&side=buy');
  check(book.data.orders.some((o) => o.id === orderId && o.cityName === 'Альфа'), 'B sees the order in the book');
  const own = await call<{ error: string }>(A, 'POST', `/api/market/orders/${orderId}/fill`, { op: op(), qty: 10 });
  check(own.status === 409 && own.data.error === 'own_order', 'A cannot fill own order');
  b = (await call<MeResponse>(B, 'GET', '/api/me')).data.city!;
  const fillOp = op();
  const filled = await call<CityResponse>(B, 'POST', `/api/market/orders/${orderId}/fill`, { op: fillOp, qty: 40 });
  check(filled.status === 200, 'B filled 40 of 100');
  check(Math.abs(filled.data.city.res.coins - (b.res.coins + 19.6)) < 0.02, `B got 20 coins minus 2 % fee (${(filled.data.city.res.coins - b.res.coins).toFixed(2)})`);
  check(Math.abs(filled.data.city.res.wood - (b.res.wood - 40)) < 0.5, 'B delivered 40 wood');
  const fillAgain = await call<CityResponse>(B, 'POST', `/api/market/orders/${orderId}/fill`, { op: fillOp, qty: 40 });
  check(fillAgain.status === 200 && Math.abs(fillAgain.data.city.res.coins - filled.data.city.res.coins) < 1e-6, 'repeated fill op is a no-op');
  const aAfterFill = (await call<MeResponse>(A, 'GET', '/api/me')).data.city!;
  check(aAfterFill.res.wood >= created.data.city.res.wood + 40 - 0.5, 'A received 40 wood');
  m = await call<MarketResponse>(A, 'GET', '/api/market');
  const mine = m.data.myOrders.find((o) => o.id === orderId);
  check(mine?.remaining === 60, 'order has 60 left');
  const cancel = await call<CityResponse>(A, 'POST', `/api/market/orders/${orderId}/cancel`, { op: op() });
  check(cancel.status === 200 && Math.abs(cancel.data.city.res.coins - (aAfterFill.res.coins + 30)) < 0.05, 'cancel returned the 30 coins left in escrow');
  const fillClosed = await call<{ error: string }>(B, 'POST', `/api/market/orders/${orderId}/fill`, { op: op(), qty: 1 });
  check(fillClosed.status === 409 && fillClosed.data.error === 'expired', 'cancelled order cannot be filled');
  const trades = await call<{ trades: { kind: string }[] }>(A, 'GET', '/api/market/trades?res=wood');
  check(trades.data.trades.some((t) => t.kind === 'exchange'), 'exchange trade in history');

  // --- sell order + expiry via cron
  const stone0 = cancel.data.city.res.stone;
  const sell = await call<CityResponse & { order?: Order }>(A, 'POST', '/api/market/orders', { op: op(), side: 'sell', res: 'stone', qty: 10, total: 30 });
  check(sell.status === 200 && Math.abs(sell.data.city.res.stone - (stone0 - 10)) < 1e-6, 'A: sell order 10 stone, stone in escrow');
  const later = now + 73 * 3_600_000;
  const cron = await fetch(`${BASE}/cdn-cgi/local/explorer/api/local/scheduled?worker=terria`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cron: '*/30 * * * *', scheduled_time: later }),
  });
  check(cron.ok, `cron triggered (${cron.status})`);
  await new Promise((res) => setTimeout(res, 500));
  m = await call<MarketResponse>(A, 'GET', '/api/market');
  check(!m.data.myOrders.some((o) => o.id === sell.data.order!.id), 'order expired after 72 h');
  const aEnd = (await call<MeResponse>(A, 'GET', '/api/me')).data.city!;
  check(aEnd.res.stone >= sell.data.city.res.stone + 10 - 1e-6, 'stone returned to A');

  // --- inactivity: 8 days later both cities (town hall 2) are abandoned, a visit revives A
  const week = now + 8 * 86_400_000;
  await fetch(`${BASE}/cdn-cgi/local/explorer/api/local/scheduled?worker=terria`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cron: '*/30 * * * *', scheduled_time: week }),
  });
  await new Promise((res) => setTimeout(res, 500));
  let w = await call<{ cities: { r: number; s: string }[] }>(B, 'GET', `/api/city/${b.regionId}`);
  check((w.data as unknown as { status: string }).status === 'abandoned', 'B abandoned after 8 days without a visit');
  now = week;
  const back = await call<MeResponse>(A, 'GET', '/api/me');
  check(back.status === 200 && back.data.city!.buildings.length >= 2, 'A came back: city intact');
  w = await call<{ cities: { r: number; s: string }[] }>(A, 'GET', '/api/world');

  // --- public views
  const world = await call<{ cities: { r: number }[] }>(A, 'GET', '/api/world');
  check(world.data.cities.some((c) => c.r === a.regionId), '/api/world lists A');
  const pub = await call<{ name: string; buildings: unknown[] }>(B, 'GET', `/api/city/${a.regionId}`);
  check(pub.status === 200 && pub.data.name === 'Альфа' && pub.data.buildings.length >= 2, '/api/city/:id public view');
  const shop = await call<{ packs: unknown[] }>(A, 'GET', '/api/shop');
  check(shop.status === 200 && shop.data.packs.length === 5, '/api/shop lists packs');
  const unauth = await fetch(`${BASE}/api/me`);
  check(unauth.status === 401, 'no auth -> 401');
  a = aEnd;

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
