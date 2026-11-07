// Хранилище: SQLite (встроен в Node.js). Все изменения баланса идут через транзакции
// и записываются в журнал ledger — по нему всегда можно восстановить историю.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,            -- Telegram ID
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
  status      TEXT NOT NULL,                  -- open | finished | refunded
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
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | cancelled
  reason      TEXT NOT NULL DEFAULT '',
  admin_chat_id    INTEGER,
  admin_message_id INTEGER,
  created_at  INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals(user_id, id);
CREATE TABLE IF NOT EXISTS payments (
  charge_id   TEXT PRIMARY KEY,               -- telegram_payment_charge_id (защита от двойного зачисления)
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,               -- звёзды (XTR)
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,                  -- deposit | bet | win | refund | withdraw
  amount      INTEGER NOT NULL,               -- со знаком: + зачисление, − списание
  ref         INTEGER,
  created_at  INTEGER NOT NULL
);
`;

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

/** Обновление базы, созданной прошлыми версиями: только добавляет, ничего не удаляет. */
function migrate(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!columns.has('blocked')) db.exec('ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  // Рефералы: кто пригласил и выдана ли уже награда за этого друга
  if (!columns.has('referrer_id')) db.exec('ALTER TABLE users ADD COLUMN referrer_id INTEGER');
  if (!columns.has('ref_rewarded')) db.exec('ALTER TABLE users ADD COLUMN ref_rewarded INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS users_referrer ON users(referrer_id)');
  db.exec(`
    CREATE INDEX IF NOT EXISTS users_username ON users(lower(username));
    CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
    CREATE INDEX IF NOT EXISTS payments_created ON payments(created_at);
    CREATE INDEX IF NOT EXISTS rounds_finished ON rounds(status, finished_at);
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,                -- subscribe (бот проверяет подписку) | link (переход по ссылке)
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      chat_ref    TEXT NOT NULL DEFAULT '',     -- @username канала/чата для проверки подписки
      reward      INTEGER NOT NULL CHECK (reward > 0),
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS basket_matches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    INTEGER NOT NULL,             -- уровень матча: 5 | 10 | 20 | 50 | 100 (без денежной стоимости)
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
      flagged     INTEGER NOT NULL DEFAULT 0,   -- подозрение на автоматизацию — для проверки админом
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
      ledger: q('INSERT INTO ledger (user_id, kind, amount, ref, created_at) VALUES (?, ?, ?, ?, ?)'),
      newRound: q("INSERT INTO rounds (status, created_at) VALUES ('open', ?)"),
      addBet: q('INSERT INTO bets (round_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)'),
      finishRound: q(`UPDATE rounds SET status = 'finished', total = ?, bank = ?, winner_id = ?, finished_at = ?
                      WHERE id = ?`),
      stat: q(`UPDATE users SET games = games + 1, wins = wins + :win, losses = losses + :loss WHERE id = :id`),
      openRounds: q("SELECT id FROM rounds WHERE status = 'open'"),
      roundStakes: q('SELECT user_id, SUM(amount) AS amount FROM bets WHERE round_id = ? GROUP BY user_id'),
      markRefunded: q("UPDATE rounds SET status = 'refunded', finished_at = ? WHERE id = ?"),
      addPayment: q(`INSERT INTO payments (charge_id, user_id, amount, payload, created_at)
                     VALUES (?, ?, ?, ?, ?) ON CONFLICT(charge_id) DO NOTHING`),
      addWithdrawal: q('INSERT INTO withdrawals (user_id, amount, fee, total, created_at) VALUES (?, ?, ?, ?, ?)'),
      getWithdrawal: q('SELECT * FROM withdrawals WHERE id = ?'),
      userWithdrawals: q(`SELECT id, amount, fee, total, status, reason, created_at, processed_at
                          FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
      closeWithdrawal: q(`UPDATE withdrawals SET status = :status, reason = :reason, processed_at = :now
                          WHERE id = :id AND status = 'pending'`),
      setAdminMessage: q('UPDATE withdrawals SET admin_chat_id = ?, admin_message_id = ? WHERE id = ?'),
      // --- админ-панель ---
      findByUsername: q("SELECT * FROM users WHERE lower(username) = lower(?) AND username <> '' LIMIT 1"),
      setBlocked: q('UPDATE users SET blocked = ? WHERE id = ?'),
      countUsers: q('SELECT COUNT(*) AS n FROM users'),
      newUsers: q('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?'),
      deposits: q("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE created_at >= ?"),
      games: q(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS turnover, COALESCE(SUM(total - bank), 0) AS income
                FROM rounds WHERE status = 'finished' AND finished_at >= ?`),
      pendingWithdrawals: q("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE status = 'pending'"),
      userDeposits: q('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE user_id = ?'),
      userWithdrawn: q("SELECT COALESCE(SUM(amount), 0) AS sum FROM withdrawals WHERE user_id = ? AND status = 'sent'"),
      broadcastIds: q('SELECT id FROM users WHERE blocked = 0 ORDER BY id'),
      // --- задания ---
      addTask: q('INSERT INTO tasks (kind, title, url, chat_ref, reward, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      getTask: q('SELECT * FROM tasks WHERE id = ?'),
      activeTasks: q(`SELECT t.*, (SELECT COUNT(*) FROM task_completions c WHERE c.task_id = t.id) AS done_count
                      FROM tasks t WHERE active = 1 ORDER BY id DESC`),
      userTasks: q(`SELECT t.id, t.kind, t.title, t.url, t.reward, (c.user_id IS NOT NULL) AS done
                    FROM tasks t LEFT JOIN task_completions c ON c.task_id = t.id AND c.user_id = ?
                    WHERE t.active = 1 ORDER BY done, t.id DESC`),
      disableTask: q('UPDATE tasks SET active = 0 WHERE id = ?'),
      completeTask: q('INSERT INTO task_completions (task_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
      topWinSince: q(`SELECT r.id, r.bank, r.total, r.finished_at, u.id AS user_id, u.first_name, u.last_name, u.username, u.photo_url,
                          (SELECT SUM(amount) FROM bets b WHERE b.round_id = r.id AND b.user_id = r.winner_id) AS stake
                        FROM rounds r JOIN users u ON u.id = r.winner_id
                        WHERE r.status = 'finished' AND r.finished_at >= ? ORDER BY r.bank DESC, r.id DESC LIMIT 1`),
      setReferrer: q('UPDATE users SET referrer_id = ? WHERE id = ? AND referrer_id IS NULL AND id <> ?'),
      friends: q(`SELECT u.id, u.first_name, u.last_name, u.username, u.photo_url, u.created_at,
                    (SELECT COALESCE(SUM(l.amount), 0) FROM ledger l
                      WHERE l.user_id = :inviter AND l.ref = u.id AND l.kind IN ('referral', 'ref_deposit')) AS earned
                  FROM users u WHERE u.referrer_id = :inviter ORDER BY earned DESC, u.id DESC LIMIT 200`),
      friendsCount: q('SELECT COUNT(*) AS n FROM users WHERE referrer_id = ?'),
      ledgerByKind: q('SELECT kind, SUM(amount) AS sum FROM ledger WHERE user_id = ? GROUP BY kind'),
      refEarned: q("SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND kind IN ('referral', 'ref_deposit')"),
      userPaid: q('SELECT COALESCE(SUM(amount), 0) AS sum FROM payments WHERE user_id = ?'),
      refPaidFor: q("SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger WHERE user_id = ? AND ref = ? AND kind = 'ref_deposit'"),
      recentWinners: q(`SELECT r.id, r.bank, r.total, r.finished_at, u.id AS user_id, u.first_name, u.last_name, u.username, u.photo_url,
                          (SELECT SUM(amount) FROM bets b WHERE b.round_id = r.id AND b.user_id = r.winner_id) AS stake
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

  // ---------- Админ-панель ----------

  /** Поиск по нику (с @ или без) или по Telegram ID. */
  findUser(query) {
    const q = String(query ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
    if (/^\d{1,15}$/.test(q)) return this.getUser(Number(q)); // ник в Telegram не может быть из одних цифр
    return q ? (this.q.findByUsername.get(q) ?? null) : null;
  }

  setBlocked(id, blocked) {
    this.q.setBlocked.run(blocked ? 1 : 0, id);
    return this.getUser(id);
  }

  /**
   * Ручное изменение баланса. delta > 0 — начислить, delta < 0 — списать,
   * но не больше, чем есть (с нулевого баланса ничего не списывается).
   */
  adjustBalance(id, delta) {
    return this.tx(() => {
      const user = this.getUser(id);
      if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
      let applied = 0;
      if (delta > 0) {
        this.#credit(id, delta, 'admin', null);
        applied = delta;
      } else if (delta < 0) {
        const take = Math.min(-delta, user.balance);
        if (take > 0) this.#debit(id, take, 'admin', null);
        applied = -take;
      }
      return { user: this.getUser(id), applied };
    });
  }

  stats(now = Date.now()) {
    const periods = { day: now - 86_400_000, week: now - 7 * 86_400_000, month: now - 30 * 86_400_000 };
    const by = (fn) => Object.fromEntries(Object.entries(periods).map(([k, since]) => [k, fn(since)]));
    return {
      users: this.q.countUsers.get().n,
      newUsers: by((t) => this.q.newUsers.get(t).n),
      deposits: by((t) => ({ ...this.q.deposits.get(t) })),
      games: by((t) => ({ ...this.q.games.get(t) })),
      pending: { ...this.q.pendingWithdrawals.get() },
    };
  }

  userSummary(id) {
    return {
      deposits: { ...this.q.userDeposits.get(id) },
      withdrawn: this.q.userWithdrawn.get(id).sum,
    };
  }

  // ---------- Задания ----------

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

  /** Награда за задание — один раз на пользователя. Возвращает null, если уже получена. */
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

  // ---------- Рефералы ----------

  /** Привязка к пригласившему — только один раз и не к самому себе. */
  setReferrer(userId, referrerId) {
    if (!this.getUser(referrerId)) return false;
    return this.q.setReferrer.run(referrerId, userId, referrerId).changes === 1;
  }

  friends(userId) {
    return {
      list: this.q.friends.all({ inviter: userId }),
      n: this.q.friendsCount.get(userId).n,
      earned: this.q.refEarned.get(userId).sum,
    };
  }

  /**
   * Доля пригласившего с пополнений друга (внутри транзакции оплаты).
   * Считается от суммы ВСЕХ пополнений друга, поэтому дробные части не теряются:
   * 3 ⭐ + 4 ⭐ → 15% от 7 = 1 ⭐. Возвращает { inviterId, amount } или null.
   */
  #payReferralShare(friendId, percent) {
    const friend = this.getUser(friendId);
    if (!friend?.referrer_id || !(percent > 0)) return null;
    const owed = Math.floor((this.q.userPaid.get(friendId).sum * percent) / 100);
    const paid = this.q.refPaidFor.get(friend.referrer_id, friendId).sum;
    const amount = owed - paid;
    if (amount <= 0) return null;
    this.#credit(friend.referrer_id, amount, 'ref_deposit', friendId);
    return { inviterId: friend.referrer_id, amount };
  }

  recentWinners(limit = 12) {
    return this.q.recentWinners.all(limit);
  }

  // ---------- Операции для игровых модулей (только внутри store.tx) ----------

  /** Списание с записью в журнал. Бросает INSUFFICIENT_FUNDS, если звёзд мало. */
  ledgerDebit(userId, amount, kind, ref) {
    this.#debit(userId, amount, kind, ref);
  }

  /** Начисление с записью в журнал. */
  ledgerCredit(userId, amount, kind, ref) {
    this.#credit(userId, amount, kind, ref);
  }

  broadcastIds() {
    return this.q.broadcastIds.all().map((r) => r.id);
  }

  /** Списание внутри уже открытой транзакции. */
  #debit(userId, amount, kind, ref) {
    const { changes } = this.q.debit.run({ id: userId, amount });
    if (changes !== 1) throw new AppError('INSUFFICIENT_FUNDS', 'Недостаточно звёзд на балансе');
    this.q.ledger.run(userId, kind, -amount, ref, Date.now());
  }

  #credit(userId, amount, kind, ref) {
    this.q.credit.run({ id: userId, amount });
    this.q.ledger.run(userId, kind, amount, ref, Date.now());
  }

  /**
   * Зачисление оплаченных звёзд (повторное уведомление о том же платеже игнорируется)
   * и, если игрока пригласили, — доля refPercent % пригласившему.
   * Возвращает игрока с полем referral: { inviterId, amount } | null.
   */
  creditPayment({ chargeId, userId, amount, payload, refPercent = 0 }) {
    return this.tx(() => {
      const { changes } = this.q.addPayment.run(chargeId, userId, amount, payload, Date.now());
      if (changes !== 1) return null;
      this.#credit(userId, amount, 'deposit', null);
      const referral = this.#payReferralShare(userId, refPercent);
      return { ...this.getUser(userId), referral };
    });
  }

  /** Заявка на вывод: сумма + комиссия списываются сразу и замораживаются до решения админа. */
  withdraw(userId, amount, fee) {
    const total = amount + fee;
    return this.tx(() => {
      const id = Number(this.q.addWithdrawal.run(userId, amount, fee, total, Date.now()).lastInsertRowid);
      this.#debit(userId, total, 'withdraw', id);
      return { user: this.getUser(userId), withdrawal: this.getWithdrawal(id) };
    });
  }

  /**
   * Оборот перед выводом (вейджер), как в казино: каждое пополнение нужно поставить × deposit раз,
   * бонусы (рефералы, задания) — × bonus раз. Считается по журналу нарастающим итогом.
   * В оборот идут ставки во всех играх за вычетом возвращённых ставок.
   */
  wager(userId, { deposit = 3, bonus = 10 } = {}) {
    const k = Object.fromEntries(this.q.ledgerByKind.all(userId).map((r) => [r.kind, Number(r.sum)]));
    const v = (name) => k[name] ?? 0;
    const required = Math.ceil(v('deposit') * deposit + (v('referral') + v('ref_deposit') + v('task')) * bonus);
    const done = Math.max(0, -(v('bet') + v('crash_bet') + v('basket_entry')) - v('crash_refund') - v('basket_refund'));
    return { required, done: Math.min(done, required), left: Math.max(0, required - done) };
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

  /** Админ отправил выплату. Возвращает null, если заявка уже обработана. */
  markWithdrawalSent(id) {
    const { changes } = this.q.closeWithdrawal.run({ id, status: 'sent', reason: '', now: Date.now() });
    return changes === 1 ? this.getWithdrawal(id) : null;
  }

  /** Отмена с причиной: замороженная сумма (вместе с комиссией) возвращается игроку. */
  cancelWithdrawal(id, reason) {
    return this.tx(() => {
      const { changes } = this.q.closeWithdrawal.run({ id, status: 'cancelled', reason, now: Date.now() });
      if (changes !== 1) return null;
      const w = this.getWithdrawal(id);
      this.#credit(w.user_id, w.total, 'withdraw_refund', id);
      return w;
    });
  }

  createRound() {
    return Number(this.q.newRound.run(Date.now()).lastInsertRowid);
  }

  placeBet(roundId, userId, amount) {
    return this.tx(() => {
      this.#debit(userId, amount, 'bet', roundId);
      this.q.addBet.run(roundId, userId, amount, Date.now());
      return this.getUser(userId);
    });
  }

  settleRound({ roundId, total, bank, winnerId, playerIds }) {
    this.tx(() => {
      this.#credit(winnerId, bank, 'win', roundId);
      for (const id of playerIds) {
        const win = id === winnerId ? 1 : 0;
        this.q.stat.run({ id, win, loss: 1 - win });
      }
      this.q.finishRound.run(total, bank, winnerId, Date.now(), roundId);
    });
  }

  /** После перезапуска сервера: незавершённые раунды отменяются, ставки возвращаются. */
  refundOpenRounds() {
    let refunded = 0;
    for (const { id } of this.q.openRounds.all()) {
      this.tx(() => {
        for (const s of this.q.roundStakes.all(id)) this.#credit(s.user_id, s.amount, 'refund', id);
        this.q.markRefunded.run(Date.now(), id);
      });
      refunded++;
    }
    return refunded;
  }
}
