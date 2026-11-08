import { AppError, GRAM, NANO, XTR } from './db.js';

const DAY = 86_400_000;
const GAME_KINDS = {
  roulette: { bet: 'bet', win: 'win', refund: 'refund' },
  crash: { bet: 'crash_bet', win: 'crash_win', refund: 'crash_refund' },
  basket: { bet: 'basket_entry', win: 'basket_prize', refund: 'basket_refund' },
};

const int = (v, { min = -Infinity, max = Infinity, name = 'value' } = {}) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new AppError('BAD_INPUT', `Некорректное значение: ${name}`);
  return n;
};

const text = (v, { max, name, required = true }) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new AppError('BAD_INPUT', `Заполните поле «${name}»`);
  if (s.length > max) throw new AppError('BAD_INPUT', `Поле «${name}» длиннее ${max} символов`);
  return s;
};

const userView = (u) => ({
  id: u.id,
  name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Игрок',
  username: u.username,
  photo: u.photo_url,
  balance: u.balance,
  gram: u.gram ?? 0,
  blocked: !!u.blocked,
  createdAt: u.created_at,
  deposited: u.deposited,
  depositedGram: u.deposited_gram ?? 0,
});

const withdrawalView = (w) => ({
  id: w.id,
  amount: w.amount,
  fee: w.fee,
  total: w.total,
  currency: w.currency,
  address: w.address,
  status: w.status,
  reason: w.reason,
  createdAt: w.created_at,
  processedAt: w.processed_at,
  user: w.first_name !== undefined ? userView({ ...w, id: w.user_id }) : undefined,
});

export function createAdminRoutes({
  store,
  bot,
  config,
  crash,
  readJson,
  requireAdmin,
  notifyBalance,
  isOnline = () => false,
  onlineIds = () => [],
  priceInfo = () => null,
}) {
  const cache = new Map();
  const q = {
    flagged: 'SELECT COUNT(*) AS n FROM basket_attempts WHERE user_id = ? AND flagged = 1',
    basketBest:
      "SELECT COALESCE(MAX(score), 0) AS best, COUNT(*) AS n FROM basket_attempts WHERE user_id = ? AND status = 'done'",
    crashBets: `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN cashout IS NOT NULL THEN 1 ELSE 0 END), 0) AS won
                           FROM crash_bets WHERE user_id = ?`,
    basketStats: `SELECT COUNT(*) AS n,
                               COALESCE(SUM(CASE WHEN currency = 'GRAM' THEN -amount * :rate / 1e9 ELSE -amount END), 0) AS sum
                  FROM ledger WHERE kind = 'basket_entry' AND created_at >= :since`,
    basketPrizes:
      "SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE kind = 'basket_prize' AND currency = 'XTR' AND created_at >= ?",
  };

  const safe = (sql, ...args) => {
    try {
      if (!cache.has(sql)) cache.set(sql, store.db.prepare(sql));
      return cache.get(sql).get(...args);
    } catch {
      return null;
    }
  };

  function gameSummary(totals) {
    const rate = store.rate();
    const side = (k, suffix) => {
      const pick = (kind) => totals[kind + suffix] ?? { n: 0, sum: 0 };
      const bet = pick(k.bet);
      const win = pick(k.win);
      const refund = pick(k.refund);
      const staked = -bet.sum - refund.sum;
      return { bets: bet.n, staked, wins: win.n, won: win.sum, net: win.sum - staked };
    };
    return Object.fromEntries(
      Object.entries(GAME_KINDS).map(([game, k]) => {
        const xtr = side(k, '');
        const gram = side(k, ':GRAM');
        return [
          game,
          {
            bets: xtr.bets + gram.bets,
            wins: xtr.wins + gram.wins,
            xtr,
            gram,
            net: xtr.net + (gram.net * rate) / NANO,
          },
        ];
      }),
    );
  }

  function detail(id) {
    const u = store.getUser(id);
    if (!u) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
    const totals = store.kindTotals(id);
    const pick = (k) => totals[k] ?? { n: 0, sum: 0 };
    const summary = store.userSummary(id);
    const deposits = summary.deposits;
    const gramDeposits = summary.gramDeposits;
    const range = store.depositRange(id);
    const withdrawals = store.userWithdrawals(id, 50);
    const by = (status) => withdrawals.filter((w) => w.status === status);
    const sum = (list) => ({
      xtr: list.filter((w) => w.currency !== GRAM).reduce((a, w) => a + w.amount, 0),
      gram: list.filter((w) => w.currency === GRAM).reduce((a, w) => a + w.amount, 0),
    });
    const ledgerXtr = store.ledgerSum(id, XTR);
    const ledgerGram = store.ledgerSum(id, GRAM);
    const both = (kind) => ({ xtr: pick(kind).sum, gram: pick(`${kind}:GRAM`).sum });
    const referrer = u.referrer_id ? store.getUser(u.referrer_id) : null;
    const crashRow = safe(q.crashBets, id);
    const basketRow = safe(q.basketBest, id);
    return {
      user: {
        ...userView({ ...u, deposited: deposits.sum, deposited_gram: gramDeposits.sum }),
        referrerId: u.referrer_id,
        updatedAt: u.updated_at,
        online: isOnline(id),
      },
      rate: store.rate(),
      roulette: { games: u.games, wins: u.wins, losses: u.losses },
      games: gameSummary(totals),
      crash: { rounds: crashRow?.n ?? 0, cashouts: crashRow?.won ?? 0 },
      basket: { attempts: basketRow?.n ?? 0, best: basketRow?.best ?? 0, flagged: safe(q.flagged, id)?.n ?? 0 },
      money: {
        deposits: { n: deposits.n, sum: deposits.sum, first: range.first, last: range.last },
        gramDeposits: { n: gramDeposits.n, sum: gramDeposits.sum },
        withdrawn: { n: by('sent').length, ...sum(by('sent')) },
        pending: { n: by('pending').length, ...sum(by('pending')) },
        cancelled: { n: by('cancelled').length, ...sum(by('cancelled')) },
        referral: {
          xtr: both('referral').xtr + both('ref_deposit').xtr,
          gram: both('referral').gram + both('ref_deposit').gram,
        },
        tasks: { n: pick('task').n, sum: pick('task').sum },
        admin: both('admin'),
      },
      wager: store.wager(id, config.wager),
      friends: store.friends(id).n,
      referrer: referrer ? userView(referrer) : null,
      withdrawals: withdrawals.map(withdrawalView),
      integrity: { ok: ledgerXtr === u.balance && ledgerGram === u.gram, xtr: ledgerXtr, gram: ledgerGram },
      ledger: store.ledgerPage(id),
    };
  }

  function overview() {
    const s = store.stats();
    const now = Date.now();
    const periods = { day: now - DAY, week: now - 7 * DAY, month: now - 30 * DAY };
    const per = (fn) => Object.fromEntries(Object.entries(periods).map(([k, since]) => [k, fn(since)]));
    return {
      ...s,
      rate: store.rate(),
      price: priceInfo(),
      crash: per((since) => crash.stats(since)),
      basket: per((since) => {
        const e = safe(q.basketStats, { since, rate: store.rate() }) ?? { n: 0, sum: 0 };
        const prize = safe(q.basketPrizes, since)?.sum ?? 0;
        return { attempts: e.n, staked: e.sum, prizes: prize, profit: e.sum - prize };
      }),
    };
  }

  async function body(req, max) {
    return (await readJson(req, max)) ?? {};
  }

  return {
    'POST /api/admin/overview': (req) => {
      requireAdmin(req);
      return overview();
    },

    'POST /api/admin/rate': async (req) => {
      requireAdmin(req);
      const rate = int((await body(req)).rate, { min: 1, max: 1_000_000, name: 'курс' });
      return { rate: store.setRate(rate) };
    },

    'POST /api/admin/users': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const offset = int(b.offset ?? 0, { min: 0, max: 1e7, name: 'offset' });
      const online = onlineIds();
      if (b.online) {
        const rate = store.rate();
        const list = online
          .map((id) => store.getUser(id))
          .filter(Boolean)
          .sort((x, y) => y.balance + (y.gram * rate) / NANO - (x.balance + (x.gram * rate) / NANO));
        return {
          total: list.length,
          offset: 0,
          rate,
          onlineCount: online.length,
          users: list.map((u) => ({ ...userView(u), online: true })),
        };
      }
      const { total, users } = store.adminUsers({
        query: text(b.query, { max: 64, name: 'поиск', required: false }),
        limit: 50,
        offset,
      });
      return {
        total,
        offset,
        rate: store.rate(),
        onlineCount: online.length,
        users: users.map((u) => ({ ...userView(u), online: isOnline(u.id) })),
      };
    },

    'POST /api/admin/user': async (req) => {
      requireAdmin(req);
      return detail(int((await body(req)).id, { min: 1, name: 'id' }));
    },

    'POST /api/admin/ledger': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const id = int(b.id, { min: 1, name: 'id' });
      const before = int(b.before ?? Number.MAX_SAFE_INTEGER, { min: 1, name: 'before' });
      return { ledger: store.ledgerPage(id, before, 50) };
    },

    'POST /api/admin/block': async (req) => {
      const admin = requireAdmin(req);
      const b = await body(req);
      const id = int(b.id, { min: 1, name: 'id' });
      if (id === admin.id) throw new AppError('BAD_INPUT', 'Нельзя заблокировать себя');
      if (!store.setBlocked(id, !!b.blocked)) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
      notifyBalance(id);
      return detail(id);
    },

    'POST /api/admin/balance': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const id = int(b.id, { min: 1, name: 'id' });
      const currency = b.currency === GRAM ? GRAM : XTR;
      let delta;
      if (currency === GRAM) {
        const raw = String(b.delta ?? '')
          .trim()
          .replace(',', '.');
        if (!/^[+-]?\d{1,7}(\.\d{1,4})?$/.test(raw)) throw new AppError('BAD_INPUT', 'Некорректное значение: сумма');
        delta = Math.round(Number(raw) * 10_000) * 100_000;
      } else {
        delta = int(b.delta, { min: -config.limits.maxAmount, max: config.limits.maxAmount, name: 'сумма' });
      }
      if (!delta) throw new AppError('BAD_INPUT', 'Сумма не может быть нулевой');
      const { applied } = store.adjustBalance(id, delta, currency);
      notifyBalance(id);
      return { applied, ...detail(id) };
    },

    'POST /api/admin/message': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const id = int(b.id, { min: 1, name: 'id' });
      const msg = text(b.text, { max: 4000, name: 'сообщение' });
      if (!store.getUser(id)) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
      if (!bot) throw new AppError('NO_BOT', 'Бот не подключён', 503);
      if (!(await bot.message(id, msg)))
        throw new AppError('NOT_DELIVERED', 'Не доставлено: пользователь не запускал бота или заблокировал его', 409);
      return { ok: true };
    },

    'POST /api/admin/broadcast': async (req) => {
      requireAdmin(req);
      const b = await body(req, 6 * 1024 * 1024);
      const photo = b.photo ? decodeImage(b.photo) : null;
      const msg = text(b.text, { max: photo ? 1024 : 4000, name: 'текст', required: !photo });
      if (!bot) throw new AppError('NO_BOT', 'Бот не подключён', 503);
      return bot.broadcast({ text: msg, photo });
    },

    'POST /api/admin/broadcast/status': (req) => {
      requireAdmin(req);
      return { ...(bot?.broadcastStatus() ?? { running: false }), audience: store.broadcastIds().length };
    },

    'POST /api/admin/tasks': (req) => {
      requireAdmin(req);
      return { tasks: store.activeTasks() };
    },

    'POST /api/admin/tasks/add': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const url = text(b.url, { max: 300, name: 'ссылка' });
      const reward = int(b.reward, { min: 1, max: 100_000, name: 'награда' });
      const title = text(b.title, { max: 80, name: 'название', required: false });
      const draft = bot ? await bot.describeTaskLink(url) : describeLocal(url);
      if (!draft) throw new AppError('BAD_INPUT', 'Это не похоже на ссылку: нужен https://… или @name');
      const task = store.addTask({ ...draft, title: title || draft.title, reward });
      return { task, note: draft.note?.replace(/<[^>]+>/g, '') ?? '', tasks: store.activeTasks() };
    },

    'POST /api/admin/tasks/delete': async (req) => {
      requireAdmin(req);
      store.disableTask(int((await body(req)).id, { min: 1, name: 'id' }));
      return { tasks: store.activeTasks() };
    },

    'POST /api/admin/withdrawals': (req) => {
      requireAdmin(req);
      return {
        pending: store.withdrawalsByStatus('pending', 100).map(withdrawalView),
        recent: [...store.withdrawalsByStatus('sent', 20), ...store.withdrawalsByStatus('cancelled', 20)]
          .sort((a, b) => b.id - a.id)
          .slice(0, 30)
          .map(withdrawalView),
      };
    },

    'POST /api/admin/withdrawals/sent': async (req) => {
      requireAdmin(req);
      const id = int((await body(req)).id, { min: 1, name: 'id' });
      const done = bot ? await bot.completeWithdrawal(id) : store.markWithdrawalSent(id);
      if (!done) throw new AppError('ALREADY', 'Заявка уже обработана', 409);
      return { ok: true };
    },

    'POST /api/admin/withdrawals/cancel': async (req) => {
      requireAdmin(req);
      const b = await body(req);
      const id = int(b.id, { min: 1, name: 'id' });
      const reason = text(b.reason, { max: 300, name: 'причина' });
      const w = bot ? await bot.cancelWithdrawal(id, reason) : store.cancelWithdrawal(id, reason);
      if (!w) throw new AppError('ALREADY', 'Заявка уже обработана', 409);
      notifyBalance(w.user_id);
      return { ok: true };
    },
  };
}

function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new AppError('BAD_INPUT', 'Поддерживаются изображения JPEG, PNG или WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new AppError('BAD_INPUT', 'Изображение больше 5 МБ');
  const sig = buf.subarray(0, 4).toString('hex');
  if (!/^(ffd8ff|89504e47|52494646)/.test(sig)) throw new AppError('BAD_INPUT', 'Файл не похож на изображение');
  return buf;
}

function describeLocal(raw) {
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw.replace(/^@/, 't.me/')}`);
    return { kind: 'link', url: url.href, title: `Перейти на ${url.hostname}`, note: '' };
  } catch {
    return null;
  }
}
