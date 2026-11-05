// Roulette Arena — клиент мини-аппа.
// Всё состояние раунда приходит с сервера (SSE). Клиент только рисует и анимирует.

const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const STAR = '<svg class="star"><use href="#i-star"/></svg>';
const PALETTE = ['#8b6cff', '#f5bf4f', '#3ccfb4', '#ff7b6e', '#5aa9ff', '#e879c8', '#a5d85c', '#ffa45b', '#7fe0f0', '#c4b3ff'];
const BET_STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const state = {
  initData: tg?.initData || '',
  devUser: null,
  config: { minBet: 1, minDeposit: 1, minWithdraw: 50, withdrawFee: 0.1, maxAmount: 1_000_000, supportUsername: '' },
  me: null,
  withdrawals: [],
  round: null,
  clockOffset: 0,
  view: 'roulette',
  backTo: 'roulette',
  shownBalance: 0,
};

// ---------- Telegram ----------
function setupTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  const at = (v) => tg.isVersionAtLeast?.(v);
  if (at('7.7')) tg.disableVerticalSwipes();
  if (at('6.1')) {
    tg.setHeaderColor('#0b0b10');
    tg.setBackgroundColor('#0b0b10');
  }
  if (at('7.10')) tg.setBottomBarColor('#0f0f15');
  const applyInsets = () => {
    const s = tg.safeAreaInset ?? {};
    const c = tg.contentSafeAreaInset ?? {};
    document.documentElement.style.setProperty('--tg-safe-top', `${(s.top ?? 0) + (c.top ?? 0)}px`);
    document.documentElement.style.setProperty('--tg-safe-bottom', `${(s.bottom ?? 0) + (c.bottom ?? 0)}px`);
  };
  applyInsets();
  tg.onEvent('safeAreaChanged', applyInsets);
  tg.onEvent('contentSafeAreaChanged', applyInsets);
  if (at('6.1')) tg.BackButton.onClick(goBack);
}

const supports = (v) => !!tg?.isVersionAtLeast?.(v);
const hf = () => (supports('6.1') ? tg.HapticFeedback : null);
const haptic = {
  tap: () => hf()?.selectionChanged(),
  impact: (s = 'light') => hf()?.impactOccurred(s),
  ok: () => hf()?.notificationOccurred('success'),
  err: () => hf()?.notificationOccurred('error'),
};

// ---------- API ----------
async function api(path, body) {
  const headers = { 'content-type': 'application/json' };
  if (state.initData) headers.authorization = `tma ${state.initData}`;
  else if (state.devUser) headers['x-dev-user'] = encodeURIComponent(JSON.stringify(state.devUser));
  const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (data.error === 'BLOCKED') showBlocked();
  if (!res.ok) throw Object.assign(new Error(data.message || 'Ошибка сети'), { code: data.error });
  return data;
}

function applyProfile({ user, withdrawals }) {
  state.me = user;
  state.withdrawals = withdrawals ?? state.withdrawals;
  renderMe();
  renderWithdrawals();
  updateBetButton();
  updateWithdrawForm();
}

const refreshMe = () => api('/api/me', {}).then(applyProfile).catch(() => {});

// ---------- Общие элементы ----------
function avatarHtml(user, cls = '') {
  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || '?';
  const initials = name.replace(/^@/, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const photo = user.photo;
  return `<div class="avatar ${cls}">${
    photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${esc(initials)}'))">` : esc(initials)
  }</div>`;
}

/** Заменяет аватар с данным id новым (фото или инициалы), сохраняя id. */
function setAvatar(id, user, cls) {
  const tmp = document.createElement('div');
  tmp.innerHTML = avatarHtml(user, cls);
  const fresh = tmp.firstElementChild;
  fresh.id = id;
  $(id).replaceWith(fresh);
}

let toastTimer;
function toast(text, kind = 'ok') {
  const icon = { ok: 'i-check', err: 'i-alert', win: 'i-star' }[kind];
  const el = $('toast');
  el.className = `toast ${kind}`;
  el.innerHTML = `<svg><use href="#${icon}"/></svg><span>${esc(text)}</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function animateNumber(el, from, to, ms = 600) {
  if (from === to) return (el.textContent = fmt(to));
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function busy(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

const digits = (input) => {
  const v = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
  if (v !== input.value) input.value = v;
  return v ? Math.min(Number(v), state.config.maxAmount) : 0;
};

// ---------- Навигация ----------
// Вкладки меню: рулетка, бонусы, профиль. Пополнение и вывод — подстраницы:
// открываются из профиля или кнопкой «+» у баланса, «назад» возвращает туда, откуда пришли.
const SUBPAGES = new Set(['deposit', 'withdraw']);

function go(view) {
  if (view === state.view) return;
  if (SUBPAGES.has(view) && !SUBPAGES.has(state.view)) state.backTo = state.view;
  state.view = view;
  document.body.dataset.view = view;
  const tab = SUBPAGES.has(view) ? state.backTo : view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === tab));
  window.scrollTo({ top: 0 });
  if (supports('6.1')) view === 'roulette' ? tg.BackButton.hide() : tg.BackButton.show();
  if (view === 'withdraw' || view === 'profile') refreshMe();
  if (view === 'tasks') loadTasks();
  if (view === 'friends') loadFriends();
  haptic.tap();
}

function goBack() {
  go(SUBPAGES.has(state.view) ? state.backTo || 'roulette' : 'roulette');
}

// ---------- Шапка и профиль ----------
function renderMe() {
  const u = state.me;
  if (!u) return;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Игрок';
  $('me-name').textContent = name;
  $('me-nick').textContent = u.username ? `@${u.username}` : `ID ${u.id}`;
  setAvatar('me-avatar', u);

  const bal = $('balance');
  if (state.shownBalance !== u.balance) {
    if (u.balance > state.shownBalance && state.shownBalance) {
      $('balance-btn').classList.remove('bump');
      void $('balance-btn').offsetWidth;
      $('balance-btn').classList.add('bump');
    }
    animateNumber(bal, state.shownBalance, u.balance);
    state.shownBalance = u.balance;
  }

  setAvatar('pf-avatar', u, 'xl');
  $('pf-name').textContent = name;
  $('pf-nick').textContent = u.username ? `@${u.username}` : '';
  $('pf-nick').hidden = !u.username;
  $('pf-id').textContent = `ID ${u.id}`;
  $('st-games').textContent = fmt(u.games);
  $('st-wins').textContent = fmt(u.wins);
  $('st-losses').textContent = fmt(u.losses);
}

// ---------- Рулетка: геометрия ----------
const R = 80;
const C = 2 * Math.PI * R;
const wheel = {
  rot: 0, // текущий поворот колеса, градусы
  shown: new Map(), // seat → отображаемая доля (для плавного перераспределения секторов)
  tween: null,
  spin: null, // { roundId, from, to, start, duration }
  roundId: null,
  flash: new Map(), // seat → время вспышки сектора (новая ставка)
  fade: 1, // прозрачность аватарок (размытие на скорости)
  pointerSector: null,
  lastHaptic: 0,
  wonAt: null,
  bulbs: [],
};

function sharesOf(round) {
  const total = round.players.reduce((s, p) => s + p.amount, 0);
  return round.players.map((p) => ({ ...p, frac: total ? p.amount / total : 0, color: PALETTE[p.seat % PALETTE.length] }));
}

/** Проценты, которые в сумме дают ровно 100 (метод наибольшего остатка). */
function percents(fracs) {
  const raw = fracs.map((f) => f * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - floor[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left-- > 0) floor[i]++;
  });
  return floor;
}

function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#16130a' : '#ffffff';
}

const SVGNS = 'http://www.w3.org/2000/svg';
const AV_R = 10.5; // радиус аватарки на секторе (единицы viewBox; толщина кольца — 28)
const avatarNodes = new Map(); // id игрока → <g> с аватаркой и процентом

function initialsOf(u) {
  const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '?';
  return name.replace(/^@/, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Аватарка игрока для сектора: создаётся один раз, дальше только двигается. */
function avatarNode(p) {
  let g = avatarNodes.get(p.id);
  if (g) return g;
  g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'sav');
  g.innerHTML =
    `<circle class="sav-ring" r="${AV_R + 1.3}"/><circle class="sav-bg" r="${AV_R}"/>` +
    `<text class="sav-ini">${esc(initialsOf(p))}</text>` +
    (p.photo
      ? `<image href="${esc(p.photo)}" x="${-AV_R}" y="${-AV_R}" width="${AV_R * 2}" height="${AV_R * 2}" clip-path="url(#avclip)" preserveAspectRatio="xMidYMid slice"/>`
      : '') +
    `<g class="sav-pct"><rect y="${AV_R - 3.2}" height="7.6" rx="3.8"/><text y="${AV_R + 0.75}"></text></g>`;
  g.querySelector('image')?.addEventListener('error', (e) => e.target.remove());
  avatarNodes.set(p.id, g);
  return g;
}

/** Номер сектора под стрелкой (для «щелчков» стрелки на границах). */
function sectorUnderPointer(segs, shownTotal) {
  const pos = ((((-wheel.rot) % 360) + 360) % 360) / 360;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    acc += (wheel.shown.get(segs[i].seat) ?? 0) / shownTotal;
    if (pos < acc) return i;
  }
  return segs.length - 1;
}

function drawWheel() {
  const round = state.round;
  const segs = round ? sharesOf(round) : [];
  const finished = round?.status === 'finished';
  const n = segs.length;
  const gap = n > 1 ? 1.4 : 0;
  const pcts = percents(segs.map((s) => s.frac));
  const shownTotal = segs.reduce((a, s) => a + (wheel.shown.get(s.seat) ?? 0), 0) || 1;
  const now = performance.now();
  // Сектор победителя «выдвигается» наружу после остановки
  const pop = finished && wheel.wonAt ? Math.min(1, (now - wheel.wonAt) / 450) : 0;
  const popE = 1 - (1 - pop) ** 3;

  let start = 0;
  let svg = '';
  let flashes = '';
  const visible = new Set();
  const labels = $('labels');
  segs.forEach((s, i) => {
    const f = (wheel.shown.get(s.seat) ?? 0) / shownTotal;
    if (f <= 0) return;
    const isWin = finished && s.id === round.winnerId;
    const r = isWin ? R + 2.5 * popE : R;
    const width = isWin ? 28 + 5 * popE : 28;
    const circ = 2 * Math.PI * r;
    const len = Math.max(0, f * circ - gap);
    const rot = -90 + start * 360 + (gap / circ) * 180;
    const cls = finished ? (isWin ? ` class="win" style="--c:${s.color}"` : ' class="dim"') : '';
    svg += `<circle r="${r}" stroke-width="${width}" stroke="${s.color}" stroke-dasharray="${len} ${circ}" transform="rotate(${rot})"${cls}/>`;
    // Вспышка сектора при новой ставке
    const flashT = wheel.flash.get(s.seat);
    if (flashT && now - flashT < 900) {
      const k = 1 - (now - flashT) / 900;
      flashes += `<circle r="${R}" stroke-width="28" stroke="#fff" opacity="${(0.55 * k * k).toFixed(3)}" stroke-dasharray="${len} ${C}" transform="rotate(${rot})"/>`;
    }
    // Аватарка игрока в середине сектора (подписи не вращаются — всегда ровно)
    if (f >= 0.07) {
      const a = ((start + f / 2) * 360 - 90 + wheel.rot) * (Math.PI / 180);
      const g = avatarNode(s);
      const label = pcts[i] < 1 ? '<1%' : `${pcts[i]}%`;
      const txt = g.querySelector('.sav-pct text');
      if (txt.textContent !== label) {
        txt.textContent = label;
        const w = 5 + label.length * 3.9;
        const rect = g.querySelector('.sav-pct rect');
        rect.setAttribute('x', -w / 2);
        rect.setAttribute('width', w);
      }
      g.style.setProperty('--c', s.color);
      g.setAttribute('transform', `translate(${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)})`);
      g.classList.toggle('dim', finished && !isWin);
      if (g.parentNode !== labels) labels.append(g);
      visible.add(s.id);
    }
    start += f;
  });
  $('sectors').innerHTML = svg;
  $('flashes').innerHTML = flashes;
  for (const [id, g] of avatarNodes) if (!visible.has(id)) g.remove();
  labels.style.opacity = wheel.fade;
  $('wheel-rot').setAttribute('transform', `rotate(${wheel.rot})`);

  // Стрелка «цепляет» границы секторов во время вращения
  if (wheel.spin?.from !== undefined && n > 1) {
    const idx = sectorUnderPointer(segs, shownTotal);
    if (wheel.pointerSector !== null && idx !== wheel.pointerSector) {
      const ptr = document.querySelector('.pointer');
      ptr.classList.remove('flick');
      void ptr.getBoundingClientRect();
      ptr.classList.add('flick');
      if (now - wheel.lastHaptic > 70) {
        haptic.impact('soft');
        wheel.lastHaptic = now;
      }
    }
    wheel.pointerSector = idx;
  }
  if (pop > 0 && pop < 1) requestAnimationFrame(drawWheel);
}

/** Плавное перераспределение секторов при новых ставках. */
function tweenShares() {
  const round = state.round;
  const target = new Map(sharesOf(round).map((s) => [s.seat, s.frac]));
  const from = new Map(wheel.shown);
  for (const seat of target.keys()) if (!from.has(seat)) from.set(seat, 0);
  const t0 = performance.now();
  const ms = from.size ? 650 : 0;
  cancelAnimationFrame(wheel.tween);
  const step = (t) => {
    const p = ms ? Math.min(1, (t - t0) / ms) : 1;
    const e = 1 - (1 - p) ** 3;
    wheel.shown = new Map([...target].map(([seat, f]) => [seat, (from.get(seat) ?? 0) + (f - (from.get(seat) ?? 0)) * e]));
    drawWheel();
    if (p < 1 || [...wheel.flash.values()].some((t2) => t - t2 < 900)) wheel.tween = requestAnimationFrame(step);
  };
  wheel.tween = requestAnimationFrame(step);
}

// ---------- Обод с огоньками ----------
const BULBS = 40;
function drawBulbs() {
  let html = '';
  for (let i = 0; i < BULBS; i++) {
    const a = ((i * 360) / BULBS - 90) * (Math.PI / 180);
    html += `<circle r="1.7" cx="${(98.6 * Math.cos(a)).toFixed(2)}" cy="${(98.6 * Math.sin(a)).toFixed(2)}"/>`;
  }
  $('bulbs').innerHTML = html;
  wheel.bulbs = [...$('bulbs').children];
  setInterval(bulbsTick, 60);
}

/** Узор огоньков зависит от этапа: перелив → бегущие огни → пульс → мерцание → победа. */
function bulbsTick() {
  const r = state.round;
  if (!r || document.hidden || state.view !== 'roulette') return;
  const t = performance.now();
  let on;
  if (r.status === 'waiting') {
    const step = Math.floor(t / 380);
    on = (i) => (i + step) % 5 === 0; // медленный перелив
  } else if (r.status === 'countdown') {
    const left = r.countdownEndsAt - serverNow();
    if (left <= 5000) {
      const beat = left % 1000; // как сердцебиение: два коротких удара в начале каждой секунды
      const lit = beat > 860 || (beat > 640 && beat < 760);
      on = () => lit;
    } else {
      const step = Math.floor(t / 90);
      on = (i) => (i + step) % 8 < 2;
    }
  } else if (r.status === 'spinning') {
    const step = Math.floor(t / 70);
    on = (i) => (i + step) % 2 === 0;
  } else {
    const since = t - (wheel.wonAt ?? t);
    on = () => since > 1300 || Math.floor(since / 160) % 2 === 0; // мигают и загораются цветом победителя
  }
  wheel.bulbs.forEach((b, i) => {
    const v = on(i);
    if (b._on !== v) {
      b._on = v;
      b.classList.toggle('on', v);
    }
  });
}

// ---------- Всплывающие ставки ----------
function betBubble(p, amount, delay) {
  setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'bubble';
    el.style.setProperty('--c', PALETTE[p.seat % PALETTE.length]);
    el.innerHTML = `${avatarHtml(p, 'xs')}<b class="num">+${fmt(amount)}</b>${STAR}<span>${p.id === state.me?.id ? 'вы' : esc(p.name)}</span>`;
    $('bubbles').append(el);
    el.addEventListener('animationend', () => el.remove());
  }, delay);
}

const serverNow = () => Date.now() + state.clockOffset;

/**
 * Траектория вращения: замах назад → разгон → долгое торможение с небольшим перелётом →
 * мягкое возвращение точно в точку, выбранную сервером (у всех игроков одинаково).
 */
const WIND = 0.06; // доля времени на замах
const SETTLE = 0.13; // доля времени на возврат после перелёта
const OVER = 3.2; // градусы перелёта
function spinAngle(s, p) {
  if (p < WIND) return s.from - 14 * Math.sin((Math.PI * p) / WIND);
  const q = (p - WIND) / (1 - WIND);
  const main = 1 - SETTLE;
  if (q < main) return s.from + (s.to + OVER - s.from) * (1 - (1 - q / main) ** 4);
  const k = (q - main) / SETTLE;
  return s.to + (OVER * (1 + Math.cos(Math.PI * k))) / 2;
}

function runSpin() {
  const r = state.round;
  if (wheel.spin?.roundId === r.id) return;
  // Точка landing (доля круга от верха по часовой) должна оказаться под стрелкой.
  const base = wheel.rot;
  const targetMod = (((-r.landing * 360) % 360) + 360) % 360;
  const baseMod = ((base % 360) + 360) % 360;
  const to = base + 360 * 6 + ((targetMod - baseMod + 360) % 360);
  wheel.spin = { roundId: r.id, from: base, to, start: r.spinStartedAt, duration: r.spinMs };
  wheel.pointerSector = null;
  $('wheel').classList.add('spinning');
  let prev = base;
  const frame = () => {
    const s = wheel.spin;
    if (!s || s.roundId !== state.round?.id) return;
    const p = Math.min(1, Math.max(0, (serverNow() - s.start) / s.duration));
    wheel.rot = spinAngle(s, p);
    // На большой скорости аватарки «смазываются» — прозрачнеют
    const speed = Math.abs(wheel.rot - prev);
    prev = wheel.rot;
    const targetFade = speed > 9 ? 0.12 : speed > 5 ? 0.45 : 1;
    wheel.fade += (targetFade - wheel.fade) * 0.25;
    drawWheel();
    if (p < 1) requestAnimationFrame(frame);
    else {
      wheel.fade = 1;
      $('wheel').classList.remove('spinning');
      drawWheel();
    }
  };
  requestAnimationFrame(frame);
}

// ---------- Рулетка: состояние ----------
function onRound(round) {
  const prev = state.round;
  state.clockOffset = round.serverNow - Date.now();
  state.round = round;

  if (prev?.id !== round.id) {
    // Новый раунд: колесо возвращается в исходное положение, секторы собираются заново.
    wheel.rot = 0;
    wheel.shown = new Map();
    wheel.spin = null;
    wheel.wonAt = null;
    wheel.flash.clear();
    $('wheel').classList.remove('spinning');
  }
  // Новые ставки: вспышка сектора и всплывающее «+сумма»
  if (prev?.id === round.id) {
    const before = new Map(prev.players.map((p) => [p.id, p.amount]));
    let k = 0;
    for (const p of round.players) {
      const delta = p.amount - (before.get(p.id) ?? 0);
      if (delta > 0) {
        wheel.flash.set(p.seat, performance.now());
        betBubble(p, delta, k++ * 280);
      }
    }
  }
  if (round.status === 'finished' && !wheel.wonAt) wheel.wonAt = performance.now();
  if (round.status === 'spinning' || round.status === 'finished') {
    if (round.status === 'finished' && !wheel.spin) {
      // Подключились после окончания вращения — сразу ставим колесо в итоговую позицию.
      wheel.rot = (((-round.landing * 360) % 360) + 360) % 360;
      wheel.spin = { roundId: round.id };
    } else runSpin();
  }
  tweenShares();
  renderCenter();
  renderStatus();
  renderPlayers();
  renderFeats();
  updateBetButton();

  const wheelEl = $('wheel');
  const winner = round.status === 'finished' ? sharesOf(round).find((p) => p.id === round.winnerId) : null;
  wheelEl.classList.toggle('won', !!winner);
  wheelEl.style.setProperty('--glow', winner?.color ?? 'var(--accent)');
  wheelEl.style.setProperty('--bulb', winner?.color ?? 'var(--gold)');

  const me = state.me?.id;
  if (prev?.status === 'spinning' && round.status === 'finished' && round.players.some((p) => p.id === me)) {
    refreshMe();
    if (round.winnerId === me) {
      haptic.ok();
      toast(`Вы выиграли ${fmt(round.bank)}`, 'win');
      confetti();
    }
  }
}

/** Карточки «Последняя игра» и «Топ игра дня». */
let featsKey = '';
function renderFeats() {
  const { lastGame, topToday } = state.round;
  const key = `${lastGame?.round}:${topToday?.round}`;
  if (key === featsKey) return;
  const fresh = featsKey !== '';
  featsKey = key;
  const card = (g, cls, icon, label) => {
    const who = g
      ? `<div class="f-row">${avatarHtml(g, 'sm')}<div class="f-who">
          <div class="f-name">${g.id === state.me?.id ? 'Вы' : esc(g.username ? `@${g.username}` : g.name)}</div>
          <div class="f-chance num">${g.chance}%</div></div>
          <div class="f-bank num">+${fmt(g.bank)}${STAR}</div></div>`
      : '<div class="f-empty">Пока нет игр</div>';
    return `<div class="feat ${cls}${fresh ? ' fresh' : ''}"><div class="f-label"><svg><use href="#${icon}"/></svg>${label}</div>${who}</div>`;
  };
  $('feats').innerHTML = card(lastGame, 'f-last', 'i-clock', 'Последняя игра') + card(topToday, 'f-top', 'i-trophy', 'Топ игра дня');
}

/** Праздничный дождь из звёзд при победе. Лёгкий: один canvas, ~1.8 секунды. */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('confetti');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const box = $('wheel').getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const colors = ['#f5bf4f', '#ffd77a', '#8b6cff', '#c4b3ff', '#ffffff'];
  const parts = Array.from({ length: 90 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 6;
    return {
      x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
      r: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0], star: Math.random() < 0.55,
    };
  });
  const star = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  };
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / 1800;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.18;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      if (p.star) star(p.r * 1.4);
      else ctx.fillRect(-p.r / 2, -p.r, p.r, p.r * 2);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

/** Банк над колесом и содержимое центра колеса для каждого этапа раунда. */
let centerKey = '';
function renderCenter() {
  const r = state.round;
  const bankEl = $('bank');
  const prevBank = Number(bankEl.dataset.v || 0);
  if (prevBank !== r.bank) animateNumber(bankEl, prevBank, r.bank, 500);
  bankEl.dataset.v = r.bank;

  const n = r.players.length;
  const inRound = r.players.some((p) => p.id === state.me?.id);
  const key = `${r.id}:${r.status}:${r.status === 'waiting' ? `${n}:${inRound}` : ''}`;
  if (key === centerKey) return;
  centerKey = key;
  const wc = $('wc');
  $('wheel').classList.remove('hot', 'beat');

  if (r.status === 'waiting' && n === 0) {
    wc.innerHTML = '<div class="wc-title">Ставь<br>первым</div>';
  } else if (r.status === 'waiting') {
    wc.innerHTML = `<svg class="wc-icon"><use href="#i-hourglass"/></svg>
      <div class="wc-title">Ждём<br>соперника</div>`;
  } else if (r.status === 'countdown') {
    wc.innerHTML = '<div class="wc-timer" id="wc-timer">15</div><div class="wc-sub">секунд</div>';
    tickCountdown();
  } else if (r.status === 'spinning') {
    wc.innerHTML = '<svg class="wc-icon"><use href="#i-roulette"/></svg><div class="wc-title">Крутим…</div>';
  } else {
    const w = r.players.find((p) => p.id === r.winnerId) ?? {};
    wc.innerHTML = `${avatarHtml(w)}<div class="wc-name">${w.id === state.me?.id ? 'Вы победили!' : esc(w.name)}</div>
      <div class="wc-prize num">+${fmt(r.bank)}${STAR}</div>`;
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Доля текущего игрока в раунде, % (или null, если он не участвует). */
function myChance(r) {
  const segs = sharesOf(r);
  const i = segs.findIndex((p) => p.id === state.me?.id);
  return i < 0 ? null : percents(segs.map((x) => x.frac))[i];
}

/** Строка под колесом: подсказка или ваш шанс. */
function renderStatus() {
  const r = state.round;
  const chance = myChance(r);
  const pct = chance === null ? '' : `Ваш шанс — <b>${chance < 1 ? '<1' : chance}%</b>`;
  const n = r.players.length;
  let html = '';
  if (r.status === 'waiting') html = pct ? 'Вы в игре · ждём второго игрока' : 'Раунд начнётся после второй ставки';
  else if (r.status === 'countdown') html = pct || `${n} ${plural(n, 'игрок', 'игрока', 'игроков')} · успейте сделать ставку`;
  else if (r.status === 'spinning') html = 'Определяем победителя…';
  else {
    const w = r.players.find((p) => p.id === r.winnerId);
    html = w?.id === state.me?.id ? '<b>Банк ваш!</b> Новый раунд скоро' : `<b>${esc(w?.name ?? '')}</b> забирает банк · новый раунд скоро`;
  }
  $('caption').innerHTML = html;
  if (r.status !== 'countdown') $('cd-ring').style.strokeDashoffset = CD_LEN;
}

const CD_LEN = 2 * Math.PI * 61; // длина кольца отсчёта вокруг центра
let countdownLoop = false;
let lastSecond = null;
/** Отсчёт в центре колеса; последние 5 секунд — красные цифры с «сердцебиением». */
function tickCountdown() {
  if (countdownLoop) return;
  countdownLoop = true;
  const frame = () => {
    const r = state.round;
    if (r?.status !== 'countdown') {
      countdownLoop = false;
      lastSecond = null;
      return;
    }
    const left = Math.max(0, r.countdownEndsAt - serverNow());
    const sec = Math.ceil(left / 1000);
    $('cd-ring').style.strokeDashoffset = CD_LEN * (1 - left / r.countdownMs);
    const t = $('wc-timer');
    if (t && sec !== lastSecond) {
      t.textContent = sec;
      const hot = sec <= 5 && sec > 0;
      t.classList.toggle('hot', hot);
      $('wheel').classList.toggle('hot', hot);
      if (hot) {
        for (const el of [t, $('wheel')]) {
          el.classList.remove('beat');
          void el.offsetWidth; // перезапуск анимации ровно на смене секунды
          el.classList.add('beat');
        }
        haptic.impact(sec <= 2 ? 'medium' : 'light');
      }
      lastSecond = sec;
    }
    if (left > 0) requestAnimationFrame(frame);
    else countdownLoop = false;
  };
  requestAnimationFrame(frame);
}

function renderPlayers() {
  const r = state.round;
  const segs = sharesOf(r);
  const pcts = percents(segs.map((s) => s.frac));
  const finished = r.status === 'finished';
  const rows = segs
    .map((s, i) => ({ ...s, pct: pcts[i] }))
    .sort((a, b) => b.amount - a.amount)
    .map((p) => {
      const cls = finished ? (p.id === r.winnerId ? ' winner' : ' dim') : '';
      const you = p.id === state.me?.id ? '<small>вы</small>' : '';
      return `<div class="player${cls}" style="--c:${p.color};--w:${(p.frac * 100).toFixed(2)}%" data-id="${p.id}">
        ${avatarHtml(p, 'sm')}
        <div class="p-main"><div class="p-name">${esc(p.name)}${you}</div>
        <div class="p-amount num">${fmt(p.amount)}${STAR}</div></div>
        <div class="p-pct num">${p.pct < 1 ? '<1' : p.pct}%</div></div>`;
    });
  // Обновляем строки, не пересоздавая уже показанные (без мерцания аватаров)
  const box = $('players');
  const existing = new Map([...box.children].map((el) => [el.dataset.id, el]));
  const html = rows.join('');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const fresh = [...tmp.children];
  box.replaceChildren(
    ...fresh.map((el) => {
      const old = existing.get(el.dataset.id);
      if (!old) return el;
      old.className = el.className;
      old.style.cssText = el.style.cssText;
      old.querySelector('.p-main').replaceWith(el.querySelector('.p-main'));
      old.querySelector('.p-pct').replaceWith(el.querySelector('.p-pct'));
      return old;
    }),
  );
}

// ---------- Ставка ----------
function betAmount() {
  return digits($('bet-input'));
}

function updateBetButton() {
  const btn = $('bet-btn');
  if (btn.classList.contains('loading')) return;
  const r = state.round;
  const amount = betAmount();
  const open = r && (r.status === 'waiting' || r.status === 'countdown');
  if (!open) {
    btn.textContent = 'Идёт розыгрыш';
    btn.disabled = true;
  } else if (state.me && amount > state.me.balance) {
    btn.textContent = 'Пополнить';
    btn.disabled = false;
  } else {
    btn.textContent = 'Сделать ставку';
    btn.disabled = amount < state.config.minBet;
  }
  syncChips();
}

/** Подсветка быстрой суммы, совпадающей с введённой. */
function syncChips() {
  const v = betAmount();
  const max = state.me?.balance ?? 0;
  document.querySelectorAll('#bet-chips button').forEach((b) => {
    const val = b.dataset.chip === 'max' ? max : Number(b.dataset.chip);
    b.classList.toggle('on', v > 0 && v === val);
  });
}

function chooseChip(chip) {
  const value = chip === 'max' ? state.me?.balance ?? 0 : Number(chip);
  if (chip === 'max' && !value) return toast('Баланс пуст — пополните его', 'err');
  $('bet-input').value = Math.min(value, state.config.maxAmount);
  haptic.tap();
  updateBetButton();
}

function stepBet(dir) {
  const v = betAmount() || 0;
  const next = dir > 0 ? BET_STEPS.find((s) => s > v) ?? v : [...BET_STEPS].reverse().find((s) => s < v) ?? state.config.minBet;
  $('bet-input').value = next;
  haptic.tap();
  updateBetButton();
}

async function placeBet() {
  const amount = betAmount();
  if (state.me && amount > state.me.balance) return go('deposit');
  const btn = $('bet-btn');
  busy(btn, true);
  try {
    applyProfile(await api('/api/bet', { amount }));
    haptic.impact('medium');
  } catch (e) {
    haptic.err();
    toast(e.message, 'err');
  } finally {
    busy(btn, false);
    updateBetButton();
  }
}

// ---------- Пополнение (Telegram Stars) ----------
function updateDepositForm() {
  const n = digits($('dep-input'));
  $('dep-btn').disabled = n < state.config.minDeposit;
}

async function deposit() {
  const amount = digits($('dep-input'));
  const btn = $('dep-btn');
  if (!supports('6.1') && !state.devUser) return toast('Оплата доступна только в Telegram', 'err');
  busy(btn, true);
  try {
    const res = await api('/api/deposit', { amount });
    if (res.dev) {
      applyProfile(res);
      toast(`Баланс пополнен на ${fmt(amount)} ⭐`);
      $('dep-input').value = '';
      return;
    }
    const { link } = res;
    tg.openInvoice(link, (status) => {
      if (status === 'paid') {
        haptic.ok();
        toast(`Баланс пополнен на ${fmt(amount)} ⭐`);
        $('dep-input').value = '';
        updateDepositForm();
        // Зачисление приходит от Telegram отдельным событием — проверяем несколько раз
        [600, 2000, 5000].forEach((ms) => setTimeout(refreshMe, ms));
      } else if (status === 'failed') {
        haptic.err();
        toast('Оплата не прошла', 'err');
      }
    });
  } catch (e) {
    haptic.err();
    toast(e.message, 'err');
  } finally {
    busy(btn, false);
    updateDepositForm();
  }
}

// ---------- Вывод ----------
function withdrawCalc() {
  const amount = digits($('wd-input'));
  const fee = Math.ceil(amount * state.config.withdrawFee);
  return { amount, fee, total: amount + fee };
}

function updateWithdrawForm() {
  const { amount, fee, total } = withdrawCalc();
  $('wd-amount').innerHTML = `${fmt(amount)}${STAR}`;
  $('wd-fee').innerHTML = `${fmt(fee)}${STAR}`;
  $('wd-total').innerHTML = `${fmt(total)}${STAR}`;
  const hint = $('wd-hint');
  let error = '';
  if (amount && amount < state.config.minWithdraw) error = `Минимальная сумма — ${fmt(state.config.minWithdraw)}`;
  else if (state.me && total > state.me.balance) error = 'Недостаточно звёзд на балансе';
  hint.textContent = error;
  hint.classList.toggle('error', !!error);
  $('wd-btn').disabled = !amount || !!error;
}

function confirmAsync(text) {
  return new Promise((resolve) => (supports('6.2') ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));
}

async function withdraw() {
  const { amount, total } = withdrawCalc();
  const ok = await confirmAsync(`Вывести ${fmt(amount)} ⭐?\nС баланса будет списано ${fmt(total)} ⭐.`);
  if (!ok) return;
  const btn = $('wd-btn');
  busy(btn, true);
  try {
    applyProfile(await api('/api/withdraw', { amount }));
    haptic.ok();
    toast('Заявка отправлена');
    $('wd-input').value = '';
  } catch (e) {
    haptic.err();
    toast(e.message, 'err');
  } finally {
    busy(btn, false);
    updateWithdrawForm();
  }
}

const STATUS = { pending: 'В обработке', sent: 'Отправлено', cancelled: 'Отменено' };
function renderWithdrawals() {
  const list = state.withdrawals;
  const box = $('wd-history');
  if (!list.length) return (box.innerHTML = '');
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  box.innerHTML =
    '<h2>Заявки</h2>' +
    list
      .map(
        (w) => `<div class="wd card">
          <div class="wd-top"><div class="wd-amount num">${fmt(w.amount)}${STAR}</div>
          <span class="chip ${w.status}">${STATUS[w.status]}</span></div>
          <div class="wd-meta">#${w.id} · ${date.format(w.createdAt)} · списано ${fmt(w.total)}</div>
          ${w.status === 'cancelled' && w.reason ? `<div class="wd-reason">Причина: ${esc(w.reason)}</div>` : ''}
        </div>`,
      )
      .join('');
}

// ---------- Задания ----------
const opened = new Set(); // задания, ссылку которых игрок уже открыл в этой сессии

async function loadTasks() {
  try {
    state.tasks = (await api('/api/tasks', {})).tasks;
    renderTasks();
  } catch {}
}

function renderTasks() {
  const tasks = state.tasks ?? [];
  $('tasks-badge').hidden = !tasks.some((t) => !t.done);
  const box = $('tasks');
  if (!tasks.length) {
    box.innerHTML = `<div class="tasks-empty"><div class="ph-icon"><svg><use href="#i-tasks"/></svg></div>
      <div class="ph-title">Новых заданий пока нет</div><div>Загляните позже</div></div>`;
    return;
  }
  const card = (t) => {
    const icon = t.kind === 'subscribe' ? 'i-telegram' : 'i-link';
    const action = t.done
      ? '<span class="t-done" aria-label="Выполнено"><svg><use href="#i-check"/></svg></span>'
      : opened.has(t.id)
        ? `<button class="t-btn check" data-task="${t.id}" data-act="check">Проверить</button>`
        : `<button class="t-btn" data-task="${t.id}" data-act="open">Выполнить</button>`;
    return `<div class="task${t.done ? ' done' : ''}">
      <div class="t-icon"><svg><use href="#${icon}"/></svg></div>
      <div class="t-main"><div class="t-title">${esc(t.title)}</div>
      <div class="t-reward num">+${fmt(t.reward)}${STAR}</div></div>${action}</div>`;
  };
  const todo = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  box.innerHTML =
    todo.map(card).join('') +
    (done.length ? `<div class="section-title">Выполненные</div>${done.map(card).join('')}` : '');
}

async function onTaskAction(btn) {
  const id = Number(btn.dataset.task);
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (btn.dataset.act === 'open') {
    api('/api/tasks/open', { id }).catch(() => {});
    if (/^https:\/\/t\.me\//i.test(task.url) && supports('6.1')) tg.openTelegramLink(task.url);
    else if (supports('6.1')) tg.openLink(task.url);
    else window.open(task.url, '_blank');
    opened.add(id);
    haptic.tap();
    return setTimeout(renderTasks, 400); // кнопка меняется на «Проверить», когда игрок вернётся
  }
  btn.classList.add('loading');
  try {
    const res = await api('/api/tasks/check', { id });
    applyProfile(res);
    state.tasks = res.tasks;
    haptic.ok();
    toast(`Задание выполнено: +${fmt(res.reward)} ⭐`);
  } catch (e) {
    haptic.err();
    toast(e.message, 'err');
    if (e.code === 'ALREADY' || e.code === 'TASK_GONE') return loadTasks();
  }
  renderTasks();
}

// ---------- Друзья ----------
async function loadFriends() {
  try {
    const res = await api('/api/friends', {});
    state.friends = res;
    applyProfile(res);
    renderFriends();
  } catch {}
}

function renderFriends() {
  const f = state.friends;
  if (!f) return;
  $('ref-reward-title').textContent = `+${fmt(f.reward)}`;
  const short = f.link.replace(/^https:\/\//, '');
  const cut = short.indexOf('ref_');
  $('ref-link-head').textContent = short ? (cut > 0 ? short.slice(0, cut) : short) : 'Ссылка появится после запуска бота';
  $('ref-link-tail').textContent = cut > 0 ? short.slice(cut) : '';
  $('ref-count').textContent = fmt(f.count);
  $('ref-earned').textContent = fmt(f.earned);
  $('friends-title').hidden = false;
  $('friends').innerHTML = f.friends.length
    ? f.friends
        .map(
          (fr) => `<div class="friend">${avatarHtml(fr, 'sm')}
            <div class="fr-main"><div class="fr-name">${esc(fr.name)}</div>
            <div class="fr-nick">${fr.username ? `@${esc(fr.username)}` : '&nbsp;'}</div></div>
            ${fr.rewarded ? `<span class="chip sent num">+${fmt(f.reward)} ⭐</span>` : '<span class="chip pending">Ждём подписку</span>'}
          </div>`,
        )
        .join('')
    : '<div class="friends-empty">Пока никого. Отправьте ссылку друзьям — звёзды придут, когда они подпишутся на канал.</div>';
}

async function copyRefLink() {
  const link = state.friends?.link;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: link });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  haptic.ok();
  toast('Ссылка скопирована');
}

function shareRefLink() {
  const link = state.friends?.link;
  if (!link) return;
  const text = 'Залетай в Roulette Arena 🎰 Крути рулетку, обгоняй соперников и забирай весь банк!';
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  haptic.tap();
  supports('6.1') ? tg.openTelegramLink(url) : window.open(url, '_blank');
}

// ---------- Запуск ----------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('round', (e) => onRound(JSON.parse(e.data)));
  es.addEventListener('balance', (e) => {
    if (JSON.parse(e.data).id === state.me?.id) refreshMe();
  });
}

function bindUi() {
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goBack));
  $('gate-link').addEventListener('click', (e) => {
    if (!supports('6.1')) return;
    e.preventDefault();
    tg.openTelegramLink(e.currentTarget.href);
  });
  $('balance-btn').addEventListener('click', () => go('deposit'));
  $('bet-minus').addEventListener('click', () => stepBet(-1));
  $('bet-plus').addEventListener('click', () => stepBet(1));
  $('bet-input').addEventListener('input', updateBetButton);
  $('bet-chips').addEventListener('click', (e) => e.target.dataset.chip && chooseChip(e.target.dataset.chip));
  $('ref-link').addEventListener('click', copyRefLink);
  $('ref-share').addEventListener('click', shareRefLink);
  $('tasks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-task]');
    if (b) onTaskAction(b);
  });
  $('bet-btn').addEventListener('click', placeBet);
  $('dep-input').addEventListener('input', updateDepositForm);
  $('dep-btn').addEventListener('click', deposit);
  $('wd-input').addEventListener('input', updateWithdrawForm);
  $('wd-btn').addEventListener('click', withdraw);
  $('support-btn').addEventListener('click', () => {
    const url = `https://t.me/${state.config.supportUsername}`;
    supports('6.1') ? tg.openTelegramLink(url) : window.open(url, '_blank');
  });
  // Клавиатура открыта — прячем меню, чтобы кнопка действия была рядом с полем
  document.addEventListener('focusin', (e) => e.target.matches('input') && document.body.classList.add('kb'));
  // Убираем с задержкой: иначе при нажатии кнопки поле теряет фокус, панель сдвигается и нажатие «промахивается».
  document.addEventListener('focusout', () =>
    setTimeout(() => !document.activeElement?.matches('input') && document.body.classList.remove('kb'), 250),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshMe();
    if (state.view === 'tasks') renderTasks();
  });
}

async function main() {
  setupTelegram();
  const params = new URLSearchParams(location.search);
  if (!state.initData && params.has('dev')) {
    state.devUser = {
      id: Number(params.get('uid') || 1),
      first_name: params.get('name') || 'Тест',
      username: params.get('nick') || 'tester',
      photo_url: params.get('photo') || '',
    };
  }
  try {
    state.config = { ...state.config, ...(await api('/api/config')) };
  } catch {}
  $('wd-min').textContent = fmt(state.config.minWithdraw);
  $('wb-withdraw-sub').textContent = `От ${fmt(state.config.minWithdraw)} ⭐`;
  $('wd-fee-pct').textContent = Math.round(state.config.withdrawFee * 100);
  $('dep-hint').textContent = `Минимум ${fmt(state.config.minDeposit)} · 1 звезда = 1 на балансе`;
  $('support-btn').hidden = !state.config.supportUsername;

  if (!state.initData && !state.devUser) {
    $('gate').hidden = false;
    if (state.config.botUsername) {
      $('gate-link').href = `https://t.me/${state.config.botUsername}`;
      $('gate-link').hidden = false;
    }
    $('boot').classList.add('hide');
    return;
  }

  bindUi();
  try {
    applyProfile(await api('/api/me', {}));
  } catch (e) {
    if (e.code === 'BLOCKED') return showBlocked();
    toast(e.message, 'err');
  }
  $('app').hidden = false;
  document.body.dataset.view = 'roulette';
  document.querySelector('#view-roulette').classList.add('active');
  drawBulbs();
  connectStream();
  loadTasks();
  updateWithdrawForm();
  updateDepositForm();
  requestAnimationFrame(() => $('boot').classList.add('hide'));
}

function showBlocked() {
  $('app').hidden = true;
  $('gate-title').textContent = 'Аккаунт заблокирован';
  $('gate-text').textContent = 'Если это ошибка, напишите в поддержку';
  if (state.config.supportUsername) {
    $('gate-link').textContent = 'Поддержка';
    $('gate-link').href = `https://t.me/${state.config.supportUsername}`;
    $('gate-link').hidden = false;
  }
  $('gate').hidden = false;
  $('boot').classList.add('hide');
}

main();
