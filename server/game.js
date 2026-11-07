import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { AppError, GRAM, XTR } from './db.js';

export class Game extends EventEmitter {
  constructor(store, settings, { random = randomInt } = {}) {
    super();
    this.store = store;
    this.s = settings;
    this.random = random;
    this.timer = null;
    this.round = null;
    this.lastGame = null;
    this.topToday = null;
  }

  #loadHistory() {
    const card = (r) =>
      r && {
        round: r.id,
        id: r.user_id,
        name: displayName(r),
        username: r.username || '',
        photo: r.photo_url || '',
        bank: r.bank,
        bankXtr: r.bank_xtr ?? r.bank,
        bankGram: r.bank_gram ?? 0,
        chance: r.total ? Math.round((r.stake / r.total) * 10000) / 100 : 0,
      };
    this.lastGame = card(this.store.recentWinners(1)[0]);
    this.topToday = card(this.store.topWinSince(Date.now() - 86_400_000));
  }

  start() {
    const refunded = this.store.refundOpenRounds();
    if (refunded) console.log(`Возвращены ставки незавершённых раундов: ${refunded}`);
    this.#loadHistory();
    this.#newRound();
  }

  stop() {
    clearTimeout(this.timer);
  }

  #newRound() {
    this.round = {
      id: this.store.createRound(),
      status: 'waiting',
      players: new Map(),
      countdownEndsAt: null,
      spinStartedAt: null,
      spinEndsAt: null,
      resultEndsAt: null,
      winnerId: null,
      landing: null,
      bank: null,
    };
    this.#emit();
  }

  placeBet(user, amount, currency = XTR) {
    const r = this.round;
    if (r.status !== 'waiting' && r.status !== 'countdown') {
      throw new AppError('ROUND_CLOSED', 'Идёт розыгрыш — ставка попадёт в следующий раунд', 409);
    }
    const updatedUser = this.store.placeBet(r.id, user.id, amount, currency);
    let p = r.players.get(user.id);
    if (!p) {
      p = { user: updatedUser, xtr: 0, gram: 0, seat: r.players.size };
      r.players.set(user.id, p);
    }
    p.user = updatedUser;
    if (currency === GRAM) p.gram += amount;
    else p.xtr += amount;

    if (r.status === 'waiting' && r.players.size >= 2) {
      r.status = 'countdown';
      r.countdownEndsAt = Date.now() + this.s.countdownMs;
      this.timer = setTimeout(() => this.#spin(), this.s.countdownMs);
    }
    this.#emit();
    return updatedUser;
  }

  #spin() {
    const r = this.round;
    const rate = this.store.rate();
    const players = [...r.players.values()].map((p) => ({ p, w: weightOf(p, rate) }));
    const total = players.reduce((sum, x) => sum + x.w, 0);

    const ticket = this.random(total);
    let cursor = 0;
    let winner = players[0];
    let winnerStart = 0;
    for (const x of players) {
      if (ticket < cursor + x.w) {
        winner = x;
        winnerStart = cursor;
        break;
      }
      cursor += x.w;
    }
    const inside = 0.12 + (this.random(10_000) / 10_000) * 0.76;
    r.landing = (winnerStart + winner.w * inside) / total;

    r.winnerId = winner.p.user.id;
    r.rate = rate;
    r.bank = potOf([...r.players.values()], rate, this.s);
    r.status = 'spinning';
    r.spinStartedAt = Date.now();
    r.spinEndsAt = r.spinStartedAt + this.s.spinMs;
    this.#emit();
    this.timer = setTimeout(() => this.#finish(total / 1000), this.s.spinMs);
  }

  #finish(total) {
    const r = this.round;
    this.store.settleRound({
      roundId: r.id,
      total: Math.round(total),
      bank: r.bank,
      winnerId: r.winnerId,
      playerIds: [...r.players.keys()],
    });
    r.status = 'finished';
    r.resultEndsAt = Date.now() + this.s.resultMs;
    this.#loadHistory();
    this.#emit();
    this.timer = setTimeout(() => this.#newRound(), this.s.resultMs);
  }

  #emit() {
    this.emit('update', this.publicState());
  }

  publicState() {
    const r = this.round;
    const rate = r.rate ?? this.store.rate();
    const players = [...r.players.values()];
    const total = players.reduce((sum, p) => sum + weightOf(p, rate), 0) / 1000;
    return {
      id: r.id,
      status: r.status,
      serverNow: Date.now(),
      countdownMs: this.s.countdownMs,
      countdownEndsAt: r.countdownEndsAt,
      spinMs: this.s.spinMs,
      spinStartedAt: r.spinStartedAt,
      spinEndsAt: r.spinEndsAt,
      resultEndsAt: r.resultEndsAt,
      rate,
      total,
      bank: r.bank ?? potOf(players, rate, this.s),
      landing: r.landing,
      winnerId: r.winnerId,
      lastGame: this.lastGame,
      topToday: this.topToday,
      players: players.map((p) => ({
        id: p.user.id,
        name: displayName(p.user),
        username: p.user.username || '',
        photo: p.user.photo_url || '',
        xtr: p.xtr,
        gram: p.gram,
        value: weightOf(p, rate) / 1000,
        seat: p.seat,
      })),
    };
  }
}

export function weightOf(p, rate) {
  return p.xtr * 1000 + Math.round((p.gram * rate) / 1_000_000);
}

export function potOf(players, rate, s) {
  const xtr = players.reduce((a, p) => a + p.xtr, 0);
  const gram = players.reduce((a, p) => a + p.gram, 0);
  const value = xtr + (gram * rate) / 1_000_000_000;
  const free = value <= (s.houseFreeUpTo ?? 9);
  const pct = Math.round(s.houseCut * 100);
  const cut = (n) => (free ? n : n - Math.floor((n * pct) / 100));
  const bx = cut(xtr);
  const bg = cut(gram);
  return { xtr: bx, gram: bg, value: bx + (bg * rate) / 1_000_000_000 };
}

export function bankOf(total, houseCut, freeUpTo = 9) {
  if (total <= freeUpTo) return total;
  const feePercent = Math.round(houseCut * 100);
  return total - Math.floor((total * feePercent) / 100);
}

export function displayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.username ? `@${u.username}` : 'Игрок');
}
