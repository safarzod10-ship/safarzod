// Basketball Rush — серверная часть: очереди, матчи на троих, таймеры и проверка бросков.
//
// Сервер — единственный источник правды:
//  • клиент присылает только параметры броска (скорость), а попал ли мяч, сервер считает сам
//    той же детерминированной физикой (public/basket-physics.js) — подделать очки нельзя;
//  • время матча — только серверное: +5 секунд за попадание добавляет сервер, броски после
//    окончания времени не принимаются;
//  • новый мяч не раньше, чем закончился полёт предыдущего (защита от ускорения игры);
//  • у каждого броска порядковый номер: повтор того же запроса возвращает тот же ответ
//    и не начисляет очко второй раз, пропуск номера отклоняется;
//  • положения кольца генерирует сервер (криптографический генератор) и показывает только
//    текущее — следующее нельзя узнать заранее;
//  • слишком быстрые «броски без прицеливания» отклоняются, а нечеловечески ровная серия
//    попаданий помечается для проверки администратором.
//
// Категории 5/10/20/50/100 — только уровни соревнований, без ставок и денежных призов.

import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { QUANT, validLaunch, simulateShot, nextHoop } from '../public/basket-physics.js';
import { AppError } from './db.js';
import { displayName } from './game.js';

export const CATEGORIES = Object.freeze([5, 10, 20, 50, 100]);

export const BASKET_DEFAULTS = Object.freeze({
  players: 3,
  countdownMs: 3500, // «3-2-1» перед стартом
  baseMs: 30_000, // стартовое время
  bonusMs: 5_000, // за каждое попадание
  graceMs: 300, // бросок, отправленный в последний момент, ещё засчитывается
  shotGapMs: 200, // пауза между мячами после завершения полёта
  shotTolMs: 150, // допуск на сетевые задержки
  minAimMs: 120, // прицеливание короче — не человек
  minSamples: 3, // минимум движений пальца при прицеливании
  queueStaleMs: 15_000, // игрок в очереди перестал отвечать — убираем
  resultsTtlMs: 10 * 60_000, // итоги матча хранятся 10 минут
});

const cryptoRnd = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

export class BasketService extends EventEmitter {
  constructor(store, options = {}, { now = Date.now, rnd = cryptoRnd } = {}) {
    super();
    this.store = store;
    this.o = { ...BASKET_DEFAULTS, ...options };
    this.now = now;
    this.rnd = rnd;
    this.queues = new Map(CATEGORIES.map((c) => [c, new Map()])); // категория → (userId → { user, seen })
    this.matches = new Map(); // id → матч
    this.byUser = new Map(); // userId → id матча
    this.nextId = 1;
  }

  // ---------- Очередь ----------

  join(user, rawCategory) {
    const category = Number(rawCategory);
    if (!CATEGORIES.includes(category)) throw new AppError('BAD_CATEGORY', 'Нет такого уровня');
    this.tick();
    const active = this.#matchOf(user.id);
    if (active && active.finishedAt === null) throw new AppError('IN_MATCH', 'Вы уже в матче', 409);
    if (active) this.byUser.delete(user.id); // старые итоги закрываются новым поиском
    for (const q of this.queues.values()) q.delete(user.id);

    const queue = this.queues.get(category);
    queue.set(user.id, { user, seen: this.now() });
    this.#pruneQueue(queue);
    if (queue.size >= this.o.players) {
      const picked = [...queue.values()].slice(0, this.o.players);
      for (const e of picked) queue.delete(e.user.id);
      this.#createMatch(category, picked.map((e) => e.user));
    }
    return this.state(user.id);
  }

  leave(userId) {
    for (const q of this.queues.values()) q.delete(userId);
    const m = this.#matchOf(userId);
    if (m && m.finishedAt !== null) this.byUser.delete(userId); // закрыл итоги
    return this.state(userId);
  }

  #pruneQueue(queue) {
    const t = this.now();
    for (const [id, e] of queue) if (t - e.seen > this.o.queueStaleMs) queue.delete(id);
  }

  // ---------- Матч ----------

  #createMatch(category, users) {
    const t = this.now();
    const startAt = t + this.o.countdownMs;
    const match = {
      id: this.nextId++,
      category,
      startAt,
      hoops: [nextHoop(null, this.rnd)], // одна случайная последовательность колец на матч — у всех равные условия
      players: new Map(),
      finishedAt: null,
      results: null,
    };
    for (const u of users) {
      match.players.set(u.id, {
        user: u,
        score: 0,
        shots: 0,
        quality: 0,
        seq: 0,
        lastShot: null,
        nextShotAt: startAt,
        deadline: startAt + this.o.baseMs,
        reactions: [],
        flagged: false,
        seen: t,
      });
      this.byUser.set(u.id, match.id);
    }
    this.matches.set(match.id, match);
    this.emit('created', match);
    return match;
  }

  #matchOf(userId) {
    const id = this.byUser.get(userId);
    return id ? this.matches.get(id) ?? null : null;
  }

  #hoop(match, index) {
    while (match.hoops.length <= index) match.hoops.push(nextHoop(match.hoops.at(-1), this.rnd));
    return match.hoops[index];
  }

  #done(p, t = this.now()) {
    return t > p.deadline + this.o.graceMs;
  }

  /** Завершает матчи, где у всех троих вышло время, и чистит старые итоги. */
  tick() {
    const t = this.now();
    for (const m of this.matches.values()) {
      if (m.finishedAt === null && [...m.players.values()].every((p) => this.#done(p, t))) this.#finish(m);
      if (m.finishedAt !== null && t - m.finishedAt > this.o.resultsTtlMs) {
        for (const [uid, mid] of this.byUser) if (mid === m.id) this.byUser.delete(uid);
        this.matches.delete(m.id);
      }
    }
  }

  /**
   * Места. Сравнение не зависит от скорости интернета:
   * 1) больше очков; 2) меньше бросков (точнее); 3) выше средняя точность попаданий
   * (насколько близко к центру кольца, считается физикой на сервере); полное равенство — общее место.
   */
  static rank(players) {
    const key = (p) => [p.score, -p.shots, p.score ? Math.round((p.quality / p.score) * 1e6) : 0];
    const cmp = (a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return 0;
    };
    const sorted = [...players].sort(cmp);
    return sorted.map((p, i) => {
      let place = i + 1;
      for (let j = i - 1; j >= 0 && cmp(sorted[j], p) === 0; j--) place = j + 1;
      return { ...p, place };
    });
  }

  #finish(match) {
    const t = this.now();
    const ranked = BasketService.rank([...match.players.values()]);
    match.finishedAt = t;
    match.results = ranked.map((p) => ({
      userId: p.user.id,
      name: displayName(p.user),
      username: p.user.username || '',
      photo: p.user.photo_url || '',
      place: p.place,
      score: p.score,
      shots: p.shots,
      quality: p.score ? Math.round((p.quality / p.score) * 1000) / 1000 : 0,
      flagged: p.flagged,
    }));
    try {
      match.dbId = this.store.saveBasketMatch({
        category: match.category,
        startedAt: match.startAt,
        finishedAt: t,
        results: match.results,
      });
    } catch (e) {
      console.error('Не удалось сохранить итоги Basketball Rush:', e.message);
    }
    this.emit('finished', match);
  }

  // ---------- Бросок ----------

  shoot(userId, body = {}) {
    this.tick();
    const match = this.#matchOf(userId);
    if (!match || match.finishedAt !== null) throw new AppError('NO_MATCH', 'Матч уже завершён', 409);
    const p = match.players.get(userId);
    const t = this.now();
    p.seen = t;
    const seq = Number(body.seq);

    // Повтор уже обработанного броска (сеть оборвалась до ответа) — тот же ответ, без повторного очка
    if (seq === p.seq && p.lastShot) return { ...p.lastShot, replay: true, serverNow: t };
    if (!Number.isSafeInteger(seq) || seq !== p.seq + 1) {
      throw new AppError('BAD_SEQ', 'Состояние матча обновлено', 409);
    }
    if (t < match.startAt) throw new AppError('NOT_STARTED', 'Матч ещё не начался', 409);
    if (this.#done(p, t)) throw new AppError('TIME_UP', 'Время вышло', 409);
    if (t < p.nextShotAt - this.o.shotTolMs) throw new AppError('TOO_FAST', 'Мяч ещё в полёте', 429);

    const aimMs = Number(body.aimMs);
    const samples = Number(body.samples);
    if (!(aimMs >= this.o.minAimMs) || !(samples >= this.o.minSamples)) {
      throw new AppError('BAD_AIM', 'Прицельтесь и отпустите палец', 400);
    }
    const ivx = Number(body.vx);
    const ivy = Number(body.vy);
    if (!Number.isSafeInteger(ivx) || !Number.isSafeInteger(ivy) || Math.abs(ivx) > 50_000 || Math.abs(ivy) > 50_000) {
      throw new AppError('BAD_SHOT', 'Некорректный бросок', 400);
    }
    const vx = ivx / QUANT;
    const vy = ivy / QUANT;
    if (!validLaunch(vx, vy)) throw new AppError('BAD_SHOT', 'Некорректный бросок', 400);

    const hoop = this.#hoop(match, p.score);
    const sim = simulateShot(hoop, vx, vy);

    p.seq = seq;
    p.shots++;
    p.reactions.push(t - Math.max(p.nextShotAt, match.startAt)); // сколько прошло от готовности мяча до броска
    if (sim.made) {
      p.score++;
      p.quality += sim.quality;
      p.deadline += this.o.bonusMs;
    }
    p.nextShotAt = t + Math.round(sim.settleT * 1000) + this.o.shotGapMs;
    this.#checkAnomaly(match, p);

    const result = {
      seq,
      vx: ivx,
      vy: ivy,
      made: sim.made,
      settleT: sim.settleT,
      score: p.score,
      shots: p.shots,
      deadline: p.deadline,
      nextShotAt: p.nextShotAt,
      shotHoop: hoop, // кольцо, в которое летел этот мяч
      hoop: this.#hoop(match, p.score), // кольцо для следующего мяча (после попадания — новое)
    };
    p.lastShot = result;
    return { ...result, serverNow: t };
  }

  /**
   * Подозрительная серия: ≥ 12 бросков, ≥ 90% попаданий и почти одинаковое время реакции
   * (от появления мяча до броска) — у человека оно заметно «гуляет», у скрипта — нет.
   * Результат не отменяется автоматически — матч помечается, админ получает уведомление.
   */
  #checkAnomaly(match, p) {
    if (p.flagged || p.shots < 12 || p.score / p.shots < 0.9) return;
    const last = p.reactions.slice(-10);
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    const sd = Math.sqrt(last.reduce((a, b) => a + (b - mean) ** 2, 0) / last.length);
    if (sd < 60) {
      p.flagged = true;
      this.emit('flag', { match, user: p.user, score: p.score, shots: p.shots, sd: Math.round(sd) });
    }
  }

  // ---------- Состояние для клиента (и после переподключения) ----------

  state(userId) {
    this.tick();
    const t = this.now();
    for (const q of this.queues.values()) {
      const e = q.get(userId);
      if (e) e.seen = t; // игрок на связи — не выкидываем из очереди
      this.#pruneQueue(q);
    }
    const queues = Object.fromEntries([...this.queues].map(([c, q]) => [c, q.size]));
    const queued = [...this.queues].find(([, q]) => q.has(userId));
    const base = {
      serverNow: t,
      categories: CATEGORIES,
      queues,
      rules: { baseMs: this.o.baseMs, bonusMs: this.o.bonusMs, players: this.o.players },
    };
    const match = this.#matchOf(userId);
    if (!match) {
      return {
        ...base,
        stage: queued ? 'queue' : 'lobby',
        queue: queued
          ? { category: queued[0], players: [...queued[1].values()].map((e) => publicUser(e.user)) }
          : null,
      };
    }
    const p = match.players.get(userId);
    p.seen = t;
    const stage = match.finishedAt !== null ? 'results' : t < match.startAt ? 'countdown' : 'playing';
    return {
      ...base,
      stage,
      match: {
        id: match.id,
        category: match.category,
        startAt: match.startAt,
        me: {
          score: p.score,
          shots: p.shots,
          seq: p.seq,
          deadline: p.deadline,
          nextShotAt: p.nextShotAt,
          hoop: this.#hoop(match, p.score),
          done: this.#done(p, t),
          lastShot: p.lastShot,
        },
        players: [...match.players.values()].map((o) => ({
          ...publicUser(o.user),
          score: o.score,
          shots: o.shots,
          done: this.#done(o, t),
          deadline: o.deadline,
        })),
        results: match.results,
      },
    };
  }

  stats(userId) {
    return this.store.basketStats(userId);
  }
}

function publicUser(u) {
  return { id: u.id, name: displayName(u), username: u.username || '', photo: u.photo_url || '' };
}
