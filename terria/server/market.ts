/**
 * Market: the system market ("по рыночной цене") and the player exchange
 * (orders with escrow, partial fills, 72 h expiry, 2 % fee).
 */
import { GOODS, MARKET, type Good } from '../src/game/config.ts';
import { driftRef, driftSystem, partialTotal, quote, round2, systemQuota } from '../src/game/market.ts';
import { advance } from '../src/game/rules.ts';
import type { CityResponse, MarketResponse, Order, PriceQuote, Trade } from '../src/game/types.ts';
import type { TgUser } from './auth.ts';
import { guardTrue, isGood, loadCity, mutateCity } from './db.ts';
import type { Env } from './env.ts';
import { ApiFail, int, num, readJson } from './http.ts';

const HOUR = 3_600_000;
const floor2 = (v: number): number => Math.floor(v * 100 + 1e-7) / 100;

export interface OrderRow {
  id: number;
  region_id: number;
  side: 'buy' | 'sell';
  res: Good;
  qty: number;
  remaining: number;
  total: number;
  escrow: number;
  status: Order['status'];
  created_at: number;
  expires_at: number;
  city_name?: string;
}

function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    regionId: r.region_id,
    cityName: r.city_name ?? '',
    side: r.side,
    res: r.res,
    qty: r.qty,
    remaining: r.remaining,
    total: r.total,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.status,
  };
}

export async function refPrices(env: Env): Promise<Record<Good, number>> {
  const rows = await env.DB.prepare('SELECT res, ref FROM prices').all<{ res: string; ref: number }>();
  const out = { ...MARKET.base };
  for (const r of rows.results) if (isGood(r.res)) out[r.res] = r.ref;
  return out;
}

export async function getMarket(env: Env, tg: TgUser, now: number): Promise<MarketResponse> {
  const loaded = await loadCity(env, tg.id);
  if (!loaded) throw new ApiFail(404, 'no_city');
  advance(loaded.city, now, loaded.mask);
  const refs = await refPrices(env);
  const prices = {} as Record<Good, PriceQuote>;
  for (const g of GOODS) prices[g] = quote(refs[g]);
  const mine = await env.DB.prepare(
    "SELECT o.*, c.name AS city_name FROM orders o JOIN cities c ON c.region_id = o.region_id WHERE o.region_id = ?1 AND o.status = 'open' ORDER BY o.created_at DESC",
  )
    .bind(loaded.row.region_id)
    .all<OrderRow>();
  return { prices, quota: systemQuota(loaded.city), myOrders: mine.results.map(toOrder), serverTime: now };
}

export async function listOrders(env: Env, url: URL, now: number): Promise<{ orders: Order[] }> {
  const res = url.searchParams.get('res');
  const side = url.searchParams.get('side');
  if (!isGood(res) || (side !== 'buy' && side !== 'sell')) throw new ApiFail(400, 'bad_request');
  // buyers want to sell to the best (highest) bid, buyers of sell orders want the lowest ask
  const order = side === 'buy' ? 'DESC' : 'ASC';
  const rows = await env.DB.prepare(
    `SELECT o.*, c.name AS city_name FROM orders o JOIN cities c ON c.region_id = o.region_id
     WHERE o.res = ?1 AND o.side = ?2 AND o.status = 'open' AND o.expires_at > ?3
     ORDER BY o.total / o.qty ${order}, o.created_at ASC LIMIT 50`,
  )
    .bind(res, side, now)
    .all<OrderRow>();
  return { orders: rows.results.map(toOrder) };
}

export async function listTrades(env: Env, url: URL): Promise<{ trades: Trade[] }> {
  const res = url.searchParams.get('res');
  if (!isGood(res)) throw new ApiFail(400, 'bad_request');
  const rows = await env.DB.prepare('SELECT id, res, qty, unit, at, kind FROM trades WHERE res = ?1 ORDER BY at DESC LIMIT 30')
    .bind(res)
    .all<Trade>();
  return { trades: rows.results };
}

function tradeInsert(env: Env, res: Good, qty: number, unit: number, at: number, kind: 'system' | 'exchange', seller: number, buyer: number): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO trades (res, qty, unit, at, kind, seller, buyer) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(
    res,
    qty,
    round2(unit),
    at,
    kind,
    seller,
    buyer,
  );
}

/** Buy from / sell to the system at the live price. */
export async function systemTrade(env: Env, req: Request, tg: TgUser, now: number): Promise<CityResponse> {
  const body = await readJson<{ op?: unknown; side?: unknown; res?: unknown; qty?: unknown }>(req);
  const res = body.res;
  if (!isGood(res) || (body.side !== 'buy' && body.side !== 'sell')) throw new ApiFail(400, 'bad_request');
  const side = body.side;
  const qty = int(body.qty, 1, 100_000);
  const refs = await refPrices(env);
  const ref = refs[res];
  const q = quote(ref);
  const r = await mutateCity(env, tg.id, now, body.op as string, (city, ctx) => {
    if (side === 'buy') {
      const cost = round2(qty * q.buy);
      if (city.res.coins + 1e-9 < cost) throw new ApiFail(409, 'no_money');
      city.res.coins -= cost;
      city.res[res] += qty;
    } else {
      if (qty > systemQuota(city)[res]) throw new ApiFail(409, 'quota');
      if (city.res[res] + 1e-9 < qty) throw new ApiFail(409, 'no_goods');
      city.res[res] -= qty;
      city.res.coins += round2(qty * q.sell);
      city.soldToday[res] = (city.soldToday[res] ?? 0) + qty;
    }
    city.actions++;
    const unit = side === 'buy' ? q.buy : q.sell;
    return {
      result: null,
      extra: [
        env.DB.prepare('UPDATE prices SET ref = ?1 WHERE res = ?2').bind(driftSystem(res, ref, qty, side), res),
        tradeInsert(env, res, qty, unit, now, 'system', side === 'sell' ? ctx.row.region_id : -1, side === 'buy' ? ctx.row.region_id : -1),
      ],
    };
  });
  return { city: r.city, serverTime: now };
}

export async function createOrder(env: Env, req: Request, tg: TgUser, now: number): Promise<CityResponse & { order?: Order }> {
  const body = await readJson<{ op?: unknown; side?: unknown; res?: unknown; qty?: unknown; total?: unknown }>(req);
  const res = body.res;
  if (!isGood(res) || (body.side !== 'buy' && body.side !== 'sell')) throw new ApiFail(400, 'bad_request');
  const side = body.side;
  const qty = int(body.qty, 1, MARKET.maxOrderQty);
  const total = round2(num(body.total, 1, 1_000_000_000));
  let regionId = -1;
  const r = await mutateCity(env, tg.id, now, body.op as string, async (city, ctx) => {
    if (city.th < MARKET.exchangeTh) throw new ApiFail(403, 'exchange_locked');
    regionId = ctx.row.region_id;
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE region_id = ?1 AND status = 'open'")
      .bind(regionId)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= MARKET.maxOrdersPerCity) throw new ApiFail(409, 'too_many_orders');
    if (side === 'buy') {
      if (city.res.coins + 1e-9 < total) throw new ApiFail(409, 'no_money');
      city.res.coins -= total;
    } else {
      if (city.res[res] + 1e-9 < qty) throw new ApiFail(409, 'no_goods');
      city.res[res] -= qty;
    }
    city.actions++;
    return {
      result: null,
      extra: [
        env.DB.prepare(
          "INSERT INTO orders (region_id, side, res, qty, remaining, total, escrow, status, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?5, 'open', ?6, ?7)",
        ).bind(regionId, side, res, qty, total, now, now + MARKET.orderTtlHours * HOUR),
      ],
    };
  });
  if (r.repeated) return { city: r.city, serverTime: now };
  const id = r.batch[r.batch.length - 1]?.meta?.last_row_id;
  const order: Order | undefined = id
    ? { id: Number(id), regionId, cityName: r.city.name, side, res, qty, remaining: qty, total, createdAt: now, expiresAt: now + MARKET.orderTtlHours * HOUR, status: 'open' }
    : undefined;
  return { city: r.city, serverTime: now, order };
}

async function getOrder(env: Env, id: number): Promise<OrderRow> {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first<OrderRow>();
  if (!o) throw new ApiFail(404, 'not_found');
  return o;
}

/** Fill (fully or partly) somebody else's order. */
export async function fillOrder(env: Env, req: Request, tg: TgUser, now: number, id: number): Promise<CityResponse> {
  const body = await readJson<{ op?: unknown; qty?: unknown }>(req);
  const wanted = int(body.qty, 1, MARKET.maxOrderQty);
  const refs = await refPrices(env);
  const r = await mutateCity(
    env,
    tg.id,
    now,
    body.op as string,
    async (city, ctx) => {
      if (city.th < MARKET.exchangeTh) throw new ApiFail(403, 'exchange_locked');
      // read the order inside the retry loop: a conflict re-reads it
      const o = await getOrder(env, id);
      if (o.status !== 'open' || o.expires_at <= now) throw new ApiFail(409, 'expired');
      if (o.region_id === ctx.row.region_id) throw new ApiFail(409, 'own_order');
      const k = Math.min(wanted, o.remaining);
      const paid = k === o.remaining ? o.escrow : Math.min(o.escrow, partialTotal(o.total, o.qty, k));
      const toSeller = floor2(paid * (1 - MARKET.fee));
      const res = o.res;
      const ownerUpdate =
        o.side === 'buy'
          ? env.DB.prepare(`UPDATE cities SET ${res} = ${res} + ?1 WHERE region_id = ?2`).bind(k, o.region_id)
          : env.DB.prepare('UPDATE cities SET coins = coins + ?1 WHERE region_id = ?2').bind(toSeller, o.region_id);
      if (o.side === 'buy') {
        // the order owner buys: I deliver goods and get coins from the escrow
        if (city.res[res] + 1e-9 < k) throw new ApiFail(409, 'no_goods');
        city.res[res] -= k;
        city.res.coins += toSeller;
      } else {
        // the order owner sells: I pay and get the goods
        if (city.res.coins + 1e-9 < paid) throw new ApiFail(409, 'no_money');
        city.res.coins -= paid;
        city.res[res] += k;
      }
      city.actions++;
      const unit = paid / k;
      return {
        result: null,
        before: [
          guardTrue(
            env,
            "(SELECT remaining FROM orders WHERE id = ?1 AND status = 'open' AND expires_at > ?3) IS ?2",
            id,
            o.remaining,
            now,
          ),
        ],
        extra: [
          env.DB.prepare(
            "UPDATE orders SET remaining = remaining - ?1, escrow = MAX(0, escrow - ?2), status = CASE WHEN remaining - ?1 = 0 THEN 'filled' ELSE status END WHERE id = ?3",
          ).bind(k, paid, id),
          ownerUpdate,
          env.DB.prepare('UPDATE prices SET ref = ?1 WHERE res = ?2').bind(driftRef(res, refs[res], unit, k), res),
          tradeInsert(env, res, k, unit, now, 'exchange', o.side === 'buy' ? ctx.row.region_id : o.region_id, o.side === 'buy' ? o.region_id : ctx.row.region_id),
        ],
      };
    },
    'no_goods',
  );
  return { city: r.city, serverTime: now };
}

export async function cancelOrder(env: Env, req: Request, tg: TgUser, now: number, id: number): Promise<CityResponse> {
  const body = await readJson<{ op?: unknown }>(req);
  const r = await mutateCity(env, tg.id, now, body.op as string, async (city, ctx) => {
    const o = await getOrder(env, id);
    if (o.region_id !== ctx.row.region_id) throw new ApiFail(404, 'not_found');
    if (o.status !== 'open') throw new ApiFail(409, 'expired');
    if (o.side === 'buy') city.res.coins += o.escrow;
    else city.res[o.res] += o.remaining;
    return {
      result: null,
      before: [
        guardTrue(env, "EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND status = 'open' AND remaining = ?2 AND escrow = ?3)", id, o.remaining, o.escrow),
      ],
      extra: [env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?1").bind(id)],
    };
  });
  return { city: r.city, serverTime: now };
}

/** Cron: close expired orders and give the escrow back. */
export async function expireOrders(env: Env, now: number): Promise<number> {
  const rows = await env.DB.prepare("SELECT * FROM orders WHERE status = 'open' AND expires_at <= ?1 LIMIT 200").bind(now).all<OrderRow>();
  const stmts: D1PreparedStatement[] = [];
  for (const o of rows.results) {
    if (!isGood(o.res)) continue;
    if (o.side === 'buy') {
      stmts.push(
        env.DB.prepare(
          "UPDATE cities SET coins = coins + COALESCE((SELECT escrow FROM orders WHERE id = ?1 AND status = 'open'), 0) WHERE region_id = ?2",
        ).bind(o.id, o.region_id),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `UPDATE cities SET ${o.res} = ${o.res} + COALESCE((SELECT remaining FROM orders WHERE id = ?1 AND status = 'open'), 0) WHERE region_id = ?2`,
        ).bind(o.id, o.region_id),
      );
    }
    stmts.push(env.DB.prepare("UPDATE orders SET status = 'expired' WHERE id = ?1 AND status = 'open'").bind(o.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return rows.results.length;
}
