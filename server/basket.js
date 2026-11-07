import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { QUANT, validLaunch, simulateShot, nextHoop } from '../public/basket-physics.js';
import { AppError, GRAM, XTR } from './db.js';
import { displayName } from './game.js';

export const BASKET_DEFAULTS = Object.freeze({
  price: 5,
  dailyPrize: 50,
  tzOffsetMin: 180,
  countdownMs: 3000,
  baseMs: 30_000,
  bonusMs: 3_000,
  swishBonusMs: 5_000,
  graceMs: 300,
  shotGapMs: 200,
  shotTolMs: 150,
  minAimMs: 120,
  minSamples: 3,
  topSize: 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS basket_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  day          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'playing',
  hoops        TEXT NOT NULL,
  start_at     INTEGER NOT NULL,
  deadline     INTEGER NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  shots        INTEGER NOT NULL DEFAULT 0,
  swishes      INTEGER NOT NULL DEFAULT 0,
  quality      REAL NOT NULL DEFAULT 0,
  seq          INTEGER NOT NULL DEFAULT 0,
  next_shot_at INTEGER NOT NULL,
  last_shot    TEXT,
  flagged      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS basket_attempts_day ON basket_attempts(day, status, score);
CREATE INDEX IF NOT EXISTS basket_attempts_user ON basket_attempts(user_id, status);
CREATE TABLE IF NOT EXISTS basket_days (
  day        TEXT PRIMARY KEY,
  winner_id  INTEGER,
  score      INTEGER NOT NULL DEFAULT 0,
  prize      INTEGER NOT NULL DEFAULT 0,
  closed_at  INTEGER NOT NULL
);
`;

const cryptoRnd = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

export class BasketService extends EventEmitter {
  constructor(store, options = {}, { now = Date.now, rnd = cryptoRnd } = {}) {
    super();
    this.store = store;
    this.o = { ...BASKET_DEFAULTS, ...options };
    this.now = now;
    this.rnd = rnd;
    this.reactions = new Map();
    const db = store.db;
    db.exec(SCHEMA);
    const q = (sql) => db.prepare(sql);
    this.q = {
      active: q("SELECT * FROM basket_attempts WHERE user_id = ? AND status = 'playing' LIMIT 1"),
      insert: q(`INSERT INTO basket_attempts (user_id, day, hoops, start_at, deadline, next_shot_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`),
      attempt: q('SELECT * FROM basket_attempts WHERE id = ?'),
      setHoops: q('UPDATE basket_attempts SET hoops = ? WHERE id = ?'),
      saveShot: q(`UPDATE basket_attempts SET score = :score, shots = :shots, swishes = :swishes, quality = :quality,
                     seq = :seq, deadline = :deadline, next_shot_at = :next, last_shot = :last, flagged = :flagged
                   WHERE id = :id`),
      expired: q("SELECT * FROM basket_attempts WHERE status = 'playing' AND deadline < ?"),
      finish: q("UPDATE basket_attempts SET status = 'done', finished_at = ? WHERE id = ? AND status = 'playing'"),
      dayResults: q(`SELECT id, user_id, score, shots, finished_at FROM basket_attempts
                     WHERE day = ? AND status = 'done' ORDER BY score DESC, shots ASC, finished_at ASC, id ASC`),
      playingOnDay: q("SELECT COUNT(*) AS n FROM basket_attempts WHERE day = ? AND status = 'playing'"),
      openDays: q(`SELECT DISTINCT day FROM basket_attempts
                   WHERE day < ? AND day NOT IN (SELECT day FROM basket_days) ORDER BY day`),
      closeDay: q('INSERT OR IGNORE INTO basket_days (day, winner_id, score, prize, closed_at) VALUES (?, ?, ?, ?, ?)'),
      lastDay: q('SELECT * FROM basket_days ORDER BY day DESC LIMIT 1'),
      myAttempts: q(`SELECT id, day, score, shots, swishes, status, created_at FROM basket_attempts
                     WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
      stats: q(`SELECT COUNT(*) AS games, COALESCE(MAX(score), 0) AS best FROM basket_attempts
                WHERE user_id = ? AND status = 'done'`),
      wins: q('SELECT COUNT(*) AS wins, COALESCE(SUM(prize), 0) AS won FROM basket_days WHERE winner_id = ?'),
      playersToday: q('SELECT COUNT(DISTINCT user_id) AS n FROM basket_attempts WHERE day = ?'),
    };
    this.#refundLegacyMatches();
  }

  dayOf(ts) {
    return new Date(ts + this.o.tzOffsetMin * 60_000).toISOString().slice(0, 10);
  }

  dayEndsAt(ts = this.now()) {
    const shifted = ts + this.o.tzOffsetMin * 60_000;
    const next = Math.floor(shifted / 86_400_000 + 1) * 86_400_000;
    return next - this.o.tzOffsetMin * 60_000;
  }

  leaderboard(day) {
    const seen = new Set();
    const rows = [];
    for (const r of this.q.dayResults.all(day)) {
      if (seen.has(r.user_id) || r.score <= 0) continue;
      seen.add(r.user_id);
      rows.push({ ...r, place: rows.length + 1 });
    }
    return rows;
  }

  priceGram() {
    return Math.ceil((this.o.price / this.store.rate()) * 100) * 10_000_000;
  }

  play(user, currency = XTR) {
    this.tick();
    if (this.q.active.get(user.id)) return this.state(user.id);
    const t = this.now();
    const cost = currency === GRAM ? this.priceGram() : this.o.price;
    this.store.tx(() => {
      const startAt = t + this.o.countdownMs;
      const hoops = JSON.stringify([nextHoop(null, this.rnd, 0)]);
      const id = Number(
        this.q.insert.run(user.id, this.dayOf(t), hoops, startAt, startAt + this.o.baseMs, startAt, t).lastInsertRowid,
      );
      this.store.ledgerDebit(user.id, cost, 'basket_entry', id, currency);
    });
    this.emit('balance', user.id);
    return this.state(user.id);
  }

  shoot(userId, body = {}) {
    this.tick();
    const e = this.q.active.get(userId);
    if (!e) throw new AppError('NO_MATCH', 'Игра уже завершена', 409);
    const t = this.now();
    const seq = Number(body.seq);

    if (seq === e.seq && e.last_shot) return { ...JSON.parse(e.last_shot), replay: true, serverNow: t };
    if (!Number.isSafeInteger(seq) || seq !== e.seq + 1) throw new AppError('BAD_SEQ', 'Состояние игры обновлено', 409);
    if (t < e.start_at) throw new AppError('NOT_STARTED', 'Игра ещё не началась', 409);
    if (t > e.deadline + this.o.graceMs) throw new AppError('TIME_UP', 'Время вышло', 409);
    if (t < e.next_shot_at - this.o.shotTolMs) throw new AppError('TOO_FAST', 'Мяч ещё в полёте', 429);
    if (!(Number(body.aimMs) >= this.o.minAimMs) || !(Number(body.samples) >= this.o.minSamples)) {
      throw new AppError('BAD_AIM', 'Прицельтесь и отпустите палец', 400);
    }
    const ivx = Number(body.vx);
    const ivy = Number(body.vy);
    if (!Number.isSafeInteger(ivx) || !Number.isSafeInteger(ivy) || Math.abs(ivx) > 50_000 || Math.abs(ivy) > 50_000) {
      throw new AppError('BAD_SHOT', 'Некорректный бросок', 400);
    }
    if (!validLaunch(ivx / QUANT, ivy / QUANT)) throw new AppError('BAD_SHOT', 'Некорректный бросок', 400);

    const hoop = this.#hoopAt(e, e.score);
    const sim = simulateShot(hoop, ivx / QUANT, ivy / QUANT);
    const swish = sim.made && !sim.contacts.some(([kind, ct]) => kind === 'rim' && ct <= sim.madeT);

    const reactions = this.reactions.get(e.id) ?? [];
    reactions.push(t - Math.max(e.next_shot_at, e.start_at));
    this.reactions.set(e.id, reactions);

    const bonus = sim.made ? (swish ? this.o.swishBonusMs : this.o.bonusMs) : 0;
    const next = {
      score: e.score + (sim.made ? 1 : 0),
      shots: e.shots + 1,
      swishes: e.swishes + (swish ? 1 : 0),
      quality: e.quality + (sim.made ? sim.quality : 0),
      seq,
      deadline: e.deadline + bonus,
      next: t + Math.round(sim.settleT * 1000) + this.o.shotGapMs,
      flagged: e.flagged,
    };
    if (!next.flagged && this.#suspicious(next, reactions)) {
      next.flagged = 1;
      this.emit('flag', { gameId: e.id, userId, score: next.score, shots: next.shots });
    }
    const result = {
      seq,
      vx: ivx,
      vy: ivy,
      made: sim.made,
      swish,
      bonusMs: bonus,
      settleT: sim.settleT,
      score: next.score,
      shots: next.shots,
      deadline: next.deadline,
      nextShotAt: next.next,
      shotHoop: hoop,
      hoop: this.#hoopAt(e, next.score),
    };
    this.q.saveShot.run({ ...next, last: JSON.stringify(result), id: e.id });
    return { ...result, serverNow: t };
  }

  #suspicious(p, reactions) {
    if (p.shots < 12 || p.score / p.shots < 0.9) return false;
    const last = reactions.slice(-10);
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length);
    return sd < 60;
  }

  #hoopAt(e, index) {
    const hoops = JSON.parse(e.hoops);
    if (hoops.length > index) return hoops[index];
    while (hoops.length <= index) hoops.push(nextHoop(hoops.at(-1), this.rnd, hoops.length));
    e.hoops = JSON.stringify(hoops);
    this.q.setHoops.run(e.hoops, e.id);
    return hoops[index];
  }

  tick() {
    const t = this.now();
    for (const e of this.q.expired.all(t - this.o.graceMs)) {
      this.q.finish.run(Math.min(t, e.deadline), e.id);
      this.reactions.delete(e.id);
      this.emit('finished', e.id);
    }
    const today = this.dayOf(t);
    for (const { day } of this.q.openDays.all(today)) {
      if (this.q.playingOnDay.get(day).n > 0) continue;
      let closed = null;
      this.store.tx(() => {
        const top = this.leaderboard(day)[0];
        const win = top && top.score > 0 ? top : null;
        if (
          this.q.closeDay.run(day, win?.user_id ?? null, win?.score ?? 0, win ? this.o.dailyPrize : 0, t).changes !== 1
        )
          return;
        if (win) this.store.ledgerCredit(win.user_id, this.o.dailyPrize, 'basket_prize', null);
        closed = { day, winner: win, prize: win ? this.o.dailyPrize : 0 };
      });
      if (closed) this.emit('dayClosed', closed);
    }
  }

  state(userId) {
    this.tick();
    const t = this.now();
    const today = this.dayOf(t);
    const e = this.q.active.get(userId);
    const board = this.leaderboard(today);
    const mine = board.find((r) => r.user_id === userId);
    const user = (id) => {
      const u = this.store.getUser(id) ?? { id };
      return { id, name: displayName(u), username: u.username || '', photo: u.photo_url || '' };
    };
    const last = this.q.lastDay.get();
    return {
      serverNow: t,
      price: this.o.price,
      priceGram: this.priceGram(),
      rules: { baseMs: this.o.baseMs, bonusMs: this.o.bonusMs, swishBonusMs: this.o.swishBonusMs },
      session: e
        ? {
            gameId: e.id,
            startAt: e.start_at,
            deadline: e.deadline,
            score: e.score,
            shots: e.shots,
            seq: e.seq,
            nextShotAt: e.next_shot_at,
            hoop: this.#hoopAt(e, e.score),
            lastShot: e.last_shot ? JSON.parse(e.last_shot) : null,
          }
        : null,
      today: {
        day: today,
        endsAt: this.dayEndsAt(t),
        prize: this.o.dailyPrize,
        players: this.q.playersToday.get(today).n,
        top: board
          .slice(0, this.o.topSize)
          .map((r) => ({ ...user(r.user_id), place: r.place, score: r.score, shots: r.shots })),
        me: mine ? { place: mine.place, score: mine.score, shots: mine.shots } : null,
      },
      lastWinner: last?.winner_id
        ? { day: last.day, score: last.score, prize: last.prize, ...user(last.winner_id) }
        : null,
      attempts: this.q.myAttempts.all(userId, 20),
      stats: { ...this.q.stats.get(userId), ...this.q.wins.get(userId) },
    };
  }

  #refundLegacyMatches() {
    const db = this.store.db;
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'basket_games'").get();
    if (!has) return;
    const open = db.prepare("SELECT id, stake FROM basket_games WHERE status = 'open'").all();
    for (const g of open) {
      const refunded = [];
      this.store.tx(() => {
        if (
          db
            .prepare("UPDATE basket_games SET status = 'refunded', closed_at = ? WHERE id = ? AND status = 'open'")
            .run(this.now(), g.id).changes !== 1
        )
          return;
        for (const e of db.prepare('SELECT user_id FROM basket_entries WHERE game_id = ?').all(g.id)) {
          this.store.ledgerCredit(e.user_id, g.stake, 'basket_refund', g.id);
          refunded.push(e.user_id);
        }
        db.prepare("UPDATE basket_entries SET status = 'refunded' WHERE game_id = ?").run(g.id);
      });
      for (const userId of refunded) this.emit('legacyRefund', { userId, stake: g.stake, gameId: g.id });
    }
  }
}
