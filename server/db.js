import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  first_name  TEXT NOT NULL DEFAULT '',
  last_name   TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  photo_url   TEXT NOT NULL DEFAULT '',
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  games       INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,
  bank        INTEGER NOT NULL DEFAULT 0,
  winner_id   INTEGER,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS bets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    INTEGER NOT NULL REFERENCES rounds(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bets_round ON bets(round_id);
CREATE TABLE IF NOT EXISTS withdrawals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  fee         INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  reason      TEXT NOT NULL DEFAULT '',
  admin_chat_id    INTEGER,
  admin_message_id INTEGER,
  created_at  INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals(user_id, id);
CREATE TABLE IF NOT EXISTS payments (
  charge_id   TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  ref         INTEGER,
  created_at  INTEGER NOT NULL
);
`;

export const XTR = 'XTR';
export const GRAM = 'GRAM';
export const NANO = 1_000_000_000;

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, 'roulette.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  migrate(db);
  return new Store(db);
}

function migrate(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((c) => c.name),
  );
  if (!columns.has('blocked')) db.exec('ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('referrer_id')) db.exec('ALTER TABLE users ADD COLUMN referrer_id INTEGER');
  if (!columns.has('ref_rewarded')) db.exec('ALTER TABLE users ADD COLUMN ref_rewarded INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('gram')) db.exec('ALTER TABLE users ADD COLUMN gram INTEGER NOT NULL DEFAULT 0 CHECK (gram >= 0)');
  const addColumn = (table, name, sql) => {
    const have = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
  };
  addColumn('ledger', 'currency', "TEXT NOT NULL DEFAULT 'XTR'");
  addColumn('bets', 'currency', "TEXT NOT NULL DEFAULT 'XTR'");
  addColumn('rounds', 'bank_xtr', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('rounds', 'bank_gram', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('withdrawals', 'currency', "TEXT NOT NULL DEFAULT 'XTR'");
  addColumn('withdrawals', 'address', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gram_deposits (
      tx_hash     TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      amount      INTEGER NOT NULL,
      sender      TEXT NOT NULL DEFAULT '',
      lt          TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gram_deposits_user ON gram_deposits(user_id);
    CREATE INDEX IF NOT EXISTS gram_deposits_created ON gram_deposits(created_at);
  `);
  db.exec('CREATE INDEX IF NOT EXISTS users_referrer ON users(referrer_id)');
  db.exec('CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS users_balance ON users(balance DESC, id)');
  db.exec('CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals(status, id)');
  db.exec(`
    CREATE INDEX IF NOT EXISTS users_username ON users(lower(username));
    CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
    CREATE INDEX IF NOT EXISTS payments_created ON payments(created_at);
    CREATE INDEX IF NOT EXISTS rounds_finished ON rounds(status, finished_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      chat_ref    TEXT NOT NULL DEFAULT '',
      reward      INTEGER NOT NULL CHECK (reward > 0),
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS basket_matches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    INTEGER NOT NULL,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS basket_results (
      match_id    INTEGER NOT NULL REFERENCES basket_matches(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      place       INTEGER NOT NULL,
      score       INTEGER NOT NULL,
      shots       INTEGER NOT NULL,
      quality     REAL NOT NULL,
      flagged     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (match_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS task_completions (
      task_id     INTEGER NOT NULL REFERENCES tasks(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (task_id, user_id)
    );
  `);
}

class Store {
  constructor(db) {
    this.db = db;
    const q = (sql) => db.prepare(sql);
    this.q = {
      upsertUser: q(`
        INSERT INTO users (id, first_name, last_name, username, photo_url, created_at, updated_at)
        VALUES (:id, :first_name, :last_name, :username, :photo_url, :now, :now)
        ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
          username = excluded.username,
          photo_url = CASE WHEN excluded.photo_url <> '' THEN excluded.photo_url ELSE users.photo_url END,
          updated_at = excluded.updated_at`),
      getUser: q('SELECT * FROM users WHERE id = ?'),
      debit: q('UPDATE users SET balance = balance - :amount WHERE id = :id AND balance >= :amount'),
      credit: q('UPDATE users SET balance = balance + :amount WHERE id = :id'),
      debitGram: q('UPDATE users SET gram = gram - :amount WHERE id = :id AND gram >= :amount'),
      creditGram: q('UPDATE users SET gram = gram + :amount WHERE id = :id'),
      ledger: q('INSERT INTO ledger (user_id, kind, amount, ref, created_at, currency) VALUES (?, ?, ?, ?, ?, ?)'),
      getSetting: q('SELECT value FROM settings WHERE key = ?'),
      setSetting: q(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ),
      addGramDeposit: q(`INSERT INTO gram_deposits (tx_hash, user_id, amount, sender, lt, created_at)
                         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tx_hash) DO NOTHING`),
      gramPaid: q('SELECT COALESCE(SUM(amount), 0) AS sum FROM gram_deposits WHERE user_id = ?'),
      userGramDeposits: q('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM gram_deposits WHERE user_id = ?'),
      gramDeposits: q('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM gram_deposits WHERE created_at >= ?'),
      newRound: q("INSERT INTO rounds (status, created_at) VALUES ('open', ?)"),
      addBet: q('INSERT INTO bets (round_id, user_id, amount, created_at, currency) VALUES (?, ?, ?, ?, ?)'),
      finishRound: q(`UPDATE rounds SET status = 'finished', total = ?, bank = ?, bank_xtr = ?, bank_gram = ?,
                      winner_id = ?, finished_at = ? WHERE id = ?`),
      stat: q(`UPDATE users SET games = games + 1, wins = wins + :win, losses = losses + :loss WHERE id = :id`),
      openRounds: q("SELECT id FROM rounds WHERE status = 'open'"),
      roundStakes: q(
        'SELECT user_id, currency, SUM(amount) AS amount FROM bets WHERE round_id = ? GROUP BY user_id, currency',
      ),
      markRefunded: q("UPDATE rounds SET status = 'refunded', finished_at = ? WHERE id = ?"),
      addPayment: q(`INSERT INTO payments (charge_id, user_id, amount, payload, created_at)
                     VALUES (?, ?, ?, ?, ?) ON CONFLICT(charge_id) DO NOTHING`),
      addWithdrawal: q(`INSERT INTO withdrawals (user_id, amount, fee, total, created_at, currency, address)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
      getWithdrawal: q('SELECT * FROM withdrawals WHERE id = ?'),
      userWithdrawals: q(`SELECT id, amount, fee, total, status, reason, created_at, processed_at, currency, address
                          FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
      closeWithdrawal: q(`UPDATE withdrawals SET status = :status, reason = :reason, processed_at = :now
                          WHERE id = :id AND status = 'pending'`),
      setAdminMessage: q('UPDATE withdrawals SET admin_chat_id = ?, admin_message_id = ? WHERE id = ?'),
      findByUsername: q("SELECT * FROM users WHERE lower(username) = lower(?) AND username <> '' LIMIT 1"),
      setBlocked: q('UPDATE users SET blocked = ? WHERE id = ?'),
      countUsers: q('SELECT COUNT(*) AS n FROM users'),
      newUsers: q('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?'),
      deposits: q('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE created_at >= ?'),
      games: q(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS turnover, COALESCE(SUM(total - bank), 0) AS income
                FROM rounds WHERE status = 'finished' AND finished_at >= ?`),
      pendingWithdrawals: q(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE status = 'pending'",
      ),
      userDeposits: q('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE user_id = ?'),
      userWithdrawn: q("SELECT COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE user_id = ? AND status = 'sent'"),
      adminUsers:
        q(`SELECT u.id, u.first_name, u.last_name, u.username, u.photo_url, u.balance, u.blocked, u.created_at,
                       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.user_id = u.id) AS deposited, u.gram,
                       (SELECT COALESCE(SUM(g.amount), 0) FROM gram_deposits g WHERE g.user_id = u.id) AS deposited_gram
                     FROM users u
                     WHERE :q = '' OR u.id = :id OR lower(u.username) LIKE :like OR lower(u.first_name || ' ' || u.last_name) LIKE :like
                     ORDER BY u.balance + u.gram * :rate / 1e9 DESC, u.id LIMIT :limit OFFSET :offset`),
      adminUsersCount: q(`SELECT COUNT(*) AS n FROM users u
                          WHERE :q = '' OR u.id = :id OR lower(u.username) LIKE :like OR lower(u.first_name || ' ' || u.last_name) LIKE :like`),
      kindTotals: q(
        'SELECT kind, currency, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? GROUP BY kind, currency',
      ),
      ledgerPage: q(
        'SELECT id, kind, amount, ref, currency, created_at FROM ledger WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
      ),
      ledgerSum: q('SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND currency = ?'),
      depositRange: q('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM payments WHERE user_id = ?'),
      withdrawalsByStatus: q(`SELECT w.*, u.first_name, u.last_name, u.username, u.photo_url, u.balance, u.gram
                              FROM withdrawals w JOIN users u ON u.id = w.user_id
                              WHERE w.status = ? ORDER BY w.id DESC LIMIT ?`),
      userPending: q("SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND status = 'pending'"),
      userWithdrawalsToday: q('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND created_at >= ?'),
      broadcastIds: q('SELECT id FROM users WHERE blocked = 0 ORDER BY id'),
      addTask: q('INSERT INTO tasks (kind, title, url, chat_ref, reward, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      getTask: q('SELECT * FROM tasks WHERE id = ?'),
      activeTasks: q(`SELECT t.*, (SELECT COUNT(*) FROM task_completions c WHERE c.task_id = t.id) AS done_count
                      FROM tasks t WHERE active = 1 ORDER BY id DESC`),
      userTasks: q(`SELECT t.id, t.kind, t.title, t.url, t.reward, (c.user_id IS NOT NULL) AS done
                    FROM tasks t LEFT JOIN task_completions c ON c.task_id = t.id AND c.user_id = ?
                    WHERE t.active = 1 ORDER BY done, t.id DESC`),
      disableTask: q('UPDATE tasks SET active = 0 WHERE id = ?'),
      completeTask: q(
        'INSERT INTO task_completions (task_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      ),
      topWinSince:
        q(`SELECT r.id, r.bank, r.bank_xtr, r.bank_gram, r.total, r.finished_at, u.id AS user_id, u.first_name, u.last_name, u.username, u.photo_url,
                          (SELECT SUM(CASE WHEN b.currency = 'GRAM' THEN b.amount * COALESCE((SELECT CAST(value AS REAL) FROM settings WHERE key = 'gram_rate'), 140) / 1e9 ELSE b.amount END)
                            FROM bets b WHERE b.round_id = r.id AND b.user_id = r.winner_id) AS stake
                        FROM rounds r JOIN users u ON u.id = r.winner_id
                        WHERE r.status = 'finished' AND r.finished_at >= ? ORDER BY r.bank DESC, r.id DESC LIMIT 1`),
      setReferrer: q('UPDATE users SET referrer_id = ? WHERE id = ? AND referrer_id IS NULL AND id <> ?'),
      friends: q(`SELECT u.id, u.first_name, u.last_name, u.username, u.photo_url, u.created_at,
                    (SELECT COALESCE(SUM(l.amount), 0) FROM ledger l
                      WHERE l.user_id = :inviter AND l.ref = u.id AND l.kind IN ('referral', 'ref_deposit') AND l.currency = 'XTR') AS earned,
                    (SELECT COALESCE(SUM(l.amount), 0) FROM ledger l
                      WHERE l.user_id = :inviter AND l.ref = u.id AND l.kind IN ('referral', 'ref_deposit') AND l.currency = 'GRAM') AS earned_gram
                  FROM users u WHERE u.referrer_id = :inviter ORDER BY earned DESC, u.id DESC LIMIT 200`),
      friendsCount: q('SELECT COUNT(*) AS n FROM users WHERE referrer_id = ?'),
      wagerRows: q(`SELECT kind, amount, ref, currency FROM ledger WHERE user_id = ? AND kind IN
        ('deposit', 'referral', 'ref_deposit', 'task', 'bet', 'crash_bet', 'basket_entry', 'refund', 'crash_refund') ORDER BY id`),
      refEarned: q(
        "SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND kind IN ('referral', 'ref_deposit') AND currency = 'XTR'",
      ),
      refEarnedGram: q(
        "SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND kind IN ('referral', 'ref_deposit') AND currency = 'GRAM'",
      ),
      userPaid: q('SELECT COALESCE(SUM(amount), 0) AS sum FROM payments WHERE user_id = ?'),
      refPaidFor: q(
        "SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND ref = ? AND kind = 'ref_deposit' AND currency = ?",
      ),
      recentWinners:
        q(`SELECT r.id, r.bank, r.bank_xtr, r.bank_gram, r.total, r.finished_at, u.id AS user_id, u.first_name, u.last_name, u.username, u.photo_url,
                          (SELECT SUM(CASE WHEN b.currency = 'GRAM' THEN b.amount * COALESCE((SELECT CAST(value AS REAL) FROM settings WHERE key = 'gram_rate'), 140) / 1e9 ELSE b.amount END)
                            FROM bets b WHERE b.round_id = r.id AND b.user_id = r.winner_id) AS stake
                        FROM rounds r JOIN users u ON u.id = r.winner_id
                        WHERE r.status = 'finished' ORDER BY r.id DESC LIMIT ?`),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  upsertUser(u) {
    this.q.upsertUser.run({
      id: u.id,
      first_name: u.first_name ?? '',
      last_name: u.last_name ?? '',
      username: u.username ?? '',
      photo_url: u.photo_url ?? '',
      now: Date.now(),
    });
    return this.getUser(u.id);
  }

  getUser(id) {
    return this.q.getUser.get(id) ?? null;
  }

  findUser(query) {
    const q = String(query ?? '')
      .trim()
      .replace(/^@/, '')
      .replace(/^https?:\/\/t\.me\//, '');
    if (/^\d{1,15}$/.test(q)) return this.getUser(Number(q));
    return q ? (this.q.findByUsername.get(q) ?? null) : null;
  }

  setBlocked(id, blocked) {
    this.q.setBlocked.run(blocked ? 1 : 0, id);
    return this.getUser(id);
  }

  rate() {
    return Number(this.q.getSetting.get('gram_rate')?.value) || this.defaultRate || 140;
  }

  setRate(rate) {
    this.q.setSetting.run('gram_rate', String(rate));
    return this.rate();
  }

  toStars(amount, currency) {
    return currency === GRAM ? (amount * this.rate()) / NANO : amount;
  }

  adjustBalance(id, delta, currency = XTR) {
    return this.tx(() => {
      const user = this.getUser(id);
      if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
      let applied = 0;
      if (delta > 0) {
        this.#credit(id, delta, 'admin', null, currency);
        applied = delta;
      } else if (delta < 0) {
        const take = Math.min(-delta, currency === GRAM ? user.gram : user.balance);
        if (take > 0) this.#debit(id, take, 'admin', null, currency);
        applied = -take;
      }
      return { user: this.getUser(id), applied };
    });
  }

  adminUsers({ query = '', limit = 50, offset = 0 } = {}) {
    const q = String(query).trim().toLowerCase().replace(/^@/, '');
    const params = { q, id: /^\d{1,15}$/.test(q) ? Number(q) : -1, like: `%${q.replace(/[%_]/g, '')}%` };
    return {
      total: this.q.adminUsersCount.get(params).n,
      users: this.q.adminUsers.all({ ...params, rate: this.rate(), limit, offset }),
    };
  }

  kindTotals(userId) {
    return Object.fromEntries(
      this.q.kindTotals
        .all(userId)
        .map((r) => [r.currency === GRAM ? `${r.kind}:GRAM` : r.kind, { n: r.n, sum: r.sum }]),
    );
  }

  ledgerPage(userId, before = Number.MAX_SAFE_INTEGER, limit = 50) {
    return this.q.ledgerPage.all(userId, before, limit);
  }

  ledgerSum(userId, currency = XTR) {
    return this.q.ledgerSum.get(userId, currency).sum;
  }

  depositRange(userId) {
    return { ...this.q.depositRange.get(userId) };
  }

  withdrawalsByStatus(status, limit = 50) {
    return this.q.withdrawalsByStatus.all(status, limit);
  }

  stats(now = Date.now()) {
    const periods = { day: now - 86_400_000, week: now - 7 * 86_400_000, month: now - 30 * 86_400_000 };
    const by = (fn) => Object.fromEntries(Object.entries(periods).map(([k, since]) => [k, fn(since)]));
    return {
      users: this.q.countUsers.get().n,
      newUsers: by((t) => this.q.newUsers.get(t).n),
      deposits: by((t) => ({ ...this.q.deposits.get(t) })),
      gramDeposits: by((t) => ({ ...this.q.gramDeposits.get(t) })),
      games: by((t) => ({ ...this.q.games.get(t) })),
      pending: { ...this.q.pendingWithdrawals.get() },
    };
  }

  userSummary(id) {
    return {
      deposits: { ...this.q.userDeposits.get(id) },
      gramDeposits: { ...this.q.userGramDeposits.get(id) },
      withdrawn: this.q.userWithdrawn.get(id).sum,
    };
  }

  addTask({ kind, title, url, chatRef = '', reward }) {
    const id = Number(this.q.addTask.run(kind, title, url, chatRef, reward, Date.now()).lastInsertRowid);
    return this.getTask(id);
  }

  getTask(id) {
    return this.q.getTask.get(id) ?? null;
  }

  activeTasks() {
    return this.q.activeTasks.all();
  }

  userTasks(userId) {
    return this.q.userTasks.all(userId).map((t) => ({ ...t, done: !!t.done }));
  }

  disableTask(id) {
    return this.q.disableTask.run(id).changes === 1;
  }

  completeTask(taskId, userId) {
    return this.tx(() => {
      const task = this.getTask(taskId);
      if (!task?.active) throw new AppError('TASK_GONE', 'Задание больше недоступно', 404);
      if (this.q.completeTask.run(taskId, userId, Date.now()).changes !== 1) return null;
      this.#credit(userId, task.reward, 'task', taskId);
      return this.getUser(userId);
    });
  }

  topWinSince(since) {
    return this.q.topWinSince.get(since) ?? null;
  }

  setReferrer(userId, referrerId) {
    if (!this.getUser(referrerId)) return false;
    return this.q.setReferrer.run(referrerId, userId, referrerId).changes === 1;
  }

  friends(userId) {
    return {
      list: this.q.friends.all({ inviter: userId }),
      n: this.q.friendsCount.get(userId).n,
      earned: this.q.refEarned.get(userId).sum,
      earnedGram: this.q.refEarnedGram.get(userId).sum,
    };
  }

  #payReferralShare(friendId, percent, currency = XTR) {
    const friend = this.getUser(friendId);
    if (!friend?.referrer_id || !(percent > 0)) return null;
    const total = (currency === GRAM ? this.q.gramPaid : this.q.userPaid).get(friendId).sum;
    const owed = Math.floor((total * percent) / 100);
    const paid = this.q.refPaidFor.get(friend.referrer_id, friendId, currency).sum;
    const amount = owed - paid;
    if (amount <= 0) return null;
    this.#credit(friend.referrer_id, amount, 'ref_deposit', friendId, currency);
    return { inviterId: friend.referrer_id, amount, currency };
  }

  recentWinners(limit = 12) {
    return this.q.recentWinners.all(limit);
  }

  ledgerDebit(userId, amount, kind, ref, currency = XTR) {
    this.#debit(userId, amount, kind, ref, currency);
  }

  ledgerCredit(userId, amount, kind, ref, currency = XTR) {
    this.#credit(userId, amount, kind, ref, currency);
  }

  broadcastIds() {
    return this.q.broadcastIds.all().map((r) => r.id);
  }

  #debit(userId, amount, kind, ref, currency = XTR) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('BAD_AMOUNT', 'Некорректная сумма');
    const { changes } = (currency === GRAM ? this.q.debitGram : this.q.debit).run({ id: userId, amount });
    if (changes !== 1) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        currency === GRAM ? 'Недостаточно Gram на балансе' : 'Недостаточно звёзд на балансе',
      );
    }
    this.q.ledger.run(userId, kind, -amount, ref, Date.now(), currency);
  }

  #credit(userId, amount, kind, ref, currency = XTR) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    (currency === GRAM ? this.q.creditGram : this.q.credit).run({ id: userId, amount });
    this.q.ledger.run(userId, kind, amount, ref, Date.now(), currency);
  }

  creditGramDeposit({ hash, userId, amount, sender = '', lt = '', refPercent = 0 }) {
    return this.tx(() => {
      if (!this.getUser(userId)) return null;
      const { changes } = this.q.addGramDeposit.run(hash, userId, amount, sender, lt, Date.now());
      if (changes !== 1) return null;
      this.#credit(userId, amount, 'deposit', null, GRAM);
      const referral = this.#payReferralShare(userId, refPercent, GRAM);
      return { ...this.getUser(userId), referral };
    });
  }

  getSetting(key) {
    return this.q.getSetting.get(key)?.value ?? null;
  }

  setSetting(key, value) {
    this.q.setSetting.run(key, String(value));
  }

  creditPayment({ chargeId, userId, amount, payload, refPercent = 0 }) {
    return this.tx(() => {
      const { changes } = this.q.addPayment.run(chargeId, userId, amount, payload, Date.now());
      if (changes !== 1) return null;
      this.#credit(userId, amount, 'deposit', null);
      const referral = this.#payReferralShare(userId, refPercent);
      return { ...this.getUser(userId), referral };
    });
  }

  withdraw(userId, amount, fee, { maxPerDay = 3, currency = XTR, address = '' } = {}) {
    const total = amount + fee;
    return this.tx(() => {
      if (this.q.userPending.get(userId).n > 0) {
        throw new AppError('PENDING', 'У вас уже есть заявка в обработке. Дождитесь её выполнения', 409);
      }
      if (this.q.userWithdrawalsToday.get(userId, Date.now() - 86_400_000).n >= maxPerDay) {
        throw new AppError('LIMIT', 'Слишком много заявок за сутки. Попробуйте завтра', 429);
      }
      const id = Number(
        this.q.addWithdrawal.run(userId, amount, fee, total, Date.now(), currency, address).lastInsertRowid,
      );
      this.#debit(userId, total, 'withdraw', id, currency);
      return { user: this.getUser(userId), withdrawal: this.getWithdrawal(id) };
    });
  }

  wager(userId, { deposit = 3, bonus = 3 } = {}) {
    const MULT = { deposit, referral: bonus, ref_deposit: bonus, task: bonus };
    const BET = { bet: 'r', crash_bet: 'c', basket_entry: 'b' };
    const REFUND = { refund: 'r', crash_refund: 'c' };
    const used = new Map();
    let left = 0,
      required = 0,
      done = 0;
    const rate = this.rate();
    for (const row of this.q.wagerRows.all(userId)) {
      const { kind, ref } = row;
      const amount = row.currency === GRAM ? Math.round((row.amount * rate) / NANO) : row.amount;
      if (MULT[kind]) {
        if (left === 0) ((required = 0), (done = 0));
        const add = Math.ceil(amount * MULT[kind]);
        left += add;
        required += add;
      } else if (BET[kind]) {
        const use = Math.min(left, -amount);
        left -= use;
        done += use;
        const key = BET[kind] + row.currency + ref;
        used.set(key, (used.get(key) ?? 0) + use);
      } else if (REFUND[kind]) {
        const key = REFUND[kind] + row.currency + ref;
        const back = Math.min(used.get(key) ?? 0, amount);
        used.set(key, (used.get(key) ?? 0) - back);
        left += back;
        done -= back;
      }
    }
    return { required, done, left };
  }

  getWithdrawal(id) {
    return this.q.getWithdrawal.get(id) ?? null;
  }

  userWithdrawals(userId, limit = 20) {
    return this.q.userWithdrawals.all(userId, limit);
  }

  setWithdrawalAdminMessage(id, chatId, messageId) {
    this.q.setAdminMessage.run(chatId, messageId, id);
  }

  markWithdrawalSent(id) {
    const { changes } = this.q.closeWithdrawal.run({ id, status: 'sent', reason: '', now: Date.now() });
    return changes === 1 ? this.getWithdrawal(id) : null;
  }

  cancelWithdrawal(id, reason) {
    return this.tx(() => {
      const { changes } = this.q.closeWithdrawal.run({ id, status: 'cancelled', reason, now: Date.now() });
      if (changes !== 1) return null;
      const w = this.getWithdrawal(id);
      this.#credit(w.user_id, w.total, 'withdraw_refund', id, w.currency);
      return w;
    });
  }

  createRound() {
    return Number(this.q.newRound.run(Date.now()).lastInsertRowid);
  }

  placeBet(roundId, userId, amount, currency = XTR) {
    return this.tx(() => {
      this.#debit(userId, amount, 'bet', roundId, currency);
      this.q.addBet.run(roundId, userId, amount, Date.now(), currency);
      return this.getUser(userId);
    });
  }

  settleRound({ roundId, total, bank, winnerId, playerIds }) {
    const pot = typeof bank === 'number' ? { xtr: bank, gram: 0, value: bank } : bank;
    this.tx(() => {
      this.#credit(winnerId, pot.xtr, 'win', roundId, XTR);
      this.#credit(winnerId, pot.gram, 'win', roundId, GRAM);
      for (const id of playerIds) {
        const win = id === winnerId ? 1 : 0;
        this.q.stat.run({ id, win, loss: 1 - win });
      }
      this.q.finishRound.run(total, Math.round(pot.value), pot.xtr, pot.gram, winnerId, Date.now(), roundId);
    });
  }

  refundOpenRounds() {
    let refunded = 0;
    for (const { id } of this.q.openRounds.all()) {
      this.tx(() => {
        for (const s of this.q.roundStakes.all(id)) this.#credit(s.user_id, s.amount, 'refund', id, s.currency);
        this.q.markRefunded.run(Date.now(), id);
      });
      refunded++;
    }
    return refunded;
  }
}
