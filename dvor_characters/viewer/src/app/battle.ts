import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { load, loadColliders } from './assets';
import type { Collider } from './game/arena';
import { HEROES, heroById, type HeroId } from './data';
import { Match, lineup, type PlayerInput, type Snapshot, type Team, type UnitView } from './game/match';
import type { Peer, RoomLink } from './net';
import { applyResult, botSkill, boostOf, heroLevelOf, loadProfile, rankOf } from './progress';
import { postGameScore, postResult } from './api';
import { MATCH } from './game/kits';
import { ICONS, rankBadge } from './icons';
import { haptic, inTelegram } from './tg';

export interface Battle { destroy(): void }
export interface Online { link: RoomLink; role: 'host' | 'guest'; blue: HeroId[]; red: HeroId[]; rival: Peer }

const ABILITY_ICON: Record<HeroId, string> = {
  technik: ICONS.turret, tank: ICONS.ram, sprinter: ICONS.speed, sniper: ICONS.bullet, medic: ICONS.medkit,
};

export function startBattle(root: HTMLElement, heroId: HeroId, onExit: () => void, firstBlue?: HeroId[], online?: Online): Battle {
  const me = heroById(heroId);
  root.innerHTML = `
    <div class="battle-stage"></div>
    <div class="battle-hud">
      <div class="scorebar">
        <div class="team blue"><span class="faces"></span><span class="score" id="s0">0</span></div>
        <div class="timer" id="timer" title="Цвет — чей круг">2:00</div>
        <div class="team red"><span class="score" id="s1">0</span><span class="faces"></span></div>
      </div>
      <div class="feed" aria-live="polite"></div>
      <button class="exit" type="button" aria-label="Выйти из боя">${ICONS.close}</button>
      <div class="stick-zone" role="application" aria-label="Джойстик: веди пальцем, двойной тап — рывок">
        <div class="stick"><span class="arr u"></span><span class="arr d"></span><span class="arr l"></span><span class="arr r"></span><div class="knob"></div><i class="dash-ring"></i></div>
      </div>
      <div class="skills one">
        <button type="button" class="sk main" data-k="a1" aria-label="${me.name}: ${me.abilities[1]}">${ABILITY_ICON[heroId]}<em></em></button>
      </div>
      <div class="hint" hidden><p><b>Атака — сама</b> по ближнему врагу</p><p><b>Двойной тап</b> под джойстиком — рывок</p><p><b>Тап по арене</b> — выстрел туда</p></div>
      <div class="dead" hidden>Возвращение через <b>3</b></div>
      <div class="countdown" hidden></div>
      <div class="result" hidden></div>
      <div class="battle-loading"><div class="bar"><i></i></div><p>Загружаю арену</p></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stage = $('.battle-stage'), hud = $('.battle-hud'), loadEl = $('.battle-loading'), loadBar = loadEl.querySelector<HTMLElement>('i')!;
  const timerEl = $('#timer'), s0 = $('#s0'), s1 = $('#s1');
  const feed = $('.feed'), deadEl = $('.dead'), cdEl = $('.countdown'), resEl = $('.result');
  const hintEl = $('.hint'), zoneStick = $('.stick-zone');
  let alive = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5d5560);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4a796, 2.3));
  const sun = new THREE.DirectionalLight(0xfff8f0, 1.9);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
  const camTarget = new THREE.Vector3(0, 0, 6);
  const camYaw = Math.PI;
  const resize = () => {
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  let trauma = 0, shakeT = 0;
  const shake = (amount: number) => { trauma = Math.min(1, trauma + amount); };
  const placeCamera = (dt = 0) => {
    trauma = Math.max(0, trauma - dt * 1.6);
    shakeT += dt * 30;
    const k = trauma * trauma * 0.12;
    const ox = k * Math.sin(shakeT * 1.7), oy = k * Math.sin(shakeT * 2.3);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const over = Math.max(0, Math.abs(camTarget.z - fz * 11) - 13.5);
    const tz = camTarget.z + fz * over;
    camera.position.set(camTarget.x - fx * 11 + ox, 6.8 + oy, tz - fz * 11);
    camera.lookAt(camTarget.x + fx * 2.2 + ox, 0.7 + oy, tz + fz * 2.2);
  };

  let match: Match | null = null;
  const bars = new Map<number, HTMLElement>();
  const sizes = new Map<string, number>();
  const expect: Record<string, number> = { MAP_Dvor: 760e3, ...Object.fromEntries(HEROES.map((h) => [h.model, 400e3])) };
  const onBytes = (id: string, n: number) => {
    sizes.set(id, n);
    const total = Object.values(expect).reduce((a, b) => a + b, 0);
    const got = Object.keys(expect).reduce((a, k) => a + Math.min(sizes.get(k) ?? 0, expect[k]), 0);
    loadBar.style.transform = `scaleX(${got / total})`;
  };

  const v = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * stage.clientWidth, ((1 - v.y) / 2) * stage.clientHeight];
  };
  const popNumber = (x: number, y: number, z: number, n: number, team: Team, heal = false) => {
    if (n <= 0) return;
    const [sx, sy] = toScreen(x, y, z);
    const el = document.createElement('span');
    el.className = `dmg ${heal ? 'heal' : team === mine ? 'ours' : 'theirs'}`;
    el.textContent = heal ? `+${n}` : String(n);
    el.style.left = `${sx + (Math.random() - 0.5) * 24}px`;
    el.style.top = `${sy}px`;
    hud.appendChild(el);
    setTimeout(() => el.remove(), 750);
  };
  const killFeed = (killer: string | null, victim: string, victimTeam: Team) => {
    const el = document.createElement('p');
    const ours = victimTeam === mine;
    el.innerHTML = `${killer ? `<b class="${ours ? 'r' : 'b'}">${killer}</b> → ` : ''}<b class="${ours ? 'b' : 'r'}">${victim}</b>`;
    feed.prepend(el);
    setTimeout(() => el.remove(), 3500);
    while (feed.children.length > 3) feed.lastElementChild?.remove();
  };
  const label = (u: UnitView) => (u.isPlayer ? 'Ты' : u.human && online ? online.rival.name : u.hero.name);
  let mine: Team = 0;
  const note = (text: string) => {
    const el = document.createElement('p');
    el.textContent = text;
    feed.prepend(el);
    setTimeout(() => el.remove(), 4000);
  };

  const showResult = (r: { winner: Team | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number; healed: number } }) => {
    haptic(r.winner === 0 ? 'success' : 'medium');
    const title = r.winner === 0 ? 'Победа!' : r.winner === 1 ? 'Поражение' : 'Ничья';
    const rw = applyResult(heroId, r);
    void postResult(rw.after, heroId);
    void postGameScore(rw.after, heroId);
    const rank = rankOf(rw.after.trophies), lv = heroLevelOf(heroId);
    resEl.className = `result ${r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw'}`;
    resEl.innerHTML = `
      <div class="result-card">
        <h2>${title}</h2>
        <p class="result-score"><span class="b">${r.score[0]}</span> : <span class="r">${r.score[1]}</span></p>
        <div class="result-reward">
          <span class="rr-badge">${rankBadge(rank.color, rank.dark)}</span>
          <span class="rr-text"><b>${rank.name}</b><span>${ICONS.trophy}${rw.after.trophies} <em class="${rw.trophies > 0 ? 'up' : rw.trophies < 0 ? 'down' : ''}">${rw.trophies > 0 ? '+' : ''}${rw.trophies}</em></span></span>
          <span class="rr-hero"><b>${me.name}</b><span>ур. ${lv}</span></span>
        </div>
        <p class="result-loot"><span>${ICONS.coin}+${rw.coins}</span>${rw.gems ? `<span>${ICONS.gem}+${rw.gems}</span>` : ''}</p>
        ${rw.rankUp ? `<p class="result-up">Новый ранг: <b>${rw.rankUp.name}</b></p>` : ''}
        <ul>
          <li><span>Выбито</span><b>${r.you.kills}</b></li>
          <li><span>Выбыл</span><b>${r.you.deaths}</b></li>
          <li><span>${r.you.healed > 0 ? 'Вылечено' : 'Урон'}</span><b>${(r.you.healed > 0 ? r.you.healed : r.you.dealt).toLocaleString('ru-RU')}</b></li>
        </ul>
        <div class="result-btns">${online ? '' : '<button type="button" class="btn-main" id="again">Ещё раз</button>'}<button type="button" class="btn-ghost" id="home">На главную</button></div>
      </div>`;
    resEl.hidden = false;
    resEl.querySelector('#again')?.addEventListener('click', () => { haptic('light'); newMatch(); });
    resEl.querySelector('#home')!.addEventListener('click', () => { haptic('light'); onExit(); });
  };

  let assets: { map: GLTF; heroes: Record<HeroId, GLTF>; colliders: Collider[]; props: GLTF } | null = null;
  let arena: THREE.Object3D | null = null;
  let countdownTimers: number[] = [];

  function newMatch(): void {
    if (!assets) return;
    match?.dispose();
    for (const o of [...scene.children]) if (o !== arena && !(o as THREE.Light).isLight) scene.remove(o);
    for (const b of bars.values()) b.remove();
    bars.clear();
    feed.innerHTML = '';
    resEl.hidden = true;
    const blue = online?.blue ?? firstBlue ?? lineup(heroId), red = online?.red ?? lineup();
    firstBlue = undefined;
    mine = online?.role === 'guest' ? 1 : 0;
    const faces = (list: HeroId[]) => list.map((id) => `<img src="${heroById(id).card}" alt="${heroById(id).name}">`).join('');
    root.querySelector('.team.blue .faces')!.innerHTML = faces(mine ? red : blue);
    root.querySelector('.team.red .faces')!.innerHTML = faces(mine ? blue : red);
    match = new Match(scene, assets.heroes, assets.colliders, heroId, {
      damage: (x, y, z, n, team, heal) => popNumber(x, y, z, n, team, heal),
      kill: (k, vic) => { killFeed(k ? label(k) : null, label(vic), vic.team); if (vic.isPlayer) haptic('medium'); if (k?.isPlayer) { shake(0.35); haptic('light'); } },
      shake: (a) => shake(a),
      end: (r) => {
        if (online) endMsg = { t: 'end', winner: r.winner, score: r.score };
        setTimeout(() => alive && showResult(r), 1200);
      },
    }, assets.props, online
      ? { blue, red, net: online.role, playerBoost: boostOf(heroId), rivalBoost: online.rival.boost }
      : { blue, red, skill: botSkill(loadProfile().trophies), playerBoost: boostOf(heroId) });
    for (const u of match.views()) {
      const el = document.createElement('div');
      el.className = `hp ${u.team === mine ? 'blue' : 'red'}${u.isPlayer ? ' me' : ''}`;
      el.innerHTML = `<b></b><i><s></s></i>${u.isPlayer && u.hero.id === 'technik' ? '<u><s></s></u>' : ''}`;
      hud.insertBefore(el, feed);
      bars.set(u.id, el);
    }
    const p = match.views().find((u) => u.isPlayer)!;
    camTarget.set(p.x, 0, p.z);
    beginCountdown();
  }
  function beginCountdown(): void {

    cdEl.hidden = false;
    hintEl.hidden = false;
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [3, 2, 1, 0].map((n, i) => window.setTimeout(() => {
      cdEl.textContent = n ? String(n) : 'Бой!';
      cdEl.classList.remove('pop'); void cdEl.offsetWidth; cdEl.classList.add('pop');
      if (!n) { match?.start(); haptic('light'); countdownTimers.push(window.setTimeout(() => (cdEl.hidden = true), 700), window.setTimeout(() => (hintEl.hidden = true), 2500)); }
    }, i * 700));
  }

  (async () => {
    const [map, cols, props, ...chars] = await Promise.all([
      load('MAP_Dvor', onBytes),
      loadColliders(),
      load('PROPS', onBytes),
      ...HEROES.map((h) => load(h.model, onBytes)),
    ]);
    if (!alive) return;
    arena = map.scene.clone();
    arena.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      const m = o as THREE.Mesh;
      const mat = m.isMesh ? (m.material as THREE.MeshBasicMaterial) : null;
      if (mat?.map) mat.map.anisotropy = 4;
    });
    scene.add(arena);
    const heroes = Object.fromEntries(HEROES.map((h, i) => [h.id, chars[i]])) as Record<HeroId, GLTF>;
    assets = { map, heroes, colliders: cols as Collider[], props: props as GLTF };
    loadEl.hidden = true;
    newMatch();
  })().catch((e) => {
    loadEl.querySelector('p')!.textContent = `Не удалось загрузить арену: ${e?.message ?? e}`;
  });

  const stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0, lastTap: 0 };
  const stickEl = $('.stick'), knobEl = $('.knob');
  const pending = { a1: false, dash: false };
  const R_STICK = () => stickEl.offsetWidth / 2 || 60;
  const moveStick = (e: PointerEvent) => {
    const R = R_STICK();
    let dx = (e.clientX - stick.cx) / R, dy = (stick.cy - e.clientY) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    stick.x = dx; stick.y = dy;
    knobEl.style.transform = `translate(${dx * R * 0.55}px, ${-dy * R * 0.55}px)`;
  };
  const release = () => {
    stick.id = -1; stick.x = stick.y = 0; knobEl.style.transform = '';
    stickEl.classList.remove('on'); stickEl.style.left = stickEl.style.top = '';
  };
  zoneStick.addEventListener('pointerdown', (e) => {
    if (stick.id >= 0) return;
    const now = performance.now();
    if (now - stick.lastTap < 320) { pending.dash = true; haptic('light'); stickEl.classList.remove('dashed'); void stickEl.offsetWidth; stickEl.classList.add('dashed'); }
    stick.lastTap = now;
    stick.id = e.pointerId; zoneStick.setPointerCapture(e.pointerId);
    const zr = zoneStick.getBoundingClientRect(), R = R_STICK();

    stick.cx = Math.min(zr.right - R, Math.max(zr.left + R, e.clientX));
    stick.cy = Math.min(zr.bottom - R, Math.max(zr.top + R, e.clientY));
    stickEl.style.left = `${stick.cx - zr.left - R}px`;
    stickEl.style.top = `${stick.cy - zr.top - R}px`;
    stickEl.classList.add('on');
    moveStick(e); e.preventDefault();
  });
  zoneStick.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
  zoneStick.addEventListener('pointerup', release);
  zoneStick.addEventListener('pointercancel', release);
  zoneStick.addEventListener('lostpointercapture', release);

  const skA1 = $('.sk[data-k="a1"]'), dashRing = $('.dash-ring');
  skA1.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pending.a1 = true;
    haptic('light');
    skA1.classList.remove('press'); void skA1.offsetWidth; skA1.classList.add('press');
  });

  const keys = new Set<string>();
  const KEYMAP: Record<string, [number, number]> = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const kd = (e: KeyboardEvent) => {
    if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'KeyJ') { keys.add('atk'); e.preventDefault(); }
    if (e.code === 'KeyK' || e.code === 'KeyE') pending.a1 = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') pending.dash = true;
  };
  const ku = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Space' || e.code === 'KeyJ') keys.delete('atk'); };
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);

  let aimShot: [number, number] | null = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  stage.addEventListener('pointerdown', (e) => {
    if (!match) return;
    const r = stage.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const p = match.views().find((u) => u.isPlayer)!;
    const dx = hit.x - p.x, dz = hit.z - p.z, l = Math.hypot(dx, dz) || 1;
    aimShot = [dx / l, dz / l];
  });

  $('.exit').hidden = inTelegram();
  $('.exit').addEventListener('click', () => onExit());

  const readInput = (): PlayerInput => {
    let mx = 0, my = 0;
    if (stick.id >= 0) { mx = stick.x; my = stick.y; } else {
      for (const k of keys) if (KEYMAP[k]) { mx += KEYMAP[k][0]; my += KEYMAP[k][1]; }
      const l = Math.hypot(mx, my); if (l) { mx /= l; my /= l; }
    }
    let attack: PlayerInput['attack'] = null;
    if (aimShot) { attack = { dir: [aimShot[0], aimShot[1]] }; aimShot = null; }
    else if (keys.has('atk')) attack = { dir: null };

    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const wx = mx * rx + my * fx, wz = mx * rz + my * fz;
    const inp: PlayerInput = { move: [wx, -wz], attack, auto: true, a1: pending.a1, dash: pending.dash };
    pending.a1 = pending.dash = false;
    return inp;
  };

  let gone = false, sendAt = 0, endMsg: { t: 'end'; winner: number; score: [number, number] } | null = null;
  const net = { a1: false, dash: false, attack: null as PlayerInput['attack'] };
  const sync = (t: number, inp: PlayerInput) => {
    if (!online || !match) return;
    if (online.role === 'host') {
      if (t - sendAt < 66 && !endMsg) return;
      sendAt = t;
      online.link.send({ t: 's', d: match.snapshot() });
      if (endMsg) { online.link.send(endMsg); endMsg = null; gone = true; }
      return;
    }
    net.a1 ||= inp.a1;
    net.dash ||= inp.dash;
    net.attack ??= inp.attack;
    if (t - sendAt < 66 && !net.a1 && !net.dash && !net.attack) return;
    sendAt = t;
    online.link.send({ t: 'i', inp: { move: inp.move, auto: true, attack: net.attack, a1: net.a1, dash: net.dash } });
    net.a1 = net.dash = false;
    net.attack = null;
  };
  const abort = (text: string) => {
    gone = true;
    resEl.className = 'result draw';
    resEl.innerHTML = `<div class="result-card"><h2>Бой прерван</h2><p class="result-up">${text}</p>
      <div class="result-btns"><button type="button" class="btn-main" id="home">На главную</button></div></div>`;
    resEl.hidden = false;
    resEl.querySelector('#home')!.addEventListener('click', () => { haptic('light'); onExit(); });
  };
  const offNet = online?.link.on((m) => {
    if (m.t === 's' && online.role === 'guest') match?.applySnapshot(m.d as Snapshot);
    else if (m.t === 'i' && online.role === 'host') match?.setRemote(m.inp as PlayerInput);
    else if (m.t === 'end' && online.role === 'guest' && match) {
      gone = true;
      const w = m.winner as number, sc = m.score as [number, number];
      const r = { winner: (w === -1 ? -1 : w === mine ? 0 : 1) as Team | -1, score: [sc[mine], sc[1 - mine]] as [number, number], you: match.stats() };
      setTimeout(() => alive && showResult(r), 1200);
    } else if ((m.t === 'left' || m.t === 'closed') && !gone && !match?.ended) {
      if (online.role === 'host' && match) { match.dropRemote(); note(`${online.rival.name} вышел — за него играет бот`); }
      else abort('Соперник отключился. Кубки не списаны.');
    }
  });

  const setCd = (b: HTMLElement, left: number, max: number) => {
    b.style.setProperty('--cd', String(max ? left / max : 0));
    b.classList.toggle('cooling', left > 0.05);
    b.querySelector('em')!.textContent = left > 0.05 ? String(Math.ceil(left)) : '';
  };
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 1 / 15);
    if (match) {
      const inp = readInput();
      match.update(dt, inp);
      if (online && !gone) sync(t, inp);
      const views = match.views();
      const p = views.find((u) => u.isPlayer)!;
      camTarget.x += (p.x - camTarget.x) * Math.min(1, dt * 10);
      camTarget.z += (p.z - camTarget.z) * Math.min(1, dt * 10);
      for (const u of views) {
        const el = bars.get(u.id)!;
        el.hidden = !u.alive;
        if (!u.alive) continue;
        v.set(u.x, 1.95, u.z).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.2) { el.hidden = true; continue; }
        const [sx, sy] = toScreen(u.x, 1.95, u.z);
        el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        el.querySelector('b')!.textContent = u.immortal ? '∞' : String(u.hp);
        el.querySelector<HTMLElement>('i s')!.style.transform = `scaleX(${u.hp / u.maxHp})`;
        const heat = el.querySelector<HTMLElement>('u s');
        if (heat) { heat.style.transform = `scaleX(${u.overheated ? 1 : u.heat / 6})`; heat.parentElement!.classList.toggle('hot', u.overheated); }
      }
      s0.textContent = String(Math.floor(match.score[mine]));
      s1.textContent = String(Math.floor(match.score[1 - mine]));
      const left = Math.max(0, Math.ceil(MATCH.seconds - match.time));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      const zo = match.zoneOwner;
      timerEl.dataset.owner = String(zo === mine ? 0 : zo === 1 - mine ? 1 : zo);
      deadEl.hidden = p.alive || match.ended;
      if (!p.alive) deadEl.querySelector('b')!.textContent = String(Math.ceil(p.respawnIn));
      const cd = match.cooldowns();
      setCd(skA1, cd.a1, cd.a1Max);
      dashRing.style.setProperty('--cd', String(cd.dashMax ? cd.dash / cd.dashMax : 0));
    }
    placeCamera(dt);
    renderer.render(scene, camera);
  });

  return {
    destroy() {
      alive = false;
      countdownTimers.forEach(clearTimeout);
      renderer.setAnimationLoop(null);
      ro.disconnect();
      removeEventListener('keydown', kd);
      removeEventListener('keyup', ku);
      match?.dispose();
      offNet?.();
      online?.link.close();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
