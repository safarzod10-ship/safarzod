// Basketball Rush — клиент: лобби, ожидание трёх игроков, игра на canvas, итоговая таблица.
// Клиент только рисует и прицеливается. Попадание, очки и время решает сервер (та же физика),
// а клиент показывает полёт мяча той же детерминированной симуляцией — анимация совпадает с проверкой.

import { WORLD, QUANT, validLaunch, simulateShot, previewPath } from './basket-physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const STAR_MEDALS = ['🥇', '🥈', '🥉'];
const POLL_MS = 1000;

export function createBasket({ api, haptic, toast, avatarHtml, esc, me, supports, tg }) {
  const s = {
    st: null, // последнее состояние с сервера
    offset: 0, // serverNow − Date.now()
    category: 5,
    poll: null,
    active: false, // вкладка открыта или идёт игра
    // игра
    hoop: null,
    hoopFrom: null,
    hoopAnimAt: 0,
    score: 0,
    shots: 0,
    seq: 0,
    deadline: 0,
    nextShotAt: 0,
    flight: null, // { frames, start, settleT, made, madeT, seq, popped }
    aim: null, // { x0, y0, x, y, t0, samples, vx, vy, valid }
    pendingShot: null,
    net: 0, // раскачка сетки
    popups: [],
    raf: 0,
    view: { cw: 0, ch: 0, dpr: 1, scale: 1, ox: 0, oy: 0 },
    lastFrame: 0,
  };
  const serverNow = () => Date.now() + s.offset;
  if (/[?&]dev=/.test(location.search)) window.__bb = s; // отладка только в режиме разработки

  // ====================== Связь с сервером ======================

  async function refresh() {
    if (s.refreshing) return; // не плодим параллельные запросы
    s.refreshing = true;
    try {
      apply(await api('/api/basket/state', {}));
    } catch {
    } finally {
      s.refreshing = false;
    }
  }

  function apply(st) {
    if (st.serverNow) s.offset = st.serverNow - Date.now();
    const prevStage = s.st?.stage;
    s.st = st;
    if (st.stats) s.stats = st.stats;
    const m = st.match;
    if (m && (st.stage === 'countdown' || st.stage === 'playing')) {
      syncMe(m.me);
      openGame();
    } else if (prevStage === 'playing' || prevStage === 'countdown') {
      closeGame();
    }
    renderScreens();
    renderHud();
    if (st.stage === 'results' && prevStage && prevStage !== 'results') {
      const mine = m.results.find((r) => r.userId === me()?.id);
      if (mine?.place === 1) haptic.ok();
    }
  }

  /** Сверка своего состояния с сервером (после переподключения или ошибки). */
  function syncMe(srv) {
    if (s.pendingShot) return; // бросок в пути — дождёмся ответа
    s.score = srv.score;
    s.shots = srv.shots;
    s.deadline = srv.deadline;
    s.nextShotAt = srv.nextShotAt;
    if (srv.seq !== s.seq || !s.hoop) {
      s.seq = srv.seq;
      if (!s.flight) setHoop(srv.hoop, false);
    }
    if (!s.flight && (s.hoop?.x !== srv.hoop.x || s.hoop?.y !== srv.hoop.y)) setHoop(srv.hoop, true);
  }

  function startPolling() {
    if (s.poll) return;
    refresh();
    s.poll = setInterval(refresh, POLL_MS);
  }
  function stopPolling() {
    clearInterval(s.poll);
    s.poll = null;
  }

  // ====================== Лобби, ожидание, итоги ======================

  function renderScreens() {
    const st = s.st;
    if (!st) return;
    const stage = st.stage;
    $('bb-lobby').hidden = stage !== 'lobby';
    $('bb-queue').hidden = stage !== 'queue';
    $('bb-results').hidden = stage !== 'results';
    const stats = s.stats ?? { games: 0, wins: 0, best: 0 };
    $('bb-st-games').textContent = fmt(stats.games);
    $('bb-st-wins').textContent = fmt(stats.wins);
    $('bb-st-best').textContent = fmt(stats.best);

    if (stage === 'lobby') {
      $('bb-cats').innerHTML = st.categories
        .map(
          (c) => `<button class="bb-cat${c === s.category ? ' on' : ''}" data-cat="${c}">
            <b class="num">${c}</b><span>${st.queues[c] ? `ищут: ${st.queues[c]}` : 'уровень'}</span></button>`,
        )
        .join('');
    }
    if (stage === 'queue') {
      const q = st.queue;
      $('bb-q-cat').textContent = q.category;
      const slots = [0, 1, 2].map((i) => {
        const p = q.players[i];
        return p
          ? `<div class="bb-slot filled">${avatarHtml(p)}<span>${p.id === me()?.id ? 'Вы' : esc(p.name)}</span></div>`
          : '<div class="bb-slot"><div class="bb-slot-empty"></div><span>Ожидание…</span></div>';
      });
      $('bb-slots').innerHTML = slots.join('');
      $('bb-q-count').textContent = `${q.players.length} из 3`;
    }
    if (stage === 'results') renderResults(st.match);
  }

  function renderResults(m) {
    const myId = me()?.id;
    const mine = m.results.find((r) => r.userId === myId);
    $('bb-res-title').textContent =
      mine?.place === 1 ? 'Победа!' : mine ? `${mine.place}-е место` : 'Итоги матча';
    $('bb-res-sub').textContent = `Уровень ${m.category} · ${mine ? `ваш счёт ${mine.score}` : ''}`;
    $('bb-res-table').innerHTML = m.results
      .map(
        (r) => `<div class="bb-row${r.userId === myId ? ' me' : ''} p${r.place}">
          <div class="bb-place">${STAR_MEDALS[r.place - 1] ?? r.place}</div>
          ${avatarHtml({ name: r.name, photo: r.photo }, 'sm')}
          <div class="bb-who"><div class="bb-name">${r.userId === myId ? 'Вы' : esc(r.name)}</div>
            <div class="bb-meta">${fmt(r.shots)} ${plural(r.shots, 'бросок', 'броска', 'бросков')} · точность ${Math.round(
              (r.score / Math.max(1, r.shots)) * 100,
            )}%</div></div>
          <div class="bb-score num">${fmt(r.score)}</div></div>`,
      )
      .join('');
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  async function join(category = s.category) {
    try {
      haptic.impact('light');
      apply(await api('/api/basket/join', { category }));
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function leave() {
    try {
      apply(await api('/api/basket/leave', {}));
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // ====================== Экран игры ======================

  function openGame() {
    const el = $('bb-game');
    if (!el.hidden) return;
    el.hidden = false;
    document.body.classList.add('bb-playing');
    if (supports('6.1')) tg.BackButton.hide();
    resize();
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(frame);
  }

  function closeGame() {
    $('bb-game').hidden = true;
    document.body.classList.remove('bb-playing');
    cancelAnimationFrame(s.raf);
    s.flight = null;
    s.aim = null;
    s.pendingShot = null;
    s.hoop = null;
    s.seq = 0;
  }

  function resize() {
    const c = $('bb-canvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const v = s.view;
    v.cw = r.width;
    v.ch = r.height;
    v.dpr = dpr;
    // Мир по высоте 0…TOP помещается целиком; пол — как можно ниже, под ним паркет площадки
    const TOP = 10;
    v.scale = Math.min(r.width / WORLD.W, (r.height - 70) / TOP);
    v.ox = (r.width - WORLD.W * v.scale) / 2;
    v.oy = Math.min(r.height - 60, Math.max(18 + TOP * v.scale, r.height * 0.76)); // линия пола
  }

  const X = (x) => s.view.ox + x * s.view.scale;
  const Y = (y) => s.view.oy - y * s.view.scale;

  function setHoop(h, animate) {
    if (animate && s.hoop) {
      s.hoopFrom = { ...s.hoop };
      s.hoopAnimAt = performance.now();
    } else s.hoopFrom = null;
    s.hoop = { ...h };
  }

  function hoopNow(t) {
    if (!s.hoopFrom) return s.hoop;
    const p = Math.min(1, (t - s.hoopAnimAt) / 420);
    if (p >= 1) {
      s.hoopFrom = null;
      return s.hoop;
    }
    const e = 1 - (1 - p) ** 3;
    return { x: s.hoopFrom.x + (s.hoop.x - s.hoopFrom.x) * e, y: s.hoopFrom.y + (s.hoop.y - s.hoopFrom.y) * e };
  }

  const timeLeft = () => Math.max(0, s.deadline - serverNow());
  const ballReady = () =>
    s.st?.stage === 'playing' && !s.flight && !s.pendingShot && timeLeft() > 0 && serverNow() >= s.nextShotAt - 120;

  // ---------- Прицеливание: потяните назад и отпустите ----------

  function onDown(e) {
    if (!ballReady()) return;
    e.preventDefault();
    $('bb-canvas').setPointerCapture?.(e.pointerId);
    s.aim = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), samples: 0, valid: false };
    $('bb-hint').classList.add('hide');
  }

  function onMove(e) {
    const a = s.aim;
    if (!a) return;
    a.x = e.clientX;
    a.y = e.clientY;
    a.samples++;
    const dx = a.x0 - a.x; // тянем назад — бросок вперёд
    const dy = a.y - a.y0; // вниз по экрану — бросок вверх
    const len = Math.sqrt(dx * dx + dy * dy);
    const maxDrag = Math.min(s.view.cw, s.view.ch) * 0.42;
    const power = Math.min(1, len / maxDrag);
    if (len < 12 || dx <= 0 || dy <= 0) {
      a.valid = false;
      return;
    }
    const speed = WORLD.VMIN + power * (WORLD.VMAX - WORLD.VMIN);
    a.vx = Math.round(((dx / len) * speed) * QUANT);
    a.vy = Math.round(((dy / len) * speed) * QUANT);
    a.power = power;
    a.valid = validLaunch(a.vx / QUANT, a.vy / QUANT);
    if (a.valid && a.lastPowerStep !== Math.round(power * 8)) {
      a.lastPowerStep = Math.round(power * 8);
      haptic.tap();
    }
  }

  function onUp() {
    const a = s.aim;
    s.aim = null;
    if (!a?.valid || !ballReady()) return;
    const aimMs = Math.round(performance.now() - a.t0);
    if (aimMs < 150) return;
    throwBall(a.vx, a.vy, aimMs, a.samples);
  }

  // ---------- Бросок ----------

  function throwBall(ivx, ivy, aimMs, samples) {
    const seq = s.seq + 1;
    const hoop = { ...s.hoop };
    const sim = simulateShot(hoop, ivx / QUANT, ivy / QUANT, { frames: true });
    s.flight = { frames: sim.frames, start: performance.now(), settleT: sim.settleT, made: sim.made, madeT: sim.madeT, seq, popped: false, contacts: sim.contacts.slice() };
    s.pendingShot = { seq, vx: ivx, vy: ivy, aimMs, samples };
    haptic.impact('light');
    sendShot(s.pendingShot, 0);
  }

  async function sendShot(body, attempt) {
    try {
      const r = await api('/api/basket/shot', body);
      if (r.serverNow) s.offset = r.serverNow - Date.now();
      s.pendingShot = null;
      s.seq = r.seq;
      s.shots = r.shots;
      s.nextShotAt = r.nextShotAt;
      s.serverShot = r;
      // Результат решает сервер; анимация совпадает, но если вдруг нет — верим серверу
      if (s.flight && s.flight.seq === r.seq) s.flight.serverMade = r.made;
      else applyShotResult(r);
    } catch (e) {
      if (e.code === undefined && attempt < 4) {
        // Сеть оборвалась: повторяем тот же бросок (сервер не начислит дважды)
        return setTimeout(() => sendShot(body, attempt + 1), 600 * (attempt + 1));
      }
      s.pendingShot = null;
      if (s.flight?.seq === body.seq) s.flight.rejected = true;
      if (e.code !== 'TIME_UP') toast(e.message, 'err');
      refresh();
    }
  }

  /** Итог броска показывается, когда мяч долетел (и сервер подтвердил). */
  function applyShotResult(r) {
    s.score = r.score;
    s.deadline = r.deadline;
    if (r.made) {
      s.net = 1;
      s.popups.push({ t: performance.now(), x: r.shotHoop.x, y: r.shotHoop.y });
      haptic.ok();
    }
    if (r.hoop.x !== s.hoop.x || r.hoop.y !== s.hoop.y) setHoop(r.hoop, true);
  }

  // ====================== Отрисовка ======================

  function frame(t) {
    s.raf = requestAnimationFrame(frame);
    const c = $('bb-canvas');
    const ctx = c.getContext('2d');
    const v = s.view;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, v.cw, v.ch);
    drawCourt(ctx);
    if (!s.hoop) return;

    // полёт мяча
    let ball = { x: WORLD.START.x, y: WORLD.START.y, rot: 0 };
    let flying = false;
    const f = s.flight;
    if (f) {
      // кадр мог начаться на долю мс раньше броска — время полёта не бывает отрицательным
      const el = Math.max(0, (t - f.start) / 1000);
      const idx = Math.min(f.frames.length / 2 - 1, el / WORLD.DT);
      const i0 = Math.floor(idx);
      const i1 = Math.min(f.frames.length / 2 - 1, i0 + 1);
      const k = idx - i0;
      ball = {
        x: f.frames[2 * i0] + (f.frames[2 * i1] - f.frames[2 * i0]) * k,
        y: f.frames[2 * i0 + 1] + (f.frames[2 * i1 + 1] - f.frames[2 * i0 + 1]) * k,
      };
      ball.rot = el * 9;
      flying = true;
      while (f.contacts.length && f.contacts[0][1] <= el) {
        f.contacts.shift();
        haptic.impact('soft');
      }
      if (!f.popped && f.made && el >= f.madeT && s.serverShot?.seq === f.seq) {
        f.popped = true;
        applyShotResult(s.serverShot);
      }
      if (el >= f.settleT) {
        if (!f.popped && s.serverShot?.seq === f.seq) applyShotResult(s.serverShot);
        if (!s.pendingShot || f.rejected) s.flight = null;
      }
    }

    if (flying) readySince = 0; // следующий мяч снова «появится» в руках
    drawHoop(ctx, hoopNow(t), t);
    drawPlayer(ctx, flying);
    if (flying || ballReady()) drawBall(ctx, ball.x, ball.y, ball.rot ?? 0, flying ? 1 : spawnScale(t));
    if (s.aim?.valid) drawAim(ctx);
    drawPopups(ctx, t);
    renderTimer();
  }

  let readySince = 0;
  function spawnScale(t) {
    if (!readySince) readySince = t;
    return Math.min(1, 0.6 + (t - readySince) / 400);
  }

  function drawCourt(ctx) {
    const v = s.view;
    const fy = Y(0);
    // зал: тёмная стена с мягким светом сверху
    const g = ctx.createLinearGradient(0, 0, 0, fy);
    g.addColorStop(0, '#0c0b12');
    g.addColorStop(1, '#16141f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.cw, fy);
    for (const [x, w] of [[0.22, 0.18], [0.62, 0.22]]) {
      const lg = ctx.createLinearGradient(0, 0, 0, fy);
      lg.addColorStop(0, 'rgba(139,108,255,0.07)');
      lg.addColorStop(1, 'rgba(139,108,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(v.cw * x, 0);
      ctx.lineTo(v.cw * (x + w), 0);
      ctx.lineTo(v.cw * (x + w * 1.8), fy);
      ctx.lineTo(v.cw * (x - w * 0.6), fy);
      ctx.closePath();
      ctx.fill();
    }
    // мягкое пятно света вокруг кольца
    if (s.hoop) {
      const rg = ctx.createRadialGradient(X(s.hoop.x), Y(s.hoop.y), 4, X(s.hoop.x), Y(s.hoop.y), v.scale * 3);
      rg.addColorStop(0, 'rgba(255,122,47,0.08)');
      rg.addColorStop(1, 'rgba(255,122,47,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, v.cw, fy);
    }
    // паркет: вид чуть сверху — доски сужаются к линии пола
    const fg = ctx.createLinearGradient(0, fy, 0, v.ch);
    fg.addColorStop(0, '#3a2a22');
    fg.addColorStop(1, '#1d1620');
    ctx.fillStyle = fg;
    ctx.fillRect(0, fy, v.cw, v.ch - fy);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    const depth = v.ch - fy;
    for (let i = 1; i < 7; i++) {
      const yy = fy + depth * (i / 7) ** 1.6;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(v.cw, yy);
      ctx.stroke();
    }
    // разметка: линия штрафного под кольцом
    ctx.strokeStyle = 'rgba(245,191,79,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, fy + 1);
    ctx.lineTo(v.cw, fy + 1);
    ctx.stroke();
  }

  function drawHoop(ctx, h, t) {
    const sc = s.view.scale;
    const bx = X(h.x + WORLD.BOARD_X);
    // стойка
    ctx.strokeStyle = '#3a3346';
    ctx.lineWidth = Math.max(3, sc * 0.12);
    ctx.beginPath();
    ctx.moveTo(bx + sc * 0.18, Y(0));
    ctx.lineTo(bx + sc * 0.18, Y(h.y + WORLD.BOARD_BOTTOM + 0.2));
    ctx.lineTo(bx, Y(h.y + WORLD.BOARD_BOTTOM + 0.2));
    ctx.stroke();
    // щит
    const top = Y(h.y + WORLD.BOARD_TOP);
    const bottom = Y(h.y + WORLD.BOARD_BOTTOM);
    ctx.fillStyle = 'rgba(235,235,245,0.95)';
    roundRect(ctx, bx - sc * 0.08, top, sc * 0.16, bottom - top, 3);
    ctx.fill();
    ctx.fillStyle = '#ff7a2f';
    ctx.fillRect(bx - sc * 0.08, Y(h.y + 0.55), sc * 0.04, sc * 0.5); // квадрат-мишень на щите
    // сетка
    const fx = X(h.x - WORLD.RIM_HALF);
    const kx = X(h.x + WORLD.RIM_HALF);
    const ry = Y(h.y);
    const sway = s.net * Math.sin(t / 45) * sc * 0.08;
    s.net *= 0.94;
    if (s.net < 0.01) s.net = 0;
    const depth = sc * 0.62 * (1 + s.net * 0.25);
    ctx.strokeStyle = 'rgba(240,240,250,0.75)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      const x0 = fx + (kx - fx) * u;
      const x1 = fx + sc * 0.14 + (kx - fx - sc * 0.28) * u + sway;
      ctx.beginPath();
      ctx.moveTo(x0, ry);
      ctx.lineTo(x1, ry + depth);
      ctx.stroke();
    }
    for (let j = 1; j <= 2; j++) {
      const yy = ry + (depth * j) / 2.4;
      const shrink = (sc * 0.14 * j) / 2.4;
      ctx.beginPath();
      ctx.moveTo(fx + shrink + sway * j * 0.4, yy);
      ctx.lineTo(kx - shrink + sway * j * 0.4, yy);
      ctx.stroke();
    }
    // дужка кольца
    ctx.strokeStyle = '#ff7a2f';
    ctx.lineWidth = Math.max(3, sc * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx, ry);
    ctx.lineTo(bx - sc * 0.06, ry);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawPlayer(ctx, threw) {
    const sc = s.view.scale;
    const x = X(0.95);
    const footY = Y(0);
    const h = sc * 2.35; // рост
    ctx.save();
    // ноги
    ctx.strokeStyle = '#2b2a3a';
    ctx.lineWidth = sc * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - sc * 0.12, footY - sc * 0.04);
    ctx.lineTo(x - sc * 0.05, footY - h * 0.45);
    ctx.moveTo(x + sc * 0.16, footY - sc * 0.04);
    ctx.lineTo(x + sc * 0.07, footY - h * 0.45);
    ctx.stroke();
    // корпус (форма в цвет приложения)
    ctx.fillStyle = '#8b6cff';
    roundRect(ctx, x - sc * 0.26, footY - h * 0.82, sc * 0.52, h * 0.4, sc * 0.16);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `700 ${Math.round(sc * 0.22)}px -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('7', x, footY - h * 0.62);
    // голова
    ctx.fillStyle = '#e9b48a';
    ctx.beginPath();
    ctx.arc(x, footY - h * 0.92, sc * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // руки: тянутся к мячу, после броска — вверх-вперёд
    const sx = x + sc * 0.12;
    const sy = footY - h * 0.75;
    const hand = threw ? { x: X(1.75), y: Y(3.05) } : { x: X(WORLD.START.x) - sc * 0.12, y: Y(WORLD.START.y) + sc * 0.12 };
    ctx.strokeStyle = '#e9b48a';
    ctx.lineWidth = sc * 0.13;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBall(ctx, x, y, rot, scale) {
    const r = WORLD.BALL_R * s.view.scale * scale;
    const cx = X(x);
    const cy = Y(y);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffa35c');
    g.addColorStop(1, '#d9541e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(40,16,4,0.75)';
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-r * 1.25, 0, r * 0.95, -0.75, 0.75);
    ctx.arc(r * 1.25, 0, r * 0.95, Math.PI - 0.75, Math.PI + 0.75);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(ctx) {
    const a = s.aim;
    const pts = previewPath(a.vx / QUANT, a.vy / QUANT, 0.8, 0.045);
    pts.forEach(([x, y], i) => {
      const k = 1 - i / pts.length;
      ctx.fillStyle = `rgba(255,255,255,${(0.2 + 0.7 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 1.6 + 2.2 * k, 0, Math.PI * 2);
      ctx.fill();
    });
    // сила броска — дуга вокруг мяча
    const cx = X(WORLD.START.x);
    const cy = Y(WORLD.START.y);
    const r = WORLD.BALL_R * s.view.scale + 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = a.power > 0.85 ? '#ff7a6b' : '#f5bf4f';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.power);
    ctx.stroke();
  }

  function drawPopups(ctx, t) {
    s.popups = s.popups.filter((p) => t - p.t < 1100);
    for (const p of s.popups) {
      const k = (t - p.t) / 1100;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#f5bf4f';
      ctx.font = `800 ${Math.round(s.view.scale * 0.5)}px -apple-system, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('+1', X(p.x), Y(p.y + 1.4 + k * 0.8));
      ctx.fillStyle = '#3dd68c';
      ctx.font = `700 ${Math.round(s.view.scale * 0.32)}px -apple-system, Roboto, sans-serif`;
      ctx.fillText('+5 сек', X(p.x), Y(p.y + 0.95 + k * 0.8));
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ====================== HUD ======================

  let lastSec = null;
  function renderTimer() {
    const st = s.st;
    if (!st?.match) return;
    const ov = $('bb-overlay');
    if (st.stage === 'countdown') {
      const n = Math.max(1, Math.ceil((st.match.startAt - serverNow()) / 1000));
      if (ov.dataset.k !== `c${n}`) {
        ov.dataset.k = `c${n}`;
        ov.innerHTML = `<div class="bb-count">${n}</div><div class="bb-count-sub">Приготовьтесь</div>`;
        ov.hidden = false;
        haptic.impact('light');
      }
      if (serverNow() >= st.match.startAt) refresh();
      $('bb-time').textContent = '0:30';
      return;
    }
    const left = timeLeft();
    const sec = Math.ceil(left / 1000);
    const tEl = $('bb-time');
    tEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    tEl.classList.toggle('hot', sec <= 5 && sec > 0);
    if (sec !== lastSec && sec <= 5 && sec > 0) haptic.impact('light');
    lastSec = sec;
    $('bb-score').textContent = s.score;
    if (left <= 0 && !s.flight && !s.pendingShot) {
      if (ov.dataset.k !== 'done') {
        ov.dataset.k = 'done';
        ov.innerHTML = `<div class="bb-done-title">Время вышло</div><div class="bb-done-score num">${s.score}</div>
          <div class="bb-count-sub">Ждём, пока доиграют соперники…</div>`;
        ov.hidden = false;
      }
    } else if (ov.dataset.k !== 'none') {
      ov.dataset.k = 'none';
      ov.hidden = true;
    }
  }

  function renderHud() {
    const m = s.st?.match;
    if (!m) return;
    $('bb-hud-cat').textContent = `Уровень ${m.category}`;
    $('bb-opps').innerHTML = m.players
      .map((p) => {
        const isMe = p.id === me()?.id;
        const score = isMe ? s.score : p.score;
        return `<div class="bb-opp${isMe ? ' me' : ''}${p.done ? ' done' : ''}">${avatarHtml(p, 'xs')}<b class="num">${score}</b></div>`;
      })
      .join('');
  }

  // ====================== Привязка ======================

  function bind() {
    $('bb-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      s.category = Number(b.dataset.cat);
      haptic.tap();
      renderScreens();
    });
    $('bb-find').addEventListener('click', () => join());
    $('bb-cancel').addEventListener('click', leave);
    $('bb-again').addEventListener('click', () => join(s.st?.match?.category ?? s.category));
    $('bb-back-lobby').addEventListener('click', leave);
    const c = $('bb-canvas');
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', () => (s.aim = null));
    window.addEventListener('resize', () => !$('bb-game').hidden && resize());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && s.active) refresh(); // вернулись — сверяемся с сервером
    });
  }

  return {
    bind,
    /** Вкладка открыта. */
    show() {
      s.active = true;
      startPolling();
    },
    hide() {
      if (!$('bb-game').hidden) return; // идёт матч — опрос продолжается
      s.active = false;
      stopPolling();
    },
    /** При запуске приложения: если есть незавершённый матч — вернуть в игру. */
    async resume() {
      try {
        const st = await api('/api/basket/state', {});
        if (st.stage === 'countdown' || st.stage === 'playing' || st.stage === 'queue') return st.stage;
      } catch {}
      return null;
    },
    onPlayersPoll: renderHud,
  };
}
