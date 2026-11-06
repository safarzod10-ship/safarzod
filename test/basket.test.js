import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { BasketService, STAKES } from '../server/basket.js';
import { WORLD, HOOP_BOUNDS, QUANT, simulateShot, previewPath, isReachable, nextHoop, validLaunch } from '../public/basket-physics.js';

// ---------- помощники ----------
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

/** Бросок в целых тысячных: попадание / промах / чистое попадание / попадание с касанием дужки. */
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

function play(ctx, uid, stake = 10) {
  const st = ctx.svc.play(ctx.users[uid - 1], stake);
  assert.ok(st.session, 'игра началась сразу');
  return st.session;
}

function shot(ctx, uid, want, extra = {}) {
  const s = ctx.svc.state(uid).session;
  const t0 = Math.max(s.nextShotAt, s.startAt);
  if (ctx.clock.t < t0) ctx.clock.t = t0 + 1;
  return ctx.svc.shoot(uid, { seq: s.seq + 1, ...findShot(s.hoop, want), aimMs: 400, samples: 10, ...extra });
}

/** Доиграть: время игрока истекает. */
function finishTime(ctx, uid) {
  const s = ctx.svc.state(uid).session;
  ctx.clock.t = Math.max(ctx.clock.t, s.deadline + 400);
  ctx.svc.tick();
}

// ---------- физика ----------
test('физика: полёт совпадает с формулой параболы, детерминирован; препятствий нет — только дужки кольца', () => {
  const far = simulateShot({ x: 50, y: 50 }, 6, 9, { frames: true });
  for (const n of [12, 60, 90]) {
    const t = n * WORLD.DT;
    const y = WORLD.START.y + 9 * t - (WORLD.G * WORLD.DT * WORLD.DT * (n * (n + 1))) / 2;
    assert.ok(Math.abs(far.frames[2 * n] - (WORLD.START.x + 6 * t)) < 1e-9 && Math.abs(far.frames[2 * n + 1] - y) < 1e-9);
  }
  const [px, py] = previewPath(6, 9, 0.5, 0.5)[0];
  assert.ok(Math.abs(px - far.frames[120]) < 1e-9 && Math.abs(py - far.frames[121]) < 0.06);
  const hoop = { x: 7, y: 5 };
  const s = findShot(hoop, 'made');
  assert.deepEqual(simulateShot(hoop, s.vx / QUANT, s.vy / QUANT, { frames: true }).frames, simulateShot(hoop, s.vx / QUANT, s.vy / QUANT, { frames: true }).frames);
  // мяч, пролетевший над кольцом, ни во что не врезается (щит — только картинка)
  const over = simulateShot(hoop, 8.5, 9.5);
  assert.equal(over.made, false);
  assert.deepEqual([...new Set(over.contacts.map(([k]) => k))].filter((k) => k !== 'floor'), []);
  // но от дужки мяч отскакивает
  let rim = false;
  for (let vy = 6; vy < 12 && !rim; vy += 0.05) rim = simulateShot(hoop, 6.2, vy).contacts.some(([k]) => k === 'rim');
  assert.ok(rim);
  assert.equal(simulateShot(hoop, 8, 4).made, false);
});

test('кольцо: все позиции достижимы; новая позиция случайна, в кадре, не повторяется', () => {
  const B = HOOP_BOUNDS;
  for (let x = B.xMin; x <= B.xMax + 1e-9; x += 0.68) for (let y = B.yMin; y <= B.yMax + 1e-9; y += 1) assert.ok(isReachable({ x, y }));
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

// ---------- матчи ----------
test('«Играть»: сразу своя игра; второй и третий садятся в тот же матч; четвёртый — в новый; разные ставки раздельно', () => {
  const ctx = setup();
  const a = play(ctx, 1, 10);
  assert.equal(ctx.store.getUser(1).balance, 990, 'ставка списана');
  const b = play(ctx, 2, 10);
  const c = play(ctx, 3, 10);
  assert.equal(b.gameId, a.gameId);
  assert.equal(c.gameId, a.gameId);
  const d = play(ctx, 4, 10);
  assert.notEqual(d.gameId, a.gameId, 'мест нет — новый матч');
  const e = play(ctx, 5, 50);
  assert.notEqual(e.gameId, d.gameId, 'другая ставка — другой матч');
  assert.deepEqual(STAKES, [5, 10, 20, 50, 100]);
  assert.throws(() => ctx.svc.play(ctx.users[0], 7), /Нет такой ставки/);
});

test('одна игра за раз: пока матч не закрыт — новую не начать; после итогов — можно, в новый матч', () => {
  const ctx = setup();
  const a = play(ctx, 1, 20);
  assert.equal(play(ctx, 1, 20).gameId, a.gameId, 'вернули в ту же игру, ставка не списана повторно');
  assert.equal(ctx.store.getUser(1).balance, 980);
  finishTime(ctx, 1);
  assert.equal(ctx.svc.state(1).activeGameId, a.gameId);
  assert.throws(() => ctx.svc.play(ctx.users[0], 20), (e) => e.code === 'WAIT_RESULT');
  assert.throws(() => ctx.svc.play(ctx.users[0], 5), (e) => e.code === 'WAIT_RESULT', 'и с другой ставкой тоже');
  assert.equal(ctx.store.getUser(1).balance, 980);
  for (const uid of [2, 3]) { play(ctx, uid, 20); finishTime(ctx, uid); }
  assert.equal(ctx.svc.state(1).activeGameId, null, 'итоги подведены');
  assert.notEqual(play(ctx, 1, 20).gameId, a.gameId, 'новая игра — в новом матче');
});

test('ставка больше баланса — отказ без следов', () => {
  const ctx = setup({}, 30);
  assert.throws(() => ctx.svc.play(ctx.users[0], 50), /Недостаточно/);
  assert.equal(ctx.svc.state(1).session, null);
  assert.equal(ctx.store.getUser(1).balance, 30);
});

test('таймер и очки: 30 с; попадание с касанием дужки +1 и +3 с; чистое +1 и +5 с; промах — ничего; кольцо меняется', () => {
  const ctx = setup();
  const s = play(ctx, 1);
  assert.equal(s.deadline - s.startAt, 30_000);
  const miss = shot(ctx, 1, 'miss');
  assert.deepEqual([miss.made, miss.score, miss.deadline], [false, 0, s.deadline]);
  assert.deepEqual(miss.hoop, s.hoop);
  const rim = shot(ctx, 1, 'rim');
  assert.deepEqual([rim.made, rim.swish, rim.score, rim.deadline, rim.bonusMs], [true, false, 1, s.deadline + 3000, 3000]);
  assert.notDeepEqual(rim.hoop, s.hoop, 'после попадания кольцо переехало');
  const sw = shot(ctx, 1, 'swish');
  assert.deepEqual([sw.made, sw.swish, sw.score, sw.deadline, sw.bonusMs], [true, true, 2, s.deadline + 8000, 5000]);
});

test('равные условия: у всех в матче одна последовательность колец, даже если играют в разное время', () => {
  const ctx = setup();
  const a = play(ctx, 1);
  const r1 = shot(ctx, 1, 'made');
  ctx.clock.t += 30 * 60_000; // второй пришёл через полчаса
  const b = play(ctx, 2);
  assert.deepEqual(b.hoop, a.hoop);
  shot(ctx, 2, 'made');
  assert.deepEqual(ctx.svc.state(2).session.hoop, r1.hoop);
});

test('защита: повтор запроса, пропуск номера, ускорение, без прицеливания, подделка скорости, до старта, после конца', () => {
  const ctx = setup();
  const s = play(ctx, 1);
  const good = findShot(s.hoop, 'made');
  assert.throws(() => ctx.svc.shoot(1, { seq: 1, ...good, aimMs: 300, samples: 8 }), (e) => e.code === 'NOT_STARTED');
  ctx.clock.t = s.startAt + 1;
  const body = { seq: 1, ...good, aimMs: 300, samples: 8 };
  assert.equal(ctx.svc.shoot(1, body).score, 1);
  const again = ctx.svc.shoot(1, body);
  assert.deepEqual([again.score, again.replay], [1, true]);
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 3 }), (e) => e.code === 'BAD_SEQ');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2 }), (e) => e.code === 'TOO_FAST');
  ctx.clock.t = ctx.svc.state(1).session.nextShotAt;
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, aimMs: 10 }), (e) => e.code === 'BAD_AIM');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, samples: 0 }), (e) => e.code === 'BAD_AIM');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, vx: 40_000, vy: 40_000 }), (e) => e.code === 'BAD_SHOT');
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2, vx: 6.5, vy: 9.1 }), (e) => e.code === 'BAD_SHOT');
  ctx.clock.t = ctx.svc.state(1).session.deadline + 301;
  assert.throws(() => ctx.svc.shoot(1, { ...body, seq: 2 }), (e) => e.code === 'NO_MATCH' || e.code === 'TIME_UP');
  assert.equal(ctx.svc.state(1).games[0].me.score, 1, 'ни одна попытка не изменила счёт');
});

test('итоги: соперники видны после своей игры; когда сыграли трое — места, победителю ставка × 2', () => {
  const ctx = setup();
  play(ctx, 1, 10); shot(ctx, 1, 'made'); shot(ctx, 1, 'made'); shot(ctx, 1, 'miss'); finishTime(ctx, 1); // 2 очка, 3 броска
  let g = ctx.svc.state(1).games[0];
  assert.equal(g.status, 'open');
  assert.equal(g.players.length, 1);
  play(ctx, 2, 10); shot(ctx, 2, 'made'); shot(ctx, 2, 'made'); // 2 очка, 2 броска — точнее
  g = ctx.svc.state(1).games[0];
  assert.equal(g.players.find((p) => p.id === 2).score, null, 'счёт играющего скрыт');
  finishTime(ctx, 2);
  assert.equal(ctx.svc.state(1).games[0].players.find((p) => p.id === 2).score, 2);
  play(ctx, 3, 10); shot(ctx, 3, 'miss'); finishTime(ctx, 3);
  g = ctx.svc.state(1).games[0];
  assert.equal(g.status, 'finished');
  assert.deepEqual(g.players.map((p) => [p.id, p.place]).sort(), [[1, 2], [2, 1], [3, 3]]);
  assert.equal(g.prize, 20);
  assert.equal(g.bank, 20, 'выплачено: ставка 10 × 2');
  assert.equal(ctx.store.getUser(2).balance, 1000 - 10 + 20);
  assert.equal(ctx.store.getUser(1).balance, 990);
  assert.equal(ctx.store.getUser(3).balance, 990);
  assert.deepEqual(ctx.svc.state(2).stats, { games: 1, wins: 1, best: 2, won: 20 });
});

test('×2 на всех ставках; ничья за 1-е место — каждому из победителей возврат ставки', () => {
  for (const stake of [5, 10, 20, 50, 100]) {
    const ctx = setup();
    play(ctx, 1, stake); shot(ctx, 1, 'made'); finishTime(ctx, 1);
    for (const uid of [2, 3]) { play(ctx, uid, stake); shot(ctx, uid, 'miss'); finishTime(ctx, uid); }
    assert.equal(ctx.store.getUser(1).balance, 1000 - stake + stake * 2, `ставка ${stake} → ×2`);
    assert.equal(ctx.store.getUser(2).balance, 1000 - stake);
  }
  const ctx = setup();
  for (const uid of [1, 2, 3]) { play(ctx, uid, 5); shot(ctx, uid, 'miss'); finishTime(ctx, uid); }
  const g = ctx.svc.state(1).games[0];
  assert.deepEqual(g.players.map((p) => p.place), [1, 1, 1], 'все промахнулись одинаково — общее место');
  assert.equal(g.bank, 15, 'каждому вернули ставку 5');
  for (const uid of [1, 2, 3]) assert.equal(ctx.store.getUser(uid).balance, 1000);
  const P = (id, score, shots, quality) => ({ user_id: id, score, shots, quality });
  assert.deepEqual(BasketService.rank([P(1, 3, 5, 2.4), P(2, 3, 4, 1.5), P(3, 3, 5, 2.7)]).map((x) => [x.user_id, x.place]), [[2, 1], [3, 2], [1, 3]]);
  assert.deepEqual(BasketService.rank([P(1, 0, 4, 0), P(2, 0, 0, 0), P(3, 0, 1, 0)]).map((x) => x.place), [1, 1, 1], '0 очков у всех — общее место');
});

test('час без троих — матч закрывается, ставки возвращаются; игрок посреди игры не мешает возврату позже', () => {
  const ctx = setup();
  const notices = [];
  ctx.svc.on('closed', (c) => notices.push(c));
  play(ctx, 1, 50); finishTime(ctx, 1);
  play(ctx, 2, 50);
  assert.equal(ctx.store.getUser(1).balance, 950);
  ctx.clock.t += 59 * 60_000;
  ctx.svc.tick();
  assert.equal(notices.length, 0, 'через 59 минут ещё ждём');
  ctx.clock.t += 60_000 + 1;
  ctx.svc.tick();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].refunded, true);
  assert.equal(ctx.store.getUser(1).balance, 1000);
  assert.equal(ctx.store.getUser(2).balance, 1000);
  assert.equal(ctx.svc.state(1).games[0].status, 'refunded');
  // в закрытый матч новых игроков не сажают
  assert.notEqual(play(ctx, 3, 50).gameId, ctx.svc.state(1).games[0].id);
});

test('перезапуск сервера и обрыв связи: игра продолжается с тем же счётом, таймером и кольцом', () => {
  const ctx = setup();
  const s = play(ctx, 1);
  const hit = shot(ctx, 1, 'made');
  // «перезапуск»: новый сервис на той же базе
  const svc2 = new BasketService(ctx.store, {}, { now: () => ctx.clock.t });
  ctx.clock.t += 5_000;
  const st = svc2.state(1).session;
  assert.deepEqual([st.score, st.seq, st.deadline], [1, 1, hit.deadline]);
  assert.deepEqual(st.hoop, hit.hoop);
  assert.equal(st.lastShot.made, true);
  assert.equal(svc2.shoot(1, { seq: 1, vx: hit.vx, vy: hit.vy, aimMs: 300, samples: 5 }).score, 1, 'повтор без второго очка');
  ctx.svc = svc2;
  assert.equal(shot(ctx, 1, 'miss').seq, 2);
  assert.ok(s.gameId);
});

test('подозрительно ровная серия попаданий помечается', () => {
  const ctx = setup();
  const flags = [];
  ctx.svc.on('flag', (f) => flags.push(f));
  play(ctx, 1);
  for (let i = 0; i < 13; i++) shot(ctx, 1, 'made');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].userId, 1);
});
