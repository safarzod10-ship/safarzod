/**
 * ДВОР — Telegram Mini App shell (from the customer's 4-screen mockup, ref/ui_mockup.png).
 * Screens: Главная (tab), Герой (hero select), Задания / Рейтинг (empty tabs), Поиск боя, Бой.
 * Character pictures come from the mockup (public/ui/); the selected hero stands on the home screen as
 * its 3D model. A boot screen loads everything (models, images, fonts) before the first screen shows.
 * The search is simulated; the battle is «Царь двора» 3 на 3 against bots (game/match.ts).
 */
import './app.css';
import { HEROES, PROFILE, STAT_NAMES, heroById, type HeroId } from './data';
import { ICONS, ROLE_ICON, STAT_ICONS } from './icons';
import { initTelegram, setBack, haptic } from './tg';
import { startBattle, type Battle } from './battle';
import { preloadAll } from './assets';
import { createHomeStage } from './home3d';

type Screen = 'home' | 'heroes' | 'tasks' | 'rating' | 'search' | 'battle';
const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Главная', icon: ICONS.home },
  { id: 'heroes', label: 'Герой', icon: ICONS.hero },
  { id: 'tasks', label: 'Задания', icon: ICONS.tasks },
  { id: 'rating', label: 'Рейтинг', icon: ICONS.rating },
];

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let selected: HeroId = heroById(store.get('dvor.hero') ?? 'technik').id;
let previewHero: HeroId = selected;

const app = document.getElementById('app')!;
app.innerHTML = `<main class="view"></main><nav class="tabbar" aria-label="Разделы">${TABS.map((t) =>
  `<button type="button" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}</nav>`;
const view = app.querySelector<HTMLElement>('.view')!;
const tabbar = app.querySelector<HTMLElement>('.tabbar')!;
tabbar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (b) { haptic('light'); go(b.dataset.tab as Screen); }
});

let cleanup: (() => void) | null = null;
let current: Screen = 'home';

function go(s: Screen): void {
  cleanup?.();
  cleanup = null;
  current = s;
  view.className = `view ${s}`;
  app.classList.toggle('wide', s === 'battle');   // the battle uses the whole (landscape) screen
  view.scrollTop = 0;
  const tabbed = s === 'home' || s === 'tasks' || s === 'rating';
  tabbar.hidden = !tabbed;
  tabbar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === s)));
  setBack(tabbed ? null : () => go('home'));
  ({ home, heroes, tasks: () => empty('Задания', 'Ежедневные задания появятся здесь.'),
    rating: () => empty('Рейтинг', 'Таблица лучших игроков появится здесь.'), search, battle })[s]();
}

const backBtn = () => `<button type="button" class="back" aria-label="Назад">${ICONS.back}</button>`;
function bindBack(): void {
  view.querySelector('.back')?.addEventListener('click', () => { haptic('light'); go('home'); });
}

// ------------------------------------------------------------------ Главная
function home(): void {
  const h = heroById(selected);
  view.innerHTML = `
    <div class="home-art" role="img" aria-label="ДВОР" style="background-image:url(ui/menu_bg.jpg)"></div>
    <div class="home-spot" aria-hidden="true"></div>
    <div class="home-stage" aria-label="${h.name}"></div>
    <div class="rank">
      <span class="rank-badge">${ICONS.rank}</span>
      <span class="rank-text"><b>${PROFILE.rank}</b><span>${ICONS.trophy}${PROFILE.trophies.toLocaleString('ru-RU')}</span></span>
    </div>
    <div class="home-bottom">
      <div class="home-hero">
        <span class="home-hero-name"><b>${h.name}</b><span>${ROLE_ICON[h.roleIcon]}${h.role}</span></span>
        <button type="button" class="home-change" id="change">${ICONS.hero}<span>Сменить</span></button>
      </div>
      <button type="button" class="btn-play" id="play">${ICONS.play}<span>Играть</span></button>
    </div>`;
  view.querySelector('#play')!.addEventListener('click', () => { haptic('medium'); go('search'); });
  view.querySelector('#change')!.addEventListener('click', () => { haptic('light'); go('heroes'); });
  const stage = createHomeStage(view.querySelector<HTMLElement>('.home-stage')!, selected);
  cleanup = () => stage.dispose();
}

// ------------------------------------------------------------------ Выбор героя
function heroes(): void {
  previewHero = selected;
  view.innerHTML = `
    ${backBtn()}
    <header class="sel-head"><h1>Выбор героя</h1><p>Выбери одного из трёх героев.<br>Каждый играет свою роль в команде.</p></header>
    <div class="cards" role="radiogroup" aria-label="Герой">${HEROES.map((h) => `
      <button type="button" class="card" role="radio" data-hero="${h.id}">
        <img src="${h.card}" alt="">
        <span class="card-name">${h.name}</span><span class="card-role">${ROLE_ICON[h.roleIcon]}</span>
      </button>`).join('')}</div>
    <section class="detail" aria-live="polite"></section>
    <div class="sel-foot"><button type="button" class="btn-main" id="pick">Выбрать героя</button></div>`;
  const detail = view.querySelector<HTMLElement>('.detail')!;
  const render = () => {
    const h = heroById(previewHero);
    view.querySelectorAll<HTMLButtonElement>('.card').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.hero === h.id)));
    detail.className = `detail ${h.detail === h.card ? 'portrait-card' : ''}`;
    detail.innerHTML = `
      <img class="detail-img" src="${h.detail}" alt="">
      <div class="detail-body">
        <h2>${h.name}</h2>
        <p class="role">${ROLE_ICON[h.roleIcon]}<span>${h.role}</span></p>
        <p class="desc">${h.text}</p>
        <h3>Характеристики (${STAT_NAMES.length})</h3>
        <ul class="stats">${STAT_NAMES.map((n, i) => `
          <li>${STAT_ICONS[i]}<span>${n}</span><span class="pips" aria-label="${h.stats[i]} из 5">${'<i class="on"></i>'.repeat(h.stats[i])}${'<i></i>'.repeat(5 - h.stats[i])}</span></li>`).join('')}
        </ul>
      </div>`;
    const pick = view.querySelector<HTMLButtonElement>('#pick')!;
    pick.textContent = h.id === selected ? 'Выбран' : 'Выбрать героя';
    pick.classList.toggle('done', h.id === selected);
  };
  view.querySelector('.cards')!.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
    if (c) { haptic('light'); previewHero = c.dataset.hero as HeroId; render(); }
  });
  view.querySelector('#pick')!.addEventListener('click', () => {
    selected = previewHero;
    store.set('dvor.hero', selected);
    haptic('success');
    render();
  });
  bindBack();
  render();
}

// ------------------------------------------------------------------ Задания / Рейтинг (пока пустые)
function empty(title: string, text: string): void {
  view.innerHTML = `<div class="empty"><h1>${title}</h1><p>${text}</p></div>`;
}

// ------------------------------------------------------------------ Поиск боя (симуляция)
function search(): void {
  const team = [selected, ...HEROES.map((h) => h.id).filter((id) => id !== selected)];
  view.innerHTML = `
    <div class="search-bg" style="background-image:url(ui/search_bg.jpg)"></div>
    ${backBtn()}
    <div class="search-top"><h1>Поиск боя</h1><p>Рейтинговый <span aria-hidden="true">•</span> 3 на 3</p></div>
    <div class="spinner" aria-hidden="true"></div>
    <p class="search-title">Поиск противников…</p>
    <p class="search-count">Найдено игроков: <b>1</b> из 6</p>
    <ul class="slots">${team.map((id) => `<li data-team><img src="${heroById(id).card}" alt="${heroById(id).name}"><span class="tick">${ICONS.check}</span></li>`).join('')}${('<li data-enemy><span class="ghost">' + ICONS.person + '</span><span class="tick">' + ICONS.check + '</span></li>').repeat(3)}</ul>
    <p class="wait">${ICONS.hourglass}<span>Ожидание: ~ <b>12</b> сек</span></p>`;
  bindBack();
  const slots = [...view.querySelectorAll<HTMLElement>('.slots li')];
  const countEl = view.querySelector('.search-count b')!;
  const waitEl = view.querySelector('.wait b')!;
  const titleEl = view.querySelector('.search-title')!;
  let found = 0;
  const show = (n: number) => {
    slots.forEach((s, i) => s.classList.toggle('found', i < n));
    countEl.textContent = String(n);
  };
  show(++found);
  let left = 12;
  const timers = [window.setInterval(() => {
    if (found < 6) {
      show(++found);
      haptic('light');
      if (found === 6) {
        titleEl.textContent = 'Бой найден!';
        haptic('success');
        timers.push(window.setTimeout(() => go('battle'), 900));
      }
    }
  }, 750), window.setInterval(() => { left = Math.max(1, left - 1); waitEl.textContent = String(left); }, 1000)];
  cleanup = () => timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
}

// ------------------------------------------------------------------ Бой
function battle(): void {
  let b: Battle | null = startBattle(view, selected, () => go('home'));
  cleanup = () => { b?.destroy(); b = null; };
}

// ------------------------------------------------------------------ загрузка при входе
const TIPS = [
  'Стой в круге с короной — команда получает очки',
  'Дым Техника замедляет врагов внутри облака',
  'Гаражная дверь Танка держит выстрелы спереди',
  'Пластинки Спринтер отскакивают от стен',
  'Выбитый игрок возвращается через 3 секунды',
];
/**
 * The splash (#boot, splash/splash.html) is already on screen: it is part of the HTML, so it shows while
 * this bundle downloads. Here it switches to real progress: each hero lights up when its model is ready.
 */
function boot(): void {
  let el = document.getElementById('boot');
  if (!el) {   // page built without the splash: a bare stand-in
    el = document.createElement('div');
    el.id = 'boot';
    el.innerHTML = '<div class="sp-foot"><div class="sp-heroes"></div><div class="sp-bar"><i></i></div><p class="sp-pct"></p><p class="sp-tip"></p></div>';
    document.body.appendChild(el);
  }
  const box = el;
  const heroesRow = box.querySelector<HTMLElement>('.sp-heroes')!;
  heroesRow.innerHTML = HEROES.map((h) =>
    `<span class="sp-h" data-model="${h.model}"><span class="sp-av"><i style="background-image:url(${h.card})"></i></span>${h.name}</span>`).join('');
  const bar = box.querySelector<HTMLElement>('.sp-bar i')!, tip = box.querySelector<HTMLElement>('.sp-tip')!;
  box.querySelector('.sp-pct')!.innerHTML = 'Загрузка <b>0</b>%';
  const pct = box.querySelector('.sp-pct b')!;
  box.classList.add('live');
  let ti = Math.floor(Math.random() * TIPS.length);
  const nextTip = () => { tip.textContent = TIPS[ti++ % TIPS.length]; tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in'); };
  nextTip();
  const tipTimer = window.setInterval(nextTip, 2600);
  let shown = 0, target = 0;
  const anim = window.setInterval(() => {   // smooth the bar between progress events
    shown += (target - shown) * 0.25;
    if (target - shown < 0.002) shown = target;
    bar.style.width = `${(shown * 100).toFixed(1)}%`;
    pct.textContent = String(Math.floor(shown * 100));
  }, 33);
  const heroReady = (model: string) => box.querySelector(`.sp-h[data-model="${model}"]`)?.classList.add('ok');
  const run = () => Promise.all([initTelegram(), preloadAll((k) => (target = k), heroReady)]);
  const finish = () => {
    target = 1;
    // let the logo animation play out (it starts with the page), then: art in, bar out, home under it
    const wait = Math.max(0, 1900 - performance.now());
    setTimeout(() => {
      clearInterval(tipTimer);
      box.classList.add('done');
      setTimeout(() => {
        go(current);
        box.classList.add('out');
        setTimeout(() => { clearInterval(anim); box.remove(); }, 500);
      }, 550);
    }, wait + 300);
  };
  const fail = (e: unknown) => {
    clearInterval(tipTimer);
    box.querySelector('.sp-foot')!.innerHTML = `<p class="sp-err">Не удалось загрузить игру<br><small>${String((e as Error)?.message ?? e)}</small></p>
      <button type="button" class="sp-retry" id="retry">Повторить</button>`;
    box.querySelector('#retry')!.addEventListener('click', () => location.reload());
  };
  run().then(finish, fail);
}
boot();
