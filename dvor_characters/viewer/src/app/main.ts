import './app.css';
import { HEROES, heroById, type HeroId } from './data';
import { ICONS, ROLE_ICON, rankBadge } from './icons';
import { initTelegram, setBack, haptic, playerName, startParam } from './tg';
import { startBattle, type Battle, type Online } from './battle';
import { RoomLink, inviteFriend, newRoomId, roomLink, type Peer } from './net';
import { preloadAll } from './assets';
import { lineup } from './game/match';
import { HERO_PRICE, MAX_UPGRADE, RANKS, STATS, UPGRADE_STEP, boostOf, buyHero, chooseFirst, heroLevel, heroLevelOf, loadProfile, markStorySeen, upgradeCost,
  nextRank, rankOf, upgrade, upgradesOf, type Stat } from './progress';
import { KITS } from './game/kits';
import { BACKSTORY, STORY } from './story';
import { fetchTop, lastPlace, postResult, syncOnBoot } from './api';

type Screen = 'home' | 'heroes' | 'tasks' | 'rating' | 'search' | 'battle' | 'story' | 'choose' | 'room';
const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Главная', icon: ICONS.home },
  { id: 'heroes', label: 'Герой', icon: ICONS.hero },
  { id: 'tasks', label: 'Задания', icon: ICONS.tasks },
  { id: 'rating', label: 'Рейтинг', icon: ICONS.rating },
];

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch {} },
};

const ownedHero = (id: string | null): HeroId => {
  const p = loadProfile();
  if (id && p.owned.includes(id)) return heroById(id).id;
  return heroById(p.chosen ?? 'technik').id;
};
let selected: HeroId = ownedHero(store.get('dvor.hero'));

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
  if (s !== 'battle' && s !== 'story') { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
  view.scrollTop = 0;
  const tabbed = s === 'home' || s === 'heroes' || s === 'tasks' || s === 'rating';
  const intro = s === 'story' || s === 'choose';
  tabbar.hidden = !tabbed;
  tabbar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === s)));
  setBack(tabbed || intro ? null : () => go('home'));
  ({ home, heroes, tasks: () => empty('Задания', 'Ежедневные задания появятся здесь.'),
    rating, search, battle, story, choose, room })[s]();
}

const backBtn = () => `<button type="button" class="back" aria-label="Назад">${ICONS.back}</button>`;
function bindBack(): void {
  view.querySelector('.back')?.addEventListener('click', () => { haptic('light'); go('home'); });
}

const topBar = (): string => {
  const p = loadProfile(), r = rankOf(p.trophies), lv = heroLevelOf(selected);
  return `<header class="topbar">
      <button type="button" class="tb-me" data-go="rating" aria-label="Профиль и рейтинг">
        <span class="tb-badge">${rankBadge(r.color, r.dark)}<em>${lv}</em></span>
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
      <div class="home-actions">
        <button type="button" class="btn-play" id="play">${ICONS.play}<span>Играть</span></button>
        <button type="button" class="btn-friend" id="friend" aria-label="Бой с другом">${ICONS.person}<span>С другом</span></button>
      </div>
    </div>`;
  view.querySelector('#play')!.addEventListener('click', () => { haptic('medium'); go('search'); });
  view.querySelector('#friend')!.addEventListener('click', () => { haptic('medium'); roomId = newRoomId(); go('room'); });
  view.querySelector('#change')!.addEventListener('click', () => { haptic('light'); go('heroes'); });
  view.querySelector('.tb-me')!.addEventListener('click', () => { haptic('light'); go('rating'); });
}

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

function choose(): void {
  let pick: HeroId = HEROES[0].id;
  view.innerHTML = `<header class="choose-head"><h1>За кого ты?</h1><p>Выбрать можно <b>один раз</b> — изменить потом нельзя.<br>Остальных героев можно будет купить за ${HERO_PRICE.toLocaleString('ru-RU')} монет.</p></header>
    <div class="hcards">${HEROES.map((h) => `
      <article class="hcard" data-hero="${h.id}" style="--c:${h.color}">
        <img src="${h.card}" alt="">
        <div class="hcard-body"><h2>${h.name}</h2><p class="role">${ROLE_ICON[h.roleIcon]}<span>${h.role}</span></p>
          <p class="hcard-story">${BACKSTORY[h.id]}</p>
          <ul class="kit">${h.abilities.map((t, i) => `<li><b>${['Атака', 'Способность'][i]}</b> ${t}</li>`).join('')}</ul></div>
      </article>`).join('')}</div>
    <div class="sel-foot"><button type="button" class="btn-main" id="pick">Выбрать</button></div>
    <div class="modal" hidden><div class="modal-card"><h2></h2><p>Этот выбор навсегда. Других героев потом можно купить за ${HERO_PRICE.toLocaleString('ru-RU')} монет.</p>
      <div class="result-btns"><button type="button" class="btn-main" id="yes">Да, выбираю</button><button type="button" class="btn-ghost" id="no">Подумаю</button></div></div></div>`;
  const row = view.querySelector<HTMLElement>('.hcards')!, btn = view.querySelector<HTMLButtonElement>('#pick')!, modal = view.querySelector<HTMLElement>('.modal')!;
  const update = () => { btn.textContent = `Выбрать: ${heroById(pick).name}`; };

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
    go(roomId ? 'room' : 'home');
  });
  update();
}

const STAT_LABEL: Record<Stat, string> = { hp: 'Здоровье', dmg: 'Урон', speed: 'Скорость', ability: 'Способность' };
const STAT_ICON: Record<Stat, string> = { hp: ICONS.heart, dmg: ICONS.damage, speed: ICONS.wing, ability: ICONS.gear };
function statValue(id: HeroId, stat: Stat, lv: number): string {
  const k = KITS[id], m = lv - 1, perks = loadProfile().perks;
  if (perks?.immortal && stat === 'hp') return '∞';
  if (perks?.damage && stat === 'dmg') return perks.damage.toLocaleString('ru-RU');
  if (perks?.noCooldown && stat === 'ability') return '0 с';
  if (stat === 'hp') return Math.round(k.hp * (1 + m * UPGRADE_STEP.hp)).toLocaleString('ru-RU');
  if (stat === 'dmg') return Math.round(k.attack.dmg * (1 + m * UPGRADE_STEP.dmg)).toLocaleString('ru-RU');
  if (stat === 'speed') return (k.speed * (1 + m * UPGRADE_STEP.speed)).toFixed(2).replace('.', ',') + ' м/с';
  return `${(k.a1.cd * (1 - m * UPGRADE_STEP.ability)).toFixed(1).replace('.', ',')} с`;
}

function heroes(): void {
  view.innerHTML = '<div class="hero-page"></div>';
  const page = view.querySelector<HTMLElement>('.hero-page')!;
  const statRow = (id: HeroId, st: Stat, lv: number, coins: number) => {
    const max = lv >= MAX_UPGRADE, cost = upgradeCost(lv), cur = statValue(id, st, lv), nxt = statValue(id, st, lv + 1);
    return `<li data-stat="${st}">
      <span class="up-name">${STAT_ICON[st]}${STAT_LABEL[st]}</span>
      <span class="up-val"><b>${cur}</b>${max || cur === nxt ? '' : `<em>→ ${nxt}</em>`}</span>
      <span class="up-bar" aria-label="${lv} из ${MAX_UPGRADE}"><s style="--k:${lv / MAX_UPGRADE}"></s><i>${lv}/${MAX_UPGRADE}</i></span>
      <button type="button" class="up-btn" data-stat="${st}" ${max || coins < cost ? 'disabled' : ''}>${max ? 'Макс.' : `${ICONS.coin}${cost}`}</button>
    </li>`;
  };
  const render = () => {
    const p = loadProfile(), h = heroById(selected), u = upgradesOf(p, h.id);
    page.innerHTML = `
      <section class="hero-card" style="--c:${h.color}">
        <div class="hero-art" style="background-image:url(${h.menu})"></div>
        <div class="hero-head">
          <span class="hero-lv"><b>${heroLevel(u)}</b><small>из ${MAX_UPGRADE}</small></span>
          <span class="hero-name"><b>${h.name}</b><span>${ROLE_ICON[h.roleIcon]}${h.role}</span></span>
          <span class="hero-coins">${ICONS.coin}<b>${p.coins.toLocaleString('ru-RU')}</b></span>
        </div>
      </section>
      <p class="hero-note">Уровень героя — среднее уровней четырёх характеристик.</p>
      <ul class="ups">${STATS.map((st) => statRow(h.id, st, u[st], p.coins)).join('')}</ul>
      <h3 class="hero-sub">Способности</h3>
      <ul class="kit">${h.abilities.map((t, i) => `<li><b>${['Атака', 'Способность'][i]}</b> ${t}</li>`).join('')}</ul>
      <h3 class="hero-sub">Другие герои</h3>
      <div class="others">${HEROES.filter((o) => o.id !== h.id).map((o) => {
        const own = p.owned.includes(o.id);
        return `<button type="button" class="other${own ? '' : ' locked'}" data-hero="${o.id}">
          <img src="${o.card}" alt=""><span class="o-name">${o.name}</span>
          <span class="o-act">${own ? `Ур. ${heroLevel(upgradesOf(p, o.id))} · играть` : `${ICONS.lock}${ICONS.coin}${(HERO_PRICE / 1000).toFixed(0)}к`}</span>
        </button>`;
      }).join('')}</div>`;
    page.classList.remove('in'); void page.offsetWidth; page.classList.add('in');
  };
  const bump = (el: Element | null, cls = 'bump') => { if (!el) return; el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls); };
  const afterUpgrade = (st: Stat) => {
    const p = loadProfile(), u = upgradesOf(p, selected);
    const row = page.querySelector<HTMLElement>(`.ups li[data-stat="${st}"]`)!;
    const tpl = document.createElement('template');
    tpl.innerHTML = statRow(selected, st, u[st], p.coins).trim();
    const next = tpl.content.firstElementChild!;
    row.querySelector('.up-val')!.replaceWith(next.querySelector('.up-val')!);
    row.querySelector('.up-btn')!.replaceWith(next.querySelector('.up-btn')!);
    row.querySelector('.up-bar i')!.textContent = `${u[st]}/${MAX_UPGRADE}`;
    row.querySelector<HTMLElement>('.up-bar s')!.style.setProperty('--k', String(u[st] / MAX_UPGRADE));
    bump(row, 'flash');
    page.querySelectorAll<HTMLButtonElement>('.up-btn[data-stat]').forEach((b) => {
      const lv = u[b.dataset.stat as Stat];
      if (lv < MAX_UPGRADE) b.disabled = p.coins < upgradeCost(lv);
    });
    const lvEl = page.querySelector('.hero-lv b')!, coinsEl = page.querySelector('.hero-coins b')!;
    if (lvEl.textContent !== String(heroLevel(u))) { lvEl.textContent = String(heroLevel(u)); bump(page.querySelector('.hero-lv')); }
    coinsEl.textContent = p.coins.toLocaleString('ru-RU');
    bump(page.querySelector('.hero-coins'));
  };
  page.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const up = t.closest<HTMLButtonElement>('.up-btn');
    if (up) { const st = up.dataset.stat as Stat; if (upgrade(selected, st)) { haptic('success'); afterUpgrade(st); } return; }
    const o = t.closest<HTMLButtonElement>('.other');
    if (!o) return;
    const id = o.dataset.hero as HeroId, p = loadProfile();
    if (!p.owned.includes(id)) {
      if (p.coins < HERO_PRICE) { haptic('light'); o.classList.remove('nope'); void o.offsetWidth; o.classList.add('nope'); return; }
      if (!buyHero(id)) return;
    }
    selected = id; store.set('dvor.hero', id); haptic('success'); render();
  });
  render();
}

function empty(title: string, text: string): void {
  view.innerHTML = `<div class="empty"><h1>${title}</h1><p>${text}</p></div>`;
}

function rating(): void {
  const p = loadProfile(), r = rankOf(p.trophies), nx = nextRank(p.trophies), lv = heroLevelOf(selected);
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
        <span><b>${lv}</b>ур. героя</span><span><b>${p.games}</b>боёв</span><span><b>${p.games ? Math.round((100 * p.wins) / p.games) : 0}%</b>побед</span><span><b>${p.kills}</b>выбито</span>
      </div>
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

let roomId = '';
let online: Online | null = null;
function room(): void {
  const id = roomId, me = heroById(selected);
  const hello: Peer = { name: playerName(), hero: selected, boost: boostOf(selected) };
  view.innerHTML = `${backBtn()}
    <section class="room">
      <h1>Бой с другом</h1>
      <p class="room-sub">Ты и друг, у каждого в команде бот. Круг, 2 минуты.</p>
      <div class="room-vs">
        <figure class="room-card"><img src="${me.card}" alt=""><figcaption><b>${playerName()}</b><span>${me.name}</span></figcaption></figure>
        <span class="room-x">VS</span>
        <figure class="room-card rival"><span class="room-ghost">${ICONS.person}</span><figcaption><b>Ждём…</b><span>соперник</span></figcaption></figure>
      </div>
      <p class="room-status" aria-live="polite">Подключаюсь…</p>
      <button type="button" class="btn-main" id="invite">Позвать друга</button>
      <p class="room-code">Комната <b>${id}</b></p>
    </section>`;
  bindBack();
  const status = view.querySelector<HTMLElement>('.room-status')!, invite = view.querySelector<HTMLButtonElement>('#invite')!;
  const rival = view.querySelector<HTMLElement>('.room-card.rival')!;
  const link = new RoomLink(id, hello);
  let handed = false, rivalPeer: Peer | null = null;
  const fail = (text: string) => {
    status.textContent = text;
    status.classList.add('bad');
    invite.textContent = 'Создать новую комнату';
    invite.onclick = () => { haptic('light'); roomId = newRoomId(); go('room'); };
  };
  const toBattle = (role: 'host' | 'guest', peer: Peer, blue: HeroId[], red: HeroId[]) => {
    handed = true;
    online = { link, role, blue, red, rival: peer };
    status.textContent = 'Бой начинается!';
    haptic('success');
    setTimeout(() => { off(); go('battle'); }, 900);
  };
  const off = link.on((m) => {
    if (m.t === 'wait') { status.textContent = 'Ждём соперника. Отправь другу приглашение.'; status.classList.remove('bad'); }
    else if (m.t === 'start') {
      const peer = (m.role === 'host' ? m.guest : m.host) as Peer;
      rivalPeer = peer;
      const card = heroById(peer.hero);
      rival.innerHTML = `<img src="${card.card}" alt=""><figcaption><b>${peer.name}</b><span>${card.name}</span></figcaption>`;
      rival.classList.add('found');
      invite.hidden = true;
      status.textContent = `${peer.name} в комнате!`;
      if (m.role === 'host') {
        const a = (m.host as Peer).hero, b = peer.hero;
        const bots = HEROES.map((h) => h.id).filter((h) => h !== a && h !== b).sort(() => Math.random() - 0.5);
        const blue: HeroId[] = [a, bots[0]], red: HeroId[] = [b, bots[1] ?? bots[0]];
        link.send({ t: 'go', blue, red });
        toBattle('host', peer, blue, red);
      }
    } else if (m.t === 'go' && rivalPeer) toBattle('guest', rivalPeer, m.blue as HeroId[], m.red as HeroId[]);
    else if (m.t === 'full' || m.t === 'over') fail('В этой комнате уже идёт бой.');
    else if (m.t === 'left') { status.textContent = 'Соперник вышел. Ждём нового.'; rival.classList.remove('found'); }
    else if (m.t === 'closed' && !handed) fail('Нет связи с сервером. Проверь интернет.');
  });
  invite.onclick = async () => {
    haptic('light');
    const r = await inviteFriend(id);
    if (r === 'shared') status.textContent = 'Приглашение отправлено. Ждём соперника.';
    else if (r === 'copied') status.textContent = 'Ссылка скопирована — отправь её другу.';
    else if (r === 'none') status.textContent = `Отправь другу ссылку: ${roomLink(id)}`;
  };
  cleanup = () => { if (!handed) link.close(); };
}

function battle(): void {
  const net = online;
  online = null;
  roomId = '';
  let b: Battle | null = startBattle(view, selected, () => go('home'), nextBlue.length ? nextBlue : undefined, net ?? undefined);
  cleanup = () => { b?.destroy(); b = null; };
}

const TIPS = [
  'Стой в круге с короной — команда получает очки',
  'Турель Техника сама стреляет 8 секунд',
  'Таран Танка оглушает всех на пути',
  'Пластинки Спринтера отскакивают от стен',
  'Бронебойная пуля Снайпера пробивает всех на линии',
  'Аптечка Медика лечит всех рядом',
  'Атака идёт сама — следи за позицией и кнопками',
  'Двойной тап под джойстиком — рывок',
  'Побеждай, чтобы подняться из Бронзы в Серебро',
  'Выбитый игрок возвращается через 3 секунды',
];

function boot(): void {
  const box = document.getElementById('boot')!;
  const bar = box.querySelector<HTMLElement>('.sp-bar i')!, tip = box.querySelector<HTMLElement>('.sp-tip')!;
  box.querySelector('.sp-pct')!.innerHTML = 'Загрузка <b>0</b>%';
  const pct = box.querySelector('.sp-pct b')!;
  box.classList.add('live');
  let ti = Math.floor(Math.random() * TIPS.length);
  const nextTip = () => { tip.textContent = TIPS[ti++ % TIPS.length]; tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in'); };
  nextTip();
  const tipTimer = window.setInterval(nextTip, 2600);
  let shown = 0, target = 0;
  const anim = window.setInterval(() => {
    shown += (target - shown) * 0.25;
    if (target - shown < 0.002) shown = target;
    bar.style.width = `${(shown * 100).toFixed(1)}%`;
    pct.textContent = String(Math.floor(shown * 100));
  }, 33);

  const cloud = () => Promise.race([syncOnBoot(), new Promise<void>((r) => setTimeout(r, 4000))]);
  const run = () => Promise.all([initTelegram().then(cloud), preloadAll((k) => (target = k))]);
  const finish = () => {
    target = 1;

    const wait = Math.max(0, 2300 - performance.now());
    setTimeout(() => {
      clearInterval(tipTimer);
      box.classList.add('done');
      setTimeout(() => {
        const p = loadProfile();
        selected = ownedHero(store.get('dvor.hero'));
        if (p.games > 0 && p.chosen) void postResult(p, selected);
        const sp = startParam().match(/^r_([a-z0-9]{6,16})$/);
        if (sp) roomId = sp[1];
        go(!p.storySeen ? 'story' : !p.chosen ? 'choose' : roomId ? 'room' : current);
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
