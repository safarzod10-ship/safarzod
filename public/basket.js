// Basketball Rush — клиент: вкладка «Игры», выбор ставки, игра на canvas, итоги матча.
// Клиент только рисует, звучит и прицеливается. Попадание, бонусы, очки и время решает сервер
// (та же детерминированная физика) — анимация совпадает с серверной проверкой.

import { WORLD, QUANT, validLaunch, simulateShot, previewPath } from './basket-physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const MEDALS = ['🥇', '🥈', '🥉'];
const STAR = '<svg class="star"><use href="#i-star"/></svg>';
const TOP = 10; // видимая высота мира над полом

/** Выигрыш победителя — ставка × 2 (как на сервере). */
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const shotsText = (n) => `${fmt(n)} ${plural(n, 'бросок', 'броска', 'бросков')}`;
const prizeOf = (stake) => stake * 2;

// ====================== Звук (Web Audio, реальные записи из /sounds) ======================
// Три звука: удар мяча об пол, бросок, толпа.
const SOUNDS = ['bounce', 'throw', 'crowd'];
function createAudio() {
  const a = { ctx: null, buf: {}, on: true };
  try {
    a.on = localStorage.getItem('bb-sound') !== '0';
  } catch {}
  a.unlock = () => {
    if (a.ctx) return a.ctx.state === 'suspended' && a.ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    a.ctx = new AC();
    for (const name of SOUNDS) {
      fetch(`/sounds/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((b) => a.ctx.decodeAudioData(b))
        .then((d) => (a.buf[name] = d))
        .catch(() => {}); // нет файла — просто без этого звука
    }
  };
  a.play = (name, volume = 1, rate = 1) => {
    if (!a.on || !a.ctx || !a.buf[name]) return;
    const src = a.ctx.createBufferSource();
    const g = a.ctx.createGain();
    src.buffer = a.buf[name];
    src.playbackRate.value = rate;
    g.gain.value = volume;
    src.connect(g).connect(a.ctx.destination);
    src.start();
  };
  a.toggle = () => {
    a.on = !a.on;
    try {
      localStorage.setItem('bb-sound', a.on ? '1' : '0');
    } catch {}
    return a.on;
  };
  return a;
}

export function createBasket({ api, haptic, toast, avatarHtml, esc, me, supports, tg, go, onProfile }) {
  const audio = createAudio();
  const s = {
    st: null,
    offset: 0,
    stake: 10,
    poll: null,
    pollMs: 0,
    active: false,
    // текущая игра
    gameId: null,
    startAt: 0,
    hoop: null,
    hoopFrom: null,
    hoopAnimAt: 0,
    score: 0,
    seq: 0,
    deadline: 0,
    nextShotAt: 0,
    flight: null,
    aim: null,
    pendingShot: null,
    serverShot: null,
    net: 0,
    flash: 0,
    popups: [],
    throwAt: -1e9,
    ended: false,
    raf: 0,
    view: { cw: 0, ch: 0, dpr: 1, scale: 1, ox: 0, oy: 0 },
    bg: null,
  };
  const serverNow = () => Date.now() + s.offset;
  if (/[?&]dev=/.test(location.search)) window.__bb = s; // отладка только в режиме разработки

  // ====================== Сервер ======================

  async function refresh() {
    if (s.refreshing) return;
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
    s.st = st;
    if (st.session) {
      startSession(st.session);
    } else if (s.gameId && !$('bb-game').hidden && !s.ended) {
      s.ended = true; // время вышло, сервер уже закрыл попытку
    }
    renderGamesTab();
    if (!$('bb-result').hidden || (s.ended && s.endShownAt && performance.now() - s.endShownAt > 1500)) renderResultSheet();
  }

  function setPoll(ms) {
    if (s.pollMs === ms) return;
    clearInterval(s.poll);
    s.pollMs = ms;
    s.poll = ms ? setInterval(refresh, ms) : null;
  }

  // ====================== Вкладка «Игры» ======================

  /** Страница игры, бейдж на карточке и «История». */
  function renderGamesTab() {
    const st = s.st;
    if (!st) return;
    const stats = st.stats ?? {};
    $('gs-games').textContent = fmt(stats.games ?? 0);
    $('gs-wins').textContent = fmt(stats.wins ?? 0);
    $('gs-best').textContent = fmt(stats.best ?? 0);
    $('gs-won').textContent = fmt(stats.won ?? 0);
    const games = st.games ?? [];
    const active = games.find((g) => g.id === st.activeGameId && g.me?.status !== 'playing');
    const playing = !!st.session;

    // бейдж на карточке в списке игр
    const badge = $('gc-badge');
    badge.hidden = !(playing || active);
    badge.textContent = playing ? 'Идёт игра' : 'Ждём итогов';

    // кнопка «Играть» и активная игра на странице игры
    const play = $('gc-play');
    if (playing) play.innerHTML = '<svg><use href="#i-ball"/></svg>Продолжить игру';
    else if (active) play.innerHTML = 'Ждём итогов';
    else play.innerHTML = '<svg><use href="#i-ball"/></svg>Играть';
    play.classList.toggle('waiting', !!active && !playing);
    $('bb-active').hidden = !active;
    $('bb-active').innerHTML = active ? gameCard(active) : '';

    // история
    $('hist-active').innerHTML = active
      ? gameCard(active)
      : `<div class="hist-empty">${playing ? 'Игра идёт прямо сейчас' : 'Нет активной игры'}</div>`;
    const past = games.filter((g) => g.status !== 'open');
    $('hist-past-title').hidden = false;
    $('hist-past').innerHTML = past.length ? past.map(gameCard).join('') : '<div class="hist-empty">Пока нет сыгранных игр</div>';
  }

  function gameCard(g) {
    const myId = me()?.id;
    let status;
    if (g.status === 'open') {
      const left = g.expiresAt - serverNow();
      const h = Math.max(0, Math.floor(left / 3_600_000));
      const m = Math.max(0, Math.floor((left % 3_600_000) / 60_000));
      const need = 3 - g.players.length;
      status = `<span class="mg-status open">${need > 0 ? `Ждём ${need} · ${h ? `${h} ч ` : ''}${m} мин` : 'Доигрывают'}</span>`;
    } else if (g.status === 'refunded') status = '<span class="mg-status refunded">Ставка возвращена</span>';
    else if (g.me?.prize > 0) status = `<span class="mg-status win">${g.me.place}-е место · +${fmt(g.me.prize)} ⭐</span>`;
    else status = `<span class="mg-status lose">${g.me?.place ?? '—'}-е место</span>`;

    const slots = [0, 1, 2].map((i) => {
      const p = g.players[i];
      if (!p) return '<div class="mg-p empty">свободно</div>';
      const score = p.score === null ? '…' : fmt(p.score);
      return `<div class="mg-p${p.id === myId ? ' me' : ''}${p.place === 1 ? ' first' : ''}">${avatarHtml(p, 'xs')}
        <div><span>${p.id === myId ? 'Вы' : esc(p.name)}</span><b class="num">${score}</b></div></div>`;
    });
    return `<div class="mg"><div class="mg-top"><span class="mg-stake num">${STAR}${fmt(g.stake)}</span>
      <span class="mg-bank">приз ${fmt(g.prize)} ⭐</span>${status}</div>
      <div class="mg-players">${slots.join('')}</div></div>`;
  }

  // ====================== Выбор ставки ======================

  function openStakes() {
    haptic.tap();
    audio.unlock();
    const stakes = s.st?.stakes ?? [5, 10, 20, 50, 100];
    const balance = me()?.balance ?? 0;
    if (!stakes.includes(s.stake)) s.stake = stakes[1];
    $('stakes').innerHTML = stakes
      .map(
        (v) => `<button class="stake${v === s.stake ? ' on' : ''}${v > balance ? ' poor' : ''}" data-stake="${v}">
          <b class="num">${fmt(v)}${STAR}</b><span>приз ${fmt(prizeOf(v))}</span></button>`,
      )
      .join('');
    renderStakeNote();
    const w = $('stake-sheet');
    w.classList.remove('closing');
    w.hidden = false;
  }

  function renderStakeNote() {
    const balance = me()?.balance ?? 0;
    const note = $('stake-note');
    const btn = $('stake-go');
    document.querySelectorAll('#stakes .stake').forEach((b) => b.classList.toggle('on', Number(b.dataset.stake) === s.stake));
    if (s.stake > balance) {
      note.innerHTML = `Не хватает ${fmt(s.stake - balance)} ⭐ — пополните баланс`;
      note.classList.add('error');
      btn.textContent = 'Пополнить баланс';
    } else {
      note.innerHTML = `Победитель получает ×2 — <b>${fmt(prizeOf(s.stake))} ⭐</b>`;
      note.classList.remove('error');
      btn.textContent = `Играть за ${fmt(s.stake)} ⭐`;
    }
  }

  function closeStakes() {
    const w = $('stake-sheet');
    if (w.hidden) return;
    w.classList.add('closing');
    setTimeout(() => (w.hidden = true), 240);
  }

  async function startGame() {
    if (s.stake > (me()?.balance ?? 0)) {
      closeStakes();
      return go('deposit');
    }
    const btn = $('stake-go');
    btn.classList.add('loading');
    try {
      const res = await api('/api/basket/play', { stake: s.stake });
      onProfile(res);
      closeStakes();
      haptic.impact('medium');
      apply(res);
    } catch (e) {
      haptic.err();
      toast(e.message, 'err');
    } finally {
      btn.classList.remove('loading');
    }
  }

  // ====================== Игровая сессия ======================

  function startSession(sess) {
    const fresh = s.gameId !== sess.gameId;
    if (fresh) {
      s.gameId = sess.gameId;
      s.ended = false;
      s.endShownAt = 0;
      s.flight = null;
      s.pendingShot = null;
      s.serverShot = sess.lastShot;
      s.popups = [];
      s.hoop = null;
      $('bb-result').hidden = true;
      $('bb-hint').classList.remove('hide');
    }
    s.startAt = sess.startAt;
    $('bb-stake').textContent = fmt(sess.stake);
    if (!s.pendingShot) {
      s.score = sess.score;
      s.deadline = sess.deadline;
      s.nextShotAt = sess.nextShotAt;
      s.seq = sess.seq;
      if (!s.flight && (!s.hoop || s.hoop.x !== sess.hoop.x || s.hoop.y !== sess.hoop.y)) setHoop(sess.hoop, !!s.hoop);
    }
    $('bb-score').textContent = s.score;
    openGame();
  }

  function openGame() {
    const el = $('bb-game');
    if (!el.hidden) return;
    el.hidden = false;
    document.body.classList.add('bb-playing');
    if (supports('6.1')) tg.BackButton.hide();
    setPoll(3000);
    resize();
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(frame);
  }

  function closeGame() {
    $('bb-game').hidden = true;
    $('bb-result').hidden = true;
    document.body.classList.remove('bb-playing');
    cancelAnimationFrame(s.raf);
    s.gameId = null;
    s.flight = null;
    s.aim = null;
    s.hoop = null;
    setPoll(s.active ? 5000 : 0);
    if (supports('6.1')) tg.BackButton.show();
    refresh();
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
    v.scale = Math.min(r.width / WORLD.W, (r.height - 90) / TOP);
    v.ox = (r.width - WORLD.W * v.scale) / 2;
    v.oy = Math.min(r.height - 70, Math.max(70 + TOP * v.scale, r.height * 0.76));
    s.bg = renderArena(v);
  }

  const X = (x) => s.view.ox + x * s.view.scale;
  const Y = (y) => s.view.oy - y * s.view.scale;

  function setHoop(h, animate) {
    s.hoopFrom = animate && s.hoop ? { ...s.hoop } : null;
    s.hoopAnimAt = performance.now();
    s.hoop = { ...h };
  }

  function hoopNow(t) {
    if (!s.hoopFrom) return s.hoop;
    const p = Math.min(1, (t - s.hoopAnimAt) / 520);
    if (p >= 1) return (s.hoopFrom = null), s.hoop;
    const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    return { x: s.hoopFrom.x + (s.hoop.x - s.hoopFrom.x) * e, y: s.hoopFrom.y + (s.hoop.y - s.hoopFrom.y) * e };
  }

  const timeLeft = () => Math.max(0, s.deadline - serverNow());
  const started = () => serverNow() >= s.startAt;
  const ballReady = () => started() && !s.ended && !s.flight && !s.pendingShot && timeLeft() > 0 && serverNow() >= s.nextShotAt - 120;

  // ---------- Прицеливание: потяните назад и отпустите ----------

  function onDown(e) {
    audio.unlock();
    if (!ballReady()) return;
    e.preventDefault();
    $('bb-canvas').setPointerCapture?.(e.pointerId);
    s.aim = { x0: e.clientX, y0: e.clientY, t0: performance.now(), samples: 0, valid: false, power: 0 };
    $('bb-hint').classList.add('hide');
  }

  function onMove(e) {
    const a = s.aim;
    if (!a) return;
    a.samples++;
    const dx = a.x0 - e.clientX;
    const dy = e.clientY - a.y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const maxDrag = Math.min(s.view.cw, s.view.ch) * 0.42;
    const power = Math.min(1, len / maxDrag);
    if (len < 12 || dx <= 0 || dy <= 0) {
      a.valid = false;
      return;
    }
    const speed = WORLD.VMIN + power * (WORLD.VMAX - WORLD.VMIN);
    a.vx = Math.round((dx / len) * speed * QUANT);
    a.vy = Math.round((dy / len) * speed * QUANT);
    a.power = power;
    a.valid = validLaunch(a.vx / QUANT, a.vy / QUANT);
    const step = Math.round(power * 8);
    if (a.valid && a.step !== step) {
      a.step = step;
      haptic.tap();
    }
  }

  function onUp() {
    const a = s.aim;
    s.aim = null;
    if (!a?.valid || !ballReady()) return;
    const aimMs = Math.round(performance.now() - a.t0);
    if (aimMs < 150) return;
    s.lastPower = a.power;
    throwBall(a.vx, a.vy, aimMs, a.samples);
  }

  function throwBall(ivx, ivy, aimMs, samples) {
    const seq = s.seq + 1;
    const sim = simulateShot({ ...s.hoop }, ivx / QUANT, ivy / QUANT, { frames: true });
    const rimBefore = sim.contacts.some(([k, t]) => k === 'rim' && t <= sim.madeT);
    s.flight = {
      frames: sim.frames, start: performance.now(), settleT: sim.settleT, made: sim.made, madeT: sim.madeT,
      swish: sim.made && !rimBefore, seq, popped: false, contacts: sim.contacts.slice(),
    };
    s.throwAt = performance.now();
    s.pendingShot = { seq, vx: ivx, vy: ivy, aimMs, samples };
    audio.play('throw', 0.5 + 0.5 * (s.lastPower ?? 0.5));
    haptic.impact('light');
    sendShot(s.pendingShot, 0);
  }

  async function sendShot(body, attempt) {
    try {
      const r = await api('/api/basket/shot', body);
      if (r.serverNow) s.offset = r.serverNow - Date.now();
      s.pendingShot = null;
      s.seq = r.seq;
      s.nextShotAt = r.nextShotAt;
      s.serverShot = r;
      if (!(s.flight && s.flight.seq === r.seq)) applyShotResult(r);
    } catch (e) {
      if (e.code === undefined && attempt < 4) return setTimeout(() => sendShot(body, attempt + 1), 600 * (attempt + 1));
      s.pendingShot = null;
      if (s.flight?.seq === body.seq) s.flight.rejected = true;
      if (e.code !== 'TIME_UP' && e.code !== 'NO_MATCH') toast(e.message, 'err');
      refresh();
    }
  }

  /** Итог броска — в момент попадания (решение сервера). */
  function applyShotResult(r) {
    s.score = r.score;
    s.deadline = r.deadline;
    $('bb-score').textContent = s.score;
    if (r.made) {
      s.net = 1;
      s.flash = 1;
      s.popups.push({ t: performance.now(), x: r.shotHoop.x, y: r.shotHoop.y, swish: r.swish, bonus: r.bonusMs / 1000 });
      const pill = $('bb-score').parentElement;
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
      audio.play('crowd', r.swish ? 1 : 0.55, r.swish ? 1.04 : 1); // чистое попадание — трибуны громче
      haptic.ok();
    }
    if (r.hoop.x !== s.hoop.x || r.hoop.y !== s.hoop.y) setTimeout(() => setHoop(r.hoop, true), 350);
  }

  // ====================== Итог моей игры ======================

  function renderResultSheet() {
    const g = s.st?.games?.find((x) => x.id === s.gameId);
    if (!g || g.me?.status === 'playing') return;
    const el = $('bb-result');
    const myId = me()?.id;
    const done = g.players.filter((p) => p.status !== 'playing');
    const need = 3 - g.players.length;
    let title;
    let sub;
    if (g.status === 'finished') {
      title = g.me.prize > 0 ? `Победа! +${fmt(g.me.prize)} ⭐` : `${g.me.place}-е место`;
      sub = `Итоги матча · ставка ${fmt(g.stake)} ⭐ · приз ${fmt(g.prize)} ⭐`;
    } else if (g.status === 'refunded') {
      title = 'Ставка возвращена';
      sub = 'Матч не собрал троих за час';
    } else {
      title = `Ваш результат: ${fmt(g.me.score)}`;
      sub = `Ставка ${fmt(g.stake)} ⭐ · победитель получает ${fmt(g.prize)} ⭐`;
    }
    const ranked = [...g.players].sort((a, b) => (a.place ?? 9) - (b.place ?? 9) || (b.score ?? -1) - (a.score ?? -1));
    const rows = ranked.map((p) => {
      const isMe = p.id === myId;
      const place = p.place ? MEDALS[p.place - 1] ?? p.place : '';
      const meta = p.status === 'playing' ? 'играет…' : `${shotsText(p.shots ?? 0)}${p.prize ? ` · <span class="res-prize">+${fmt(p.prize)} ⭐</span>` : ''}`;
      return `<div class="res-row${isMe ? ' me' : ''}"><div class="res-place">${place}</div>${avatarHtml(p, 'sm')}
        <div class="res-who"><div class="res-name">${isMe ? 'Вы' : esc(p.name)}</div><div class="res-meta">${meta}</div></div>
        <div class="res-score num">${p.score === null ? '…' : fmt(p.score)}</div></div>`;
    });
    for (let i = 0; i < need; i++) rows.push('<div class="res-row empty">Свободное место</div>');
    const waiting =
      g.status === 'open'
        ? `<div class="res-wait"><i></i>${need > 0 ? `Ожидание ${need === 1 ? '3-го участника' : 'ещё 2 участников'} для подведения итогов` : 'Соперники доигрывают…'}</div>`
        : '';
    const html = `<div class="res-title">${title}</div><div class="res-sub">${sub}</div>
      <div class="res-list">${rows.join('')}</div>${waiting}
      <div class="dock-row"><button class="btn secondary" data-res="history">История</button>
      <button class="btn primary" data-res="close" style="flex:1">Готово</button></div>`;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
    if (el.hidden) {
      el.hidden = false;
      $('bb-overlay').hidden = true;
      if (g.status === 'finished' && g.me.prize > 0) haptic.ok();
    }
  }

  // ====================== Отрисовка ======================

  function frame(t) {
    s.raf = requestAnimationFrame(frame);
    const v = s.view;
    const ctx = $('bb-canvas').getContext('2d');
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    if (s.bg) ctx.drawImage(s.bg, 0, 0, v.cw, v.ch);
    if (!s.hoop) return;
    drawScoreboard(ctx, t);

    // мяч в полёте
    let ball = null;
    const f = s.flight;
    if (f) {
      const el = Math.max(0, (t - f.start) / 1000);
      const n = f.frames.length / 2 - 1;
      const idx = Math.min(n, el / WORLD.DT);
      const i0 = Math.floor(idx);
      const i1 = Math.min(n, i0 + 1);
      const k = idx - i0;
      ball = {
        x: f.frames[2 * i0] + (f.frames[2 * i1] - f.frames[2 * i0]) * k,
        y: f.frames[2 * i0 + 1] + (f.frames[2 * i1 + 1] - f.frames[2 * i0 + 1]) * k,
        rot: el * 9,
      };
      while (f.contacts.length && f.contacts[0][1] <= el) {
        const [kind] = f.contacts.shift();
        if (kind === 'floor') audio.play('bounce', 0.55);
        else haptic.impact('soft');
      }
      if (!f.popped && f.made && el >= f.madeT && s.serverShot?.seq === f.seq) {
        f.popped = true;
        applyShotResult(s.serverShot);
      }
      if (el >= f.settleT) {
        if (!f.popped && s.serverShot?.seq === f.seq) {
          f.popped = true;
          applyShotResult(s.serverShot);
        }
        if (!s.pendingShot || f.rejected) s.flight = null;
      }
    }

    const h = hoopNow(t);
    drawBoard(ctx, h);
    drawRimBack(ctx, h);
    if (ball) drawBall(ctx, ball.x, ball.y, ball.rot, 1);
    drawNet(ctx, h, t);
    drawRimFront(ctx, h);
    drawPlayer(ctx, t, !ball);
    if (s.aim?.valid) drawAim(ctx);
    drawPopups(ctx, t);
    if (s.flash > 0) {
      ctx.fillStyle = `rgba(245,191,79,${(s.flash * 0.12).toFixed(3)})`;
      ctx.fillRect(0, 0, v.cw, v.ch);
      s.flash = Math.max(0, s.flash - 0.04);
    }
    tickClock();
  }

  // ---------- Арена (рисуется один раз на размер экрана) ----------

  function renderArena(v) {
    const c = document.createElement('canvas');
    c.width = Math.round(v.cw * v.dpr);
    c.height = Math.round(v.ch * v.dpr);
    const g = c.getContext('2d');
    g.scale(v.dpr, v.dpr);
    const fy = v.oy;
    const sc = v.scale;
    // стена зала
    const wall = g.createLinearGradient(0, 0, 0, fy);
    wall.addColorStop(0, '#120a24');
    wall.addColorStop(0.55, '#1d1036');
    wall.addColorStop(1, '#2a1546');
    g.fillStyle = wall;
    g.fillRect(0, 0, v.cw, fy);
    // фермы под потолком
    g.strokeStyle = 'rgba(160,120,255,0.08)';
    g.lineWidth = 2;
    const trussY = v.ch * 0.07;
    g.beginPath();
    g.moveTo(0, trussY);
    g.lineTo(v.cw, trussY);
    g.moveTo(0, trussY + 16);
    g.lineTo(v.cw, trussY + 16);
    for (let x = 0; x < v.cw + 20; x += 24) {
      g.moveTo(x, trussY);
      g.lineTo(x + 12, trussY + 16);
      g.lineTo(x + 24, trussY);
    }
    g.stroke();
    // прожекторы и лучи
    for (const lx of [0.18, 0.5, 0.82]) {
      const x = v.cw * lx;
      const beam = g.createLinearGradient(0, trussY, 0, fy);
      beam.addColorStop(0, 'rgba(190,150,255,0.16)');
      beam.addColorStop(1, 'rgba(190,150,255,0)');
      g.fillStyle = beam;
      g.beginPath();
      g.moveTo(x - 6, trussY + 18);
      g.lineTo(x + 6, trussY + 18);
      g.lineTo(x + v.cw * 0.2, fy);
      g.lineTo(x - v.cw * 0.2, fy);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(235,220,255,0.9)';
      g.beginPath();
      g.arc(x, trussY + 20, 3.2, 0, Math.PI * 2);
      g.fill();
      const glow = g.createRadialGradient(x, trussY + 20, 0, x, trussY + 20, 26);
      glow.addColorStop(0, 'rgba(200,170,255,0.45)');
      glow.addColorStop(1, 'rgba(200,170,255,0)');
      g.fillStyle = glow;
      g.fillRect(x - 26, trussY - 6, 52, 52);
    }
    // трибуны: ряды болельщиков-силуэтов (детерминированный «шум», без мерцания между кадрами)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const standTop = fy - sc * 4.6;
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const y = standTop + (r / rows) * (fy - sc * 0.7 - standTop);
      const size = sc * (0.2 + (r / rows) * 0.12);
      const shade = 22 + r * 5;
      for (let x = -size + (r % 2) * size; x < v.cw + size; x += size * 2.1) {
        const jx = x + (rnd() - 0.5) * size * 0.6;
        const jy = y + (rnd() - 0.5) * size * 0.5;
        const hue = rnd() < 0.15 ? `rgb(${shade + 40},${shade + 10},${shade + 70})` : `rgb(${shade + 14},${shade},${shade + 36})`;
        g.fillStyle = hue;
        g.beginPath();
        g.arc(jx, jy, size * 0.55, 0, Math.PI * 2); // голова
        g.fill();
        g.beginPath();
        g.ellipse(jx, jy + size * 1.25, size * 0.95, size * 0.75, 0, Math.PI, 0); // плечи
        g.fill();
        if (rnd() < 0.06) {
          g.fillStyle = 'rgba(255,235,180,0.75)'; // вспышки телефонов
          g.fillRect(jx + size * 0.4, jy - size * 0.2, 2, 3);
        }
      }
    }
    // рекламный бортик со светящейся надписью
    const bandH = sc * 0.62;
    const by = fy - bandH;
    const band = g.createLinearGradient(0, by, 0, fy);
    band.addColorStop(0, '#2b1658');
    band.addColorStop(1, '#170b30');
    g.fillStyle = band;
    g.fillRect(0, by, v.cw, bandH);
    g.fillStyle = 'rgba(245,191,79,0.85)';
    g.fillRect(0, by, v.cw, 2);
    g.font = `800 ${Math.round(bandH * 0.42)}px -apple-system, Roboto, sans-serif`;
    g.textBaseline = 'middle';
    let tx = 10;
    let k = 0;
    while (tx < v.cw) {
      const text = k++ % 2 ? '★' : 'ROULETTE ARENA';
      g.fillStyle = k % 2 ? 'rgba(220,200,255,0.92)' : 'rgba(245,191,79,0.95)';
      g.fillText(text, tx, by + bandH / 2 + 1);
      tx += g.measureText(text).width + 16;
    }
    // паркет с отражением
    const floor = g.createLinearGradient(0, fy, 0, v.ch);
    floor.addColorStop(0, '#5a3524');
    floor.addColorStop(0.35, '#3b2219');
    floor.addColorStop(1, '#170e14');
    g.fillStyle = floor;
    g.fillRect(0, fy, v.cw, v.ch - fy);
    const refl = g.createLinearGradient(0, fy, 0, fy + bandH * 1.4);
    refl.addColorStop(0, 'rgba(160,110,255,0.22)');
    refl.addColorStop(1, 'rgba(160,110,255,0)');
    g.fillStyle = refl;
    g.fillRect(0, fy, v.cw, bandH * 1.4);
    g.strokeStyle = 'rgba(255,220,180,0.06)';
    g.lineWidth = 1;
    const depth = v.ch - fy;
    for (let i = 1; i < 8; i++) {
      const yy = fy + depth * (i / 8) ** 1.5;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(v.cw, yy);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, fy + 1);
    g.lineTo(v.cw, fy + 1);
    g.stroke();
    // виньетка
    const vig = g.createRadialGradient(v.cw / 2, v.ch * 0.45, v.ch * 0.25, v.cw / 2, v.ch * 0.45, v.ch * 0.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vig;
    g.fillRect(0, 0, v.cw, v.ch);
    return c;
  }

  // ---------- Табло с временем ----------

  let lastSec = null;
  function drawScoreboard(ctx, t) {
    const v = s.view;
    const left = s.ended ? 0 : started() ? timeLeft() : (s.deadline - s.startAt);
    const sec = Math.ceil(left / 1000);
    const hot = started() && sec <= 5 && !s.ended;
    const w = Math.min(118, v.cw * 0.3);
    const h = w * 0.56;
    const x = 14;
    const y = v.ch * 0.19;
    ctx.fillStyle = 'rgba(10,6,20,0.85)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(255,93,108,0.7)' : 'rgba(160,120,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `700 ${Math.round(h * 0.17)}px -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('ВРЕМЯ', x + w / 2, y + h * 0.27);
    const pulse = hot ? 1 + 0.12 * Math.max(0, 1 - ((t % 1000) / 300)) : 1;
    ctx.save();
    ctx.translate(x + w / 2, y + h * 0.78);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = hot ? '#ff5d6c' : '#ffd36a';
    ctx.shadowColor = hot ? 'rgba(255,93,108,0.8)' : 'rgba(255,200,90,0.6)';
    ctx.shadowBlur = 14;
    ctx.font = `800 ${Math.round(h * 0.56)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillText(String(Math.max(0, sec)).padStart(2, '0'), 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // ---------- Кольцо, щит, сетка ----------

  /** Щит — вид спереди, кольцо ровно по центру под ним, без стойки и креплений (как в аркадах). */
  function drawBoard(ctx, h) {
    const sc = s.view.scale;
    const x0 = X(h.x - WORLD.BOARD_HALF);
    const x1 = X(h.x + WORLD.BOARD_HALF);
    const y0 = Y(h.y + WORLD.BOARD_TOP);
    const y1 = Y(h.y - 0.12);
    const w = x1 - x0;
    const hh = y1 - y0;
    // мягкая подсветка зала за щитом
    const glow = ctx.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2, 0, (x0 + x1) / 2, (y0 + y1) / 2, sc * 2);
    glow.addColorStop(0, 'rgba(170,130,255,0.18)');
    glow.addColorStop(1, 'rgba(170,130,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x0 - sc * 2, y0 - sc * 2, w + sc * 4, hh + sc * 4);
    // тень и рамка
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, x0 + 3, y0 + 5, w, hh, sc * 0.06);
    ctx.fill();
    ctx.fillStyle = '#2a2140';
    roundRect(ctx, x0, y0, w, hh, sc * 0.06);
    ctx.fill();
    // стекло щита
    const inset = Math.max(3, sc * 0.07);
    const glass = ctx.createLinearGradient(x0, y0, x1, y1);
    glass.addColorStop(0, '#f6f4ff');
    glass.addColorStop(1, '#d9e4f2');
    ctx.fillStyle = glass;
    roundRect(ctx, x0 + inset, y0 + inset, w - inset * 2, hh - inset * 2, sc * 0.03);
    ctx.fill();
    // блик на стекле
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(x0 + inset, y0 + inset);
    ctx.lineTo(x0 + w * 0.45, y0 + inset);
    ctx.lineTo(x0 + w * 0.2, y1 - inset);
    ctx.lineTo(x0 + inset, y1 - inset);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    // квадрат-мишень по центру над кольцом
    const qw = sc * 0.62;
    const qh = sc * 0.5;
    ctx.strokeStyle = '#2a2140';
    ctx.lineWidth = Math.max(2, sc * 0.06);
    ctx.strokeRect(X(h.x) - qw / 2, Y(h.y) - qh - sc * 0.06, qw, qh);
  }

  const RIM_RY = 0.075; // «глубина» кольца — почти плоское, как на виде спереди
  function drawRimBack(ctx, h) {
    const sc = s.view.scale;
    ctx.strokeStyle = '#b8321e';
    ctx.lineWidth = Math.max(2.5, sc * 0.07);
    ctx.beginPath();
    ctx.ellipse(X(h.x), Y(h.y), WORLD.RIM_HALF * sc, RIM_RY * sc, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  function drawRimFront(ctx, h) {
    const sc = s.view.scale;
    ctx.strokeStyle = '#ff4a2e';
    ctx.lineWidth = Math.max(3, sc * 0.09);
    ctx.beginPath();
    ctx.ellipse(X(h.x), Y(h.y), WORLD.RIM_HALF * sc, RIM_RY * sc, 0, 0, Math.PI);
    ctx.stroke();
    // крючки сетки по дужке
    ctx.fillStyle = '#ffd8cc';
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (i / 6);
      ctx.beginPath();
      ctx.arc(X(h.x) + Math.cos(a) * WORLD.RIM_HALF * sc, Y(h.y) + Math.sin(a) * RIM_RY * sc, Math.max(1, sc * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Сетка висит ровно под кольцом; при попадании растягивается и качается. */
  function drawNet(ctx, h, t) {
    const sc = s.view.scale;
    const cx = X(h.x);
    const ry = Y(h.y);
    const top = WORLD.RIM_HALF * sc;
    const bottom = top * 0.58;
    const depth = sc * 0.78 * (1 + s.net * 0.35);
    const sway = s.net * Math.sin(t / 45) * sc * 0.05;
    s.net *= 0.95;
    if (s.net < 0.01) s.net = 0;
    ctx.strokeStyle = 'rgba(250,248,255,0.9)';
    ctx.lineWidth = Math.max(1, sc * 0.022);
    const cols = 8;
    const rowsN = 4;
    const pt = (i, j) => {
      const v = j / rowsN;
      const w = top + (bottom - top) * v;
      return [cx - w + (2 * w * i) / cols + sway * v, ry + RIM_RY * sc * 0.5 + depth * v];
    };
    ctx.beginPath();
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < cols; i++) {
        const [ax, ay] = pt(i, j);
        const [bx, by] = pt(i + 1, j + 1);
        const [cx2, cy2] = pt(i + 1, j);
        const [dx, dy] = pt(i, j + 1);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.moveTo(cx2, cy2);
        ctx.lineTo(dx, dy);
      }
    }
    ctx.stroke();
  }

  // ---------- Игрок: ведёт мяч, прицеливается, бросает ----------

  function drawPlayer(ctx, t, holdsBall) {
    const sc = s.view.scale;
    const baseX = 0.95;
    const aiming = !!s.aim;
    const sinceThrow = (t - s.throwAt) / 1000;
    const throwing = sinceThrow < 0.45;
    const idle = holdsBall && !aiming && !throwing;
    const P = (x, y) => [X(x), Y(y)];

    // ведение мяча: ~2 удара в секунду, мяч разгоняется к полу
    const period = 0.56;
    const ph = ((t / 1000) % period) / period;
    const hand = 1.08;
    const dribY = idle ? hand - (hand - WORLD.BALL_R) * (ph < 0.5 ? (ph * 2) ** 2 : (2 - ph * 2) ** 2) : 0;
    if (idle) {
      const hit = ph >= 0.5 && s.lastPh < 0.5;
      if (hit && ballReady()) audio.play('bounce', 0.28);
      s.lastPh = ph;
    }
    const bob = idle ? Math.sin(ph * Math.PI * 2) * 0.03 : aiming ? -0.04 : 0;
    const crouch = aiming ? 0.08 + (s.aim?.power ?? 0) * 0.08 : 0;

    const hip = 1.0 - crouch + bob;
    const shoulder = 1.72 - crouch + bob;
    const headY = 2.05 - crouch + bob;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(X(baseX), Y(0) + 2, sc * 0.42, sc * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // ноги + кроссовки
    const knee = 0.5 - crouch * 0.4;
    for (const [fx, kx, c] of [[-0.14, -0.06, '#d9a77e'], [0.16, 0.1, '#e6b58a']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = sc * 0.15;
      ctx.beginPath();
      ctx.moveTo(...P(baseX + fx * 0.6, hip));
      ctx.lineTo(...P(baseX + kx + crouch * 0.4, knee));
      ctx.lineTo(...P(baseX + fx, 0.12));
      ctx.stroke();
      ctx.fillStyle = '#f2f2f7';
      ctx.beginPath();
      ctx.ellipse(X(baseX + fx + 0.06), Y(0.06), sc * 0.15, sc * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8b6cff';
      ctx.fillRect(X(baseX + fx - 0.06), Y(0.14), sc * 0.14, sc * 0.03);
    }
    // шорты
    ctx.fillStyle = '#3b2a78';
    roundRect(ctx, X(baseX - 0.27), Y(hip + 0.16), sc * 0.56, sc * 0.42, sc * 0.08);
    ctx.fill();
    // майка
    const jersey = ctx.createLinearGradient(X(baseX - 0.3), 0, X(baseX + 0.3), 0);
    jersey.addColorStop(0, '#7a5cf0');
    jersey.addColorStop(1, '#9d84ff');
    ctx.fillStyle = jersey;
    roundRect(ctx, X(baseX - 0.28), Y(shoulder + 0.05), sc * 0.56, sc * (shoulder - hip + 0.05), sc * 0.16);
    ctx.fill();
    ctx.strokeStyle = '#f5bf4f';
    ctx.lineWidth = Math.max(1.5, sc * 0.03);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(sc * 0.26)}px -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('7', X(baseX), Y((shoulder + hip) / 2 + 0.06));
    // голова: волосы, повязка
    ctx.fillStyle = '#e6b58a';
    ctx.beginPath();
    ctx.arc(X(baseX + 0.02), Y(headY), sc * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#231a2e';
    ctx.beginPath();
    ctx.arc(X(baseX + 0.0), Y(headY + 0.06), sc * 0.205, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.fillStyle = '#f5bf4f';
    ctx.fillRect(X(baseX - 0.19), Y(headY + 0.09), sc * 0.42, sc * 0.06);

    // руки и мяч
    const sh = P(baseX + 0.08, shoulder - 0.05);
    let ballPos = null;
    let handPos;
    if (aiming) {
      // естественная поза броска: мяч над головой, локти вперёд
      ballPos = { x: WORLD.START.x, y: WORLD.START.y };
      handPos = P(WORLD.START.x - 0.1, WORLD.START.y - 0.1);
    } else if (throwing) {
      const a = Math.min(1, sinceThrow / 0.15);
      handPos = P(baseX + 0.45 + 0.35 * a, shoulder + 0.55 + 0.4 * a); // сопровождение броска
    } else if (holdsBall) {
      ballPos = { x: baseX + 0.48, y: dribY };
      handPos = P(baseX + 0.46, hand + 0.12 + (idle ? 0.05 * Math.sin(ph * Math.PI * 2) : 0));
    } else {
      handPos = P(baseX + 0.3, hip + 0.25);
    }
    // дальняя рука
    ctx.strokeStyle = '#d9a77e';
    ctx.lineWidth = sc * 0.12;
    ctx.beginPath();
    ctx.moveTo(sh[0] - sc * 0.12, sh[1]);
    ctx.lineTo((sh[0] + handPos[0]) / 2 - sc * 0.05, (sh[1] + handPos[1]) / 2 + sc * 0.05);
    ctx.lineTo(handPos[0] - sc * 0.12, handPos[1] + sc * 0.02);
    ctx.stroke();
    if (ballPos && holdsBall) drawBall(ctx, ballPos.x, ballPos.y, t / 260, ballReady() ? spawn(t) : 1);
    // ближняя рука поверх мяча
    ctx.strokeStyle = '#e6b58a';
    ctx.beginPath();
    ctx.moveTo(...sh);
    ctx.lineTo((sh[0] + handPos[0]) / 2 + sc * 0.04, (sh[1] + handPos[1]) / 2 + sc * 0.08);
    ctx.lineTo(...handPos);
    ctx.stroke();
    ctx.restore();
    if (!holdsBall) s.readySince = 0;
  }

  function spawn(t) {
    if (!s.readySince) s.readySince = t;
    return Math.min(1, 0.55 + (t - s.readySince) / 380);
  }

  function drawBall(ctx, x, y, rot, scale) {
    const r = WORLD.BALL_R * s.view.scale * scale;
    const cx = X(x);
    const cy = Y(y);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffb070');
    g.addColorStop(0.6, '#f0702c');
    g.addColorStop(1, '#b4431a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(40,14,4,0.8)';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r * 0.35, -r);
    ctx.quadraticCurveTo(-r * 0.85, 0, -r * 0.35, r);
    ctx.moveTo(r * 0.35, -r);
    ctx.quadraticCurveTo(r * 0.85, 0, r * 0.35, r);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(ctx) {
    const a = s.aim;
    const pts = previewPath(a.vx / QUANT, a.vy / QUANT, 0.8, 0.045);
    pts.forEach(([x, y], i) => {
      const k = 1 - i / pts.length;
      ctx.fillStyle = `rgba(255,255,255,${(0.18 + 0.75 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 1.5 + 2.4 * k, 0, Math.PI * 2);
      ctx.fill();
    });
    const cx = X(WORLD.START.x);
    const cy = Y(WORLD.START.y);
    const r = WORLD.BALL_R * s.view.scale + 8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = a.power > 0.85 ? '#ff7a6b' : '#f5bf4f';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.power);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawPopups(ctx, t) {
    s.popups = s.popups.filter((p) => t - p.t < 1300);
    for (const p of s.popups) {
      const k = (t - p.t) / 1300;
      const rise = (1 - (1 - k) ** 3) * 0.9;
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      if (p.swish) {
        ctx.fillStyle = '#ffd36a';
        ctx.font = `900 ${Math.round(s.view.scale * 0.42)}px -apple-system, Roboto, sans-serif`;
        ctx.fillText('ЧИСТО!', X(p.x), Y(p.y + 1.85 + rise));
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(s.view.scale * 0.55)}px -apple-system, Roboto, sans-serif`;
      ctx.fillText('+1', X(p.x), Y(p.y + 1.3 + rise));
      ctx.fillStyle = '#3dd68c';
      ctx.font = `800 ${Math.round(s.view.scale * 0.32)}px -apple-system, Roboto, sans-serif`;
      ctx.fillText(`+${p.bonus} сек`, X(p.x), Y(p.y + 0.92 + rise));
      ctx.shadowBlur = 0;
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

  // ---------- Отсчёт, последние секунды, конец ----------

  function tickClock() {
    const ov = $('bb-overlay');
    if (!started()) {
      const n = Math.max(1, Math.ceil((s.startAt - serverNow()) / 1000));
      if (ov.dataset.k !== `c${n}`) {
        ov.dataset.k = `c${n}`;
        ov.innerHTML = `<div class="bb-count">${n}</div><div class="bb-count-sub">Приготовьтесь</div>`;
        ov.hidden = false;
        haptic.impact('light');
      }
      return;
    }
    const left = timeLeft();
    const sec = Math.ceil(left / 1000);
    if (sec !== lastSec && sec <= 5 && sec > 0 && !s.ended) haptic.impact('light');
    lastSec = sec;
    const over = (left <= 0 || s.ended) && !s.flight && !s.pendingShot;
    if (over) {
      if (ov.dataset.k !== 'done') {
        ov.dataset.k = 'done';
        ov.innerHTML = `<div class="bb-done-title">Время вышло</div><div class="bb-done-score num">${s.score}</div>
          <div class="bb-count-sub">Подводим итоги…</div>`;
        ov.hidden = false;
        haptic.impact('heavy');
        s.ended = true;
        s.endShownAt = performance.now();
        setTimeout(refresh, 1200);
        setTimeout(refresh, 2600);
      }
    } else if (ov.dataset.k !== 'none') {
      ov.dataset.k = 'none';
      ov.hidden = true;
    }
  }

  // ====================== Привязка ======================

  function bind() {
    document.querySelector('[data-game="basket"]').addEventListener('click', () => {
      audio.unlock();
      go('basket');
    });
    $('bb-history-btn').addEventListener('click', () => go('basket-history'));
    $('gc-play').addEventListener('click', () => {
      if (s.st?.session) return apply(s.st); // вернуться в идущую игру
      if (s.st?.activeGameId) {
        haptic.err();
        toast('Дождитесь итогов текущей игры', 'err');
        return go('basket-history');
      }
      openStakes();
    });
    $('stakes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-stake]');
      if (!b) return;
      s.stake = Number(b.dataset.stake);
      haptic.tap();
      renderStakeNote();
    });
    $('stake-go').addEventListener('click', startGame);
    $('stake-sheet').addEventListener('click', (e) => e.target.matches('[data-close]') && closeStakes());
    $('bb-result').addEventListener('click', (e) => {
      const act = e.target.closest('[data-res]')?.dataset.res;
      if (act === 'close') closeGame();
      if (act === 'history') {
        closeGame();
        go('basket-history');
      }
    });
    $('bb-sound').addEventListener('click', () => {
      audio.unlock();
      const on = audio.toggle();
      $('bb-sound').innerHTML = `<svg><use href="#i-${on ? 'sound' : 'mute'}"/></svg>`;
      haptic.tap();
    });
    $('bb-sound').innerHTML = `<svg><use href="#i-${audio.on ? 'sound' : 'mute'}"/></svg>`;
    const c = $('bb-canvas');
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', () => (s.aim = null));
    window.addEventListener('resize', () => !$('bb-game').hidden && resize());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (s.active || s.gameId)) refresh();
    });
  }

  return {
    bind,
    show() {
      s.active = true;
      refresh();
      if (!s.gameId) setPoll(5000);
    },
    hide() {
      s.active = false;
      if (!s.gameId) setPoll(0);
    },
    /** При запуске: незавершённая игра — сразу вернуть в неё. */
    async resume() {
      try {
        const st = await api('/api/basket/state', {});
        if (st.session) {
          apply(st);
          return true;
        }
      } catch {}
      return false;
    },
  };
}
