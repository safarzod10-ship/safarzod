import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { AppError } from './db.js';

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
      bank: 0,
    };
    this.#emit();
  }

  placeBet(user, amount) {
    const r = this.round;
    if (r.status !== 'waiting' && r.status !== 'countdown') {
      throw new AppError('ROUND_CLOSED', 'Идёт розыгрыш — ставка попадёт в следующий раунд', 409);
    }
    const updatedUser = this.store.placeBet(r.id, user.id, amount);

    const existing = r.players.get(user.id);
    if (existing) {
      existing.amount += amount;
      existing.user = updatedUser;
    } else {
      r.players.set(user.id, { user: updatedUser, amount, seat: r.players.size });
    }

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
    const players = [...r.players.values()];
    const total = players.reduce((sum, p) => sum + p.amount, 0);

    const ticket = this.random(total);
    let cursor = 0;
    let winner = players[0];
    let winnerStart = 0;
    for (const p of players) {
      if (ticket < cursor + p.amount) {
        winner = p;
        winnerStart = cursor;
        break;
      }
      cursor += p.amount;
    }
    const inside = 0.12 + (this.random(10_000) / 10_000) * 0.76;
    r.landing = (winnerStart + winner.amount * inside) / total;

    r.winnerId = winner.user.id;
    r.bank = bankOf(total, this.s.houseCut, this.s.houseFreeUpTo);
    r.status = 'spinning';
    r.spinStartedAt = Date.now();
    r.spinEndsAt = r.spinStartedAt + this.s.spinMs;
    this.#emit();
    this.timer = setTimeout(() => this.#finish(total), this.s.spinMs);
  }

  #finish(total) {
    const r = this.round;
    this.store.settleRound({
      roundId: r.id,
      total,
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
    const players = [...r.players.values()];
    const total = players.reduce((sum, p) => sum + p.amount, 0);
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
      bank:
        r.status === 'spinning' || r.status === 'finished'
          ? r.bank
          : bankOf(total, this.s.houseCut, this.s.houseFreeUpTo),
      landing: r.landing,
      winnerId: r.winnerId,
      lastGame: this.lastGame,
      topToday: this.topToday,
      players: players.map((p) => ({
        id: p.user.id,
        name: displayName(p.user),
        username: p.user.username || '',
        photo: p.user.photo_url || '',
        amount: p.amount,
        seat: p.seat,
      })),
    };
  }
}

export function bankOf(total, houseCut, freeUpTo = 9) {
  if (total <= freeUpTo) return total;
  const feePercent = Math.round(houseCut * 100);
  return total - Math.floor((total * feePercent) / 100);
}

export function displayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.username ? `@${u.username}` : 'Игрок');
}
