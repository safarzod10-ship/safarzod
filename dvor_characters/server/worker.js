const SETUP_VERSION = '5';
const BOT = 'dvor_app';
const GAME = 'dvor';
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra },
});
const HERO_NAMES = { technik: 'Техник', tank: 'Танк', sprinter: 'Спринтер', sniper: 'Снайпер', medic: 'Медик' };

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
  if (!row || now - row.updated > 20000) {
    await env.DB.prepare(`INSERT INTO players (id, name, trophies, hero, level, games, wins, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, trophies = excluded.trophies, hero = excluded.hero, level = excluded.level,
      games = excluded.games, wins = excluded.wins, updated = excluded.updated`)
      .bind(user.id, displayName(user), trophies, hero, level, games, wins, now).run();
  }
  const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE trophies > ?').bind(trophies).first();
  return json({ rank: (ahead?.n ?? 0) + 1 });
}

const appLink = (param) => `https://t.me/${BOT}?startapp=${param}`;

function playKeyboard(env, chatType = 'private') {

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
  + '<b>С другом онлайн</b>\nВ игре нажми «С другом» → «Позвать друга», или в любом чате напиши <code>@' + BOT + '</code> и выбери «Вызов на бой». '
  + 'Комната ждёт, пока друг не нажмёт «В бой».\nВ группе: добавь бота и напиши /play.\n\n/top — рейтинг игроков';

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

const ROOM_RE = /^[a-z0-9]{6,16}$/;
function roomId() {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

async function duel(env, user, room) {
  const me = await env.DB.prepare('SELECT trophies, hero FROM players WHERE id = ?').bind(user.id).first();
  const tro = me?.trophies ?? 0;
  return {
    type: 'article', id: `duel_${room}`, title: '⚔️ Вызов на бой', description: `Комната ждёт соперника. Мои кубки: ${tro}`,
    input_message_content: { parse_mode: 'HTML', message_text: `⚔️ <b>${displayName(user)}</b> вызывает тебя на бой во ДВОРе!\n`
      + `Мои кубки: <b>${tro}</b> 🏆${me?.hero ? ` · играю за ${HERO_NAMES[me.hero]}` : ''}\n\nКомната открыта — жми «В бой», я жду.` },
    reply_markup: { inline_keyboard: [[{ text: '⚔️ В бой', url: appLink(`r_${room}`) }]] },
  };
}

async function onInline(q, env) {
  const asked = (q.query || '').trim().replace(/^r_/, '');
  const results = [
    { type: 'game', id: 'game', game_short_name: GAME },
    await duel(env, q.from, ROOM_RE.test(asked) ? asked : roomId()),
    { type: 'article', id: 'top', title: '🏆 Рейтинг двора', description: 'Отправить в чат лучших игроков',
      input_message_content: { message_text: await topText(env), parse_mode: 'HTML' },
      reply_markup: { inline_keyboard: [[{ text: '▶ Играть', url: appLink('top') }]] } },
  ];
  let r = await tg(env, 'answerInlineQuery', { inline_query_id: q.id, results, cache_time: 30, is_personal: true });
  await note(env, 'inline_last', JSON.stringify({ ok: r.ok, err: r.description || null }));
  if (!r.ok) r = await tg(env, 'answerInlineQuery', { inline_query_id: q.id, results: results.slice(1), cache_time: 30, is_personal: true });
  return r;
}

async function onUpdate(update, env) {
  if (update.inline_query) return onInline(update.inline_query, env);
  const msg = update.message;
  if (msg?.text) {
    const chat = msg.chat.id, type = msg.chat.type;
    const [cmd, to] = msg.text.split(/\s/)[0].split('@');
    if (to && to.toLowerCase() !== BOT) return;
    if (cmd === '/top') return tg(env, 'sendMessage', { chat_id: chat, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env, type) });
    if (cmd === '/help') return tg(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: playKeyboard(env, type), text: HELP });
    if (cmd === '/play') return sendPlay(env, chat, type);
    if (type !== 'private') return;
    return tg(env, 'sendMessage', { chat_id: chat, text: START, parse_mode: 'HTML', reply_markup: playKeyboard(env, type) });
  }
  const cb = update.callback_query;
  if (cb) {
    if (cb.game_short_name) {

      const where = cb.inline_message_id ? { i: cb.inline_message_id } : { c: cb.message?.chat.id, m: cb.message?.message_id };
      const token = await signToken(env, { u: cb.from.id, n: displayName(cb.from), ...where, t: Date.now() });
      return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, url: `${env.WEBAPP_URL}?g=${token}` });
    }
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.data === 'top' && cb.message) return tg(env, 'sendMessage', { chat_id: cb.message.chat.id, text: await topText(env), parse_mode: 'HTML', reply_markup: playKeyboard(env, cb.message.chat.type) });
  }
}

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
  if (row && now - row.updated < 5000) return json({ ok: false, retry: 5 });
  await env.DB.prepare('INSERT INTO profiles (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(id, data, now).run();
  return json({ ok: true, updated: now });
}

async function apiRoomShare(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const user = await verifyInitData(env, body.initData);
  if (!user?.id) return json({ error: 'not from Telegram' }, 401);
  if (!ROOM_RE.test(body.room || '')) return json({ error: 'bad room' }, 400);
  const r = await tg(env, 'savePreparedInlineMessage', { user_id: user.id, result: await duel(env, user, body.room),
    allow_user_chats: true, allow_group_chats: true, allow_channel_chats: false, allow_bot_chats: false });
  return r.ok ? json({ id: r.result.id }) : json({ error: r.description || 'telegram' }, 502);
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

const cleanBoost = (b) => {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 1));
  return { hp: n(b?.hp, 1, 1.6), dmg: n(b?.dmg, 1, 1.6), speed: n(b?.speed, 1, 1.2), cd: n(b?.cd, 0.7, 1) };
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({});
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  peers(except) {
    return this.ctx.getWebSockets().filter((s) => s !== except && s.readyState === 1 && s.deserializeAttachment()?.role);
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 32000) return;
    const me = ws.deserializeAttachment() || {};
    if (me.role) {
      for (const s of this.peers(ws)) s.send(msg);
      return;
    }
    let m;
    try { m = JSON.parse(msg); } catch { return; }
    if (m.t !== 'hello') return;
    const user = m.initData ? await verifyInitData(this.env, m.initData) : null;
    const peer = {
      name: user ? displayName(user) : String(m.name || 'Игрок').replace(/[<>&]/g, '').slice(0, 24),
      hero: HERO_NAMES[m.hero] ? m.hero : 'technik',
      boost: cleanBoost(m.boost),
    };
    const uid = user?.id ?? 0;
    const others = this.peers(ws);
    if (await this.ctx.storage.get('started') || others.length >= 2) {
      ws.send(JSON.stringify({ t: 'over' }));
      ws.close(4002, 'over');
      return;
    }
    const host = others[0];
    if (host && uid && host.deserializeAttachment().uid === uid) {
      host.close(4003, 'replaced');
      ws.serializeAttachment({ role: 'host', peer, uid });
      ws.send(JSON.stringify({ t: 'wait' }));
      return;
    }
    if (!host) {
      ws.serializeAttachment({ role: 'host', peer, uid });
      ws.send(JSON.stringify({ t: 'wait' }));
      return;
    }
    ws.serializeAttachment({ role: 'guest', peer, uid });
    await this.ctx.storage.put('started', Date.now());
    const start = { t: 'start', host: host.deserializeAttachment().peer, guest: peer };
    host.send(JSON.stringify({ ...start, role: 'host' }));
    ws.send(JSON.stringify({ ...start, role: 'guest' }));
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const was = ws.deserializeAttachment()?.role;
    const rest = this.peers(ws);
    if (was) for (const s of rest) s.send(JSON.stringify({ t: 'left' }));
    if (!rest.length) await this.ctx.storage.deleteAll();
  }
}

let setupDone = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
    if (url.pathname === '/api/room/share' && request.method === 'POST') return apiRoomShare(request, env);
    const room = url.pathname.match(/^\/room\/([a-z0-9]{6,16})$/);
    if (room) return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
    if (url.pathname === '/health') return json({ ok: true, server: 'dvor' });
    return new Response('ДВОР', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(setup(env, 'https://dvor-server.dvor-game.workers.dev'));
  },
};
