const $ = (id) => document.getElementById(id);
const W = 132;
const STRIP = 44;
const TARGET = 38;

import { play, playAll, preloadAll } from './lottie.js';

const ANIMS = [
  'snakebox',
  'candycane',
  'lunarsnake',
  'vicecream',
  'chillflame',
  'lolpop',
  'xmasstocking',
  'poolfloat',
  'whipcupcake',
  'instantramen',
  'star',
  'star-effect',
];

const STACK = { 1: 1, 5: 2, 10: 3, 15: 4 };

const starTile = (amount) => {
  const n = STACK[amount] ?? 1;
  const stars = Array.from({ length: n }, (_, i) => `<svg class="tgs s${i}"><use href="#i-tgstar"/></svg>`).join('');
  return `<div class="gw-star n${n}"><div class="gw-stack">${stars}</div><b class="num">${amount}</b></div>`;
};

const nftArt = (p, anim) =>
  `<div class="gw-nft"${anim ? ` data-lottie="${p.id}"` : ''}><img src="${p.image}" alt="" decoding="async"></div>`;

const art = (p, anim = false) => (p.kind === 'nft' ? nftArt(p, anim) : starTile(p.amount));

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export function createGifts({ api, haptic, toast, onProfile, invite, onToggle = () => {} }) {
  const s = { st: null, spinning: false, offset: 0 };

  const byId = (id) => s.st?.prizes.find((p) => p.id === id);

  function item(p, i) {
    return `<div class="gw-item ${p.kind}" data-id="${p.id}" style="left:${i * W}px">
      <div class="gw-art">${art(p)}</div>
      <div class="gw-name"><b>${p.name}</b><span>${p.kind === 'nft' ? 'NFT-подарок' : 'на баланс'}</span></div>
    </div>`;
  }

  function filler() {
    const list = s.st.prizes;
    const nft = list.filter((p) => p.kind === 'nft');
    const stars = list.filter((p) => p.kind === 'stars');
    return Math.random() < 0.45
      ? nft[Math.floor(Math.random() * nft.length)]
      : stars[Math.floor(Math.random() * stars.length)];
  }

  function buildStrip(targetId) {
    const items = Array.from({ length: STRIP }, (_, i) => (i === TARGET && targetId ? byId(targetId) : filler()));
    $('gw-strip').innerHTML = items.map((p, i) => item(p, i)).join('');
  }

  const base = () => $('gw-reel').clientWidth / 2 - W / 2;
  const centerOffset = (index) => base() - index * W;

  function setOffset(y, animate) {
    const strip = $('gw-strip');
    strip.style.transition = animate ? 'transform 5.4s cubic-bezier(0.1, 0.6, 0.08, 1)' : 'none';
    strip.style.transform = `translate3d(${y}px, 0, 0)`;
    s.offset = y;
  }

  function render() {
    const st = s.st;
    if (!st) return;
    const badge = $('gift-fab-n');
    badge.textContent = st.spins;
    badge.hidden = !st.spins;
    $('gift-fab').classList.toggle('ready', st.spins > 0);
    const done = st.perSpin - st.nextIn;
    $('gw-bar').style.transform = `scaleX(${done / st.perSpin})`;
    $('gw-progress-text').textContent = st.spins
      ? `Доступно ${st.spins} ${plural(st.spins, 'прокрутка', 'прокрутки', 'прокруток')}`
      : `Пригласите ещё ${st.nextIn} ${plural(st.nextIn, 'друга', 'друзей', 'друзей')} — и получите прокрутку`;
    $('gw-progress-sub').textContent = `${done} из ${st.perSpin} друзей до следующей · всего приглашено ${st.invites}`;
    if (!s.spinning) {
      const btn = $('gw-spin');
      btn.textContent = st.spins ? 'Крутить' : 'Пригласить друзей';
      btn.classList.toggle('secondary', !st.spins);
      btn.classList.toggle('primary', !!st.spins);
    }
    if (!$('gw-prizes').dataset.ready) {
      $('gw-prizes').dataset.ready = '1';
      $('gw-prizes').innerHTML = st.prizes
        .map(
          (p) =>
            `<div class="gw-prize ${p.kind}"><div class="gw-art">${art(p, true)}</div><span>${p.name}</span></div>`,
        )
        .join('');
    }
    if (!$('gw').hidden) startAnimations();
  }

  let preload = null;
  function preloadAnimations(progress) {
    if (!preload) preload = preloadAll(ANIMS, progress);
    else if (progress) preload.then(() => progress(ANIMS.length, ANIMS.length));
    return preload;
  }

  async function startAnimations() {
    const box = $('gw-loading');
    if (s.animsReady) return playAll($('gw-prizes'));
    box.hidden = false;
    const ok = await preloadAnimations((done, total) => {
      $('gw-loading-text').textContent = `Загружаем анимации ${done} из ${total}`;
      $('gw-loading-bar').style.transform = `scaleX(${total ? done / total : 0})`;
    });
    box.hidden = true;
    if (!ok) preload = null;
    s.animsReady = ok;
    playAll($('gw-prizes'));
  }

  async function load() {
    try {
      s.st = await api('/api/wheel', {});
      render();
    } catch {}
  }

  function open() {
    haptic.tap();
    const el = $('gw');
    el.hidden = false;
    el.classList.remove('closing');
    document.body.classList.add('gw-open');
    onToggle(true);
    $('gw-result').hidden = true;
    if (!s.spinning) {
      buildStrip(null);
      requestAnimationFrame(() => setOffset(centerOffset(3), false));
    }
    load();
  }

  function close() {
    if (s.spinning) return;
    const el = $('gw');
    el.classList.add('closing');
    document.body.classList.remove('gw-open');
    onToggle(false);
    setTimeout(() => (el.hidden = true), 220);
  }

  function ticks(until) {
    let last = Math.round((base() - s.offset) / W);
    const strip = $('gw-strip');
    const step = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
      const idx = Math.round((base() - m.m41) / W);
      if (idx !== last) {
        last = idx;
        haptic.tap();
      }
      if (performance.now() < until) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function showResult(p) {
    const box = $('gw-result');
    const starArt = `<div class="gw-big-star"><div class="gw-fx" data-fx></div><div class="gw-star-anim" data-lottie="star"><svg><use href="#i-tgstar"/></svg></div></div>`;
    box.innerHTML = `<div class="gw-result-art ${p.kind}">${p.kind === 'nft' ? art(p, true) : starArt}</div>
      <div class="gw-result-title">${p.kind === 'nft' ? p.name : `+${p.amount} ⭐`}</div>
      <div class="gw-result-sub">${
        p.kind === 'nft' ? 'NFT-подарок ваш! Отправим его вам в Telegram в течение суток.' : 'Звёзды уже на балансе.'
      }</div>
      <button class="btn primary block" data-gw-ok>Отлично</button>`;
    box.hidden = false;
    const a = box.querySelector('[data-lottie]');
    if (a) play(a, a.dataset.lottie);
    const fx = box.querySelector('[data-fx]');
    if (fx) play(fx, 'star-effect', { loop: false });
  }

  async function spin() {
    if (s.spinning) return;
    if (!s.st?.spins) return invite();
    const btn = $('gw-spin');
    btn.classList.add('loading');
    s.spinning = true;
    try {
      const res = await api('/api/wheel/spin', {});
      buildStrip(res.prize);
      setOffset(centerOffset(2), false);
      void $('gw-strip').offsetHeight;
      setOffset(centerOffset(TARGET) + (Math.random() - 0.5) * W * 0.5, true);
      haptic.impact('medium');
      ticks(performance.now() + 5400);
      setTimeout(() => {
        setOffset(centerOffset(TARGET), true);
        $('gw-strip').style.transition = 'transform 0.35s ease';
        const won = $('gw-strip').children[TARGET];
        won.classList.add('win');
        const nft = won.querySelector('.gw-nft');
        if (nft) {
          nft.dataset.lottie = res.prize;
          play(nft, res.prize);
        }
        s.spinning = false;
        s.st = res;
        onProfile(res);
        render();
        haptic.ok();
        showResult(byId(res.prize));
      }, 5500);
    } catch (e) {
      s.spinning = false;
      haptic.err();
      toast(e.message, 'err');
      load();
    } finally {
      btn.classList.remove('loading');
    }
  }

  function bind() {
    $('gift-fab').addEventListener('click', open);
    $('gw').addEventListener('click', (e) => {
      if (e.target.closest('[data-gw-close]')) close();
      if (e.target.closest('[data-gw-ok]')) $('gw-result').hidden = true;
    });
    $('gw-spin').addEventListener('click', spin);
    const activate = async () => {
      const code = $('gw-code').value.trim();
      if (!code) return $('gw-code').focus();
      const btn = $('gw-code-go');
      btn.classList.add('loading');
      try {
        s.st = await api('/api/wheel/promo', { code });
        render();
        haptic.ok();
        toast('Промокод активирован — бесплатная прокрутка ваша');
        $('gw-code').value = '';
      } catch (e) {
        haptic.err();
        toast(e.message, 'err');
      } finally {
        btn.classList.remove('loading');
      }
    };
    $('gw-code-go').addEventListener('click', activate);
    $('gw-code').addEventListener('keydown', (e) => e.key === 'Enter' && activate());
  }

  return { bind, load, preloadAnimations, isOpen: () => !$('gw').hidden, close };
}
