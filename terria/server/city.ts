/** City endpoints: /api/me, /api/city, /api/city/actions, /api/world, /api/city/:id */
import { advance, applyBatch, cleanName, newCity } from '../src/game/rules.ts';
import type { Action, CityResponse, MeResponse, PublicCity, WorldCitySummary } from '../src/game/types.ts';
import type { TgUser } from './auth.ts';
import { cached } from './cache.ts';
import { cityData, ensureUser, loadCity, mutateCity, touchCity, type UserRow } from './db.ts';
import type { Env } from './env.ts';
import { ApiFail, isUniqueFail, readJson } from './http.ts';
import { regionCount, regionMask } from './masks.ts';

const HOUR = 3_600_000;

export async function getMe(env: Env, tg: TgUser, now: number): Promise<MeResponse> {
  const user = await ensureUser(env, tg, now);
  const loaded = await loadCity(env, user.id);
  if (!loaded) {
    return { user: { id: user.id, name: user.name }, city: null, serverTime: now, full: false, freeRegions: await freeRegionCount(env) };
  }
  const tickBefore = loaded.city.tick;
  advance(loaded.city, now, loaded.mask);
  // persist the lazily advanced state only now and then (writes are the scarce resource)
  if (loaded.row.status !== 'active' || now - tickBefore > HOUR || now - loaded.row.last_seen > HOUR) {
    await touchCity(env, loaded, now);
  }
  return { user: { id: user.id, name: user.name }, city: loaded.city, serverTime: now, full: false, freeRegions: 0 };
}

async function freeRegionCount(env: Env): Promise<number> {
  const total = await regionCount(env);
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM cities').first<{ n: number }>();
  return Math.max(0, total - (row?.n ?? 0));
}

/** Pick a random free region, or recycle the oldest abandoned one. */
async function pickRegion(env: Env): Promise<{ id: number; recycle: { userId: number } | null } | null> {
  const total = await regionCount(env);
  const taken = await env.DB.prepare('SELECT region_id FROM cities').all<{ region_id: number }>();
  const used = new Set(taken.results.map((r) => r.region_id));
  if (used.size < total) {
    const free: number[] = [];
    for (let i = 0; i < total; i++) if (!used.has(i)) free.push(i);
    return { id: free[Math.floor(Math.random() * free.length)], recycle: null };
  }
  const old = await env.DB.prepare(
    "SELECT region_id, user_id FROM cities WHERE status = 'abandoned' ORDER BY last_seen ASC LIMIT 1",
  ).first<{ region_id: number; user_id: number }>();
  return old ? { id: old.region_id, recycle: { userId: old.user_id } } : null;
}

export async function createCity(env: Env, req: Request, tg: TgUser, now: number): Promise<MeResponse> {
  const body = await readJson<{ name?: unknown }>(req);
  const name = cleanName(typeof body.name === 'string' ? body.name : '');
  if (!name) throw new ApiFail(400, 'bad_name');
  const user: UserRow = await ensureUser(env, tg, now);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await loadCity(env, user.id)) return getMe(env, tg, now);
    const pick = await pickRegion(env);
    if (!pick) throw new ApiFail(409, 'full');
    const mask = await regionMask(env, pick.id);
    const city = newCity(pick.id, name, mask, now);
    city.crystals = user.crystals;
    const stmts: D1PreparedStatement[] = [];
    if (pick.recycle) {
      // the old owner keeps the account, crystals and payments; the city goes
      stmts.push(
        env.DB.prepare("DELETE FROM cities WHERE region_id = ?1 AND status = 'abandoned'").bind(pick.id),
        env.DB.prepare('UPDATE users SET region_id = NULL WHERE id = ?1 AND region_id = ?2').bind(pick.recycle.userId, pick.id),
        env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE region_id = ?1 AND status = 'open'").bind(pick.id),
      );
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO cities (region_id, user_id, name, th, pop, status, coins, wood, stone, iron, food, goods, data, ver, last_seen, created_at)
         VALUES (?1, ?2, ?3, 1, ?4, 'active', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12)`,
      ).bind(
        pick.id,
        user.id,
        city.name,
        Math.floor(city.pop),
        city.res.coins,
        city.res.wood,
        city.res.stone,
        city.res.iron,
        city.res.food,
        city.res.goods,
        cityData(city),
        now,
      ),
      env.DB.prepare('UPDATE users SET region_id = ?1 WHERE id = ?2').bind(pick.id, user.id),
    );
    try {
      await env.DB.batch(stmts);
      return getMe(env, tg, now);
    } catch (e) {
      if (isUniqueFail(e)) continue; // somebody took the region (or this user raced himself)
      throw e;
    }
  }
  throw new ApiFail(409, 'conflict');
}

const MAX_ACTIONS = 50;

export async function cityActions(env: Env, req: Request, tg: TgUser, now: number): Promise<CityResponse> {
  const body = await readJson<{ op?: unknown; actions?: unknown }>(req);
  if (!Array.isArray(body.actions) || body.actions.length === 0 || body.actions.length > MAX_ACTIONS) {
    throw new ApiFail(400, 'bad_request');
  }
  for (const a of body.actions) if (!a || typeof a !== 'object' || typeof (a as Action).type !== 'string') throw new ApiFail(400, 'bad_request');
  const actions = body.actions as Action[];
  const r = await mutateCity(env, tg.id, now, body.op as string, (city, ctx) => {
    const results = applyBatch(city, actions, ctx.mask, now);
    return { result: results, save: results.some((x) => x.ok) };
  });
  return { city: r.city, serverTime: now, results: r.result };
}

export async function worldSummary(env: Env, now: number): Promise<{ cities: WorldCitySummary[] }> {
  return cached('world', 60_000, now, async () => {
    const rows = await env.DB.prepare('SELECT region_id AS r, name AS n, th, pop, status AS s FROM cities').all<WorldCitySummary>();
    return { cities: rows.results };
  });
}

export async function publicCity(env: Env, regionId: number, now: number): Promise<PublicCity> {
  return cached(`city:${regionId}`, 60_000, now, async () => {
    const row = await env.DB.prepare(
      'SELECT c.region_id, c.name, c.th, c.pop, c.status, c.data, u.name AS owner FROM cities c JOIN users u ON u.id = c.user_id WHERE c.region_id = ?1',
    )
      .bind(regionId)
      .first<{ region_id: number; name: string; th: number; pop: number; status: 'active' | 'abandoned'; data: string; owner: string }>();
    if (!row) throw new ApiFail(404, 'not_found');
    const data = JSON.parse(row.data) as { buildings: PublicCity['buildings']; owned: string };
    return {
      regionId: row.region_id,
      name: row.name,
      owner: row.owner,
      th: row.th,
      pop: row.pop,
      status: row.status,
      buildings: data.buildings,
      owned: data.owned,
    };
  });
}
