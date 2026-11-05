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
  return new Store(db);
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

  /** Зачисление оплаченных звёзд. Повторное уведомление о том же платеже игнорируется. */
  creditPayment({ chargeId, userId, amount, payload }) {
    return this.tx(() => {
      const { changes } = this.q.addPayment.run(chargeId, userId, amount, payload, Date.now());
      if (changes !== 1) return null;
      this.#credit(userId, amount, 'deposit', null);
      return this.getUser(userId);
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
      this.#credit(w.user_id, w.total, 'refund', id);
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
