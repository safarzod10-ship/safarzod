// Точка входа: HTTP API + раздача мини-аппа + живые обновления раунда (SSE) + бот.

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
};

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

// ---------- SSE: состояние раунда всем подключённым клиентам ----------
const streams = new Set();
game.on('update', (state) => broadcast('round', state));
crash.on('update', (state) => broadcast('crash', state));
crash.on('balance', (id) => broadcast('balance', { id }));
if (bot) bot.crashStats = (since) => crash.stats(since);
if (bot) bot.onBalance = (user) => broadcast('balance', { id: user.id }); // клиент сам запросит /api/me

function broadcast(event, data) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) res.write(chunk);
}
setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 20_000).unref();

// ---------- Вспомогательное ----------
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024) throw new AppError('TOO_LARGE', 'Слишком большой запрос', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('BAD_JSON', 'Некорректный запрос');
  }
}

function authenticate(req) {
  const header = req.headers.authorization ?? '';
  let tgUser = null;
  if (header.startsWith('tma ')) tgUser = validateInitData(header.slice(4), config.botToken);
  else if (config.devMode && req.headers['x-dev-user']) tgUser = JSON.parse(decodeURIComponent(req.headers['x-dev-user']));
  if (!tgUser) throw new AppError('UNAUTHORIZED', 'Откройте приложение через Telegram', 401);
  const isNew = !store.getUser(tgUser.id);
  let user = store.upsertUser(tgUser);
  // Новый игрок пришёл по реферальной ссылке t.me/<бот>?startapp=ref_<id>
  const ref = /^ref_(\d{1,15})$/.exec(tgUser.startParam ?? '');
  if (isNew && ref && store.setReferrer(user.id, Number(ref[1]))) {
    user = store.getUser(user.id);
    bot?.onInvited(user).catch(() => {});
  }
  if (user.blocked) throw new AppError('BLOCKED', 'Ваш аккаунт заблокирован', 403);
  return user;
}

function amountOf(body, min) {
  const n = Number(body.amount);
  if (!Number.isSafeInteger(n) || n < min) throw new AppError('BAD_AMOUNT', `Минимальная сумма — ${min}`);
  if (n > config.limits.maxAmount) throw new AppError('BAD_AMOUNT', 'Слишком большая сумма');
  return n;
}

const lastAction = new Map(); // защита от случайных двойных нажатий
const taskOpened = new Map(); // `${userId}:${taskId}` → когда игрок открыл ссылку задания
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
  };
}

// ---------- API ----------
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
  }),

  'GET /api/round': () => game.publicState(),

  'POST /api/me': (req) => profile(authenticate(req)),

  'POST /api/friends': async (req) => {
    const user = authenticate(req);
    const { list, n, earned } = store.friends(user.id);
    return {
      link: bot?.username ? bot.referralLink(user.id) : config.devMode ? `https://t.me/roulette_bot?startapp=ref_${user.id}` : '',
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
    if (!bot && config.devMode) {
      // Локальная разработка без бота: зачисляем сразу, чтобы можно было проверить интерфейс.
      store.creditPayment({ chargeId: `dev-${Date.now()}-${Math.random()}`, userId: user.id, amount, payload: 'dev', refPercent: config.refPercent });
      return { dev: true, ...profile(store.getUser(user.id)) };
    }
    if (!bot) throw new AppError('NO_BOT', 'Оплата недоступна', 503);
    return { link: await bot.createDepositLink(user.id, amount) };
  },

  'POST /api/tasks': (req) => ({ tasks: store.userTasks(authenticate(req).id).map(publicTask) }),

  // Игрок открыл ссылку задания — запоминаем время (для заданий без автоматической проверки)
  'POST /api/tasks/open': async (req) => {
    const user = authenticate(req);
    const { id } = await readJson(req);
    taskOpened.set(`${user.id}:${Number(id)}`, Date.now());
    return { ok: true };
  },

  'POST /api/tasks/check': async (req) => {
    const user = authenticate(req);
    const { id } = await readJson(req);
    throttle(user.id, 1500);
    const task = store.getTask(Number(id));
    if (!task?.active) throw new AppError('TASK_GONE', 'Задание больше недоступно', 404);
    if (task.kind === 'subscribe') {
      let member = false;
      try {
        member = bot ? await bot.isMember(task.chat_ref, user.id) : config.devMode;
      } catch {
        throw new AppError('CHECK_FAILED', 'Не удалось проверить подписку. Попробуйте через минуту', 503);
      }
      if (!member) throw new AppError('NOT_DONE', 'Подписка не найдена. Подпишитесь и нажмите «Проверить»');
    } else {
      const opened = taskOpened.get(`${user.id}:${task.id}`);
      if (!opened) throw new AppError('NOT_DONE', 'Сначала откройте ссылку задания');
      if (Date.now() - opened < 5000) throw new AppError('NOT_DONE', 'Загляните по ссылке и нажмите «Проверить» через пару секунд');
    }
    const updated = store.completeTask(task.id, user.id);
    if (!updated) throw new AppError('ALREADY', 'Награда за это задание уже получена', 409);
    broadcast('balance', { id: user.id });
    return { reward: task.reward, ...profile(updated), tasks: store.userTasks(user.id).map(publicTask) };
  },

  // ---------- Basketball Rush ----------
  // ---------- Racket Crash ----------
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
    return { ...crash.cancelBet(user.id), ...profile(store.getUser(user.id)) };
  },
  'POST /api/crash/cashout': (req) => {
    const user = authenticate(req);
    return { ...crash.cashout(user.id), ...profile(store.getUser(user.id)) };
  },
  'POST /api/crash/my': (req) => ({ bets: crash.myBets(authenticate(req).id) }),

  'POST /api/basket/state': (req) => basket.state(authenticate(req).id),
  'POST /api/basket/play': async (req) => {
    const user = authenticate(req);
    const { stake } = await readJson(req);
    throttle(user.id, 800);
    return { ...basket.play(user, stake), ...profile(store.getUser(user.id)) };
  },
  'POST /api/basket/shot': async (req) => basket.shoot(authenticate(req).id, await readJson(req)),

  'POST /api/withdraw': async (req) => {
    const user = authenticate(req);
    const amount = amountOf(await readJson(req), config.limits.minWithdraw);
    throttle(user.id, 1500);
    await bot?.assertSubscribed(config.withdrawChannel, user.id); // вывод — только подписчикам канала
    const fee = Math.ceil(amount * config.limits.withdrawFee);
    const { withdrawal } = store.withdraw(user.id, amount, fee);
    bot?.notifyWithdrawal(withdrawal, store.getUser(user.id)).catch((e) => console.error('Заявка админу:', e.message));
    return profile(store.getUser(user.id));
  },
};

function openStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 2000\nevent: round\ndata: ${JSON.stringify(game.publicState())}\n\n`);
  streams.add(res);
  req.on('close', () => streams.delete(res));
}

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'FORBIDDEN' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(PUBLIC_DIR, 'index.html'); // одностраничное приложение
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, { error: 'NOT_FOUND' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
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
setInterval(() => basket.tick(), 1000).unref(); // доигранные попытки, итоги, возвраты через 12 часов
basket.on('balance', (id) => broadcast('balance', { id }));
basket.on('flag', ({ gameId, userId, score, shots }) => {
  console.warn(`Basketball Rush: подозрительная серия у ${userId} (матч ${gameId})`);
  const u = store.getUser(userId);
  bot?.notifyAdmin(
    `🏀 <b>Basketball Rush: проверьте игрока</b>\n${u?.username ? '@' + u.username + ' · ' : ''}ID <code>${userId}</code>\n` +
      `Матч #${gameId}: ${score} из ${shots}, время реакции почти одинаковое. Результат помечен.`,
  );
});
basket.on('closed', ({ game, entries, refunded }) => {
  for (const e of entries) {
    broadcast('balance', { id: e.user_id });
    if (!bot) continue;
    if (refunded) {
      bot.notifyUser(e.user_id, `🏀 Матч #${game.id} не собрал троих за час — ставка <b>${game.stake} ⭐</b> возвращена на баланс.`);
    } else {
      const table = [...entries]
        .sort((a, b) => a.place - b.place)
        .map((x) => `${['🥇', '🥈', '🥉'][x.place - 1] ?? x.place} ${x.user_id === e.user_id ? '<b>Вы</b>' : 'Игрок'} — ${x.score}`)
        .join('\n');
      const head = e.prize > 0 ? `🏆 Победа! <b>+${e.prize} ⭐</b>` : `Итог: ${e.place}-е место`;
      bot.notifyUser(e.user_id, `🏀 <b>Basketball Rush · матч #${game.id}</b>\n${head}\n\n${table}`);
    }
  }
});server.listen(config.port, () => console.log(`Сервер слушает порт ${config.port}${config.devMode ? ' (DEV_MODE)' : ''}`));
bot?.start().catch((e) => {
  console.error('Бот не запустился:', e.message);
  process.exit(1); // Docker перезапустит контейнер
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
