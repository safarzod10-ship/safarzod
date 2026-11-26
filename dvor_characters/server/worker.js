/**
 * ДВОР server on Cloudflare Workers (free plan): the Telegram bot and the players' leaderboard.
 *
 *   POST /tg            Telegram webhook (checked with the secret token header)
 *   POST /api/result    a player's progress after a match (Telegram initData is verified)
 *   GET  /api/top       top 50 by trophies, cached at the edge for 60 s
 *   scheduled()         one-off setup: webhook, commands, menu button, descriptions (the first
 *                       fetch does the same, so it also runs without the cron)
 *
 * Bindings: DB (D1 "dvor"), ROOMS (Durable Object, reserved for online rooms), BOT_TOKEN and
 * WEBHOOK_SECRET (secrets), WEBAPP_URL (text). Light on the free tier: one D1 write per finished match
 * (and at most one per 20 s per player), leaderboard reads come from the edge cache.
 */

const SETUP_VERSION = '3';
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra },
});
const HERO_NAMES = { technik: 'Техник', tank: 'Танк', sprinter: 'Спринтер', sniper: 'Снайпер', medic: 'Медик' };

// ------------------------------------------------------------------ Telegram helpers
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Telegram Mini App initData check (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
async function verifyInitData(env, initData) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac('WebAppData', env.BOT_TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
  if (!(age < 86400 * 7)) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch { return null; }
}

const displayName = (u) => {
  const n = [u.first_name, u.last_name ? `${u.last_name[0]}.` : ''].filter(Boolean).join(' ').trim() || u.username || 'Игрок';
  return n.replace(/[<>&]/g, '').slice(0, 24);
};

// ------------------------------------------------------------------ leaderboard
async function top(env, n = 50) {
  const { results } = await env.DB.prepare('SELECT name, trophies, hero, level FROM players ORDER BY trophies DESC, updated ASC LIMIT ?').bind(n).all();
  return results;
}

async function apiTop(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL('/api/top', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = json({ players: await top(env), t: Date.now() }, 200, { 'cache-control': 'public, max-age=60' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function apiResult(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const user = await verifyInitData(env, body.initData);
  if (!user || !user.id) return json({ error: 'not from Telegram' }, 401);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT updated FROM players WHERE id = ?').bind(user.id).first();
  const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const trophies = clampInt(body.trophies, 20000), level = Math.max(1, clampInt(body.level, 500));
  const games = clampInt(body.games, 1e6), wins = clampInt(body.wins, 1e6);
  const hero = HERO_NAMES[body.hero] ? body.hero : null;
  if (!row || now - row.updated > 20000) {   // at most one write per 20 s per player
    await env.DB.prepare(`INSERT INTO players (id, name, trophies, hero, level, games, wins, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, trophies = excluded.trophies, hero = excluded.hero, level = excluded.level,
      games = excluded.games, wins = excluded.wins, updated = excluded.updated`)
      .bind(user.id, displayName(user), trophies, hero, level, games, wins, now).run();
  }
  const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE trophies > ?').bind(trophies).first();
  return json({ rank: (ahead?.n ?? 0) + 1 });
}

// ------------------------------------------------------------------ bot
function playKeyboard(env) {
  return { inline_keyboard: [[{ text: '▶ Играть', web_app: { url: env.WEBAPP_URL } }], [{ text: '🏆 Рейтинг игроков', callback_data: 'top' }]] };
}

async function topText(env) {
  const list = await top(env, 10);
  if (!list.length) return 'Рейтинг пока пуст — сыграй первый бой и попади в него!';
  const medal = ['🥇', '🥈', '🥉'];
  return '🏆 <b>Лучшие во дворе</b>\n\n' + list.map((p, i) =>
    `${medal[i] ?? `${i + 1}.`} ${p.name} — ${p.trophies} 🏆${p.hero ? ` · ${HERO_NAMES[p.hero]}` : ''}`).join('\n');
}

const START = [
  '<b>ДВОР</b>',
  '',
  'Пятеро выросли в одном дворе и были лучшими друзьями. Одна ночь всё сломала: друзья разругались и разошлись.',
  '',
  'Теперь каждый бьётся за Круг в центре двора. Бои 2 на 2, ранги от Бронзы до Царя двора.',
  '',
  'Жми «Играть» 👇',
].join('\n');

async function onUpdate(update, env) {
  const msg = update.message;
  if (msg?.text) {
    const chat = msg.chat.id;
    const cmd = msg.text.split(/[\s@]/)[0];
    if (cmd === '/top') return tg(env, 'sendMessage', { chat_id: chat, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env) });
    if (cmd === '/help') {
      return tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: playKeyboard(env), text:
        '<b>Как играть</b>\nДжойстик — движение, двойной тап — рывок. Атака идёт сама.\nДве кнопки справа — способности героя.\nСтой в Круге, чтобы команда получала очки. Кто первым наберёт 100 — побеждает.\n\n/top — рейтинг игроков' });
    }
    return tg(env, 'sendMessage', { chat_id: chat, text: START, parse_mode: 'HTML', reply_markup: playKeyboard(env) });
  }
  const cb = update.callback_query;
  if (cb) {
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.data === 'top' && cb.message) return tg(env, 'sendMessage', { chat_id: cb.message.chat.id, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env) });
  }
}

async function setup(env, origin) {
  const done = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind('setup').first();
  if (done?.v === SETUP_VERSION) return;
  const res = {};
  res.webhook = await tg(env, 'setWebhook', { url: `${origin}/tg`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  res.commands = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Начать' }, { command: 'top', description: 'Рейтинг игроков' }, { command: 'help', description: 'Как играть' }] });
  res.menu = await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: env.WEBAPP_URL } } });
  res.desc = await tg(env, 'setMyDescription', { description: 'ДВОР — бои 2 на 2 за Круг двора. Пятеро бывших друзей, пять героев, ранги от Бронзы до Царя двора. Жми «Начать».' });
  res.short = await tg(env, 'setMyShortDescription', { short_description: 'Бои 2 на 2 за Круг двора. Играй прямо в Telegram.' });
  res.me = await tg(env, 'getMe', {});
  const ok = res.webhook.ok && res.commands.ok && res.menu.ok;
  await env.DB.prepare('INSERT INTO meta (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t')
    .bind(ok ? 'setup' : 'setup_error', ok ? SETUP_VERSION : JSON.stringify(res).slice(0, 2000), Date.now()).run();
  await env.DB.prepare('INSERT INTO meta (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t')
    .bind('setup_result', JSON.stringify(res).slice(0, 4000), Date.now()).run();
}

// ------------------------------------------------------------------ online rooms (reserved)
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('room ok');
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) { for (const s of this.state.getWebSockets()) s.send(msg); }
}

let setupDone = false;   // per isolate: the D1 flag is checked once, then never again

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // the first request (Mini App opening, a bot message) also finishes the one-off setup
    if (!setupDone) ctx.waitUntil(setup(env, url.origin).then(() => { setupDone = true; }).catch(() => {}));
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
    }
    if (url.pathname === '/tg' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(onUpdate(update, env).catch(() => {}));
      return new Response('ok');
    }
    if (url.pathname === '/api/top' && request.method === 'GET') return apiTop(request, env, ctx);
    if (url.pathname === '/api/result' && request.method === 'POST') return apiResult(request, env);
    if (url.pathname === '/health') return json({ ok: true, server: 'dvor' });
    return new Response('ДВОР', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(setup(env, 'https://dvor-server.dvor-game.workers.dev'));
  },
};
