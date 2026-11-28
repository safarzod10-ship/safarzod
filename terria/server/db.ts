/**
 * Loading and saving cities with D1 batches as transactions:
 *  - balances are written as deltas (`coins = coins + ?`) guarded by CHECK (>= 0),
 *    so a trade filled by somebody else at the same moment is never lost;
 *  - a version guard aborts the batch when the city changed since it was read;
 *  - every mutating request carries an op id (idempotency).
 */
import { GOODS, RESOURCES, type Good, type Res } from '../src/game/config.ts';
import { advance, type RegionMask } from '../src/game/rules.ts';
import type { CityState, Stock } from '../src/game/types.ts';
import type { TgUser } from './auth.ts';
import { displayName } from './auth.ts';
import type { Env } from './env.ts';
import { ApiFail, isCheckFail, isGuardConflict } from './http.ts';
import { regionMask } from './masks.ts';

export interface UserRow {
  id: number;
  name: string;
  username: string;
  region_id: number | null;
  crystals: number;
  created_at: number;
  last_seen: number;
  bot_chat: number;
  warned_at: number;
}

export interface CityRow {
  region_id: number;
  user_id: number;
  name: string;
  th: number;
  pop: number;
  status: 'active' | 'abandoned';
  coins: number;
  wood: number;
  stone: number;
  iron: number;
  food: number;
  goods: number;
  data: string;
  ver: number;
  last_seen: number;
  created_at: number;
  crystals: number;
}

export interface Loaded {
  row: CityRow;
  city: CityState;
  mask: RegionMask;
}

export const RES_COLUMNS: readonly Res[] = RESOURCES;
export const isGood = (v: unknown): v is Good => typeof v === 'string' && (GOODS as readonly string[]).includes(v);

export async function getUser(env: Env, id: number): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
}

/** Creates the user on first contact (one write, only once). */
export async function ensureUser(env: Env, tg: TgUser, now: number): Promise<UserRow> {
  const found = await getUser(env, tg.id);
  if (found) return found;
  const row: UserRow = {
    id: tg.id,
    name: displayName(tg),
    username: (tg.username ?? '').slice(0, 64),
    region_id: null,
    crystals: 0,
    created_at: now,
    last_seen: now,
    bot_chat: 0,
    warned_at: 0,
  };
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (id, name, username, region_id, crystals, created_at, last_seen) VALUES (?1, ?2, ?3, NULL, 0, ?4, ?4)',
  )
    .bind(row.id, row.name, row.username, now)
    .run();
  return (await getUser(env, tg.id)) ?? row;
}

export function rowToCity(row: CityRow): CityState {
  const data = JSON.parse(row.data) as Omit<CityState, 'res' | 'crystals'>;
  const res = {} as Stock;
  for (const r of RES_COLUMNS) res[r] = row[r];
  return { ...data, res, crystals: row.crystals } as CityState;
}

export function cityData(c: CityState): string {
  const { res: _res, crystals: _crystals, ...rest } = c;
  return JSON.stringify(rest);
}

export async function loadCityRow(env: Env, userId: number): Promise<CityRow | null> {
  return env.DB.prepare(
    'SELECT c.*, u.crystals AS crystals FROM cities c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?1',
  )
    .bind(userId)
    .first<CityRow>();
}

export async function loadCity(env: Env, userId: number): Promise<Loaded | null> {
  const row = await loadCityRow(env, userId);
  if (!row) return null;
  return { row, city: rowToCity(row), mask: await regionMask(env, row.region_id) };
}

/** Delta that lands exactly on `next` (exact zero when spending everything). */
export function delta(prev: number, next: number): number {
  if (next <= 1e-9) return -prev;
  return next - prev;
}

/** Guard: aborts the batch when the city version is not `ver` any more. */
export function versionGuard(env: Env, regionId: number, ver: number): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO guard (x) SELECT NULL WHERE (SELECT ver FROM cities WHERE region_id = ?1) IS NOT ?2').bind(
    regionId,
    ver,
  );
}

/** Generic guard: aborts the batch when `sql` (a boolean SELECT expression) is not true. */
export function guardTrue(env: Env, condition: string, ...binds: unknown[]): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO guard (x) SELECT NULL WHERE NOT (${condition})`).bind(...binds);
}

export function cityUpdate(env: Env, row: CityRow, c: CityState, now: number): D1PreparedStatement[] {
  const d = RES_COLUMNS.map((r) => delta(row[r], c.res[r]));
  const out = [
    versionGuard(env, row.region_id, row.ver),
    env.DB.prepare(
      `UPDATE cities SET coins = coins + ?1, wood = wood + ?2, stone = stone + ?3, iron = iron + ?4, food = food + ?5, goods = goods + ?6,
         data = ?7, name = ?8, th = ?9, pop = ?10, status = 'active', last_seen = ?11, ver = ver + 1
       WHERE region_id = ?12`,
    ).bind(...d, cityData(c), c.name, c.th, Math.floor(c.pop), now, row.region_id),
  ];
  const dc = c.crystals - row.crystals;
  if (dc !== 0) out.push(env.DB.prepare('UPDATE users SET crystals = crystals + ?1 WHERE id = ?2').bind(dc, row.user_id));
  return out;
}

export interface MutateCtx {
  env: Env;
  now: number;
  row: CityRow;
  mask: RegionMask;
}

export interface Mutation<T> {
  result: T;
  /** extra statements, run after the city update in the same transaction */
  extra?: D1PreparedStatement[];
  /** statements run BEFORE the city update (guards on other rows) */
  before?: D1PreparedStatement[];
  /** false: nothing to save (e.g. every action failed) */
  save?: boolean;
}

export interface Mutated<T> {
  city: CityState;
  result: T | undefined;
  repeated: boolean;
}

const OPS_KEPT = 32;

/**
 * Load the caller's city, advance it, run `fn`, save atomically. Retries on
 * version conflicts. `checkCode` is the error reported when a CHECK fails
 * (somebody spent the same coins / goods meanwhile).
 */
export async function mutateCity<T>(
  env: Env,
  userId: number,
  now: number,
  op: string,
  fn: (city: CityState, ctx: MutateCtx) => Mutation<T> | Promise<Mutation<T>>,
  checkCode = 'no_money',
): Promise<Mutated<T>> {
  if (typeof op !== 'string' || op.length < 4 || op.length > 64) throw new ApiFail(400, 'bad_request');
  for (let attempt = 0; attempt < 4; attempt++) {
    const loaded = await loadCity(env, userId);
    if (!loaded) throw new ApiFail(404, 'no_city');
    const { row, city, mask } = loaded;
    advance(city, now, mask);
    if (city.ops.includes(op)) return { city, result: undefined, repeated: true };
    const m = await fn(city, { env, now, row, mask });
    if (m.save === false) return { city, result: m.result, repeated: false };
    city.ops = [...city.ops, op].slice(-OPS_KEPT);
    try {
      await env.DB.batch([...(m.before ?? []), ...cityUpdate(env, row, city, now), ...(m.extra ?? [])]);
      return { city, result: m.result, repeated: false };
    } catch (e) {
      if (isGuardConflict(e)) continue;
      if (isCheckFail(e)) throw new ApiFail(409, checkCode);
      throw e;
    }
  }
  throw new ApiFail(409, 'conflict');
}

/** Persist the lazily advanced state of a city without an action (GET /api/me). */
export async function touchCity(env: Env, loaded: Loaded, now: number): Promise<void> {
  try {
    await env.DB.batch(cityUpdate(env, loaded.row, loaded.city, now));
  } catch (e) {
    if (!isGuardConflict(e)) throw e; // somebody else saved first: fine
  }
}
