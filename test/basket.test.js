import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { BasketService } from '../server/basket.js';
import {
  WORLD,
  HOOP_BOUNDS,
  QUANT,
  simulateShot,
  previewPath,
  isReachable,
  nextHoop,
  validLaunch,
} from '../public/basket-physics.js';

function setup(opts = {}, balance = 1000) {
  const store = openDb(':memory:');
  const users = [1, 2, 3, 4, 5].map((id) => {
    store.upsertUser({ id, first_name: `P${id}`, username: `p${id}` });
    store.creditPayment({ chargeId: `seed${id}`, userId: id, amount: balance, payload: 'seed' });
    return store.getUser(id);
  });
  const clock = { t: 1_000_000 };
  const svc = new BasketService(store, opts, { now: () => clock.t });
  return { store, users, clock, svc };
}

function findShot(hoop, want) {
  for (let speed = WORLD.VMIN; speed <= WORLD.VMAX; speed += 0.04) {
    for (let k = 0; k < 220; k++) {
      const s = 0.2 + k * 0.025;
      const n = Math.sqrt(1 + s * s);
      const vx = Math.round((speed / n) * QUANT);
      const vy = Math.round(((speed * s) / n) * QUANT);
      if (!validLaunch(vx / QUANT, vy / QUANT)) continue;
      const r = simulateShot(hoop, vx / QUANT, vy / QUANT);
      const rim = r.contacts.some(([kind, t]) => kind === 'rim' && t <= r.madeT);
      const ok =
        want === 'miss' ? !r.made : want === 'swish' ? r.made && !rim : want === 'rim' ? r.made && rim : r.made;
      if (ok) return { vx, vy };
    }
  }
  throw new Error(`не нашёл бросок: ${want}`);
}

function play(ctx, uid) {
  const st = ctx.svc.play(ctx.users[uid - 1]);
  assert.ok(st.session, 'игра началась сразу');
  return st.session;
}

function shot(ctx, uid, want, extra = {}) {
  const s = ctx.svc.state(uid).session;
  const t0 = Math.max(s.nextShotAt, s.startAt);
  if (ctx.clock.t < t0) ctx.clock.t = t0 + 1;
  return ctx.svc.shoot(uid, { seq: s.seq + 1, ...findShot(s.hoop, want), aimMs: 400, samples: 10, ...extra });
}

function finishTime(ctx, uid) {
  const s = ctx.svc.state(uid).session;
  ctx.clock.t = Math.max(ctx.clock.t, s.deadline + 400);
  ctx.svc.tick();
}

test('физика: полёт совпадает с формулой параболы, детерминирован; препятствий нет — только дужки кольца', () => {
  const far = simulateShot({ x: 50, y: 50 }, 6, 9, { frames: true });
  for (const n of [12, 60, 90]) {
    const t = n * WORLD.DT;
    const y = WORLD.START.y + 9 * t - (WORLD.G * WORLD.DT * WORLD.DT * (n * (n + 1))) / 2;
    assert.ok(
      Math.abs(far.frames[2 * n] - (WORLD.START.x + 6 * t)) < 1e-9 && Math.abs(far.frames[2 * n + 1] - y) < 1e-9,
    );
  }
  const [px, py] = previewPath(6, 9, 0.5, 0.5)[0];
  assert.ok(Math.abs(px - far.frames[120]) < 1e-9 && Math.abs(py - far.frames[121]) < 0.06);
  const hoop = { x: 7, y: 5 };
  const s = findShot(hoop, 'made');
  assert.deepEqual(
    simulateShot(hoop, s.vx / QUANT, s.vy / QUANT, { frames: true }).frames,
    simulateShot(hoop, s.vx / QUANT, s.vy / QUANT, { frames: true }).frames,
  );
  const over = simulateShot(hoop, 8.5, 9.5);
  assert.equal(over.made, false);
  assert.deepEqual(
    [...new Set(over.contacts.map(([k]) => k))].filter((k) => k !== 'floor'),
    [],
  );
  let rim = false;
  for (let vy = 6; vy < 12 && !rim; vy += 0.05) rim = simulateShot(hoop, 6.2, vy).contacts.some(([k]) => k === 'rim');
  assert.ok(rim);
  assert.equal(simulateShot(hoop, 8, 4).made, false);
});

test('кольцо: все позиции достижимы; новая позиция случайна, в кадре, не повторяется', () => {
  const B = HOOP_BOUNDS;
  for (let x = B.xMin; x <= B.xMax + 1e-9; x += 0.68)
    for (let y = B.yMin; y <= B.yMax + 1e-9; y += 1) assert.ok(isReachable({ x, y }));
  let prev = null;
  const seen = new Set();
  const moves = { closer: 0, farther: 0, higher: 0, lower: 0 };
  for (let i = 0; i < 200; i++) {
    const h = nextHoop(prev, Math.random, 12);
    assert.ok(h.x >= B.xMin && h.x <= B.xMax && h.y >= B.yMin && h.y <= B.yMax);
    if (prev) {
      assert.ok(Math.hypot(h.x - prev.x, h.y - prev.y) >= 1.1);
      moves[h.x < prev.x ? 'closer' : 'farther']++;
      moves[h.y > prev.y ? 'higher' : 'lower']++;
    }
    seen.add(`${h.x},${h.y}`);
    prev = h;
  }
  assert.ok(seen.size > 190);
  for (const k in moves) assert.ok(moves[k] > 30, k);
});

test('сложность: первое кольцо в центре; с очками кольцо уходит дальше и больше не подходит близко', () => {
  for (let i = 0; i < 50; i++) {
    const first = nextHoop(null, Math.random, 0);
    assert.ok(first.x >= 4.6 && first.x <= 5.4 && first.y >= 4.2 && first.y <= 4.9, 'старт — по центру экрана');
  }
  const minX = (level) => {
    let m = Infinity;
    let prev = { x: 6, y: 5 };
    for (let i = 0; i < 80; i++) m = Math.min(m, (prev = nextHoop(prev, Math.random, level)).x);
    return m;
  };
  assert.ok(minX(1) < 5.3, 'в начале кольцо бывает близко');
  assert.ok(minX(12) >= 7.1, 'с 12 очков — только далеко');
  assert.ok(minX(30) >= 7.1);
  assert.ok(minX(6) > minX(1) - 0.01);
});

const T0 = Date.UTC(2026, 10, 7, 7, 0, 0);

function playScore(ctx, uid, score, misses = 0) {
  play(ctx, uid);
  for (let i = 0; i < score; i++) shot(ctx, uid, 'made');
  for (let i = 0; i < misses; i++) shot(ctx, uid, 'miss');
  finishTime(ctx, uid);
}

test('попытка стоит ровно 5 ⭐, игра начинается сразу; одновременно — одна попытка', () => {
  const ctx = setup();
  ctx.clock.t = T0;
  const s = play(ctx, 1);
  assert.equal(ctx.store.getUser(1).balance, 995);
  assert.equal(play(ctx, 1).gameId, s.gameId, 'повторный «Играть» возвращает в ту же попытку');
  assert.equal(ctx.store.getUser(1).balance, 995, 'без второго списания');
  finishTime(ctx, 1);
  play(ctx, 1);
  assert.equal(ctx.store.getUser(1).balance, 990, 'новая попытка — снова 5 ⭐');
});

test('мало звёзд — отказ без следов', () => {
  const ctx = setup({}, 4);
  assert.throws(() => ctx.svc.play(ctx.users[0]), /Недостаточно/);
  assert.equal(ctx.svc.state(1).session, null);
  assert.equal(ctx.store.getUser(1).balance, 4);
});

test('таймер и очки: 30 с; попадание +1 и +3 с; чистое +1 и +5 с; промах — ничего; кольцо переезжает', () => {
  const ctx = setup();
  const s = play(ctx, 1);
  assert.equal(s.deadline - s.startAt, 30_000);
  const miss = shot(ctx, 1, 'miss');
  assert.deepEqual([miss.made, miss.score, miss.deadline], [false, 0, s.deadline]);
  const rim = shot(ctx, 1, 'rim');
  assert.deepEqual([rim.score, rim.deadline, rim.bonusMs], [1, s.deadline + 3000, 3000]);
  assert.notDeepEqual(rim.hoop, s.hoop);
  const sw = shot(ctx, 1, 'swish');
  assert.deepEqual([sw.swish, sw.score, sw.deadline], [true, 2, s.deadline + 8000]);
});

test('таблица дня: в зачёт лучшая попытка игрока; при равенстве — меньше бросков, затем кто раньше', () => {
  const ctx = setup();
  ctx.clock.t = T0;
  playScore(ctx, 1, 2);
  playScore(ctx, 2, 3, 1);
  playScore(ctx, 1, 4);
  playScore(ctx, 3, 3);
  const st = ctx.svc.state(2);
  assert.deepEqual(
    st.today.top.map((r) => [r.id, r.place, r.score]),
    [
      [1, 1, 4],
      [3, 2, 3],
      [2, 3, 3],
    ],
  );
  assert.deepEqual(st.today.me, { place: 3, score: 3, shots: 4 });
  assert.equal(st.today.players, 3);
  assert.equal(st.stats.games, 1);
});

test('конец дня (00:00 МСК): первое место получает 50 ⭐ ровно один раз; следующий день — новая таблица', () => {
  const ctx = setup();
  const closed = [];
  ctx.svc.on('dayClosed', (c) => closed.push(c));
  ctx.clock.t = T0;
  playScore(ctx, 1, 2);
  playScore(ctx, 2, 5);
  const endsAt = ctx.svc.state(1).today.endsAt;
  assert.equal(endsAt, Date.UTC(2026, 10, 7, 21, 0, 0), 'полночь по Москве = 21:00 UTC');
  ctx.clock.t = endsAt - 1000;
  ctx.svc.tick();
  assert.equal(closed.length, 0, 'до полуночи итогов нет');
  ctx.clock.t = endsAt + 1000;
  ctx.svc.tick();
  ctx.svc.tick();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].winner.user_id, 2);
  assert.equal(ctx.store.getUser(2).balance, 1000 - 5 + 50);
  assert.equal(ctx.store.getUser(1).balance, 995);
  const st = ctx.svc.state(1);
  assert.equal(st.today.top.length, 0, 'новый день — пустая таблица');
  assert.equal(st.lastWinner.id, 2);
  assert.deepEqual(
    st.stats.wins === undefined ? null : [ctx.svc.state(2).stats.wins, ctx.svc.state(2).stats.won],
    [1, 50],
  );
});

test('попытка, начатая до полуночи, засчитывается в свой день; итоги ждут, пока она закончится', () => {
  const ctx = setup();
  const closed = [];
  ctx.svc.on('dayClosed', (c) => closed.push(c));
  ctx.clock.t = Date.UTC(2026, 10, 7, 20, 59, 50);
  play(ctx, 1);
  shot(ctx, 1, 'made');
  ctx.clock.t = Date.UTC(2026, 10, 7, 21, 0, 5);
  ctx.svc.tick();
  assert.equal(closed.length, 0);
  finishTime(ctx, 1);
  ctx.svc.tick();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].day, '2026-11-07');
  assert.equal(ctx.store.getUser(1).balance, 1000 - 5 + 50);
});

test('день, где никто не набрал очков, закрывается без приза', () => {
  const ctx = setup();
  const closed = [];
  ctx.svc.on('dayClosed', (c) => closed.push(c));
  ctx.clock.t = T0;
  playScore(ctx, 1, 0, 2);
  ctx.clock.t = ctx.svc.dayEndsAt(T0) + 1000;
  ctx.svc.tick();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].winner, null);
  assert.equal(ctx.store.getUser(1).balance, 995);
});

test('защита: повтор запроса, пропуск номера, ускорение, без прицеливания, подделка скорости, до старта, после конца', () => {
  const ctx = setup();
  const s = play(ctx, 1);
  const good = findShot(s.hoop, 'made');
  assert.throws(
    () => ctx.svc.shoot(1, { seq: 1, ...good, aimMs: 300, samples: 8 }),
    (e) => e.code === 'NOT_STARTED',
  );
  ctx.clock.t = s.startAt + 1;
  const body = { seq: 1, ...good, aimMs: 300, samples: 8 };
  assert.equal(ctx.svc.shoot(1, body).score, 1);
  assert.deepEqual([ctx.svc.shoot(1, body).score, ctx.svc.shoot(1, body).replay], [1, true]);
  assert.throws(
    () => ctx.svc.shoot(1, { ...body, seq: 3 }),
    (e) => e.code === 'BAD_SEQ',
  );
  assert.throws(
    () => ctx.svc.shoot(1, { ...body, seq: 2 }),
    (e) => e.code === 'TOO_FAST',
  );
  ctx.clock.t = ctx.svc.state(1).session.nextShotAt;
  assert.throws(
    () => ctx.svc.shoot(1, { ...body, seq: 2, aimMs: 10 }),
    (e) => e.code === 'BAD_AIM',
  );
  assert.throws(
    () => ctx.svc.shoot(1, { ...body, seq: 2, vx: 40_000, vy: 40_000 }),
    (e) => e.code === 'BAD_SHOT',
  );
  ctx.clock.t = ctx.svc.state(1).session.deadline + 301;
  assert.throws(
    () => ctx.svc.shoot(1, { ...body, seq: 2 }),
    (e) => e.code === 'NO_MATCH' || e.code === 'TIME_UP',
  );
  assert.equal(ctx.svc.state(1).attempts[0].score, 1);
});

test('перезапуск сервера и обрыв связи: попытка продолжается с тем же счётом, таймером и кольцом', () => {
  const ctx = setup();
  play(ctx, 1);
  const hit = shot(ctx, 1, 'made');
  const svc2 = new BasketService(ctx.store, {}, { now: () => ctx.clock.t });
  ctx.clock.t += 3_000;
  const st = svc2.state(1).session;
  assert.deepEqual([st.score, st.seq, st.deadline], [1, 1, hit.deadline]);
  assert.deepEqual(st.hoop, hit.hoop);
  assert.equal(svc2.shoot(1, { seq: 1, vx: hit.vx, vy: hit.vy, aimMs: 300, samples: 5 }).score, 1);
});

test('подозрительно ровная серия попаданий помечается', () => {
  const ctx = setup();
  const flags = [];
  ctx.svc.on('flag', (f) => flags.push(f));
  play(ctx, 1);
  for (let i = 0; i < 13; i++) shot(ctx, 1, 'made');
  assert.equal(flags.length, 1);
});

test('переход со старой версии: незакрытые матчи со ставками закрываются, ставки возвращаются', () => {
  const store = openDb(':memory:');
  store.upsertUser({ id: 1, first_name: 'A' });
  store.creditPayment({ chargeId: 's', userId: 1, amount: 100, payload: 'seed' });
  store.db
    .exec(`CREATE TABLE basket_games (id INTEGER PRIMARY KEY, stake INTEGER, status TEXT, hoops TEXT, bank INTEGER DEFAULT 0, created_at INTEGER, closed_at INTEGER);
                 CREATE TABLE basket_entries (game_id INTEGER, user_id INTEGER, status TEXT);
                 INSERT INTO basket_games VALUES (7, 20, 'open', '[]', 0, 1, NULL);
                 INSERT INTO basket_entries VALUES (7, 1, 'done');`);
  store.tx(() => store.ledgerDebit(1, 20, 'basket_stake', 7));
  const refunds = [];
  const svc = new BasketService(store, {}, { now: () => 5 });
  svc.on('legacyRefund', (r) => refunds.push(r));
  assert.equal(store.getUser(1).balance, 100);
  new BasketService(store, {}, { now: () => 6 });
  assert.equal(store.getUser(1).balance, 100);
});
