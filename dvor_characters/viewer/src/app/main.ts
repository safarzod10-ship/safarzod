/**
 * ДВОР — Telegram Mini App shell (from the customer's mockups).
 * Screens: Главная (the selected hero's menu art), Герой (5 heroes), Задания (empty), Рейтинг (rank
 * ladder, level, match history), Поиск боя, Бой. The splash loads everything (models, images, fonts)
 * before the first screen shows. The search is simulated; the battle is «Царь двора» 2 на 2 against
 * bots (game/match.ts) whose skill follows the player's rank (progress.ts).
 */
import './app.css';
import { HEROES, heroById, type HeroId } from './data';
import { ICONS, ROLE_ICON, STAT_ICONS, rankBadge } from './icons';
import { initTelegram, setBack, haptic, playerName } from './tg';
import { startBattle, type Battle } from './battle';
import { preloadAll } from './assets';
import { lineup } from './game/match';
import { HERO_PRICE, MAX_UPGRADE, RANKS, UPGRADE_COST, UPGRADE_STEP, buyHero, chooseFirst, levelOf, loadProfile, markStorySeen,
  nextRank, rankOf, upgrade, upgradesOf, type Stat } from './progress';
import { KITS } from './game/kits';
import { BACKSTORY, STORY } from './story';
import { fetchTop, lastPlace, postResult } from './api';

type Screen = 'home' | 'heroes' | 'tasks' | 'rating' | 'search' | 'battle' | 'story' | 'choose';
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
// the hero to play: must be one the player owns (the first pick or a bought one)
const ownedHero = (id: string | null): HeroId => {
  const p = loadProfile();
  if (id && p.owned.includes(id)) return heroById(id).id;
  return heroById(p.chosen ?? 'technik').id;
};
let selected: HeroId = ownedHero(store.get('dvor.hero'));
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
  const intro = s === 'story' || s === 'choose';
  tabbar.hidden = !tabbed;
  tabbar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === s)));
  setBack(tabbed || intro ? null : () => go('home'));
  ({ home, heroes, tasks: () => empty('Задания', 'Ежедневные задания появятся здесь.'),
    rating, search, battle, story, choose })[s]();
}

const backBtn = () => `<button type="button" class="back" aria-label="Назад">${ICONS.back}</button>`;
function bindBack(): void {
  view.querySelector('.back')?.addEventListener('click', () => { haptic('light'); go('home'); });
}

// ------------------------------------------------------------------ Главная
/** Top bar: who you are (level, rank) and the game balance (coins, crystals). */
const topBar = (): string => {
  const p = loadProfile(), r = rankOf(p.trophies), lv = levelOf(p.xp);
  return `<header class="topbar">
      <button type="button" class="tb-me" data-go="rating" aria-label="Профиль и рейтинг">
        <span class="tb-badge">${rankBadge(r.color, r.dark)}<em>${lv.level}</em></span>
        <span class="tb-name"><b>${playerName()}</b><small>${r.name} · ${ICONS.trophy}${p.trophies}</small></span>
      </button>
      <span class="tb-cur"><span class="pill">${ICONS.coin}<b>${p.coins.toLocaleString('ru-RU')}</b></span><span class="pill">${ICONS.gem}<b>${p.gems.toLocaleString('ru-RU')}</b></span></span>
    </header>`;
};
function home(): void {
  const h = heroById(selected);
  view.innerHTML = `
    ${topBar()}
    <div class="home-art" role="img" aria-label="ДВОР — ${h.name}" style="background-image:url(${h.menu})"></div>
    <div class="home-bottom">
      <div class="home-hero">
        <span class="home-hero-name"><b>${h.name}</b><span>${ROLE_ICON[h.roleIcon]}${h.role}</span></span>
        <button type="button" class="home-change" id="change">${ICONS.hero}<span>Сменить</span></button>
      </div>
      <button type="button" class="btn-play" id="play">${ICONS.play}<span>Играть</span></button>
    </div>`;
  view.querySelector('#play')!.addEventListener('click', () => { haptic('medium'); go('search'); });
  view.querySelector('#change')!.addEventListener('click', () => { haptic('light'); go('heroes'); });
  view.querySelector('.tb-me')!.addEventListener('click', () => { haptic('light'); go('rating'); });
}

// ------------------------------------------------------------------ История (один раз, перед первым выбором)
function story(): void {
  let i = 0;
  view.innerHTML = `<div class="story" role="dialog" aria-label="История"><div class="story-art"></div><div class="story-tint"></div>
    <button type="button" class="story-skip">Пропустить</button>
    <div class="story-box"><p class="story-dots">${STORY.map(() => '<i></i>').join('')}</p><h2></h2><p class="story-text"></p><span class="story-next">Нажми, чтобы продолжить</span></div></div>`;
  const art = view.querySelector<HTMLElement>('.story-art')!, tint = view.querySelector<HTMLElement>('.story-tint')!;
  const h = view.querySelector('h2')!, t = view.querySelector('.story-text')!, dots = [...view.querySelectorAll('.story-dots i')];
  const show = () => {
    const sl = STORY[i];
    art.style.backgroundImage = `url(${sl.art})`;
    art.classList.remove('kb'); void art.offsetWidth; art.classList.add('kb');
    tint.style.background = sl.tint ?? 'transparent';
    h.textContent = sl.title; t.textContent = sl.text;
    dots.forEach((d, k) => d.classList.toggle('on', k <= i));
    view.querySelector('.story-box')!.classList.remove('in'); void (view.querySelector('.story-box') as HTMLElement).offsetWidth;
    view.querySelector('.story-box')!.classList.add('in');
  };
  const done = () => { markStorySeen(); go('choose'); };
  view.querySelector('.story')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.story-skip')) return done();
    haptic('light');
    if (++i >= STORY.length) done(); else show();
  });
  show();
}

// ------------------------------------------------------------------ Первый выбор героя (навсегда)
function choose(): void {
  let pick: HeroId = HEROES[0].id;
  view.innerHTML = `<header class="choose-head"><h1>За кого ты?</h1><p>Выбрать можно <b>один раз</b> — изменить потом нельзя.<br>Остальных героев можно будет купить за ${HERO_PRICE.toLocaleString('ru-RU')} монет.</p></header>
    <div class="hcards">${HEROES.map((h) => `
      <article class="hcard" data-hero="${h.id}" style="--c:${h.color}">
        <img src="${h.card}" alt="">
        <div class="hcard-body"><h2>${h.name}</h2><p class="role">${ROLE_ICON[h.roleIcon]}<span>${h.role}</span></p>
          <p class="hcard-story">${BACKSTORY[h.id]}</p>
          <ul class="kit">${h.abilities.map((t, i) => `<li><b>${['Атака', 'Кнопка 1', 'Кнопка 2'][i]}</b> ${t}</li>`).join('')}</ul></div>
      </article>`).join('')}</div>
    <div class="sel-foot"><button type="button" class="btn-main" id="pick">Выбрать</button></div>
    <div class="modal" hidden><div class="modal-card"><h2></h2><p>Этот выбор навсегда. Других героев потом можно купить за ${HERO_PRICE.toLocaleString('ru-RU')} монет.</p>
      <div class="result-btns"><button type="button" class="btn-main" id="yes">Да, выбираю</button><button type="button" class="btn-ghost" id="no">Подумаю</button></div></div></div>`;
  const row = view.querySelector<HTMLElement>('.hcards')!, btn = view.querySelector<HTMLButtonElement>('#pick')!, modal = view.querySelector<HTMLElement>('.modal')!;
  const update = () => { btn.textContent = `Выбрать: ${heroById(pick).name}`; };
  // the card in the middle of the strip is the one picked
  const onScroll = () => {
    const mid = row.scrollLeft + row.clientWidth / 2;
    let best = pick, bd = Infinity;
    row.querySelectorAll<HTMLElement>('.hcard').forEach((c) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = c.dataset.hero as HeroId; } });
    if (best !== pick) { pick = best; update(); }
  };
  row.addEventListener('scroll', onScroll, { passive: true });
  row.addEventListener('click', (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>('.hcard'); if (c) c.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); });
  btn.addEventListener('click', () => { haptic('light'); modal.querySelector('h2')!.textContent = `Точно ${heroById(pick).name}?`; modal.hidden = false; });
  modal.querySelector('#no')!.addEventListener('click', () => { modal.hidden = true; });
  modal.querySelector('#yes')!.addEventListener('click', () => {
    chooseFirst(pick);
    selected = pick; store.set('dvor.hero', pick);
    haptic('success');
    go('home');
  });
  update();
}

// ------------------------------------------------------------------ Герои: свои, покупка, улучшения
const STAT_LABEL: Record<Stat, string> = { hp: 'Здоровье', dmg: 'Урон', speed: 'Скорость' };
function statValue(id: HeroId, stat: Stat, lv: number): string {
  const k = KITS[id];
  if (stat === 'hp') return Math.round(k.hp * (1 + lv * UPGRADE_STEP.hp)).toLocaleString('ru-RU');
  if (stat === 'dmg') return Math.round(k.attack.dmg * (1 + lv * UPGRADE_STEP.dmg)).toLocaleString('ru-RU');
  return (k.speed * (1 + lv * UPGRADE_STEP.speed)).toFixed(2).replace('.', ',') + ' м/с';
}
function heroes(): void {
  previewHero = selected;
  view.innerHTML = `
    ${backBtn()}
    <header class="sel-head"><h1>Герои</h1><p class="sel-coins">${ICONS.coin}<b></b></p></header>
    <div class="cards" role="radiogroup" aria-label="Герой">${HEROES.map((h) => `
      <button type="button" class="card" role="radio" data-hero="${h.id}">
        <img src="${h.card}" alt="">
        <span class="card-name">${h.name}</span><span class="card-role">${ROLE_ICON[h.roleIcon]}</span><span class="card-lock">${ICONS.lock}</span>
      </button>`).join('')}</div>
    <section class="detail" aria-live="polite"></section>
    <div class="sel-foot"><button type="button" class="btn-main" id="pick"></button></div>`;
  const detail = view.querySelector<HTMLElement>('.detail')!;
  const render = () => {
    const p = loadProfile(), h = heroById(previewHero), own = p.owned.includes(h.id), u = upgradesOf(p, h.id);
    view.querySelector('.sel-coins b')!.textContent = p.coins.toLocaleString('ru-RU');
    view.querySelectorAll<HTMLButtonElement>('.card').forEach((c) => {
      c.setAttribute('aria-checked', String(c.dataset.hero === h.id));
      c.classList.toggle('locked', !p.owned.includes(c.dataset.hero!));
    });
    detail.className = 'detail portrait-card';
    detail.innerHTML = `
      <img class="detail-img" src="${h.card}" alt="">
      <div class="detail-body">
        <h2>${h.name}</h2>
        <p class="role">${ROLE_ICON[h.roleIcon]}<span>${h.role}</span></p>
        <p class="desc">${BACKSTORY[h.id]}</p>
        <ul class="kit">${h.abilities.map((t, i) => `<li><b>${['Атака', 'Кнопка 1', 'Кнопка 2'][i]}</b> ${t}</li>`).join('')}</ul>
        <h3>${own ? 'Улучшения' : 'Характеристики'}</h3>
        <ul class="ups">${(['hp', 'dmg', 'speed'] as Stat[]).map((st) => {
          const lv = u[st], max = lv >= MAX_UPGRADE, cost = UPGRADE_COST[lv];
          return `<li><span class="up-name">${STAT_ICONS[st === 'hp' ? 0 : st === 'dmg' ? 1 : 2]}${STAT_LABEL[st]}</span>
            <span class="up-val"><b>${statValue(h.id, st, lv)}</b>${own && !max ? `<em>→ ${statValue(h.id, st, lv + 1)}</em>` : ''}</span>
            <span class="pips" aria-label="${lv} из ${MAX_UPGRADE}">${'<i class="on"></i>'.repeat(lv)}${'<i></i>'.repeat(MAX_UPGRADE - lv)}</span>
            ${own ? `<button type="button" class="up-btn" data-stat="${st}" ${max || p.coins < cost ? 'disabled' : ''}>${max ? 'Макс.' : `${ICONS.coin}${cost.toLocaleString('ru-RU')}`}</button>` : ''}</li>`;
        }).join('')}</ul>
      </div>`;
    const pick = view.querySelector<HTMLButtonElement>('#pick')!;
    pick.disabled = false;
    pick.classList.remove('done');
    if (own) {
      pick.textContent = h.id === selected ? 'Выбран для боя' : `Играть за: ${h.name}`;
      pick.classList.toggle('done', h.id === selected);
    } else {
      pick.innerHTML = `Купить ${ICONS.coin}${HERO_PRICE.toLocaleString('ru-RU')}`;
      pick.disabled = p.coins < HERO_PRICE;
    }
  };
  view.querySelector('.cards')!.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLButtonElement>('.card');
    if (c) { haptic('light'); previewHero = c.dataset.hero as HeroId; render(); }
  });
  detail.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.up-btn');
    if (b && upgrade(previewHero, b.dataset.stat as Stat)) { haptic('success'); render(); }
  });
  view.querySelector('#pick')!.addEventListener('click', () => {
    const p = loadProfile();
    if (!p.owned.includes(previewHero)) {
      if (!buyHero(previewHero)) return;
      haptic('success');
    }
    selected = previewHero;
    store.set('dvor.hero', selected);
    haptic('success');
    render();
  });
  bindBack();
  render();
}

// ------------------------------------------------------------------ Задания (пока пустые)
function empty(title: string, text: string): void {
  view.innerHTML = `<div class="empty"><h1>${title}</h1><p>${text}</p></div>`;
}

// ------------------------------------------------------------------ Рейтинг: ранги, уровень, история
function rating(): void {
  const p = loadProfile(), r = rankOf(p.trophies), nx = nextRank(p.trophies), lv = levelOf(p.xp);
  const toNext = nx ? Math.round((100 * (p.trophies - r.min)) / (nx.min - r.min)) : 100;
  const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн назад`; };
  view.innerHTML = `
    <section class="prog">
      <h2 class="lb-title">Игроки двора${lastPlace() ? `<small>твоё место: ${lastPlace()}</small>` : ''}</h2>
      <ol class="leaders"><li class="muted">Загружаю рейтинг…</li></ol>
      <h2>Мой путь</h2>
      <div class="prog-head">
        <span class="prog-badge">${rankBadge(r.color, r.dark)}</span>
        <div><h1>${r.name}</h1><p>${ICONS.trophy}<b>${p.trophies}</b>${nx ? ` · до «${nx.name}» ${nx.min - p.trophies}` : ' · высший ранг'}</p>
          <i class="prog-bar"><s style="width:${toNext}%"></s></i></div>
      </div>
      <div class="prog-stats">
        <span><b>${lv.level}</b>уровень</span><span><b>${p.games}</b>боёв</span><span><b>${p.games ? Math.round((100 * p.wins) / p.games) : 0}%</b>побед</span><span><b>${p.kills}</b>выбито</span>
      </div>
      <p class="prog-lv">Уровень ${lv.level}: ${lv.into} / ${lv.need} опыта<i class="prog-bar xp"><s style="width:${Math.round((100 * lv.into) / lv.need)}%"></s></i></p>
      <h2>Ранги</h2>
      <ol class="ladder">${RANKS.map((x) => `<li class="${x.name === r.name ? 'me' : p.trophies >= x.min ? 'done' : ''}"><span class="lb">${rankBadge(x.color, x.dark)}</span><span>${x.name}</span><b>${x.min}</b></li>`).reverse().join('')}</ol>
      <h2>Последние бои</h2>
      ${p.history.length ? `<ul class="history">${p.history.map((m) => `<li class="${m.result}"><img src="${heroById(m.hero).card}" alt=""><span><b>${m.result === 'win' ? 'Победа' : m.result === 'lose' ? 'Поражение' : 'Ничья'}</b> ${m.score[0]}:${m.score[1]} · ${ago(m.t)}</span><em>${m.trophies > 0 ? '+' : ''}${m.trophies}</em></li>`).join('')}</ul>` : '<p class="muted">Сыграй первый бой — он появится здесь.</p>'}
    </section>`;
  const list = view.querySelector('.leaders')!;
  let alive = true;
  cleanup = () => { alive = false; };
  fetchTop().then((top) => {
    if (!alive) return;
    list.innerHTML = top.length ? top.map((t, i) => `<li class="${i < 3 ? `m${i + 1}` : ''}"><b>${i + 1}</b>${t.hero ? `<img src="${heroById(t.hero).card}" alt="">` : '<i></i>'}<span>${t.name.replace(/[<>&]/g, '')}<small>ур. ${t.level}</small></span><em>${ICONS.trophy}${t.trophies}</em></li>`).join('')
      : '<li class="muted">Пока пусто — сыграй бой в Telegram, и ты будешь первым.</li>';
  }).catch(() => { if (alive) list.innerHTML = '<li class="muted">Рейтинг сейчас недоступен — нет связи с сервером.</li>'; });
}

// ------------------------------------------------------------------ Поиск боя (симуляция)
let nextBlue: HeroId[] = [];
function search(): void {
  const team = (nextBlue = lineup(selected));
  view.innerHTML = `
    <div class="search-bg" style="background-image:url(ui/search_bg.jpg)"></div>
    ${backBtn()}
    <div class="search-top"><h1>Поиск боя</h1><p>Рейтинговый <span aria-hidden="true">•</span> 2 на 2</p></div>
    <div class="spinner" aria-hidden="true"></div>
    <p class="search-title">Поиск противников…</p>
    <p class="search-count">Найдено игроков: <b>1</b> из 4</p>
    <ul class="slots">${team.map((id) => `<li data-team><img src="${heroById(id).card}" alt="${heroById(id).name}"><span class="tick">${ICONS.check}</span></li>`).join('')}${('<li data-enemy><span class="ghost">' + ICONS.person + '</span><span class="tick">' + ICONS.check + '</span></li>').repeat(2)}</ul>
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
    if (found < 4) {
      show(++found);
      haptic('light');
      if (found === 4) {
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
  let b: Battle | null = startBattle(view, selected, () => go('home'), nextBlue.length ? nextBlue : undefined);
  cleanup = () => { b?.destroy(); b = null; };
}

// ------------------------------------------------------------------ загрузка при входе
const TIPS = [
  'Стой в круге с короной — команда получает очки',
  'Дым Техника замедляет врагов внутри облака',
  'Гаражная дверь Танка держит выстрелы спереди',
  'Пластинки Спринтер отскакивают от стен',
  'Растяжка Снайпера оглушает того, кто на неё наступит',
  'Аптечка Медика лечит всех рядом, госпиталь — всех в круге',
  'Атака идёт сама — следи за позицией и кнопками',
  'Двойной тап под джойстиком — рывок',
  'Побеждай, чтобы подняться из Бронзы в Серебро',
  'Выбитый игрок возвращается через 3 секунды',
];
/**
 * The splash (#boot, splash/splash.html) is already on screen: it is part of the HTML, so it shows while
 * this bundle downloads. Here it switches to real progress (bytes of every model, pictures, fonts).
 */
function boot(): void {
  let el = document.getElementById('boot');
  if (!el) {   // page built without the splash: a bare stand-in
    el = document.createElement('div');
    el.id = 'boot';
    el.innerHTML = '<div class="sp-foot"><div class="sp-bar"><i></i></div><p class="sp-pct"></p><p class="sp-tip"></p></div>';
    document.body.appendChild(el);
  }
  const box = el;
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
  const run = () => Promise.all([initTelegram(), preloadAll((k) => (target = k))]);
  const finish = () => {
    target = 1;
    // let the logo animation play out (it starts with the page), then the logo and the bar fade, home under it
    const wait = Math.max(0, 2300 - performance.now());
    setTimeout(() => {
      clearInterval(tipTimer);
      box.classList.add('done');
      setTimeout(() => {
        const p = loadProfile();   // first launch: the story, then the one-time hero pick
        if (p.games > 0 && p.chosen) void postResult(p, selected);   // keep the leaderboard name / trophies fresh
        go(!p.storySeen ? 'story' : !p.chosen ? 'choose' : current);
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
