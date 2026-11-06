import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { openDb } from '../server/db.js';
import { CrashService, crashPoint, multiplierAt, msFor } from '../server/crash.js';

// Управляемые время и таймеры: тест сам «перематывает» раунд
function setup(opts = {}, { balance = 1000, seeds } = {}) {
  const store = openDb(':memory:');
  for (const id of [1, 2, 3]) {
    store.upsertUser({ id, first_name: `P${id}` });
    store.creditPayment({ chargeId: `s${id}`, userId: id, amount: balance, payload: 'seed' });
  }
  const clock = { t: 1_000_000 };
  const queue = [];
  const timers = {
    timeout: (fn, ms) => { const h = { at: clock.t + ms, fn }; queue.push(h); return h; },
    interval: () => ({ interval: true }),
    clear: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
  };
  let n = 0;
  const seed = seeds ? () => seeds[n++ % seeds.length] : undefined;
  const svc = new CrashService(store, opts, { now: () => clock.t, timers, ...(seed ? { seed } : {}) });
  /** выполнить следующий запланированный шаг (запуск раунда / взрыв / новый раунд) */
  const step = () => {
    queue.sort((a, b) => a.at - b.at);
    const h = queue.shift();
    clock.t = Math.max(clock.t, h.at);
    h.fn();
  };
  return { store, clock, svc, step };
}

/** Подбирает seed, при котором взрыв первого раунда (id 1) — в нужном диапазоне. */
function seedFor(edge, min, max) {
  for (;;) {
    const s = randomBytes(32).toString('hex');
    const c = crashPoint(s, 1, edge);
    if (c >= min && c <= max) return s;
  }
}

test('математика: P(взрыв > m) ≈ (1 − E)/m, возврат игроку ≈ 95% при любой стратегии', () => {
  const N = 200_000;
  const pts = Array.from({ length: N }, (_, i) => crashPoint(`seed-${i}`, i, 0.05));
  for (const m of [101, 150, 200, 500, 1000, 2000]) {
    const p = pts.filter((c) => c > m).length / N;
    const rtp = (p * m) / 100;
    assert.ok(Math.abs(rtp - 0.95) < 0.02, `вывод на ×${m / 100}: возврат ${rtp.toFixed(3)}`);
  }
  const instant = pts.filter((c) => c === 100).length / N;
  assert.ok(instant > 0.04 && instant < 0.065, `мгновенный взрыв ×1.00 ≈ 5%: ${instant}`);
});

test('доказуемая честность: хэш публикуется заранее, seed раскрывается после взрыва и пересчитывается', () => {
  const s = seedFor(0.05, 150, 400);
  const ctx = setup({}, { seeds: [s] });
  const before = ctx.svc.publicState();
  assert.equal(before.seed, null);
  assert.equal(before.crash, null);
  assert.equal(before.hash, createHash('sha256').update(s).digest('hex'));
  ctx.step(); // старт
  ctx.step(); // взрыв
  const after = ctx.svc.publicState();
  assert.equal(after.status, 'crashed');
  assert.equal(after.seed, s);
  assert.equal(createHash('sha256').update(after.seed).digest('hex'), before.hash);
  assert.equal(after.crash, crashPoint(after.seed, after.id, 0.05));
});

test('множитель растёт по формуле: ×2 ≈ 8.2 с, ×10 ≈ 27 с', () => {
  assert.equal(multiplierAt(0, 0.085), 100);
  assert.ok(Math.abs(msFor(200, 0.085) - 8155) < 5);
  assert.ok(Math.abs(msFor(1000, 0.085) - 27089) < 5);
  assert.equal(multiplierAt(msFor(350, 0.085) + 1, 0.085), 350);
});

test('ставки: лимиты мин/макс, баланс, одна ставка на раунд, отмена до старта, после старта — закрыто', () => {
  const ctx = setup();
  const u = ctx.store.getUser(1);
  assert.throws(() => ctx.svc.placeBet(u, 4), /от 5 до 100/);
  assert.throws(() => ctx.svc.placeBet(u, 101), /от 5 до 100/);
  assert.throws(() => ctx.svc.placeBet(u, 10, 1.0), /от ×1.01/);
  ctx.svc.placeBet(u, 50, 2);
  assert.equal(ctx.store.getUser(1).balance, 950);
  assert.throws(() => ctx.svc.placeBet(u, 10), /уже сделали/);
  ctx.svc.cancelBet(1);
  assert.equal(ctx.store.getUser(1).balance, 1000);
  ctx.svc.placeBet(u, 20);
  ctx.step(); // старт
  assert.throws(() => ctx.svc.placeBet(ctx.store.getUser(2), 10), /закрыты/);
  assert.throws(() => ctx.svc.cancelBet(1), /уже начался/);
  const poor = setup({}, { balance: 7 });
  assert.throws(() => poor.svc.placeBet(poor.store.getUser(1), 10), /Недостаточно/);
});

test('вывод: вручную по текущему множителю, автовывод ровно на цели, не успел — ставка сгорает', () => {
  const s = seedFor(0.05, 400, 600); // взрыв между ×4 и ×6
  const ctx = setup({}, { seeds: [s] });
  ctx.svc.placeBet(ctx.store.getUser(1), 100); // вручную
  ctx.svc.placeBet(ctx.store.getUser(2), 50, 3); // автовывод ×3
  ctx.svc.placeBet(ctx.store.getUser(3), 10, 50); // цель ×50 — не дождётся
  ctx.step(); // старт
  const r = ctx.svc.publicState();
  ctx.clock.t = r.startAt + msFor(200, 0.085) + 1; // ×2.00
  const out = ctx.svc.cashout(1);
  assert.deepEqual([out.cashout, out.payout], [200, 200]);
  assert.equal(ctx.store.getUser(1).balance, 1000 - 100 + 200);
  assert.throws(() => ctx.svc.cashout(1), /уже забран/);
  ctx.clock.t = r.startAt + msFor(301, 0.085) + 1;
  ctx.svc.tick();
  const b2 = ctx.svc.publicState().bets.find((b) => b.id === 2);
  assert.deepEqual([b2.cashout, b2.payout], [300, 150], 'автовывод ровно на ×3.00');
  ctx.step(); // взрыв
  const b3 = ctx.svc.publicState().bets.find((b) => b.id === 3);
  assert.equal(b3.cashout, null);
  assert.equal(ctx.store.getUser(3).balance, 990, 'ставка сгорела');
  assert.throws(() => ctx.svc.cashout(3), /не летит/);
});

test('после взрыва вывести нельзя, даже если запрос пришёл чуть позже взрыва', () => {
  const s = seedFor(0.05, 120, 180);
  const ctx = setup({}, { seeds: [s] });
  ctx.svc.placeBet(ctx.store.getUser(1), 100);
  ctx.step();
  const r = ctx.svc.round;
  ctx.clock.t = r.startAt + msFor(r.crash, 0.085) + 50; // таймер взрыва ещё не сработал
  assert.throws(() => ctx.svc.cashout(1), /не успели|не летит/i);
  assert.equal(ctx.store.getUser(1).balance, 900);
});

test('лимит выигрыша с одной ставки: автоматический вывод на 1500 ⭐', () => {
  const s = seedFor(0.05, 2000, 100_000); // взрыв выше ×20
  const ctx = setup({}, { seeds: [s] });
  ctx.svc.placeBet(ctx.store.getUser(1), 100); // 100 × 15 = 1500 — предел
  ctx.step();
  const r = ctx.svc.round;
  ctx.clock.t = r.startAt + msFor(1501, 0.085);
  ctx.svc.tick();
  const b = ctx.svc.publicState().bets[0];
  assert.deepEqual([b.cashout, b.payout], [1500, 1500]);
  assert.equal(ctx.store.getUser(1).balance, 1000 - 100 + 1500);
});

test('лимит выплат за раунд: при достижении все активные ставки выводятся, никто не теряет', () => {
  const s = seedFor(0.05, 3000, 100_000);
  const ctx = setup({ maxRoundPayout: 600 }, { seeds: [s] });
  for (const id of [1, 2, 3]) ctx.svc.placeBet(ctx.store.getUser(id), 100);
  ctx.step();
  const r = ctx.svc.round;
  ctx.clock.t = r.startAt + msFor(201, 0.085) + 1; // 3 × 100 × 2.01 = 603 ≥ 600
  ctx.svc.tick();
  const bets = ctx.svc.publicState().bets;
  assert.ok(bets.every((b) => b.cashout === 201 && b.payout === 201));
});

test('перезапуск сервера посреди раунда: раунд отменяется, ставки возвращаются', () => {
  const ctx = setup();
  ctx.svc.placeBet(ctx.store.getUser(1), 40);
  ctx.step(); // летит
  ctx.svc.stop();
  const svc2 = new CrashService(ctx.store, {}, { now: () => ctx.clock.t, timers: { timeout: () => ({}), interval: () => ({}), clear() {} } });
  assert.equal(ctx.store.getUser(1).balance, 1000);
  assert.equal(svc2.publicState().status, 'betting');
});

test('доход казино на модели: оборот × ~5% (и больше за счёт лимитов)', () => {
  const ctx = setup({}, { balance: 10_000_000 });
  let staked = 0;
  let paid = 0;
  for (let i = 0; i < 4000; i++) {
    const r = ctx.svc.round;
    const targets = [1.5, 2, 3];
    for (const id of [1, 2, 3]) {
      ctx.svc.placeBet(ctx.store.getUser(id), 20, targets[id - 1]);
      staked += 20;
    }
    ctx.step(); // старт
    // симулируем автовыводы точно: тик в моменты целей
    for (const m of [150, 200, 300]) {
      if (ctx.svc.round.status !== 'flying') break;
      ctx.clock.t = Math.max(ctx.clock.t, ctx.svc.round.startAt + msFor(m, 0.085) + 1);
      ctx.svc.tick();
    }
    while (ctx.svc.round.id === r.id) ctx.step();
    paid += ctx.svc.store.db.prepare('SELECT COALESCE(SUM(payout),0) s FROM crash_bets WHERE round_id = ?').get(r.id).s;
  }
  const edge = 1 - paid / staked;
  assert.ok(edge > 0.02 && edge < 0.09, `доход казино ${(edge * 100).toFixed(1)}%`);
});
