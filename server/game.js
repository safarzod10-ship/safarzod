// Игровой движок рулетки. Сервер — единственный источник правды: он принимает ставки,
// считает доли, выбирает победителя и сообщает всем клиентам одно и то же состояние.
//
// Жизненный цикл раунда:
//   waiting   — 0–1 участник, ждём второго (ставки принимаются)
//   countdown — есть 2+ участника, 15 секунд на присоединение (ставки принимаются)
//   spinning  — победитель выбран, клиенты крутят колесо до одной и той же точки
//   finished  — показ победителя, затем новый раунд

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

  /** «Последняя игра» и «Топ игра дня» для карточек над колесом. */
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
      players: new Map(), // userId → { user, amount, seat }
      countdownEndsAt: null,
      spinStartedAt: null,
      spinEndsAt: null,
      resultEndsAt: null,
      winnerId: null,
      landing: null, // точка на колесе (0..1 от начала круга), куда указывает стрелка
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

    // Победитель: случайный «билет» из всех поставленных очков — шанс равен доле.
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
    // Точка остановки — случайное место внутри сектора победителя, не у самой границы.
    const inside = 0.12 + (this.random(10_000) / 10_000) * 0.76;
    r.landing = (winnerStart + winner.amount * inside) / total;

    r.winnerId = winner.user.id;
    r.bank = bankOf(total, this.s.houseCut);
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

  /** Состояние раунда для клиентов. Комиссия не раскрывается — только банк к выплате. */
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
      bank: r.status === 'spinning' || r.status === 'finished' ? r.bank : bankOf(total, this.s.houseCut),
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

export function bankOf(total, houseCut) {
  // Целочисленно: 500 × 0.9 в дробях даёт 449.999…, а должно быть ровно 450.
  const keepPercent = Math.round((1 - houseCut) * 100);
  return Math.floor((total * keepPercent) / 100);
}

export function displayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.username ? `@${u.username}` : 'Игрок');
}
