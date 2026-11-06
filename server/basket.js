// Basketball Rush — серверная часть. Асинхронные матчи на троих со ставкой.
//
// «Играть» → выбор суммы → сервер ищет открытый матч с этой ставкой, где есть свободное место
// и где игрока ещё нет; если такого нет — создаёт новый. Игра начинается сразу, ждать никого не нужно.
// Когда сыграли трое — подводятся итоги и выплачивается банк. Если за час набралось меньше трёх
// игроков — матч закрывается и ставки возвращаются. Одновременно у игрока может быть только одна
// незакрытая игра: новую можно начать, когда подведены итоги предыдущей.
//
// Сервер — единственный источник правды:
//  • клиент присылает только скорость броска; попал ли мяч и было ли касание кольца, сервер считает
//    сам той же детерминированной физикой (public/basket-physics.js);
//  • время и бонусные секунды — только серверные; броски до старта и после конца не принимаются;
//  • новый мяч — не раньше окончания полёта предыдущего (ускорение игры не работает);
//  • номер броска: повтор того же запроса возвращает тот же ответ, пропуск номера отклоняется;
//  • кольца — одна случайная (криптографически) последовательность на матч: равные условия для троих;
//  • броски без прицеливания отклоняются; нечеловечески ровная серия попаданий помечается.
//  Всё состояние хранится в базе — матчи переживают перезапуск сервера и обрыв связи у игрока.

import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { QUANT, validLaunch, simulateShot, nextHoop } from '../public/basket-physics.js';
import { AppError } from './db.js';
import { bankOf, displayName } from './game.js';

export const STAKES = Object.freeze([5, 10, 20, 50, 100]);

export const BASKET_DEFAULTS = Object.freeze({
  players: 3,
  countdownMs: 3000, // «3-2-1» перед первым мячом
  baseMs: 30_000, // стартовое время
  bonusMs: 3_000, // обычное попадание
  swishBonusMs: 5_000, // чистое попадание — мяч не коснулся дужки кольца
  graceMs: 300, // бросок, отправленный в последний момент, ещё засчитывается
  shotGapMs: 200,
  shotTolMs: 150,
  minAimMs: 120,
  minSamples: 3,
  expireMs: 60 * 60 * 1000, // матч ждёт троих не дольше часа
  houseCut: 0.1, // комиссия с банка (как в рулетке)
  houseFreeUpTo: 9, // банк до 9 включительно — без комиссии
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS basket_games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stake       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | finished | refunded
  hoops       TEXT NOT NULL,                  -- JSON: последовательность положений кольца
  bank        INTEGER NOT NULL DEFAULT 0,     -- выплачено победителю (после комиссии)
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS basket_games_open ON basket_games(status, stake, id);
CREATE TABLE IF NOT EXISTS basket_entries (
  game_id      INTEGER NOT NULL REFERENCES basket_games(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'playing', -- playing | done | refunded
  joined_at    INTEGER NOT NULL,
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
  place        INTEGER,
  prize        INTEGER NOT NULL DEFAULT 0,
  finished_at  INTEGER,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS basket_entries_user ON basket_entries(user_id, status);
CREATE INDEX IF NOT EXISTS basket_entries_status ON basket_entries(status, deadline);
`;

const cryptoRnd = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

export class BasketService extends EventEmitter {
  constructor(store, options = {}, { now = Date.now, rnd = cryptoRnd } = {}) {
    super();
    this.store = store;
    this.o = { ...BASKET_DEFAULTS, ...options };
    this.now = now;
    this.rnd = rnd;
    this.reactions = new Map(); // `${game}:${user}` → время реакции по броскам (для пометки ботов)
    const db = store.db;
    db.exec(SCHEMA);
    const q = (sql) => db.prepare(sql);
    this.q = {
      active: q("SELECT * FROM basket_entries WHERE user_id = ? AND status = 'playing' LIMIT 1"),
      openOfUser: q(`SELECT e.game_id FROM basket_entries e JOIN basket_games g ON g.id = e.game_id
                     WHERE e.user_id = ? AND g.status = 'open' LIMIT 1`),
      findOpen: q(`SELECT g.* FROM basket_games g
                   WHERE g.status = 'open' AND g.stake = :stake
                     AND (SELECT COUNT(*) FROM basket_entries e WHERE e.game_id = g.id) < :players
                     AND NOT EXISTS (SELECT 1 FROM basket_entries e WHERE e.game_id = g.id AND e.user_id = :user)
                   ORDER BY g.id LIMIT 1`),
      newGame: q("INSERT INTO basket_games (stake, hoops, created_at) VALUES (?, ?, ?)"),
      game: q('SELECT * FROM basket_games WHERE id = ?'),
      setHoops: q('UPDATE basket_games SET hoops = ? WHERE id = ?'),
      join: q(`INSERT INTO basket_entries (game_id, user_id, joined_at, start_at, deadline, next_shot_at)
               VALUES (?, ?, ?, ?, ?, ?)`),
      saveShot: q(`UPDATE basket_entries SET score = :score, shots = :shots, swishes = :swishes, quality = :quality,
                     seq = :seq, deadline = :deadline, next_shot_at = :next, last_shot = :last, flagged = :flagged
                   WHERE game_id = :game AND user_id = :user`),
      expiredPlaying: q("SELECT * FROM basket_entries WHERE status = 'playing' AND deadline < ?"),
      markDone: q("UPDATE basket_entries SET status = 'done', finished_at = ? WHERE game_id = ? AND user_id = ? AND status = 'playing'"),
      entries: q('SELECT * FROM basket_entries WHERE game_id = ? ORDER BY joined_at'),
      setResult: q('UPDATE basket_entries SET place = ?, prize = ? WHERE game_id = ? AND user_id = ?'),
      closeGame: q('UPDATE basket_games SET status = ?, bank = ?, closed_at = ? WHERE id = ? AND status = ?'),
      setRefunded: q("UPDATE basket_entries SET status = 'refunded' WHERE game_id = ?"),
      staleOpen: q(`SELECT g.* FROM basket_games g WHERE g.status = 'open' AND g.created_at < ?
                    AND NOT EXISTS (SELECT 1 FROM basket_entries e WHERE e.game_id = g.id AND e.status = 'playing')`),
      myGames: q(`SELECT g.* FROM basket_games g JOIN basket_entries e ON e.game_id = g.id
                  WHERE e.user_id = ? ORDER BY g.id DESC LIMIT ?`),
      stats: q(`SELECT COUNT(*) AS games, COALESCE(SUM(e.place = 1), 0) AS wins, COALESCE(MAX(e.score), 0) AS best,
                  COALESCE(SUM(e.prize), 0) AS won
                FROM basket_entries e WHERE e.user_id = ? AND e.status = 'done'`),
      openCount: q(`SELECT g.stake, COUNT(*) AS n FROM basket_games g
                    WHERE g.status = 'open' AND (SELECT COUNT(*) FROM basket_entries e WHERE e.game_id = g.id) < ?
                    GROUP BY g.stake`),
    };
  }

  // ====================== Начать игру ======================

  /** «Играть» с выбранной ставкой: свободное место в открытом матче или новый матч. */
  play(user, rawStake) {
    const stake = Number(rawStake);
    if (!STAKES.includes(stake)) throw new AppError('BAD_STAKE', 'Нет такой ставки');
    this.tick();
    if (this.q.active.get(user.id)) return this.state(user.id); // уже играет — вернём в игру
    if (this.q.openOfUser.get(user.id)) {
      throw new AppError('WAIT_RESULT', 'Дождитесь итогов текущей игры — потом можно сыграть снова', 409);
    }
    const t = this.now();
    this.store.tx(() => {
      let game = this.q.findOpen.get({ stake, players: this.o.players, user: user.id });
      if (!game) {
        const hoops = JSON.stringify([nextHoop(null, this.rnd)]);
        const id = Number(this.q.newGame.run(stake, hoops, t).lastInsertRowid);
        game = this.q.game.get(id);
      }
      this.store.ledgerDebit(user.id, stake, 'basket_stake', game.id); // мало звёзд — откат всей операции
      const startAt = t + this.o.countdownMs;
      this.q.join.run(game.id, user.id, t, startAt, startAt + this.o.baseMs, startAt);
    });
    this.emit('balance', user.id);
    return this.state(user.id);
  }

  // ====================== Бросок ======================

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

    const game = this.q.game.get(e.game_id);
    const hoop = this.#hoopAt(game, e.score);
    const sim = simulateShot(hoop, ivx / QUANT, ivy / QUANT);
    // Чистое попадание: до попадания мяч ни разу не коснулся дужки (щит — можно)
    const swish = sim.made && !sim.contacts.some(([kind, ct]) => kind === 'rim' && ct <= sim.madeT);

    const key = `${e.game_id}:${userId}`;
    const reactions = this.reactions.get(key) ?? [];
    reactions.push(t - Math.max(e.next_shot_at, e.start_at));
    this.reactions.set(key, reactions);

    const next = {
      score: e.score + (sim.made ? 1 : 0),
      shots: e.shots + 1,
      swishes: e.swishes + (swish ? 1 : 0),
      quality: e.quality + (sim.made ? sim.quality : 0),
      seq,
      deadline: e.deadline + (sim.made ? (swish ? this.o.swishBonusMs : this.o.bonusMs) : 0),
      next: t + Math.round(sim.settleT * 1000) + this.o.shotGapMs,
      flagged: e.flagged,
    };
    if (!next.flagged && this.#suspicious(next, reactions)) {
      next.flagged = 1;
      this.emit('flag', { gameId: e.game_id, userId, score: next.score, shots: next.shots });
    }
    const result = {
      seq,
      vx: ivx,
      vy: ivy,
      made: sim.made,
      swish,
      bonusMs: sim.made ? (swish ? this.o.swishBonusMs : this.o.bonusMs) : 0,
      settleT: sim.settleT,
      score: next.score,
      shots: next.shots,
      deadline: next.deadline,
      nextShotAt: next.next,
      shotHoop: hoop,
      hoop: this.#hoopAt(game, next.score),
    };
    this.q.saveShot.run({ ...next, last: JSON.stringify(result), game: e.game_id, user: userId });
    return { ...result, serverNow: t };
  }

  /** ≥ 12 бросков, ≥ 90% попаданий и почти одинаковое время реакции — так играет скрипт. */
  #suspicious(p, reactions) {
    if (p.shots < 12 || p.score / p.shots < 0.9) return false;
    const last = reactions.slice(-10);
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length);
    return sd < 60;
  }

  #hoopAt(game, index) {
    const hoops = JSON.parse(game.hoops);
    if (hoops.length > index) return hoops[index];
    while (hoops.length <= index) hoops.push(nextHoop(hoops.at(-1), this.rnd));
    this.q.setHoops.run(JSON.stringify(hoops), game.id);
    game.hoops = JSON.stringify(hoops);
    return hoops[index];
  }

  // ====================== Итоги, возвраты ======================

  /** Закрывает сыгранные попытки, подводит итоги полных матчей, возвращает ставки просроченных. */
  tick() {
    const t = this.now();
    for (const e of this.q.expiredPlaying.all(t - this.o.graceMs)) {
      this.q.markDone.run(Math.min(t, e.deadline), e.game_id, e.user_id);
      this.reactions.delete(`${e.game_id}:${e.user_id}`);
      const entries = this.q.entries.all(e.game_id);
      if (entries.length >= this.o.players && entries.every((x) => x.status === 'done')) this.#finish(e.game_id);
    }
    for (const g of this.q.staleOpen.all(t - this.o.expireMs)) this.#refund(g);
  }

  /**
   * Места: больше очков → меньше бросков → точнее в центр кольца; полное равенство (и 0 очков) — общее место.
   * Скорость интернета на результат не влияет.
   */
  static rank(entries) {
    // число бросков сравниваем только при ненулевом счёте: 0 очков — это 0 очков, сколько ни бросай
    const key = (p) => [p.score, p.score ? -p.shots : 0, p.score ? Math.round((p.quality / p.score) * 1e6) : 0];
    const cmp = (a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return 0;
    };
    const sorted = [...entries].sort(cmp);
    return sorted.map((p, i) => {
      let place = i + 1;
      for (let j = i - 1; j >= 0 && cmp(sorted[j], p) === 0; j--) place = j + 1;
      return { ...p, place };
    });
  }

  #finish(gameId) {
    const t = this.now();
    let closed = null;
    this.store.tx(() => {
      const game = this.q.game.get(gameId);
      if (game.status !== 'open') return;
      const ranked = BasketService.rank(this.q.entries.all(gameId));
      const pot = bankOf(game.stake * ranked.length, this.o.houseCut, this.o.houseFreeUpTo);
      const winners = ranked.filter((r) => r.place === 1);
      const share = Math.floor(pot / winners.length); // ничья за 1-е место — банк делится поровну
      for (const r of ranked) {
        const prize = r.place === 1 ? share : 0;
        if (prize > 0) this.store.ledgerCredit(r.user_id, prize, 'basket_win', gameId);
        this.q.setResult.run(r.place, prize, gameId, r.user_id);
      }
      this.q.closeGame.run('finished', share * winners.length, t, gameId, 'open');
      closed = { game: this.q.game.get(gameId), entries: this.q.entries.all(gameId), refunded: false };
    });
    if (closed) this.emit('closed', closed);
  }

  #refund(game) {
    let closed = null;
    this.store.tx(() => {
      if (this.q.closeGame.run('refunded', 0, this.now(), game.id, 'open').changes !== 1) return;
      const entries = this.q.entries.all(game.id);
      for (const e of entries) this.store.ledgerCredit(e.user_id, game.stake, 'basket_refund', game.id);
      this.q.setRefunded.run(game.id);
      closed = { game: this.q.game.get(game.id), entries, refunded: true };
    });
    if (closed) this.emit('closed', closed);
  }

  // ====================== Состояние для клиента ======================

  state(userId) {
    this.tick();
    const t = this.now();
    const open = Object.fromEntries(this.q.openCount.all(this.o.players).map((r) => [r.stake, r.n]));
    const e = this.q.active.get(userId);
    let session = null;
    if (e) {
      const game = this.q.game.get(e.game_id);
      session = {
        gameId: e.game_id,
        stake: game.stake,
        startAt: e.start_at,
        deadline: e.deadline,
        score: e.score,
        shots: e.shots,
        seq: e.seq,
        nextShotAt: e.next_shot_at,
        hoop: this.#hoopAt(game, e.score),
        lastShot: e.last_shot ? JSON.parse(e.last_shot) : null,
      };
    }
    return {
      serverNow: t,
      stakes: STAKES,
      open,
      rules: {
        baseMs: this.o.baseMs,
        bonusMs: this.o.bonusMs,
        swishBonusMs: this.o.swishBonusMs,
        players: this.o.players,
        expireMs: this.o.expireMs,
      },
      session,
      activeGameId: this.q.openOfUser.get(userId)?.game_id ?? null, // незакрытая игра: новую начать нельзя
      games: this.q.myGames.all(userId, 15).map((g) => this.#publicGame(g, userId)),
      stats: { ...this.q.stats.get(userId) },
    };
  }

  #publicGame(g, userId) {
    const entries = this.q.entries.all(g.id);
    const mine = entries.find((x) => x.user_id === userId);
    return {
      id: g.id,
      stake: g.stake,
      status: g.status,
      bank: g.status === 'finished' ? g.bank : bankOf(g.stake * this.o.players, this.o.houseCut, this.o.houseFreeUpTo),
      createdAt: g.created_at,
      expiresAt: g.created_at + this.o.expireMs,
      me: mine && { score: mine.score, status: mine.status, place: mine.place, prize: mine.prize },
      players: entries.map((x) => {
        const u = this.store.getUser(x.user_id) ?? { id: x.user_id };
        // счёт соперника виден, когда он доиграл (и когда доиграл сам игрок)
        const reveal = x.status !== 'playing' && mine?.status !== 'playing';
        return {
          id: x.user_id,
          name: displayName(u),
          username: u.username || '',
          photo: u.photo_url || '',
          status: x.status,
          score: reveal ? x.score : null,
          shots: reveal ? x.shots : null,
          place: x.place,
          prize: x.prize,
        };
      }),
    };
  }
}
