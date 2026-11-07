import { WORLD, QUANT, validLaunch, simulateShot, previewPath, nextHoop } from './basket-physics.js';
import { GRAM, gramInput, currency } from './money.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const MEDALS = ['🥇', '🥈', '🥉'];
const STAR = '<svg class="star"><use href="#i-star"/></svg>';
const TOP = 10;

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const shotsText = (n) => `${fmt(n)} ${plural(n, 'бросок', 'броска', 'бросков')}`;
const TUTOR_KEY = 'bb-practice-v1';

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
        .catch(() => {});
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
    poll: null,
    pollMs: 0,
    active: false,
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
  if (/[?&]dev=/.test(location.search)) window.__bb = s;

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
      s.ended = true;
    }
    renderGamesTab();
    if (!$('bb-result').hidden || (s.ended && s.endShownAt && performance.now() - s.endShownAt > 1500))
      renderResultSheet();
  }

  function setPoll(ms) {
    if (s.pollMs === ms) return;
    clearInterval(s.poll);
    s.pollMs = ms;
    s.poll = ms ? setInterval(refresh, ms) : null;
  }

  const placeMark = (p) => (p <= 3 ? MEDALS[p - 1] : `<span class="lb-n">${p}</span>`);

  function lbRow(r, myId) {
    const isMe = r.id === myId;
    return `<div class="lb-row${isMe ? ' me' : ''}${r.place === 1 ? ' first' : ''}">
      <div class="lb-place">${placeMark(r.place)}</div>${avatarHtml(r, 'xs')}
      <div class="lb-who"><span>${isMe ? 'Вы' : esc(r.name)}</span><small>${shotsText(r.shots)}</small></div>
      <b class="lb-score num">${fmt(r.score)}</b></div>`;
  }

  function renderGamesTab() {
    const st = s.st;
    if (!st?.today) return;
    const t = st.today;
    const myId = me()?.id;
    const stats = st.stats ?? {};
    $('gs-games').textContent = fmt(stats.games ?? 0);
    $('gs-best').textContent = fmt(stats.best ?? 0);
    $('gs-wins').textContent = fmt(stats.wins ?? 0);
    $('gs-won').textContent = fmt(stats.won ?? 0);

    const badge = $('gc-badge');
    badge.hidden = !(st.session || t.me);
    badge.textContent = st.session ? 'Идёт игра' : t.me ? `Вы #${t.me.place} сегодня` : '';

    $('bt-prize').textContent = fmt(t.prize);
    $('bt-players').textContent = `${fmt(t.players)} ${plural(t.players, 'игрок', 'игрока', 'игроков')} сегодня`;
    $('bt-me').innerHTML = t.me
      ? `Ваше место <b>#${t.me.place}</b> · лучший результат <b>${fmt(t.me.score)}</b>`
      : 'Наберите хотя бы 1 очко, чтобы попасть в таблицу';
    tickDay();

    const rows = t.top.map((r) => lbRow(r, myId));
    if (t.me && !t.top.some((r) => r.id === myId)) {
      rows.push(
        '<div class="lb-gap">···</div>' +
          lbRow(
            { id: myId, name: 'Вы', photo: me()?.photo, place: t.me.place, score: t.me.score, shots: t.me.shots },
            myId,
          ),
      );
    }
    $('bt-top').innerHTML = rows.length
      ? rows.join('')
      : '<div class="hist-empty">Сегодня ещё никто не играл — станьте первым</div>';
    const lw = st.lastWinner;
    $('bt-last').hidden = !lw;
    if (lw)
      $('bt-last').innerHTML =
        `🏆 Победитель ${lw.day.slice(8, 10)}.${lw.day.slice(5, 7)}: <b>${lw.id === myId ? 'вы' : esc(lw.name)}</b> — ${fmt(lw.score)} очков, +${fmt(lw.prize)} ⭐`;

    const play = $('gc-play');
    play.innerHTML = st.session
      ? '<svg><use href="#i-ball"/></svg>Продолжить игру'
      : `<svg><use href="#i-ball"/></svg>Играть за ${priceLabel()}`;

    const date = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const list = (st.attempts ?? []).filter((a) => a.status === 'done');
    $('hist-past').innerHTML = list.length
      ? list
          .map(
            (
              a,
            ) => `<div class="att"><div><b class="num">${fmt(a.score)}</b><span>${plural(a.score, 'очко', 'очка', 'очков')}</span></div>
            <small>${shotsText(a.shots)}${a.swishes ? ` · ${a.swishes} чист.` : ''}</small><time>${date.format(a.created_at)}</time></div>`,
          )
          .join('')
      : '<div class="hist-empty">Пока нет сыгранных попыток</div>';
  }

  function tickDay() {
    const t = s.st?.today;
    if (!t) return;
    const left = Math.max(0, t.endsAt - serverNow());
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const sec = Math.floor((left % 60_000) / 1000);
    $('bt-left').textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  setInterval(() => s.active && tickDay(), 1000);

  const tutorSeen = () => {
    try {
      return localStorage.getItem(TUTOR_KEY) === '1';
    } catch {
      return false;
    }
  };

  const priceLabel = () => {
    const st = s.st;
    if (currency() === GRAM) return `${gramInput(st?.priceGram ?? 0)} Gram`;
    return `${fmt(st?.price ?? 5)} ⭐`;
  };
  const canAfford = () =>
    currency() === GRAM ? (me()?.gram ?? 0) >= (s.st?.priceGram ?? 0) : (me()?.balance ?? 0) >= (s.st?.price ?? 5);

  function coach(text, { hand = false, skip = true } = {}) {
    const el = $('bb-coach');
    el.hidden = false;
    $('bb-coach-text').innerHTML = text;
    $('bb-coach-skip').hidden = !skip;
    $('bb-hand').hidden = !hand;
    if (hand) placeHand();
  }

  function placeHand() {
    const c = $('bb-canvas').getBoundingClientRect();
    const hand = $('bb-hand');
    hand.style.left = `${c.left + c.width * 0.62}px`;
    hand.style.top = `${c.top + c.height * 0.36}px`;
  }

  function startPractice(thenPlay) {
    if (thenPlay && !canAfford()) {
      toast(`Нужно ${priceLabel()} — пополните баланс`, 'err');
      return go('deposit');
    }
    audio.unlock();
    s.practice = { thenPlay, misses: 0 };
    s.gameId = null;
    s.ended = false;
    s.flight = null;
    s.pendingShot = null;
    s.popups = [];
    s.score = 0;
    s.seq = 0;
    s.startAt = 0;
    s.deadline = Infinity;
    s.nextShotAt = 0;
    s.hoop = null;
    $('bb-result').hidden = true;
    $('bb-hint').classList.add('hide');
    $('bb-score').textContent = '0';
    $('bb-stake').textContent = 'Тренировка';
    openGame();
    setHoop(nextHoop(null, Math.random, 0), false);
    requestAnimationFrame(() =>
      coach(
        '<b>Тренер:</b> зажмите палец в любом месте экрана и потяните <b>влево-вниз</b>, как рогатку. Отпустите — мяч полетит в кольцо.',
        {
          hand: true,
        },
      ),
    );
  }

  function practiceResult(made) {
    const p = s.practice;
    if (!p) return;
    if (!made) {
      p.misses++;
      coach(
        p.misses > 2
          ? '<b>Тренер:</b> чем длиннее тянете, тем сильнее бросок. Смотрите на пунктир — он показывает, куда полетит мяч.'
          : '<b>Тренер:</b> почти! Попробуйте ещё раз — чуть сильнее или слабее.',
        { hand: p.misses > 2 },
      );
      return;
    }
    try {
      localStorage.setItem(TUTOR_KEY, '1');
    } catch {}
    haptic.ok();
    s.practice = null;
    if (!p.thenPlay) {
      coach('<b>Тренер:</b> отлично, вы готовы! За игру — 30 секунд, каждое попадание даёт +3 секунды, чистое — +5.', {
        skip: false,
      });
      setTimeout(() => {
        $('bb-coach').hidden = true;
        closeGame();
      }, 2600);
      return;
    }
    coach(
      `<b>Тренер:</b> есть! Теперь по-настоящему: 30 секунд, каждое попадание +3 секунды. Ставка ${priceLabel()}.`,
      {
        skip: false,
      },
    );
    setTimeout(() => {
      $('bb-coach').hidden = true;
      s.hoop = null;
      startGame();
    }, 2200);
  }

  function skipPractice() {
    const p = s.practice;
    s.practice = null;
    $('bb-coach').hidden = true;
    try {
      localStorage.setItem(TUTOR_KEY, '1');
    } catch {}
    if (p?.thenPlay) {
      s.hoop = null;
      s.flight = null;
      startGame();
    } else closeGame();
  }

  async function startGame() {
    if (!canAfford()) {
      if (!$('bb-game').hidden) closeGame();
      toast(`Нужно ${priceLabel()} — пополните баланс`, 'err');
      return go('deposit');
    }
    const btn = $('gc-play');
    btn.classList.add('loading');
    audio.unlock();
    try {
      const res = await api('/api/basket/play', { currency: currency() });
      onProfile(res);
      haptic.impact('medium');
      apply(res);
    } catch (e) {
      haptic.err();
      toast(e.message, 'err');
    } finally {
      btn.classList.remove('loading');
    }
  }

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
    $('bb-stake').textContent = 'В игре';
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
    s.practice = null;
    $('bb-coach').hidden = true;
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
    if (!r.width || !r.height) return requestAnimationFrame(resize);
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
    if (p >= 1) return ((s.hoopFrom = null), s.hoop);
    const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    return { x: s.hoopFrom.x + (s.hoop.x - s.hoopFrom.x) * e, y: s.hoopFrom.y + (s.hoop.y - s.hoopFrom.y) * e };
  }

  const timeLeft = () => Math.max(0, s.deadline - serverNow());
  const started = () => serverNow() >= s.startAt;
  const ballReady = () =>
    started() && !s.ended && !s.flight && !s.pendingShot && timeLeft() > 0 && serverNow() >= s.nextShotAt - 120;

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
      frames: sim.frames,
      start: performance.now(),
      settleT: sim.settleT,
      made: sim.made,
      madeT: sim.madeT,
      swish: sim.made && !rimBefore,
      seq,
      popped: false,
      contacts: sim.contacts.slice(),
    };
    s.throwAt = performance.now();
    audio.play('throw', 0.5 + 0.5 * (s.lastPower ?? 0.5));
    haptic.impact('light');
    if (s.practice) {
      $('bb-coach').hidden = true;
      return;
    }
    s.pendingShot = { seq, vx: ivx, vy: ivy, aimMs, samples };
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
      if (e.code === undefined && attempt < 4)
        return setTimeout(() => sendShot(body, attempt + 1), 600 * (attempt + 1));
      s.pendingShot = null;
      if (s.flight?.seq === body.seq) s.flight.rejected = true;
      if (e.code !== 'TIME_UP' && e.code !== 'NO_MATCH') toast(e.message, 'err');
      refresh();
    }
  }

  function applyShotResult(r) {
    s.score = r.score;
    s.deadline = r.deadline;
    $('bb-score').textContent = s.score;
    if (r.made) {
      s.net = 1;
      s.flash = 1;
      s.popups.push({
        t: performance.now(),
        x: r.shotHoop.x,
        y: r.shotHoop.y,
        swish: r.swish,
        bonus: r.bonusMs / 1000,
      });
      const pill = $('bb-score').parentElement;
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
      audio.play('crowd', r.swish ? 1 : 0.55, r.swish ? 1.04 : 1);
      haptic.ok();
    }
    if (r.hoop.x !== s.hoop.x || r.hoop.y !== s.hoop.y) setTimeout(() => setHoop(r.hoop, true), 350);
  }

  function renderResultSheet() {
    const st = s.st;
    const att = st?.attempts?.find((a) => a.id === s.gameId);
    if (!att || att.status !== 'done' || !st.today) return;
    const el = $('bb-result');
    const t = st.today;
    const myId = me()?.id;
    const best = t.me && att.score >= t.me.score && att.score > 0;
    const sub = t.me
      ? `Ваше место сегодня — <b>#${t.me.place}</b> из ${fmt(t.players)} · лучший результат ${fmt(t.me.score)}`
      : 'Наберите хотя бы 1 очко, чтобы попасть в таблицу дня';
    const html = `<div class="res-title">${fmt(att.score)} ${plural(att.score, 'очко', 'очка', 'очков')}</div>
      <div class="res-sub">${best ? '🔥 Ваш лучший результат дня! ' : ''}${sub}</div>
      <div class="res-list">${
        t.top
          .slice(0, 3)
          .map((r) => lbRow(r, myId))
          .join('') || ''
      }</div>
      <div class="res-wait">🏆 Первое место в 00:00 МСК получает <b>${fmt(t.prize)} ⭐</b></div>
      <div class="dock-row"><button class="btn secondary" data-res="close">Готово</button>
      <button class="btn primary" data-res="again" style="flex:1">Ещё раз · ${priceLabel()}</button></div>`;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
    if (el.hidden) {
      el.hidden = false;
      $('bb-overlay').hidden = true;
      if (best) haptic.ok();
    }
  }

  function frame(t) {
    s.raf = requestAnimationFrame(frame);
    const v = s.view;
    const ctx = $('bb-canvas').getContext('2d');
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    if (s.bg) ctx.drawImage(s.bg, 0, 0, v.cw, v.ch);
    if (!s.hoop) return;
    drawScoreboard(ctx, t);

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
      if (s.practice && !f.popped && ((f.made && el >= f.madeT) || el >= f.settleT)) {
        f.popped = true;
        if (f.made) {
          s.net = 1;
          s.flash = 1;
          s.popups.push({ t: performance.now(), x: s.hoop.x, y: s.hoop.y, swish: f.swish, bonus: 0 });
          audio.play('crowd', 0.7);
          $('bb-score').textContent = '1';
        }
        practiceResult(f.made);
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

  function renderArena(v) {
    const c = document.createElement('canvas');
    c.width = Math.round(v.cw * v.dpr);
    c.height = Math.round(v.ch * v.dpr);
    const g = c.getContext('2d');
    g.scale(v.dpr, v.dpr);
    const fy = v.oy;
    const sc = v.scale;
    const wall = g.createLinearGradient(0, 0, 0, fy);
    wall.addColorStop(0, '#120a24');
    wall.addColorStop(0.55, '#1d1036');
    wall.addColorStop(1, '#2a1546');
    g.fillStyle = wall;
    g.fillRect(0, 0, v.cw, fy);
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
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const standTop = fy - sc * 4.6;
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const y = standTop + (r / rows) * (fy - sc * 0.7 - standTop);
      const size = sc * (0.2 + (r / rows) * 0.12);
      const shade = 22 + r * 5;
      for (let x = -size + (r % 2) * size; x < v.cw + size; x += size * 2.1) {
        const jx = x + (rnd() - 0.5) * size * 0.6;
        const jy = y + (rnd() - 0.5) * size * 0.5;
        const hue =
          rnd() < 0.15 ? `rgb(${shade + 40},${shade + 10},${shade + 70})` : `rgb(${shade + 14},${shade},${shade + 36})`;
        g.fillStyle = hue;
        g.beginPath();
        g.arc(jx, jy, size * 0.55, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(jx, jy + size * 1.25, size * 0.95, size * 0.75, 0, Math.PI, 0);
        g.fill();
        if (rnd() < 0.06) {
          g.fillStyle = 'rgba(255,235,180,0.75)';
          g.fillRect(jx + size * 0.4, jy - size * 0.2, 2, 3);
        }
      }
    }
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
    const vig = g.createRadialGradient(v.cw / 2, v.ch * 0.45, v.ch * 0.25, v.cw / 2, v.ch * 0.45, v.ch * 0.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vig;
    g.fillRect(0, 0, v.cw, v.ch);
    return c;
  }

  let lastSec = null;
  function drawScoreboard(ctx, t) {
    const v = s.view;
    const left =
      s.practice || s.deadline === Infinity ? 30_000 : s.ended ? 0 : started() ? timeLeft() : s.deadline - s.startAt;
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
    const pulse = hot ? 1 + 0.12 * Math.max(0, 1 - (t % 1000) / 300) : 1;
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

  function drawBoard(ctx, h) {
    const sc = s.view.scale;
    const x0 = X(h.x - WORLD.BOARD_HALF);
    const x1 = X(h.x + WORLD.BOARD_HALF);
    const y0 = Y(h.y + WORLD.BOARD_TOP);
    const y1 = Y(h.y - 0.12);
    const w = x1 - x0;
    const hh = y1 - y0;
    const glow = ctx.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2, 0, (x0 + x1) / 2, (y0 + y1) / 2, sc * 2);
    glow.addColorStop(0, 'rgba(170,130,255,0.18)');
    glow.addColorStop(1, 'rgba(170,130,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x0 - sc * 2, y0 - sc * 2, w + sc * 4, hh + sc * 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, x0 + 3, y0 + 5, w, hh, sc * 0.06);
    ctx.fill();
    ctx.fillStyle = '#2a2140';
    roundRect(ctx, x0, y0, w, hh, sc * 0.06);
    ctx.fill();
    const inset = Math.max(3, sc * 0.07);
    const glass = ctx.createLinearGradient(x0, y0, x1, y1);
    glass.addColorStop(0, '#f6f4ff');
    glass.addColorStop(1, '#d9e4f2');
    ctx.fillStyle = glass;
    roundRect(ctx, x0 + inset, y0 + inset, w - inset * 2, hh - inset * 2, sc * 0.03);
    ctx.fill();
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
    const qw = sc * 0.62;
    const qh = sc * 0.5;
    ctx.strokeStyle = '#2a2140';
    ctx.lineWidth = Math.max(2, sc * 0.06);
    ctx.strokeRect(X(h.x) - qw / 2, Y(h.y) - qh - sc * 0.06, qw, qh);
  }

  const RIM_RY = 0.075;
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
    ctx.fillStyle = '#ffd8cc';
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (i / 6);
      ctx.beginPath();
      ctx.arc(
        X(h.x) + Math.cos(a) * WORLD.RIM_HALF * sc,
        Y(h.y) + Math.sin(a) * RIM_RY * sc,
        Math.max(1, sc * 0.025),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

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

  function drawPlayer(ctx, t, holdsBall) {
    const sc = s.view.scale;
    const C = {
      skin: '#c88b5d',
      skinDark: '#9c6340',
      jersey: '#f4f6fb',
      jerseyDark: '#cdd5e6',
      navy: '#1c2650',
      navyDark: '#111834',
      gold: '#f4b93a',
      hair: '#201712',
      shoe: '#f6f7fb',
      shoeDark: '#c9d0df',
    };
    const baseX = 0.95;
    const aiming = !!s.aim;
    const sinceThrow = (t - s.throwAt) / 1000;
    const throwing = sinceThrow < 0.45;
    const idle = holdsBall && !aiming && !throwing;
    const P = (p) => [X(p[0]), Y(p[1])];
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const smooth = (v) => v * v * (3 - 2 * v);

    const period = 0.56;
    const ph = ((t / 1000) % period) / period;
    const hand = 1.08;
    const dribY = idle ? hand - (hand - WORLD.BALL_R) * (ph < 0.5 ? (ph * 2) ** 2 : (2 - ph * 2) ** 2) : 0;
    if (idle) {
      const hit = ph >= 0.5 && s.lastPh < 0.5;
      if (hit && ballReady()) audio.play('bounce', 0.28);
      s.lastPh = ph;
    }
    const power = aiming ? (s.aim?.power ?? 0) : 0;
    const crouch = aiming ? 0.08 + power * 0.08 : 0;
    const tk = clamp01(sinceThrow / 0.45);
    const lift = throwing ? Math.sin(Math.PI * tk) * 0.09 : 0;
    const bob = idle ? Math.cos(ph * Math.PI * 2) * 0.02 : 0;
    const breathe = !idle && !aiming && !throwing ? Math.sin(t / 650) * 0.008 : 0;
    const armsUp = aiming ? 1 : !holdsBall || throwing ? 1 - smooth(clamp01((sinceThrow - 0.3) / 0.5)) : 0;

    const hipY = (idle ? 1.02 : 1.08) - crouch * 0.8 + bob + lift + breathe;
    const lean = idle ? 0.2 : aiming ? -0.06 + crouch * 0.3 : 0.1 - armsUp * 0.08;
    const hipC = [baseX - 0.03 - crouch * 0.25, hipY];
    const torsoLen = 0.78;
    const u = [Math.sin(lean), Math.cos(lean)];
    const n = [u[1], -u[0]];
    const T = (a, b) => [hipC[0] + u[0] * torsoLen * a + n[0] * b, hipC[1] + u[1] * torsoLen * a + n[1] * b];
    const rise = armsUp * 0.07;
    const shN = T(0.88 + rise, 0.02);
    const shF = T(0.88 + rise, -0.07);
    const headC = T(1.32 + rise * 0.3, 0.04 - armsUp * 0.04);
    const headR = 0.16;

    const ankleN = [baseX + 0.15, 0.1 + lift];
    const ankleF = [baseX - 0.17, 0.1 + lift];
    const hipN = T(0.02, 0.05);
    const hipF = T(0.02, -0.06);
    const [kneeN] = playerIk(hipN, ankleN, 0.53, 0.5, 1);
    const [kneeF] = playerIk(hipF, ankleF, 0.53, 0.5, 1);

    let ballPos = null;
    let nearT;
    let farT;
    let nearDir = null;
    if (aiming) {
      ballPos = { x: WORLD.START.x, y: WORLD.START.y };
      nearT = [WORLD.START.x - 0.2, WORLD.START.y - 0.17];
      farT = [WORLD.START.x - 0.24, WORLD.START.y - 0.04];
      nearDir = Math.atan2(0.17, 0.2);
    } else if (throwing || !holdsBall) {
      const a = smooth(clamp01(Math.max(0, sinceThrow) / 0.16));
      const back = 1 - armsUp;
      const rel = [WORLD.START.x - 0.2, WORLD.START.y - 0.17];
      const fol = [shN[0] + 0.5, shN[1] + 0.52];
      nearT = mix(mix(rel, fol, a), [baseX + 0.1, hipY - 0.04], back);
      farT = mix(
        mix([WORLD.START.x - 0.24, WORLD.START.y - 0.04], [shF[0] + 0.42, shF[1] + 0.38], a),
        [baseX - 0.02, hipY - 0.02],
        back,
      );
      nearDir = back > 0.5 ? null : 0.75 - a * 1.9;
    } else {
      ballPos = { x: baseX + 0.48, y: dribY };
      nearT = [baseX + 0.43, Math.max(hand + 0.1, dribY + WORLD.BALL_R + 0.09)];
      farT = [baseX + 0.24, hipY + 0.2 + bob];
      nearDir = -1.35;
    }
    const [elbowN, wristN] = playerIk(shN, nearT, 0.4, 0.37, -1);
    const [elbowF, wristF] = playerIk(shF, farT, 0.4, 0.37, -1);
    const handDir = (elbow, wrist, d) => d ?? Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
    const handTip = (wrist, ang) => [wrist[0] + Math.cos(ang) * 0.1, wrist[1] + Math.sin(ang) * 0.1];
    const R = (v) => v * sc;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(X(baseX), Y(0) + 2, sc * (0.44 - lift), sc * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    const farHandAng = handDir(elbowF, wristF, aiming ? nearDir + 0.3 : null);
    playerChain(
      ctx,
      [P(shF), P(elbowF), P(wristF), P(handTip(wristF, farHandAng))],
      [R(0.07), R(0.055), R(0.042), R(0.038)],
      null,
      C.skinDark,
    );

    playerChain(ctx, [P(hipF), P(kneeF), P(ankleF)], [R(0.1), R(0.075), R(0.048)], null, C.skinDark);
    playerShoe(ctx, sc, P, ankleF, C.shoeDark, C);
    playerChain(ctx, [P(hipF), P(mix(hipF, kneeF, 0.55))], [R(0.15), R(0.135)], null, C.navyDark);

    playerChain(ctx, [P(hipN), P(kneeN), P(ankleN)], [R(0.105), R(0.078), R(0.05)], C.skin, C.skinDark);
    ctx.fillStyle = C.shoe;
    playerCapsule(ctx, P(ankleN), P(mix(ankleN, kneeN, 0.12)), R(0.055), R(0.055));
    playerShoe(ctx, sc, P, ankleN, C.shoe, C);

    playerChain(ctx, [P(T(0.86, 0.02)), P(mix(T(0.9, 0.03), headC, 0.7))], [R(0.07), R(0.062)], C.skin, C.skinDark);

    const J = (a, b) => P(T(a, b));
    const jersey = () => {
      ctx.beginPath();
      ctx.moveTo(...J(-0.05, -0.19));
      ctx.lineTo(...J(-0.05, 0.2));
      ctx.quadraticCurveTo(...J(0.32, 0.25), ...J(0.62, 0.24));
      ctx.lineTo(...J(0.7, 0.18));
      ctx.quadraticCurveTo(...J(0.86, 0.12), ...J(0.98, 0.11));
      ctx.quadraticCurveTo(...J(0.86, 0.02), ...J(0.98, -0.08));
      ctx.lineTo(...J(0.98, -0.17));
      ctx.quadraticCurveTo(...J(0.82, -0.17), ...J(0.68, -0.24));
      ctx.quadraticCurveTo(...J(0.35, -0.25), ...J(-0.05, -0.19));
      ctx.closePath();
    };
    jersey();
    ctx.fillStyle = C.jersey;
    ctx.fill();
    ctx.save();
    jersey();
    ctx.clip();
    ctx.fillStyle = C.jerseyDark;
    ctx.beginPath();
    ctx.moveTo(...J(-0.2, -0.3));
    ctx.lineTo(...J(1.1, -0.3));
    ctx.lineTo(...J(1.1, -0.1));
    ctx.lineTo(...J(-0.2, -0.07));
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(...J(-0.2, 0.15));
    ctx.lineTo(...J(1.1, 0.15));
    ctx.lineTo(...J(1.1, 0.12));
    ctx.lineTo(...J(-0.2, 0.12));
    ctx.fill();
    ctx.restore();
    jersey();
    ctx.strokeStyle = C.navy;
    ctx.lineWidth = Math.max(1, sc * 0.03);
    ctx.stroke();
    const num = P(T(0.52, 0.04));
    ctx.save();
    ctx.translate(num[0], num[1]);
    ctx.rotate(lean);
    ctx.font = `900 ${Math.round(sc * 0.27)}px -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1, sc * 0.035);
    ctx.strokeStyle = C.gold;
    ctx.strokeText('7', 0, 0);
    ctx.fillStyle = C.navy;
    ctx.fillText('7', 0, 0);
    ctx.restore();

    playerChain(ctx, [P(T(0.06, -0.02)), P(T(0.06, 0.06))], [R(0.195), R(0.195)], C.navy, C.navyDark);
    playerChain(ctx, [P(hipN), P(mix(hipN, kneeN, 0.54))], [R(0.15), R(0.135)], C.navy, C.navyDark);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(1, sc * 0.035);
    ctx.beginPath();
    ctx.moveTo(...P(mix(T(0.16, 0.0), hipN, 0.2)));
    ctx.lineTo(...P(mix(hipN, kneeN, 0.5)));
    ctx.stroke();
    ctx.fillStyle = C.navyDark;
    ctx.beginPath();
    ctx.moveTo(...J(0.17, -0.2));
    ctx.lineTo(...J(0.17, 0.21));
    ctx.lineTo(...J(0.11, 0.21));
    ctx.lineTo(...J(0.11, -0.2));
    ctx.fill();

    playerHead(ctx, P(headC), R(headR), lean * 0.5 - (aiming ? 0.25 : 0), C);

    if (ballPos && holdsBall) drawBall(ctx, ballPos.x, ballPos.y, t / 260, ballReady() ? spawn(t) : 1);

    const nearHandAng = handDir(elbowN, wristN, nearDir);
    playerChain(ctx, [P(shN), P(elbowN), P(wristN)], [R(0.078), R(0.06), R(0.045)], C.skin, C.skinDark);
    ctx.fillStyle = C.gold;
    playerCapsule(ctx, P(mix(elbowN, wristN, 0.78)), P(mix(elbowN, wristN, 0.92)), R(0.05), R(0.048));
    playerChain(ctx, [P(wristN), P(handTip(wristN, nearHandAng))], [R(0.046), R(0.042)], C.skin, C.skinDark);
    ctx.restore();
    if (!holdsBall) s.readySince = 0;
  }

  function playerIk(a, b, l1, l2, dir) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.max(1e-4, Math.min(Math.hypot(dx, dy), (l1 + l2) * 0.999));
    const c = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const ang = Math.atan2(dy, dx) + dir * Math.acos(c);
    const j = [a[0] + Math.cos(ang) * l1, a[1] + Math.sin(ang) * l1];
    const e = Math.atan2(b[1] - j[1], b[0] - j[0]);
    return [j, [j[0] + Math.cos(e) * l2, j[1] + Math.sin(e) * l2]];
  }

  function playerCapsule(ctx, a, b, ra, rb) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.beginPath();
    ctx.arc(a[0], a[1], ra, ang + Math.PI / 2, ang + Math.PI * 1.5);
    ctx.arc(b[0], b[1], rb, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }

  function playerChain(ctx, pts, radii, light, dark) {
    ctx.fillStyle = dark;
    for (let i = 0; i < pts.length - 1; i++) playerCapsule(ctx, pts[i], pts[i + 1], radii[i], radii[i + 1]);
    if (!light) return;
    ctx.fillStyle = light;
    for (let i = 0; i < pts.length - 1; i++) {
      const o = Math.min(radii[i], radii[i + 1]) * 0.24;
      playerCapsule(
        ctx,
        [pts[i][0] - o * 0.5, pts[i][1] - o],
        [pts[i + 1][0] - o * 0.5, pts[i + 1][1] - o],
        radii[i] * 0.74,
        radii[i + 1] * 0.74,
      );
    }
  }

  function playerShoe(ctx, sc, P, ankle, fill, C) {
    const [hx, top] = P([ankle[0] - 0.09, ankle[1] + 0.05]);
    const [tx, bottom] = P([ankle[0] + 0.25, ankle[1] - 0.1]);
    const [cx] = P([ankle[0] + 0.06, 0]);
    const toeTop = bottom - sc * 0.1;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(hx + sc * 0.03, bottom);
    ctx.lineTo(tx - sc * 0.04, bottom);
    ctx.quadraticCurveTo(tx + sc * 0.01, bottom, tx, toeTop + sc * 0.04);
    ctx.quadraticCurveTo(tx - sc * 0.03, toeTop, cx + sc * 0.02, top + sc * 0.03);
    ctx.lineTo(hx + sc * 0.02, top);
    ctx.quadraticCurveTo(hx - sc * 0.01, top + sc * 0.04, hx, bottom - sc * 0.03);
    ctx.quadraticCurveTo(hx, bottom, hx + sc * 0.03, bottom);
    ctx.fill();
    ctx.fillStyle = C.navy;
    roundRect(ctx, hx - sc * 0.005, bottom - sc * 0.035, tx - hx + sc * 0.01, sc * 0.04, sc * 0.02);
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(1, sc * 0.025);
    ctx.beginPath();
    ctx.moveTo(hx + sc * 0.05, bottom - sc * 0.07);
    ctx.quadraticCurveTo(cx + sc * 0.04, bottom - sc * 0.06, cx + sc * 0.08, top + sc * 0.06);
    ctx.stroke();
  }

  function playerHead(ctx, c, r, tilt, C) {
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.rotate(tilt);
    ctx.fillStyle = C.skin;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.42, r * 0.55, r * 0.5, r * 0.42, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.88, -r * 0.05);
    ctx.lineTo(r * 1.08, r * 0.25);
    ctx.lineTo(r * 0.85, r * 0.3);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.05, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = C.hair;
    ctx.beginPath();
    ctx.moveTo(-r * 1.2, r * 0.45);
    ctx.lineTo(-r * 0.45, r * 0.3);
    ctx.lineTo(-r * 0.25, -r * 0.3);
    ctx.lineTo(r * 1.2, -r * 0.42);
    ctx.lineTo(r * 1.2, -r * 1.2);
    ctx.lineTo(-r * 1.2, -r * 1.2);
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(-r * 1.2, -r * 0.22);
    ctx.lineTo(r * 1.2, -r * 0.48);
    ctx.lineTo(r * 1.2, -r * 0.2);
    ctx.lineTo(-r * 1.2, r * 0.06);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.skinDark;
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, r * 0.12, r * 0.16, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.hair;
    ctx.beginPath();
    ctx.arc(r * 0.55, r * 0.08, Math.max(0.8, r * 0.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

  function tickClock() {
    const ov = $('bb-overlay');
    if (s.practice || (!s.gameId && !$('bb-coach').hidden)) {
      ov.hidden = true;
      ov.dataset.k = 'none';
      return;
    }
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

  function bind() {
    document.querySelector('[data-game="basket"]').addEventListener('click', () => {
      audio.unlock();
      go('basket');
    });
    $('bb-history-btn').addEventListener('click', () => go('basket-history'));
    $('bb-howto').addEventListener('click', () => startPractice(false));
    $('gc-play').addEventListener('click', () => {
      if (s.st?.session) return apply(s.st);
      if (!tutorSeen()) return startPractice(true);
      startGame();
    });
    $('bb-coach-skip').addEventListener('click', skipPractice);
    $('bb-result').addEventListener('click', (e) => {
      const act = e.target.closest('[data-res]')?.dataset.res;
      if (act === 'close') closeGame();
      if (act === 'again') {
        closeGame();
        setTimeout(startGame, 250);
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
    setCurrency() {
      if (s.st) renderGamesTab();
    },
    show() {
      s.active = true;
      refresh();
      if (!s.gameId) setPoll(5000);
    },
    hide() {
      s.active = false;
      if (!s.gameId) setPoll(0);
    },
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
