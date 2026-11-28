/**
 * TERRIA Worker: static Mini App (assets, free), JSON API under /api/*,
 * Telegram webhook under /tg/*, cron every 30 minutes.
 */
import { CRYSTAL_PACKS } from '../src/game/config.ts';
import { verifyInitData, type TgUser } from './auth.ts';
import { cityActions, createCity, getMe, publicCity, worldSummary } from './city.ts';
import { getUser } from './db.ts';
import type { Env } from './env.ts';
import { ApiFail, errorResponse, json } from './http.ts';
import { cancelOrder, createOrder, fillOrder, getMarket, listOrders, listTrades, systemTrade } from './market.ts';
import { runCron } from './cron.ts';
import { createInvoice, ensureBotSetup, handleWebhook } from './telegram.ts';

async function authenticate(req: Request, env: Env): Promise<TgUser> {
  const h = req.headers.get('authorization') ?? '';
  const space = h.indexOf(' ');
  const scheme = h.slice(0, space).toLowerCase();
  const value = h.slice(space + 1).trim();
  if (scheme === 'tma' && env.BOT_TOKEN) {
    const user = await verifyInitData(value, env.BOT_TOKEN, Math.floor(Date.now() / 1000));
    if (user) return user;
  }
  if (scheme === 'dev' && env.DEV_AUTH === '1') {
    const [id, ...name] = value.split(' ');
    const n = Number(id);
    if (Number.isSafeInteger(n) && n > 0) return { id: n, first_name: name.join(' ') || `Dev ${n}` };
  }
  throw new ApiFail(401, 'unauthorized');
}

function clock(req: Request, env: Env): number {
  if (env.DEV_AUTH === '1') {
    const t = Number(req.headers.get('x-dev-now'));
    if (Number.isFinite(t) && t > 0) return t;
  }
  return Date.now();
}

const devCors = (env: Env): Record<string, string> =>
  env.DEV_AUTH === '1'
    ? {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type, x-dev-now',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      }
    : {};

async function api(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;
  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: devCors(env) });
  const now = clock(req, env);
  const user = await authenticate(req, env);
  let m2: RegExpMatchArray | null;

  if (m === 'GET' && p === '/api/me') {
    if (env.BOT_TOKEN) ctx.waitUntil(ensureBotSetup(env).catch((e) => console.error('bot setup', e)));
    return json(await getMe(env, user, now));
  }
  if (m === 'POST' && p === '/api/city') return json(await createCity(env, req, user, now));
  if (m === 'POST' && p === '/api/city/actions') return json(await cityActions(env, req, user, now));
  if (m === 'GET' && p === '/api/world') return json(await worldSummary(env, now), 200, { 'cache-control': 'private, max-age=30' });
  if (m === 'GET' && (m2 = p.match(/^\/api\/city\/(\d{1,5})$/))) {
    return json(await publicCity(env, Number(m2[1]), now), 200, { 'cache-control': 'private, max-age=30' });
  }
  if (m === 'GET' && p === '/api/market') return json(await getMarket(env, user, now));
  if (m === 'GET' && p === '/api/market/orders') return json(await listOrders(env, url, now));
  if (m === 'GET' && p === '/api/market/trades') return json(await listTrades(env, url));
  if (m === 'POST' && p === '/api/market/system') return json(await systemTrade(env, req, user, now));
  if (m === 'POST' && p === '/api/market/orders') return json(await createOrder(env, req, user, now));
  if (m === 'POST' && (m2 = p.match(/^\/api\/market\/orders\/(\d{1,12})\/(fill|cancel)$/))) {
    const id = Number(m2[1]);
    return json(m2[2] === 'fill' ? await fillOrder(env, req, user, now, id) : await cancelOrder(env, req, user, now, id));
  }
  if (m === 'GET' && p === '/api/shop') {
    const u = await getUser(env, user.id);
    return json({ packs: CRYSTAL_PACKS, crystals: u?.crystals ?? 0, payments: !!env.BOT_TOKEN });
  }
  if (m === 'POST' && p === '/api/shop/invoice') return json(await createInvoice(env, req, user));
  throw new ApiFail(404, 'not_found');
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      let res: Response;
      try {
        res = await api(req, env, ctx, url);
      } catch (e) {
        res = errorResponse(e);
      }
      for (const [k, v] of Object.entries(devCors(env))) res.headers.set(k, v);
      return res;
    }
    if (url.pathname === '/tg/webhook' && req.method === 'POST') {
      try {
        return await handleWebhook(env, req, Date.now());
      } catch (e) {
        return errorResponse(e); // 500: Telegram will retry (payments must not be lost)
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(runCron(env, controller.scheduledTime || Date.now()));
  },
} satisfies ExportedHandler<Env>;
