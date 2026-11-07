import { EventEmitter } from 'node:events';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { AppError } from './db.js';
import { displayName } from './game.js';

export const CRASH_DEFAULTS = Object.freeze({
  houseEdge: 0.05,
  minBet: 5,
  maxBet: 100,
  maxWin: 1500,
  maxRoundPayout: 4000,
  bettingMs: 8000,
  crashedMs: 4000,
  growth: 0.085,
  tickMs: 100,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crash_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL,
  seed        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  crash       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  ended_at    INTEGER
);
CREATE TABLE IF NOT EXISTS crash_bets (
  round_id    INTEGER NOT NULL REFERENCES crash_rounds(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  auto        INTEGER,
  cashout     INTEGER,
  payout      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS crash_rounds_status ON crash_rounds(status, id);
CREATE INDEX IF NOT EXISTS crash_bets_user ON crash_bets(user_id, round_id);
`;

export function crashPoint(seed, roundId, edge) {
  const h = createHmac('sha256', seed).update(`crash:${roundId}`).digest('hex');
  const r = parseInt(h.slice(0, 13), 16) / 2 ** 52;
  return Math.max(100, Math.floor((100 * (1 - edge)) / (1 - r)));
}

export const multiplierAt = (ms, growth) =>
  Math.max(100, Math.floor(100 * Math.exp((growth * Math.max(0, ms)) / 1000)));

export const msFor = (m100, growth) => (Math.log(m100 / 100) / growth) * 1000;

const realTimers = {
  timeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  interval: (fn, ms) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    return t;
  },
  clear: (t) => (clearTimeout(t), clearInterval(t)),
};

export class CrashService extends EventEmitter {
  constructor(
    store,
    options = {},
    { now = Date.now, seed = () => randomBytes(32).toString('hex'), autoStart = true, timers = realTimers } = {},
  ) {
    super();
    this.store = store;
    this.o = { ...CRASH_DEFAULTS, ...options };
    this.now = now;
    this.newSeed = seed;
    this.t = timers;
    this.timers = [];
    store.db.exec(SCHEMA);
    const q = (sql) => store.db.prepare(sql);
    this.q = {
      newRound: q("INSERT INTO crash_rounds (status, seed, hash, crash, created_at) VALUES ('betting', ?, ?, 0, ?)"),
      setCrash: q('UPDATE crash_rounds SET crash = ? WHERE id = ?'),
      round: q('SELECT * FROM crash_rounds WHERE id = ?'),
      setStatus: q(
        'UPDATE crash_rounds SET status = ?, started_at = COALESCE(?, started_at), ended_at = ? WHERE id = ?',
      ),
      unfinished: q("SELECT id FROM crash_rounds WHERE status IN ('betting', 'flying')"),
      addBet: q('INSERT INTO crash_bets (round_id, user_id, amount, auto, created_at) VALUES (?, ?, ?, ?, ?)'),
      delBet: q('DELETE FROM crash_bets WHERE round_id = ? AND user_id = ? AND cashout IS NULL'),
      bet: q('SELECT * FROM crash_bets WHERE round_id = ? AND user_id = ?'),
      bets: q('SELECT * FROM crash_bets WHERE round_id = ? ORDER BY amount DESC, created_at'),
      cashout: q(
        'UPDATE crash_bets SET cashout = ?, payout = ? WHERE round_id = ? AND user_id = ? AND cashout IS NULL',
      ),
      history: q("SELECT id, crash, hash, seed FROM crash_rounds WHERE status = 'crashed' ORDER BY id DESC LIMIT ?"),
      myBets: q(`SELECT b.round_id, b.amount, b.cashout, b.payout, r.crash, r.status FROM crash_bets b
                 JOIN crash_rounds r ON r.id = b.round_id WHERE b.user_id = ? ORDER BY b.round_id DESC LIMIT ?`),
      stats: q(`SELECT COUNT(*) AS rounds, COALESCE(SUM(amount), 0) AS staked, COALESCE(SUM(payout), 0) AS paid
                FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id WHERE r.status = 'crashed' AND r.ended_at >= ?`),
    };
    this.round = null;
    if (autoStart) this.start();
  }

  start() {
    for (const { id } of this.q.unfinished.all()) this.#void(id);
    this.#newRound();
  }

  stop() {
    for (const t of this.timers) this.t.clear(t);
    this.timers = [];
  }

  #later(fn, ms) {
    this.timers.push(this.t.timeout(fn, Math.max(0, ms)));
  }

  #void(roundId) {
    this.store.tx(() => {
      for (const b of this.q.bets.all(roundId)) {
        if (b.cashout === null) this.store.ledgerCredit(b.user_id, b.amount, 'crash_refund', roundId);
      }
      this.q.setStatus.run('void', null, this.now(), roundId);
    });
  }

  #newRound() {
    const seed = this.newSeed();
    const hash = createHash('sha256').update(seed).digest('hex');
    const t = this.now();
    const id = Number(this.q.newRound.run(seed, hash, t).lastInsertRowid);
    const crash = crashPoint(seed, id, this.o.houseEdge);
    this.q.setCrash.run(crash, id);
    this.round = {
      id,
      seed,
      hash,
      crash,
      status: 'betting',
      bettingEndsAt: t + this.o.bettingMs,
      startAt: null,
      paidOut: 0,
    };
    this.#emit();
    this.#later(() => this.#launch(), this.o.bettingMs);
  }

  #launch() {
    const r = this.round;
    r.status = 'flying';
    r.startAt = this.now();
    this.q.setStatus.run('flying', r.startAt, null, r.id);
    this.#emit();
    const flightMs = msFor(r.crash, this.o.growth);
    const tick = this.t.interval(() => this.tick(), this.o.tickMs);
    this.timers.push(tick);
    r.tick = tick;
    this.#later(() => this.#crash(), flightMs);
  }

  tick() {
    const r = this.round;
    if (!r || r.status !== 'flying') return;
    const m = multiplierAt(this.now() - r.startAt, this.o.growth);
    if (m >= r.crash) return this.#crash();
    const active = this.q.bets.all(r.id).filter((b) => b.cashout === null);
    let changed = false;
    for (const b of active) {
      const target = this.#target(b);
      if (target !== null && target <= m && target < r.crash) {
        this.#payout(b, target);
        changed = true;
      }
    }
    const live = this.q.bets.all(r.id).filter((b) => b.cashout === null);
    const exposure = live.reduce((sum, b) => sum + Math.floor((b.amount * m) / 100), 0);
    if (live.length && r.paidOut + exposure >= this.o.maxRoundPayout) {
      for (const b of live) this.#payout(b, m);
      changed = true;
    }
    if (changed) this.#emit();
  }

  #target(b) {
    const capByWin = Math.floor((this.o.maxWin * 100) / b.amount);
    return b.auto ? Math.min(b.auto, capByWin) : capByWin;
  }

  #payout(b, m100) {
    const r = this.round;
    const payout = Math.min(this.o.maxWin, Math.floor((b.amount * m100) / 100));
    this.store.tx(() => {
      if (this.q.cashout.run(m100, payout, r.id, b.user_id).changes !== 1) return;
      this.store.ledgerCredit(b.user_id, payout, 'crash_win', r.id);
      r.paidOut += payout;
    });
    this.emit('balance', b.user_id);
  }

  #crash() {
    const r = this.round;
    if (!r || r.status !== 'flying') return;
    this.t.clear(r.tick);
    r.status = 'crashed';
    this.q.setStatus.run('crashed', null, this.now(), r.id);
    this.#emit();
    this.#later(() => this.#newRound(), this.o.crashedMs);
  }

  placeBet(user, rawAmount, rawAuto) {
    const r = this.round;
    if (!r || r.status !== 'betting') throw new AppError('BETS_CLOSED', 'Ставки на этот раунд закрыты', 409);
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount < this.o.minBet || amount > this.o.maxBet) {
      throw new AppError('BAD_AMOUNT', `Ставка от ${this.o.minBet} до ${this.o.maxBet} ⭐`);
    }
    let auto = null;
    if (rawAuto !== null && rawAuto !== undefined && rawAuto !== '') {
      auto = Math.round(Number(rawAuto) * 100);
      if (!Number.isSafeInteger(auto) || auto < 101 || auto > 100_000)
        throw new AppError('BAD_AUTO', 'Автовывод — от ×1.01');
    }
    if (this.q.bet.get(r.id, user.id)) throw new AppError('ALREADY', 'Вы уже сделали ставку в этом раунде', 409);
    this.store.tx(() => {
      this.store.ledgerDebit(user.id, amount, 'crash_bet', r.id);
      this.q.addBet.run(r.id, user.id, amount, auto, this.now());
    });
    this.emit('balance', user.id);
    this.#emit();
    return this.publicState();
  }

  cancelBet(userId) {
    const r = this.round;
    if (!r || r.status !== 'betting') throw new AppError('BETS_CLOSED', 'Раунд уже начался', 409);
    const b = this.q.bet.get(r.id, userId);
    if (!b) throw new AppError('NO_BET', 'Ставки нет', 404);
    this.store.tx(() => {
      this.q.delBet.run(r.id, userId);
      this.store.ledgerCredit(userId, b.amount, 'crash_refund', r.id);
    });
    this.emit('balance', userId);
    this.#emit();
    return this.publicState();
  }

  cashout(userId) {
    const r = this.round;
    if (!r || r.status !== 'flying') throw new AppError('NOT_FLYING', 'Ракета не летит', 409);
    const b = this.q.bet.get(r.id, userId);
    if (!b) throw new AppError('NO_BET', 'В этом раунде нет вашей ставки', 404);
    if (b.cashout !== null) throw new AppError('ALREADY', 'Выигрыш уже забран', 409);
    const m = multiplierAt(this.now() - r.startAt, this.o.growth);
    if (m >= r.crash) {
      this.#crash();
      throw new AppError('TOO_LATE', 'Не успели — ракета улетела', 409);
    }
    this.#payout(b, Math.min(m, this.#target(b)));
    this.#emit();
    const done = this.q.bet.get(r.id, userId);
    return { cashout: done.cashout, payout: done.payout, ...this.publicState() };
  }

  #emit() {
    this.emit('update', this.publicState());
  }

  publicState() {
    const r = this.round;
    const crashed = r.status === 'crashed';
    return {
      id: r.id,
      status: r.status,
      serverNow: this.now(),
      hash: r.hash,
      seed: crashed ? r.seed : null,
      crash: crashed ? r.crash : null,
      bettingEndsAt: r.bettingEndsAt,
      startAt: r.startAt,
      growth: this.o.growth,
      limits: { minBet: this.o.minBet, maxBet: this.o.maxBet, maxWin: this.o.maxWin, houseEdge: this.o.houseEdge },
      bets: this.q.bets.all(r.id).map((b) => {
        const u = this.store.getUser(b.user_id) ?? { id: b.user_id };
        return {
          id: b.user_id,
          name: displayName(u),
          photo: u.photo_url || '',
          amount: b.amount,
          auto: b.auto,
          cashout: b.cashout,
          payout: b.payout,
        };
      }),
      history: this.q.history.all(20).map((h) => ({ id: h.id, crash: h.crash })),
    };
  }

  fairness(limit = 20) {
    return this.q.history.all(limit).map((h) => ({ id: h.id, crash: h.crash, hash: h.hash, seed: h.seed }));
  }

  myBets(userId, limit = 20) {
    return this.q.myBets.all(userId, limit);
  }

  stats(since) {
    const s = this.q.stats.get(since);
    return { ...s, profit: s.staked - s.paid };
  }
}
