/**
 * ДВОР server on Cloudflare Workers (free plan): the Telegram bot and the players' leaderboard.
 *
 *   POST /tg            Telegram webhook (checked with the secret token header)
 *   POST /api/result    a player's progress after a match (Telegram initData is verified)
 *   POST /api/game-score the result of a match started from a game message (inline / group), signed token
 *   POST /api/profile/load, /api/profile/save   the player's progress (coins, trophies, heroes, upgrades)
 *                       kept in D1 per Telegram user, so it survives a new phone or cleared app data
 *   GET  /api/top       top 50 by trophies, cached at the edge for 60 s
 *   scheduled()         one-off setup: webhook, commands, menu button, descriptions (the first
 *                       fetch does the same, so it also runs without the cron)
 *
 * Bindings: DB (D1 "dvor"), ROOMS (Durable Object, reserved for online rooms), BOT_TOKEN and
 * WEBHOOK_SECRET (secrets), WEBAPP_URL (text). Light on the free tier: one D1 write per finished match
 * (and at most one per 20 s per player), leaderboard reads come from the edge cache.
 */

const SETUP_VERSION = '5';
const BOT = 'dvor_app';
const GAME = 'dvor';   // game short name from @BotFather /newgame (until it exists, links to the Mini App are used)
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
/** Mini App link that works in any chat (groups too); needs the Main Mini App enabled in @BotFather. */
const appLink = (param) => `https://t.me/${BOT}?startapp=${param}`;

function playKeyboard(env, chatType = 'private') {
  // web_app buttons work only in private chats; elsewhere the Mini App opens through a t.me link
  const play = chatType === 'private' ? { text: '▶ Играть', web_app: { url: env.WEBAPP_URL } } : { text: '▶ Играть', url: appLink('group') };
  return { inline_keyboard: [[play], [{ text: '🏆 Рейтинг игроков', callback_data: 'top' }]] };
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

const HELP = '<b>Как играть</b>\nДжойстик — движение, двойной тап — рывок. Атака идёт сама.\nКнопка справа — способность героя.\n'
  + 'Стой в Круге, чтобы команда получала очки. Кто первым наберёт 100 — побеждает.\n\n'
  + '<b>С друзьями</b>\nВ любом чате напиши <code>@' + BOT + '</code> и выбери «Вызов на бой».\nВ группе: добавь бота и напиши /play.\n\n/top — рейтинг игроков';

// ---- signed token for a game opened from a game message: who pressed Play, on which message
async function signToken(env, data) {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sig = hex(await hmac(env.WEBHOOK_SECRET, body)).slice(0, 32);
  return `${body}.${sig}`;
}
async function readToken(env, token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || hex(await hmac(env.WEBHOOK_SECRET, body)).slice(0, 32) !== sig) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(body.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; }
}

/** A game message in a chat; without the registered game, a message with a link button. */
async function sendPlay(env, chat, chatType) {
  const r = await tg(env, 'sendGame', { chat_id: chat, game_short_name: GAME });
  await note(env, 'sendgame_last', JSON.stringify({ ok: r.ok, err: r.description || null }));
  if (r.ok) return r;
  return tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: playKeyboard(env, chatType),
    text: '⚔️ <b>Бой во дворе!</b>\nЖми «Играть» — бои 2 на 2 за Круг.' });
}

async function note(env, k, v) {
  await env.DB.prepare('INSERT INTO meta (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t')
    .bind(k, String(v).slice(0, 2000), Date.now()).run();
}

async function onInline(q, env) {
  const me = await env.DB.prepare('SELECT trophies, hero FROM players WHERE id = ?').bind(q.from.id).first();
  const tro = me?.trophies ?? 0;
  const who = displayName(q.from);
  const results = [
    { type: 'game', id: 'game', game_short_name: GAME },
    { type: 'article', id: 'duel', title: '⚔️ Вызов на бой', description: `Мои кубки: ${tro}. Кто сильнее?`,
      input_message_content: { message_text: `⚔️ <b>${who}</b> вызывает тебя на бой во ДВОРе!\nМои кубки: <b>${tro}</b> 🏆${me?.hero ? ` · играю за ${HERO_NAMES[me.hero]}` : ''}\nПобьёшь?`, parse_mode: 'HTML' },
      reply_markup: { inline_keyboard: [[{ text: '▶ Принять вызов', url: appLink('duel') }]] } },
    { type: 'article', id: 'top', title: '🏆 Рейтинг двора', description: 'Отправить в чат лучших игроков',
      input_message_content: { message_text: await topText(env), parse_mode: 'HTML' },
      reply_markup: { inline_keyboard: [[{ text: '▶ Играть', url: appLink('top') }]] } },
  ];
  let r = await tg(env, 'answerInlineQuery', { inline_query_id: q.id, results, cache_time: 30, is_personal: true });
  await note(env, 'inline_last', JSON.stringify({ ok: r.ok, err: r.description || null }));
  if (!r.ok) r = await tg(env, 'answerInlineQuery', { inline_query_id: q.id, results: results.slice(1), cache_time: 30, is_personal: true });   // no game registered yet
  return r;
}

async function onUpdate(update, env) {
  if (update.inline_query) return onInline(update.inline_query, env);
  const msg = update.message;
  if (msg?.text) {
    const chat = msg.chat.id, type = msg.chat.type;
    const [cmd, to] = msg.text.split(/\s/)[0].split('@');
    if (to && to.toLowerCase() !== BOT) return;   // a command for another bot in a group
    if (cmd === '/top') return tg(env, 'sendMessage', { chat_id: chat, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env, type) });
    if (cmd === '/help') return tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: playKeyboard(env, type), text: HELP });
    if (cmd === '/play') return sendPlay(env, chat, type);
    if (type !== 'private') return;   // in groups the bot speaks only when asked
    return tg(env, 'sendMessage', { chat_id: chat, text: START, parse_mode: 'HTML', reply_markup: playKeyboard(env, type) });
  }
  const cb = update.callback_query;
  if (cb) {
    if (cb.game_short_name) {
      // Play on a game message: open the game with a token that says who and where (for the chat's high scores)
      const where = cb.inline_message_id ? { i: cb.inline_message_id } : { c: cb.message?.chat.id, m: cb.message?.message_id };
      const token = await signToken(env, { u: cb.from.id, n: displayName(cb.from), ...where, t: Date.now() });
      return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, url: `${env.WEBAPP_URL}?g=${token}` });
    }
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.data === 'top' && cb.message) return tg(env, 'sendMessage', { chat_id: cb.message.chat.id, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env, cb.message.chat.type) });
  }
}

/** A match played from a game message: the chat's high score table and the global leaderboard. */
async function apiGameScore(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const t = await readToken(env, body.g);
  if (!t || !t.u || Date.now() - t.t > 86400 * 1000 * 3) return json({ error: 'bad token' }, 401);
  const score = Math.max(0, Math.min(20000, Math.floor(Number(body.trophies) || 0)));
  const where = t.i ? { inline_message_id: t.i } : { chat_id: t.c, message_id: t.m };
  const r = await tg(env, 'setGameScore', { user_id: t.u, score, force: true, ...where });
  const now = Date.now();
  const row = await env.DB.prepare('SELECT updated FROM players WHERE id = ?').bind(t.u).first();
  const hero = HERO_NAMES[body.hero] ? body.hero : null;
  if (!row || now - row.updated > 20000) {
    await env.DB.prepare(`INSERT INTO players (id, name, trophies, hero, level, games, wins, updated) VALUES (?, ?, ?, ?, ?, 0, 0, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, trophies = excluded.trophies, hero = excluded.hero, level = excluded.level, updated = excluded.updated`)
      .bind(t.u, String(t.n || 'Игрок').slice(0, 24), score, hero, Math.max(1, Math.min(30, Math.floor(Number(body.level) || 1))), now).run();
  }
  return json({ ok: !!r.ok });
}

// ------------------------------------------------------------------ cloud save
/** Who is asking: a Telegram Mini App user (initData) or a player from a game message (signed token). */
async function who(env, body) {
  if (body.initData) { const u = await verifyInitData(env, body.initData); return u?.id ? u.id : null; }
  if (body.g) { const t = await readToken(env, body.g); return t?.u ?? null; }
  return null;
}

async function apiProfileLoad(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = await who(env, body);
  if (!id) return json({ error: 'not from Telegram' }, 401);
  const row = await env.DB.prepare('SELECT data, updated FROM profiles WHERE id = ?').bind(id).first();
  return json({ profile: row ? JSON.parse(row.data) : null, updated: row?.updated ?? 0 });
}

async function apiProfileSave(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = await who(env, body);
  if (!id) return json({ error: 'not from Telegram' }, 401);
  const data = JSON.stringify(body.profile ?? null);
  if (!body.profile || typeof body.profile !== 'object' || data.length > 30000) return json({ error: 'bad profile' }, 400);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT updated FROM profiles WHERE id = ?').bind(id).first();
  if (row && now - row.updated < 5000) return json({ ok: false, retry: 5 });   // at most one write per 5 s per player
  await env.DB.prepare('INSERT INTO profiles (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(id, data, now).run();
  return json({ ok: true, updated: now });
}

async function setup(env, origin) {
  const done = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind('setup').first();
  if (done?.v === SETUP_VERSION) return;
  const res = {};
  res.webhook = await tg(env, 'setWebhook', { url: `${origin}/tg`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query', 'inline_query'], drop_pending_updates: true });
  res.commands = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Начать' }, { command: 'play', description: 'Бой (и в группе)' }, { command: 'top', description: 'Рейтинг игроков' }, { command: 'help', description: 'Как играть' }] });
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
    if (url.pathname === '/api/game-score' && request.method === 'POST') return apiGameScore(request, env);
    if (url.pathname === '/api/profile/load' && request.method === 'POST') return apiProfileLoad(request, env);
    if (url.pathname === '/api/profile/save' && request.method === 'POST') return apiProfileSave(request, env);
    if (url.pathname === '/health') return json({ ok: true, server: 'dvor' });
    return new Response('ДВОР', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(setup(env, 'https://dvor-server.dvor-game.workers.dev'));
  },
};
