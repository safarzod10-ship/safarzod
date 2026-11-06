import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { BasketService, CATEGORIES } from '../server/basket.js';
import {
  WORLD, HOOP_BOUNDS, QUANT, simulateShot, previewPath, isReachable, nextHoop, validLaunch,
} from '../public/basket-physics.js';

// ---------- помощники ----------
function setup(opts = {}) {
  const store = openDb(':memory:');
  const users = [1, 2, 3, 4].map((id) => store.upsertUser({ id, first_name: `P${id}`, username: `p${id}` }));
  const clock = { t: 1_000_000 };
  const svc = new BasketService(store, opts, { now: () => clock.t });
  return { store, users, clock, svc };
}

/** Ищет бросок (в целых тысячных, как шлёт клиент), который попадает / промахивается. */
function findShot(hoop, wantMade) {
  for (let speed = WORLD.VMIN; speed <= WORLD.VMAX; speed += 0.05) {
    for (let k = 0; k < 200; k++) {
      const s = 0.2 + k * 0.027;
      const n = Math.sqrt(1 + s * s);
      const vx = Math.round((speed / n) * QUANT);
      const vy = Math.round(((speed * s) / n) * QUANT);
      if (!validLaunch(vx / QUANT, vy / QUANT)) continue;
      if (simulateShot(hoop, vx / QUANT, vy / QUANT).made === wantMade) return { vx, vy };
    }
  }
  throw new Error('не нашёл бросок');
}

function startMatch(ctx, category = 10) {
  const [a, b, c] = ctx.users;
  ctx.svc.join(a, category);
  ctx.svc.join(b, category);
  const st = ctx.svc.join(c, category);
  assert.equal(st.stage, 'countdown');
  ctx.clock.t = st.match.startAt + 1;
  return st.match;
}

function shot(ctx, uid, made, extra = {}) {
  const st = ctx.svc.state(uid);
  const me = st.match.me;
  if (ctx.clock.t < me.nextShotAt) ctx.clock.t = me.nextShotAt;
  const s = findShot(me.hoop, made);
  return ctx.svc.shoot(uid, { seq: me.seq + 1, ...s, aimMs: 400, samples: 12, ...extra });
}

// ---------- физика ----------
test('физика: полёт без препятствий совпадает с формулой параболы', () => {
  const hoop = { x: 50, y: 50 }; // кольцо далеко — не мешает
  const r = simulateShot(hoop, 6, 9, { frames: true });
  // полуявный Эйлер: после n шагов y = y0 + vy·t − g·dt²·n(n+1)/2
  for (const n of [12, 60, 90]) {
    const t = n * WORLD.DT;
    const y = WORLD.START.y + 9 * t - WORLD.G * WORLD.DT * WORLD.DT * (n * (n + 1)) / 2;
    const x = WORLD.START.x + 6 * t;
    assert.ok(Math.abs(r.frames[2 * n] - x) < 1e-9 && Math.abs(r.frames[2 * n + 1] - y) < 1e-9, `шаг ${n}`);
  }
  // предпросмотр (точная парабола) близок к симуляции
  const [px, py] = previewPath(6, 9, 0.5, 0.5)[0];
  assert.ok(Math.abs(px - r.frames[120]) < 1e-9 && Math.abs(py - r.frames[121]) < 0.06);
});

test('физика: детерминирована, попадание и промах различаются, мяч отскакивает от дужки и щита', () => {
  const hoop = { x: 7, y: 5 };
  const make = findShot(hoop, true);
  const a = simulateShot(hoop, make.vx / QUANT, make.vy / QUANT, { frames: true });
  const b = simulateShot(hoop, make.vx / QUANT, make.vy / QUANT, { frames: true });
  assert.deepEqual(a.frames, b.frames);
  assert.ok(a.made && a.quality > 0 && a.quality <= 1);
  assert.ok(a.settleT > a.madeT && a.settleT < WORLD.MAX_T);
  // сильный бросок в щит — есть контакт со щитом
  let board = false;
  for (let vy = 8; vy < 13 && !board; vy += 0.1) board = simulateShot(hoop, 9.5, vy).contacts.some(([k]) => k === 'board');
  assert.ok(board, 'есть отскок от щита');
  // мяч, ударивший дужку снизу, не засчитывается
  const low = simulateShot(hoop, 8, 4);
  assert.equal(low.made, false);
});

test('кольцо: все позиции в границах достижимы; новая позиция случайна, в кадре и не повторяет прошлую', () => {
  const B = HOOP_BOUNDS;
  for (let x = B.xMin; x <= B.xMax + 1e-9; x += 0.68) for (let y = B.yMin; y <= B.yMax + 1e-9; y += 1) {
    assert.ok(isReachable({ x, y }), `достижимо ${x},${y}`);
  }
  let prev = null;
  const seen = new Set();
  const moves = { closer: 0, farther: 0, higher: 0, lower: 0 };
  for (let i = 0; i < 200; i++) {
    const h = nextHoop(prev, Math.random);
    assert.ok(h.x >= B.xMin && h.x <= B.xMax && h.y >= B.yMin && h.y <= B.yMax, 'в границах');
    assert.ok(h.x + WORLD.BOARD_X + WORLD.BALL_R < WORLD.W, 'щит в кадре');
    if (prev) {
      assert.ok(Math.hypot(h.x - prev.x, h.y - prev.y) >= 1.1, 'заметно сместилось');
      moves[h.x < prev.x ? 'closer' : 'farther']++;
      moves[h.y > prev.y ? 'higher' : 'lower']++;
    }
    seen.add(`${h.x},${h.y}`);
    prev = h;
  }
  assert.ok(seen.size > 190, 'нет одинаковой последовательности');
  for (const k in moves) assert.ok(moves[k] > 30, `бывает «${k}»`);
});

// ---------- матч ----------
test('очередь: ровно трое → матч; четвёртый ждёт; уровни раздельные; выход из очереди', () => {
  const ctx = setup();
  const [a, b, c, d] = ctx.users;
  assert.equal(ctx.svc.join(a, 5).stage, 'queue');
  assert.equal(ctx.svc.join(b, 20).stage, 'queue'); // другой уровень
  assert.equal(ctx.svc.join(c, 5).queue.players.length, 2);
  assert.equal(ctx.svc.leave(c.id).stage, 'lobby');
  ctx.svc.join(c, 5);
  ctx.svc.join(d, 5);
  assert.equal(ctx.svc.state(a.id).stage, 'countdown');
  assert.deepEqual(ctx.svc.state(a.id).match.players.map((p) => p.id).sort(), [1, 3, 4]);
  assert.equal(ctx.svc.state(b.id).stage, 'queue');
  assert.throws(() => ctx.svc.join(a, 10), /уже в матче/);
  assert.throws(() => ctx.svc.join(b, 7), /Нет такого уровня/);
  assert.deepEqual(CATEGORIES, [5, 10, 20, 50, 100]);
});

test('таймер и очки: 30 с старт, попадание = +1 очко и +5 с, промах ничего не даёт, кольцо меняется', () => {
  const ctx = setup();
  const m = startMatch(ctx);
  const st0 = ctx.svc.state(1).match.me;
  assert.equal(st0.deadline, m.startAt + 30_000);
  const hoop0 = st0.hoop;

  const miss = shot(ctx, 1, false);
  assert.deepEqual([miss.made, miss.score, miss.deadline], [false, 0, m.startAt + 30_000]);
  assert.deepEqual(miss.hoop, hoop0, 'после промаха кольцо на месте');

  const hit = shot(ctx, 1, true);
  assert.deepEqual([hit.made, hit.score, hit.deadline], [true, 1, m.startAt + 35_000]);
  assert.notDeepEqual(hit.hoop, hoop0, 'после попадания кольцо переехало');
  // у всех троих одна и та же последовательность колец — равные условия
  assert.deepEqual(ctx.svc.state(2).match.me.hoop, hoop0);
  shot(ctx, 2, true);
  assert.deepEqual(ctx.svc.state(2).match.me.hoop, hit.hoop);
});

test('защита: повтор запроса не даёт второго очка, пропуск номера, ускорение, бросок без прицеливания, подделка скорости', () => {
  const ctx = setup();
  startMatch(ctx);
  const me = ctx.svc.state(1).match.me;
  const good = findShot(me.hoop, true);
  const body = { seq: 1, ...good, aimMs: 300, samples: 8 };
  const r1 = ctx.svc.shoot(1, body);
  const r2 = ctx.svc.shoot(1, body); // сеть повторила запрос
  assert.equal(r1.score, 1);
  assert.equal(r2.score, 1);
  assert.equal(r2.replay, true);
  assert.equal(ctx.svc.state(1).match.me.shots, 1);

  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 3 }), (e) => e.code === 'BAD_SEQ');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2 }), (e) => e.code === 'TOO_FAST', 'мяч ещё летит');
  ctx.clock.t = ctx.svc.state(1).match.me.nextShotAt;
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, aimMs: 20 }), (e) => e.code === 'BAD_AIM');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, samples: 0 }), (e) => e.code === 'BAD_AIM');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, vx: 40_000, vy: 40_000 }), (e) => e.code === 'BAD_SHOT', 'сверхскорость');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, vx: 6.5, vy: 9.1 }), (e) => e.code === 'BAD_SHOT', 'не целые тысячные');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, vx: -3000, vy: 9000 }), (e) => e.code === 'BAD_SHOT', 'назад');
  assert.equal(ctx.svc.state(1).match.me.score, 1, 'ни одна попытка не изменила счёт');
});

test('время: до старта и после окончания броски не принимаются; бросок в последний момент засчитывается', () => {
  const ctx = setup();
  const [a, b, c] = ctx.users;
  ctx.svc.join(a, 50); ctx.svc.join(b, 50);
  const st = ctx.svc.join(c, 50);
  const s = findShot(st.match.me.hoop, true);
  assert.throws(() => ctx.svc.shoot(1, { seq: 1, ...s, aimMs: 300, samples: 5 }), (e) => e.code === 'NOT_STARTED');
  ctx.clock.t = st.match.startAt + 1;
  shot(ctx, 2, true); shot(ctx, 2, true); // у второго игрока +10 с — матч продолжается дольше
  ctx.clock.t = st.match.startAt + 30_000 + 100; // вышло время, но в пределах допуска на сеть
  assert.equal(ctx.svc.shoot(1, { seq: 1, ...s, aimMs: 300, samples: 5 }).score, 1);
  ctx.clock.t = st.match.startAt + 35_000 + 301; // +5 с за попадание уже истекли
  const me = ctx.svc.state(1).match.me;
  assert.equal(me.done, true);
  assert.throws(() => ctx.svc.shoot(1, { seq: 2, ...s, aimMs: 300, samples: 5 }), (e) => e.code === 'TIME_UP');
});

test('синхронизация трёх участников: матч завершается только когда время вышло у всех, места верные', () => {
  const ctx = setup();
  const m = startMatch(ctx, 100);
  shot(ctx, 1, true); shot(ctx, 1, true); shot(ctx, 1, false); // 2 очка, 3 броска
  shot(ctx, 2, true); shot(ctx, 2, true);                       // 2 очка, 2 броска — точнее
  shot(ctx, 3, false);                                           // 0
  // у игрока 3 время вышло раньше, у 1 и 2 ещё идёт (+10 с)
  ctx.clock.t = m.startAt + 30_400;
  assert.equal(ctx.svc.state(3).stage, 'playing');
  assert.equal(ctx.svc.state(3).match.me.done, true);
  assert.equal(ctx.svc.state(1).match.players.find((p) => p.id === 3).done, true);
  ctx.clock.t = m.startAt + 40_400;
  const res = ctx.svc.state(1);
  assert.equal(res.stage, 'results');
  assert.deepEqual(res.match.results.map((r) => [r.userId, r.place, r.score]), [[2, 1, 2], [1, 2, 2], [3, 3, 0]]);
  assert.deepEqual(ctx.store.basketStats(2), { games: 1, wins: 1, best: 2 });
  // итоги закрыты — снова лобби, можно искать новый матч
  assert.equal(ctx.svc.leave(1).stage, 'lobby');
  assert.equal(ctx.svc.join(ctx.users[0], 5).stage, 'queue');
});

test('ничьи: решают число бросков и точность, а не скорость сети; полное равенство — общее место', () => {
  const P = (id, score, shots, quality) => ({ user: { id }, score, shots, quality });
  const r = BasketService.rank([P(1, 3, 5, 2.4), P(2, 3, 4, 1.5), P(3, 3, 5, 2.7)]);
  assert.deepEqual(r.map((x) => [x.user.id, x.place]), [[2, 1], [3, 2], [1, 3]]);
  const t = BasketService.rank([P(1, 2, 3, 1.2), P(2, 2, 3, 1.2), P(3, 0, 4, 0)]);
  assert.deepEqual(t.map((x) => [x.user.id, x.place]), [[1, 1], [2, 1], [3, 3]]);
});

test('переподключение: после обрыва состояние матча восстанавливается полностью, таймер идёт по серверу', () => {
  const ctx = setup();
  const m = startMatch(ctx);
  const hit = shot(ctx, 1, true);
  // игрок «пропал» на 10 секунд и открыл приложение снова
  ctx.clock.t += 10_000;
  const st = ctx.svc.state(1);
  assert.equal(st.stage, 'playing');
  assert.equal(st.match.me.score, 1);
  assert.equal(st.match.me.seq, 1);
  assert.equal(st.match.me.deadline, m.startAt + 35_000);
  assert.deepEqual(st.match.me.hoop, hit.hoop);
  assert.equal(st.match.me.lastShot.made, true, 'последний бросок известен — можно досмотреть итог');
  // повтор того броска после переподключения — без второго очка
  assert.equal(ctx.svc.shoot(1, { seq: 1, vx: hit.vx, vy: hit.vy, aimMs: 300, samples: 5 }).score, 1);
  // следующий бросок продолжает нумерацию
  assert.equal(shot(ctx, 1, false).seq, 2);
});

test('подозрительно ровная серия попаданий помечается для проверки', () => {
  const ctx = setup();
  const flags = [];
  ctx.svc.on('flag', (f) => flags.push(f));
  startMatch(ctx);
  for (let i = 0; i < 13; i++) shot(ctx, 1, true); // бот: всегда попадает сразу по готовности мяча
  assert.equal(flags.length, 1);
  assert.equal(flags[0].user.id, 1);
  ctx.clock.t += 120_000;
  const res = ctx.svc.state(1).match.results.find((r) => r.userId === 1);
  assert.equal(res.flagged, true);
});

test('игрок в очереди перестал отвечать — его убирают, чтобы не начать матч с отсутствующим', () => {
  const ctx = setup();
  ctx.svc.join(ctx.users[0], 20);
  ctx.clock.t += 20_000;
  ctx.svc.join(ctx.users[1], 20);
  const st = ctx.svc.state(2);
  assert.equal(st.stage, 'queue');
  assert.deepEqual(st.queue.players.map((p) => p.id), [2]);
});
