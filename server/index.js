import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertProductionConfig } from './config.js';
import { openDb, AppError } from './db.js';
import { validateInitData } from './auth.js';
import { Game } from './game.js';
import { Bot } from './bot.js';
import { BasketService } from './basket.js';
import { CrashService } from './crash.js';
import { createAdminRoutes } from './admin.js';

assertProductionConfig();

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://t.me https://*.telegram.org https://*.telesco.pe",
    "media-src 'self'",
    "connect-src 'self'",
    'frame-ancestors https://web.telegram.org https://*.telegram.org https://t.me',
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; '),
};
const DEV_AUTH = config.devMode && !config.botToken;

const store = openDb(config.dataDir);
const game = new Game(store, config.game);
const basket = new BasketService(store, config.basket);
const crash = new CrashService(store, config.crash);
const bot = config.botToken
  ? new Bot({
      token: config.botToken,
      webAppUrl: config.publicUrl,
      adminId: config.adminId,
      supportUsername: config.supportUsername,
      channelUrl: config.channelUrl,
      chatUrl: config.chatUrl,
      refPercent: config.refPercent,
      bannerPath: fileURLToPath(new URL('../public/banner.jpg', import.meta.url)),
      limits: config.limits,
      store,
    })
  : null;

const streams = new Set();
const streamsByIp = new Map();
game.on('update', (state) => broadcast('round', state));
crash.on('update', (state) => broadcast('crash', state));
crash.on('balance', (id) => broadcast('balance', { id }));
if (bot) bot.onBalance = (user) => broadcast('balance', { id: user.id });

function broadcast(event, data) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) res.write(chunk);
}
setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 20_000).unref();

function send(res, status, body) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 8 * 1024) {
  if (req.method !== 'POST') return {};
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new AppError('BAD_JSON', 'Некорректный запрос', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('TOO_LARGE', 'Слишком большой запрос', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new AppError('BAD_JSON', 'Некорректный запрос');
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || '';
}

const buckets = new Map();
function rateLimit(key, perMinute) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: perMinute, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) throw new AppError('TOO_FAST', 'Слишком много запросов. Подождите немного', 429);
  b.tokens -= 1;
}
setInterval(() => {
  const old = Date.now() - 10 * 60_000;
  for (const [k, b] of buckets) if (b.at < old) buckets.delete(k);
  for (const [k, t] of taskOpened) if (t < old) taskOpened.delete(k);
}, 60_000).unref();

function authenticate(req) {
  const header = req.headers.authorization ?? '';
  let tgUser = null;
  if (header.startsWith('tma ')) tgUser = validateInitData(header.slice(4), config.botToken);
  else if (DEV_AUTH && req.headers['x-dev-user']) {
    try {
      tgUser = {
        ...JSON.parse(decodeURIComponent(req.headers['x-dev-user'])),
        authDate: Math.floor(Date.now() / 1000),
      };
    } catch {}
  }
  if (!tgUser) throw new AppError('UNAUTHORIZED', 'Откройте приложение через Telegram', 401);
  rateLimit(`u:${tgUser.id}`, 240);
  const isNew = !store.getUser(tgUser.id);
  let user = store.upsertUser(tgUser);
  const ref = /^ref_(\d{1,15})$/.exec(tgUser.startParam ?? '');
  if (isNew && ref && store.setReferrer(user.id, Number(ref[1]))) {
    user = store.getUser(user.id);
    bot?.onInvited(user).catch(() => {});
  }
  if (user.blocked && !isAdmin(user.id)) throw new AppError('BLOCKED', 'Ваш аккаунт заблокирован', 403);
  user.authDate = tgUser.authDate;
  return user;
}

const isAdmin = (id) => !!config.adminId && String(id) === String(config.adminId);

function requireAdmin(req) {
  const user = authenticate(req);
  if (!isAdmin(user.id)) throw new AppError('FORBIDDEN', 'Недоступно', 403);
  if (!DEV_AUTH && Date.now() / 1000 - user.authDate > 6 * 3600) {
    throw new AppError('UNAUTHORIZED', 'Сессия устарела. Перезапустите приложение', 401);
  }
  return user;
}

function amountOf(body, min) {
  const n = Number(body.amount);
  if (!Number.isSafeInteger(n) || n < min) throw new AppError('BAD_AMOUNT', `Минимальная сумма — ${min}`);
  if (n > config.limits.maxAmount) throw new AppError('BAD_AMOUNT', 'Слишком большая сумма');
  return n;
}

const lastAction = new Map();
const taskOpened = new Map();
const publicTask = (t) => ({ id: t.id, kind: t.kind, title: t.title, url: t.url, reward: t.reward, done: t.done });
function throttle(userId, ms = 400) {
  const now = Date.now();
  if (now - (lastAction.get(userId) ?? 0) < ms) throw new AppError('TOO_FAST', 'Слишком часто', 429);
  lastAction.set(userId, now);
}

function profile(user) {
  return {
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photo: user.photo_url,
      balance: user.balance,
      games: user.games,
      wins: user.wins,
      losses: user.losses,
    },
    withdrawals: store.userWithdrawals(user.id).map((w) => ({
      id: w.id,
      amount: w.amount,
      fee: w.fee,
      total: w.total,
      status: w.status,
      reason: w.reason,
      createdAt: w.created_at,
    })),
    wager: store.wager(user.id, config.wager),
    admin: isAdmin(user.id),
  };
}

const routes = {
  'GET /api/config': () => ({
    supportUsername: config.supportUsername,
    channelUrl: config.channelUrl,
    withdrawChannel: config.withdrawChannel,
    botUsername: bot?.username ?? '',
    minBet: config.game.minBet,
    minDeposit: config.limits.minDeposit,
    minWithdraw: config.limits.minWithdraw,
    withdrawFee: config.limits.withdrawFee,
    maxAmount: config.limits.maxAmount,
    wager: config.wager,
  }),

  'GET /api/round': () => game.publicState(),

  'POST /api/me': (req) => profile(authenticate(req)),

  'POST /api/friends': async (req) => {
    const user = authenticate(req);
    const { list, n, earned } = store.friends(user.id);
    return {
      link: bot?.username
        ? bot.referralLink(user.id)
        : config.devMode
          ? `https://t.me/roulette_bot?startapp=ref_${user.id}`
          : '',
      percent: config.refPercent,
      count: n,
      earned,
      friends: list.map((f) => ({
        id: f.id,
        name: [f.first_name, f.last_name].filter(Boolean).join(' ') || (f.username ? `@${f.username}` : 'Игрок'),
        username: f.username,
        photo: f.photo_url,
        earned: f.earned,
      })),
      ...profile(store.getUser(user.id)),
    };
  },

  'POST /api/bet': async (req) => {
    const user = authenticate(req);
    const amount = amountOf(await readJson(req), config.game.minBet);
    throttle(user.id);
    game.placeBet(user, amount);
    return profile(store.getUser(user.id));
  },

  'POST /api/deposit': async (req) => {
    const user = authenticate(req);
    const amount = amountOf(await readJson(req), config.limits.minDeposit);
    if (!bot && DEV_AUTH) {
      store.creditPayment({
        chargeId: `dev-${Date.now()}-${Math.random()}`,
        userId: user.id,
        amount,
        payload: 'dev',
        refPercent: config.refPercent,
      });
      return { dev: true, ...profile(store.getUser(user.id)) };
    }
    if (!bot) throw new AppError('NO_BOT', 'Оплата недоступна', 503);
    return { link: await bot.createDepositLink(user.id, amount) };
  },

  'POST /api/tasks': (req) => ({ tasks: store.userTasks(authenticate(req).id).map(publicTask) }),

  'POST /api/tasks/open': async (req) => {
    const user = authenticate(req);
    const id = Number((await readJson(req)).id);
    if (!Number.isSafeInteger(id) || !store.getTask(id)?.active)
      throw new AppError('TASK_GONE', 'Задание больше недоступно', 404);
    const key = `${user.id}:${id}`;
    if (!taskOpened.has(key)) taskOpened.set(key, Date.now());
    return { ok: true };
  },

  'POST /api/tasks/check': async (req) => {
    const user = authenticate(req);
    const { id } = await readJson(req);
    throttle(user.id, 1500);
    rateLimit(`task:${user.id}`, 10);
    const task = store.getTask(Number(id));
    if (!task?.active) throw new AppError('TASK_GONE', 'Задание больше недоступно', 404);
    if (task.kind === 'subscribe') {
      let member = false;
      try {
        member = bot ? await bot.isMember(task.chat_ref, user.id) : DEV_AUTH;
      } catch {
        throw new AppError('CHECK_FAILED', 'Не удалось проверить подписку. Попробуйте через минуту', 503);
      }
      if (!member) throw new AppError('NOT_DONE', 'Подписка не найдена. Подпишитесь и нажмите «Проверить»');
    } else {
      const opened = taskOpened.get(`${user.id}:${task.id}`);
      if (!opened) throw new AppError('NOT_DONE', 'Сначала откройте ссылку задания');
      if (Date.now() - opened < 5000)
        throw new AppError('NOT_DONE', 'Загляните по ссылке и нажмите «Проверить» через пару секунд');
    }
    const updated = store.completeTask(task.id, user.id);
    if (!updated) throw new AppError('ALREADY', 'Награда за это задание уже получена', 409);
    broadcast('balance', { id: user.id });
    return { reward: task.reward, ...profile(updated), tasks: store.userTasks(user.id).map(publicTask) };
  },

  'GET /api/crash': () => crash.publicState(),
  'GET /api/crash/fair': () => ({ edge: config.crash.houseEdge, rounds: crash.fairness(30) }),
  'POST /api/crash/bet': async (req) => {
    const user = authenticate(req);
    const { amount, auto } = await readJson(req);
    throttle(user.id, 300);
    return { ...crash.placeBet(user, amount, auto), ...profile(store.getUser(user.id)) };
  },
  'POST /api/crash/cancel': (req) => {
    const user = authenticate(req);
    throttle(user.id, 300);
    return { ...crash.cancelBet(user.id), ...profile(store.getUser(user.id)) };
  },
  'POST /api/crash/cashout': (req) => {
    const user = authenticate(req);
    return { ...crash.cashout(user.id), ...profile(store.getUser(user.id)) };
  },
  'POST /api/crash/my': (req) => ({ bets: crash.myBets(authenticate(req).id) }),

  'POST /api/basket/state': (req) => basket.state(authenticate(req).id),
  'POST /api/basket/play': (req) => {
    const user = authenticate(req);
    throttle(user.id, 800);
    return { ...basket.play(user), ...profile(store.getUser(user.id)) };
  },

  'POST /api/ping': (req) => {
    const user = authenticate(req);
    rateLimit(`ping:${user.id}`, 6);
    seenAt.set(user.id, Date.now());
    return { online: onlineCount() };
  },
  'POST /api/basket/shot': async (req) => {
    const user = authenticate(req);
    rateLimit(`shot:${user.id}`, 120);
    return basket.shoot(user.id, await readJson(req));
  },

  'POST /api/withdraw': async (req) => {
    const user = authenticate(req);
    const amount = amountOf(await readJson(req), config.limits.minWithdraw);
    throttle(user.id, 1500);
    rateLimit(`wd:${user.id}`, 3);
    const { left } = store.wager(user.id, config.wager);
    if (left > 0) throw new AppError('WAGER', `Для вывода нужно сделать ставок ещё на ${left} ⭐`);
    await bot?.assertSubscribed(config.withdrawChannel, user.id);
    const fee = Math.ceil(amount * config.limits.withdrawFee);
    const { withdrawal } = store.withdraw(user.id, amount, fee);
    broadcast('balance', { id: user.id });
    bot?.notifyWithdrawal(withdrawal, store.getUser(user.id)).catch((e) => console.error('Заявка админу:', e.message));
    return profile(store.getUser(user.id));
  },
  ...createAdminRoutes({
    store,
    bot,
    config,
    crash,
    readJson,
    requireAdmin,
    notifyBalance: (id) => broadcast('balance', { id }),
  }),
};

const MAX_STREAMS = 5000;
const MAX_STREAMS_PER_IP = 8;

function openStream(req, res) {
  const ip = clientIp(req);
  const n = streamsByIp.get(ip) ?? 0;
  if (streams.size >= MAX_STREAMS || n >= MAX_STREAMS_PER_IP) return send(res, 429, { error: 'TOO_MANY' });
  streamsByIp.set(ip, n + 1);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 2000\nevent: round\ndata: ${JSON.stringify(game.publicState())}\n\n`);
  streams.add(res);
  req.on('close', () => {
    streams.delete(res);
    const left = (streamsByIp.get(ip) ?? 1) - 1;
    if (left > 0) streamsByIp.set(ip, left);
    else streamsByIp.delete(ip);
  });
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    return send(res, 400, { error: 'BAD_PATH' });
  }
  if (rel.split(/[/\\]/).some((part) => part.startsWith('.'))) return send(res, 404, { error: 'NOT_FOUND' });
  let file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'FORBIDDEN' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(PUBLIC_DIR, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, { error: 'NOT_FOUND' });
  }
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return send(res, 400, { error: 'BAD_URL' });
  }
  try {
    if (pathname.startsWith('/api/')) rateLimit(`ip:${clientIp(req)}`, 600);
    if (pathname === '/api/stream') return openStream(req, res);
    const handler = routes[`${req.method} ${pathname}`];
    if (handler) return send(res, 200, await handler(req));
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND', message: 'Нет такого метода' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (err) {
    if (err instanceof AppError) return send(res, err.status, { error: err.code, message: err.message });
    console.error(err);
    send(res, 500, { error: 'INTERNAL', message: 'Что-то пошло не так. Попробуйте ещё раз' });
  }
});

game.start();
setInterval(() => basket.tick(), 1000).unref();
basket.on('balance', (id) => broadcast('balance', { id }));
basket.on('flag', ({ gameId, userId, score, shots }) => {
  console.warn(`Basketball Rush: подозрительная серия у ${userId} (попытка ${gameId})`);
  const u = store.getUser(userId);
  bot?.notifyAdmin(
    `🏀 <b>Basketball Rush: проверьте игрока</b>\n${u?.username ? '@' + u.username + ' · ' : ''}ID <code>${userId}</code>\n` +
      `Попытка #${gameId}: ${score} из ${shots}, время реакции почти одинаковое. Результат помечен.`,
  );
});
basket.on('dayClosed', ({ day, winner, prize }) => {
  if (!winner) return;
  broadcast('balance', { id: winner.user_id });
  bot?.notifyUser(
    winner.user_id,
    `🏆 <b>Basketball Rush</b>\nВы — лучший игрок дня ${day} (${winner.score} очков)!\nПриз <b>+${prize} ⭐</b> уже на балансе.`,
  );
});
basket.on('legacyRefund', ({ userId, stake, gameId }) => {
  bot?.notifyUser(
    userId,
    `🏀 Basketball Rush стал ежедневным турниром. Ставка <b>${stake} ⭐</b> за незавершённый матч #${gameId} возвращена.`,
  );
});

const seenAt = new Map();
function onlineCount() {
  const since = Date.now() - 70_000;
  let n = 0;
  for (const [id, t] of seenAt) {
    if (t >= since) n++;
    else seenAt.delete(id);
  }
  return n;
}
setInterval(() => broadcast('online', { online: onlineCount() }), 15_000).unref();

server.listen(config.port, () =>
  console.log(`Сервер слушает порт ${config.port}${config.devMode ? ' (DEV_MODE)' : ''}`),
);
bot?.start().catch((e) => {
  console.error('Бот не запустился:', e.message);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    game.stop();
    bot?.stop();
    for (const res of streams) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
