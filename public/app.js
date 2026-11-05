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
  if (at('6.1')) tg.BackButton.onClick(() => go('roulette'));
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
function go(view) {
  if (view === state.view) return;
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.go === view));
  window.scrollTo({ top: 0 });
  if (supports('6.1')) view === 'roulette' ? tg.BackButton.hide() : tg.BackButton.show();
  if (view === 'withdraw' || view === 'profile') refreshMe();
  haptic.tap();
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

function drawWheel() {
  const round = state.round;
  const segs = round ? sharesOf(round) : [];
  const finished = round?.status === 'finished';
  const sectors = $('sectors');
  const labels = $('labels');
  const n = segs.length;
  const gap = n > 1 ? 1.4 : 0;
  const pcts = percents(segs.map((s) => s.frac));
  const shownTotal = segs.reduce((a, s) => a + (wheel.shown.get(s.seat) ?? 0), 0) || 1;

  let start = 0;
  let svg = '';
  let text = '';
  segs.forEach((s, i) => {
    const f = (wheel.shown.get(s.seat) ?? 0) / shownTotal;
    if (f <= 0) return;
    const len = Math.max(0, f * C - gap);
    const dim = finished && s.id !== round.winnerId ? ' class="dim"' : '';
    svg += `<circle r="${R}" stroke="${s.color}" stroke-dasharray="${len} ${C}" transform="rotate(${-90 + start * 360 + (gap / C) * 180})"${dim}/>`;
    if (f >= 0.055) {
      const a = ((start + f / 2) * 360 - 90 + wheel.rot) * (Math.PI / 180);
      const label = pcts[i] < 1 ? '<1%' : `${pcts[i]}%`;
      text += `<text x="${(R * Math.cos(a)).toFixed(2)}" y="${(R * Math.sin(a)).toFixed(2)}" fill="${inkFor(s.color)}"${dim}>${label}</text>`;
    }
    start += f;
  });
  sectors.innerHTML = svg;
  labels.innerHTML = text; // подписи не вращаются вместе с колесом — всегда читаемы
  $('wheel-rot').setAttribute('transform', `rotate(${wheel.rot})`);
}

/** Плавное перераспределение секторов при новых ставках. */
function tweenShares() {
  const round = state.round;
  const target = new Map(sharesOf(round).map((s) => [s.seat, s.frac]));
  const from = new Map(wheel.shown);
  for (const seat of target.keys()) if (!from.has(seat)) from.set(seat, 0);
  const t0 = performance.now();
  const ms = from.size ? 550 : 0;
  cancelAnimationFrame(wheel.tween);
  const step = (t) => {
    const p = ms ? Math.min(1, (t - t0) / ms) : 1;
    const e = 1 - (1 - p) ** 3;
    wheel.shown = new Map([...target].map(([seat, f]) => [seat, (from.get(seat) ?? 0) + (f - (from.get(seat) ?? 0)) * e]));
    drawWheel();
    if (p < 1) wheel.tween = requestAnimationFrame(step);
  };
  wheel.tween = requestAnimationFrame(step);
}

const serverNow = () => Date.now() + state.clockOffset;
const easeSpin = (p) => 1 - (1 - p) ** 4; // быстрый старт и долгое мягкое торможение

function runSpin() {
  const r = state.round;
  if (wheel.spin?.roundId === r.id) return;
  // Точка landing (доля круга от верха по часовой) должна оказаться под стрелкой.
  const base = wheel.rot;
  const targetMod = (((-r.landing * 360) % 360) + 360) % 360;
  const baseMod = ((base % 360) + 360) % 360;
  const to = base + 360 * 6 + ((targetMod - baseMod + 360) % 360);
  wheel.spin = { roundId: r.id, from: base, to, start: r.spinStartedAt, duration: r.spinMs };
  $('wheel').classList.add('spinning');
  let lastTick = 0;
  const frame = () => {
    const s = wheel.spin;
    if (!s || s.roundId !== state.round?.id) return;
    const p = Math.min(1, Math.max(0, (serverNow() - s.start) / s.duration));
    wheel.rot = s.from + (s.to - s.from) * easeSpin(p);
    drawWheel();
    // Лёгкая вибрация при прохождении границ — затихает к концу
    const sector = Math.floor(wheel.rot / 30);
    if (sector !== lastTick && p < 0.85 && p > 0.02) {
      lastTick = sector;
      if (p > 0.45) haptic.impact('soft');
    }
    if (p < 1) requestAnimationFrame(frame);
    else $('wheel').classList.remove('spinning');
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
    $('wheel').classList.remove('spinning');
  }
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
  updateBetButton();

  const me = state.me?.id;
  if (prev?.status === 'spinning' && round.status === 'finished' && round.players.some((p) => p.id === me)) {
    refreshMe();
    if (round.winnerId === me) {
      haptic.ok();
      toast(`Вы выиграли ${fmt(round.bank)}`, 'win');
    }
  }
}

function renderCenter() {
  const r = state.round;
  const bankEl = $('bank');
  const prevBank = Number(bankEl.dataset.v || 0);
  animateNumber(bankEl, prevBank, r.bank, 500);
  bankEl.dataset.v = r.bank;
  const n = r.players.length;
  if (r.status === 'finished') {
    const w = r.players.find((p) => p.id === r.winnerId);
    $('wc-caption').textContent = 'Победитель';
    $('wc-sub').textContent = w?.id === state.me?.id ? 'Вы' : w?.name ?? '';
  } else {
    $('wc-caption').textContent = 'Банк раунда';
    $('wc-sub').textContent = n === 0 ? 'Нет ставок' : `${n} ${plural(n, 'игрок', 'игрока', 'игроков')}`;
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

let statusKey = '';
function renderStatus() {
  const r = state.round;
  const el = $('status');
  const key = `${r.id}:${r.status}`;
  if (key === statusKey) return;
  statusKey = key;
  el.className = 'status card';

  if (r.status === 'waiting') {
    el.innerHTML = `<div class="st-row"><div class="st-icon"><svg><use href="#i-hourglass"/></svg></div>
      <div><div class="st-title">Ожидание игроков</div><div class="st-sub">Раунд начнётся после второй ставки</div></div></div>`;
  } else if (r.status === 'countdown') {
    el.innerHTML = `<div class="st-row"><div><div class="st-title">До конца раунда</div>
      <div class="st-sub">Успейте сделать ставку</div></div><div class="st-timer num" id="timer">00:15</div></div>
      <div class="progress"><i id="timer-bar"></i></div>`;
    tickCountdown();
  } else if (r.status === 'spinning') {
    el.classList.add('spin');
    el.innerHTML = `<div class="st-row"><div class="st-icon"><svg><use href="#i-roulette"/></svg></div>
      <div><div class="st-title">Розыгрыш</div><div class="st-sub">Определяем победителя</div></div></div>`;
  } else {
    const w = r.players.find((p) => p.id === r.winnerId) ?? {};
    const isMe = w.id === state.me?.id;
    el.innerHTML = `<div class="st-row">${avatarHtml(w, 'sm')}
      <div style="min-width:0"><div class="st-title">${isMe ? 'Вы забираете банк' : `${esc(w.name)} забирает банк`}</div>
      <div class="st-sub">Новый раунд через несколько секунд</div></div>
      <div class="st-prize num">+${fmt(r.bank)}${STAR}</div></div>`;
  }
}

function tickCountdown() {
  const r = state.round;
  if (r?.status !== 'countdown') return;
  const left = Math.max(0, r.countdownEndsAt - serverNow());
  const sec = Math.ceil(left / 1000);
  const t = $('timer');
  const bar = $('timer-bar');
  if (t) t.textContent = `00:${String(sec).padStart(2, '0')}`;
  if (bar) bar.style.transform = `scaleX(${left / r.countdownMs})`;
  if (left > 0) requestAnimationFrame(tickCountdown);
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
      return `<div class="player${cls}" style="--c:${p.color}" data-id="${p.id}">
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

// ---------- Запуск ----------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('round', (e) => onRound(JSON.parse(e.data)));
  es.addEventListener('balance', (e) => {
    if (JSON.parse(e.data).id === state.me?.id) refreshMe();
  });
}

function bindUi() {
  document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('balance-btn').addEventListener('click', () => go('deposit'));
  $('bet-minus').addEventListener('click', () => stepBet(-1));
  $('bet-plus').addEventListener('click', () => stepBet(1));
  $('bet-input').addEventListener('input', updateBetButton);
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
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshMe());
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
    toast(e.message, 'err');
  }
  $('app').hidden = false;
  document.querySelector('#view-roulette').classList.add('active');
  connectStream();
  updateWithdrawForm();
  updateDepositForm();
  requestAnimationFrame(() => $('boot').classList.add('hide'));
}

main();
