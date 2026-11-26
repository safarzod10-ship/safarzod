/**
 * Battle screen: «Царь двора» 3 на 3 against bots (game/match.ts) on the real 3D arena and models,
 * with the HUD from the mockup: joystick, attack (tap = auto-aim, drag = aim), two hero abilities,
 * dash, score / timer, HP bars, damage numbers, kill feed and the result screen.
 *
 * Assets: <html data-assets="b64"> (claude.ai artifact: no .glb hosting, no WebAssembly) loads
 * models/<id>.txt (base64 GLB without Meshopt); otherwise models/<id>.glb with the Meshopt decoder.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Collider } from '../arena';
import { HEROES, heroById, type HeroId } from './data';
import { Match, type PlayerInput, type Team } from './game/match';
import { MATCH } from './game/kits';
import { ICONS } from './icons';
import { haptic } from './tg';

const BASE = './models/';
const B64 = document.documentElement.dataset.assets === 'b64';

let loaderP: Promise<GLTFLoader> | null = null;
function getLoader(): Promise<GLTFLoader> {
  loaderP ??= (async () => {
    const l = new GLTFLoader();
    if (B64) {
      (window as unknown as { createImageBitmap?: unknown }).createImageBitmap = undefined;   // <img> decoding
    } else {
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      l.setMeshoptDecoder(MeshoptDecoder);
    }
    return l;
  })();
  return loaderP;
}

const cache = new Map<string, Promise<GLTF>>();
function load(id: string, onBytes: (id: string, n: number) => void): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const loader = await getLoader();
      if (!B64) return loader.loadAsync(`${BASE}${id}.glb`, (e) => onBytes(id, e.loaded));
      const res = await fetch(`${BASE}${id}.txt`);
      if (!res.ok || !res.body) throw new Error(`${id}: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
        onBytes(id, n * 0.75);
      }
      const all = new Uint8Array(n);
      let o = 0;
      for (const q of parts) { all.set(q, o); o += q.length; }
      const bin = atob(new TextDecoder().decode(all));
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return loader.parseAsync(buf.buffer, BASE);
    })();
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}


export interface Battle { destroy(): void }

const ABILITY_ICONS: Record<HeroId, [string, string]> = {
  technik: [ICONS.turret, ICONS.cloud],
  tank: [ICONS.door, ICONS.ram],
  sprinter: [ICONS.speed, ICONS.wave],
};

export function startBattle(root: HTMLElement, heroId: HeroId, onExit: () => void): Battle {
  const me = heroById(heroId);
  const blue = [heroId, ...HEROES.map((h) => h.id).filter((id) => id !== heroId)].map(heroById);
  const red = (['tank', 'technik', 'sprinter'] as HeroId[]).map(heroById);
  const [ic1, ic2] = ABILITY_ICONS[heroId];
  root.innerHTML = `
    <div class="battle-stage"></div>
    <div class="battle-hud">
      <div class="scorebar">
        <div class="team blue">${blue.map((h) => `<img src="${h.card}" alt="${h.name}">`).join('')}<span class="score" id="s0">0</span></div>
        <div class="timer" id="timer">2:00</div>
        <div class="team red"><span class="score" id="s1">0</span>${red.map((h) => `<img src="${h.card}" alt="${h.name}">`).join('')}</div>
      </div>
      <div class="zonebar"><i class="z0"></i><span id="zone">Круг ничей</span><i class="z1"></i></div>
      <div class="feed" aria-live="polite"></div>
      <button class="exit" type="button" aria-label="Выйти из боя">${ICONS.close}</button>
      <div class="stick" role="application" aria-label="Джойстик"><span class="arr u"></span><span class="arr d"></span><span class="arr l"></span><span class="arr r"></span><div class="knob"></div></div>
      <div class="skills">
        <button type="button" class="sk run" data-k="dash" aria-label="Рывок">${ICONS.run}<em></em></button>
        <button type="button" class="sk main" data-k="a1" aria-label="${me.name}: способность 1">${ic1}<em></em></button>
        <button type="button" class="sk cloud" data-k="a2" aria-label="${me.name}: способность 2">${ic2}<em></em></button>
        <button type="button" class="sk aim" data-k="atk" aria-label="Атака">${ICONS.crosshair}</button>
      </div>
      <div class="aimline" hidden></div>
      <div class="dead" hidden>Возвращение через <b>3</b></div>
      <div class="countdown" hidden></div>
      <div class="result" hidden></div>
      <div class="battle-loading"><div class="bar"><i></i></div><p>Загружаю арену</p></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stage = $('.battle-stage'), hud = $('.battle-hud'), loadEl = $('.battle-loading'), loadBar = loadEl.querySelector<HTMLElement>('i')!;
  const timerEl = $('#timer'), s0 = $('#s0'), s1 = $('#s1'), zoneEl = $('#zone'), zoneBar = $('.zonebar');
  const stickEl = $('.stick'), knobEl = $('.knob'), feed = $('.feed'), deadEl = $('.dead'), cdEl = $('.countdown'), resEl = $('.result');
  const aimLine = $('.aimline');
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
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 120);
  const camTarget = new THREE.Vector3(0, 0, 6);
  const resize = () => {
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  const placeCamera = () => {
    const dist = camera.aspect < 1 ? 17 : 15;
    const el = THREE.MathUtils.degToRad(57);
    camera.position.set(camTarget.x, Math.sin(el) * dist, camTarget.z + Math.cos(el) * dist);
    camera.lookAt(camTarget.x, 0, camTarget.z + 0.3);
  };

  let match: Match | null = null;
  const bars = new Map<number, HTMLElement>();
  const sizes = new Map<string, number>();
  const expect: Record<string, number> = { MAP_Dvor: 760e3, USER_CH_Technik: 310e3, USER_CH_Tank: 290e3, USER_CH_Sprinter: 330e3 };
  const onBytes = (id: string, n: number) => {
    sizes.set(id, n);
    const total = Object.values(expect).reduce((a, b) => a + b, 0);
    const got = Object.keys(expect).reduce((a, k) => a + Math.min(sizes.get(k) ?? 0, expect[k]), 0);
    loadBar.style.width = `${Math.round((100 * got) / total)}%`;
  };

  // ---- floating damage numbers and kill feed
  const v = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * stage.clientWidth, ((1 - v.y) / 2) * stage.clientHeight];
  };
  const popNumber = (x: number, y: number, z: number, n: number, team: Team) => {
    const [sx, sy] = toScreen(x, y, z);
    const el = document.createElement('span');
    el.className = `dmg ${team === 0 ? 'ours' : 'theirs'}`;
    el.textContent = String(n);
    el.style.left = `${sx + (Math.random() - 0.5) * 24}px`;
    el.style.top = `${sy}px`;
    hud.appendChild(el);
    setTimeout(() => el.remove(), 750);
  };
  const killFeed = (killer: string | null, victim: string, victimTeam: Team) => {
    const el = document.createElement('p');
    el.innerHTML = `${killer ? `<b class="${victimTeam === 0 ? 'r' : 'b'}">${killer}</b> → ` : ''}<b class="${victimTeam === 0 ? 'b' : 'r'}">${victim}</b>`;
    feed.prepend(el);
    setTimeout(() => el.remove(), 3500);
    while (feed.children.length > 3) feed.lastElementChild?.remove();
  };
  const label = (u: { team: Team; isPlayer: boolean; hero: { name: string } }) => (u.isPlayer ? 'Ты' : u.hero.name);

  // ---- result screen
  const showResult = (r: { winner: Team | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number } }) => {
    haptic(r.winner === 0 ? 'success' : 'medium');
    const title = r.winner === 0 ? 'Победа!' : r.winner === 1 ? 'Поражение' : 'Ничья';
    resEl.className = `result ${r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw'}`;
    resEl.innerHTML = `
      <div class="result-card">
        <h2>${title}</h2>
        <p class="result-score"><span class="b">${r.score[0]}</span> : <span class="r">${r.score[1]}</span></p>
        <ul>
          <li><span>Выбито</span><b>${r.you.kills}</b></li>
          <li><span>Выбыл</span><b>${r.you.deaths}</b></li>
          <li><span>Урон</span><b>${r.you.dealt.toLocaleString('ru-RU')}</b></li>
        </ul>
        <div class="result-btns"><button type="button" class="btn-main" id="again">Ещё раз</button><button type="button" class="btn-ghost" id="home">На главную</button></div>
      </div>`;
    resEl.hidden = false;
    resEl.querySelector('#again')!.addEventListener('click', () => { haptic('light'); restart(); });
    resEl.querySelector('#home')!.addEventListener('click', () => { haptic('light'); onExit(); });
  };

  let assets: { map: GLTF; heroes: Record<HeroId, GLTF>; colliders: Collider[] } | null = null;
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
    match = new Match(scene, assets.heroes, assets.colliders, heroId, {
      damage: (x, y, z, n, team) => popNumber(x, y, z, n, team),
      kill: (k, vic) => { killFeed(k ? label(k) : null, label(vic), vic.team); if (vic.isPlayer) haptic('medium'); },
      end: (r) => setTimeout(() => alive && showResult(r), 1200),
    });
    for (const u of match.views()) {
      const el = document.createElement('div');
      el.className = `hp ${u.team === 0 ? 'blue' : 'red'}${u.isPlayer ? ' me' : ''}`;
      el.innerHTML = `<b></b><i><s></s></i>${u.isPlayer && u.hero.id === 'technik' ? '<u><s></s></u>' : ''}`;
      hud.insertBefore(el, feed);
      bars.set(u.id, el);
    }
    const p = match.views()[0];
    camTarget.set(p.x, 0, p.z - 1.5);
    // 3-2-1
    cdEl.hidden = false;
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [3, 2, 1, 0].map((n, i) => window.setTimeout(() => {
      cdEl.textContent = n ? String(n) : 'Бой!';
      cdEl.classList.remove('pop'); void cdEl.offsetWidth; cdEl.classList.add('pop');
      if (!n) { match?.start(); haptic('light'); countdownTimers.push(window.setTimeout(() => (cdEl.hidden = true), 700)); }
    }, i * 700));
  }
  function restart(): void { newMatch(); }

  (async () => {
    const [map, cols, ...chars] = await Promise.all([
      load('MAP_Dvor', onBytes),
      fetch(`${BASE}MAP_Dvor.colliders.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
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
    assets = { map, heroes, colliders: cols as Collider[] };
    loadEl.hidden = true;
    newMatch();
  })().catch((e) => {
    loadEl.querySelector('p')!.textContent = `Не удалось загрузить арену: ${e?.message ?? e}`;
  });

  // ---- input: joystick
  const stick = { x: 0, y: 0, id: -1 };
  const moveStick = (e: PointerEvent) => {
    const r = stickEl.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (r.top + R - e.clientY) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    stick.x = dx; stick.y = dy;
    knobEl.style.transform = `translate(${dx * R * 0.55}px, ${-dy * R * 0.55}px)`;
  };
  const release = () => { stick.id = -1; stick.x = stick.y = 0; knobEl.style.transform = ''; stickEl.classList.remove('on'); };
  stickEl.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickEl.classList.add('on'); moveStick(e); e.preventDefault(); });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
  stickEl.addEventListener('pointerup', release);
  stickEl.addEventListener('pointercancel', release);
  stickEl.addEventListener('lostpointercapture', release);

  // ---- input: attack button (tap = auto-aim, hold = keep firing, drag = aim and fire on release)
  const pending = { a1: false, a2: false, dash: false };
  let atkHeld = false, atkAim: [number, number] | null = null, atkFireOnce = false, atkId = -1;
  const atkBtn = $('.sk.aim');
  const atkStart = { x: 0, y: 0 };
  atkBtn.addEventListener('pointerdown', (e) => {
    atkId = e.pointerId; atkBtn.setPointerCapture(e.pointerId);
    atkStart.x = e.clientX; atkStart.y = e.clientY;
    atkHeld = true; atkAim = null; atkFireOnce = true;
    haptic('light'); e.preventDefault();
  });
  atkBtn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== atkId) return;
    const dx = e.clientX - atkStart.x, dy = e.clientY - atkStart.y, l = Math.hypot(dx, dy);
    if (l > 14) { atkAim = [dx / l, dy / l]; atkHeld = false; }
  });
  const atkUp = (e: PointerEvent) => {
    if (e.pointerId !== atkId) return;
    atkId = -1;
    if (atkAim) { aimShot = atkAim; }
    atkHeld = false; atkAim = null;
  };
  let aimShot: [number, number] | null = null;
  atkBtn.addEventListener('pointerup', atkUp);
  atkBtn.addEventListener('pointercancel', atkUp);
  root.querySelectorAll<HTMLButtonElement>('.sk[data-k="a1"], .sk[data-k="a2"], .sk[data-k="dash"]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pending[b.dataset.k as 'a1' | 'a2' | 'dash'] = true;
      haptic('light');
      b.classList.remove('press'); void b.offsetWidth; b.classList.add('press');
    });
  });
  // keyboard: WASD / arrows, Space or J = attack, K/E = ability 1, L/Q = ability 2, Shift = dash
  const keys = new Set<string>();
  const KEYMAP: Record<string, [number, number]> = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const kd = (e: KeyboardEvent) => {
    if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'KeyJ') { keys.add('atk'); e.preventDefault(); }
    if (e.code === 'KeyK' || e.code === 'KeyE') pending.a1 = true;
    if (e.code === 'KeyL' || e.code === 'KeyQ') pending.a2 = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') pending.dash = true;
  };
  const ku = (e: KeyboardEvent) => { keys.delete(e.code); if (e.code === 'Space' || e.code === 'KeyJ') keys.delete('atk'); };
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  // mouse / tap on the arena: attack toward that point
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  stage.addEventListener('pointerdown', (e) => {
    if (!match) return;
    const r = stage.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const p = match.views()[0];
    const dx = hit.x - p.x, dz = hit.z - p.z, l = Math.hypot(dx, dz) || 1;
    aimShot = [dx / l, dz / l];
  });
  $('.exit').addEventListener('click', () => onExit());

  const readInput = (): PlayerInput => {
    let mx = 0, my = 0;
    if (stick.id >= 0) { mx = stick.x; my = stick.y; } else {
      for (const k of keys) if (KEYMAP[k]) { mx += KEYMAP[k][0]; my += KEYMAP[k][1]; }
      const l = Math.hypot(mx, my); if (l) { mx /= l; my /= l; }
    }
    let attack: PlayerInput['attack'] = null;
    if (aimShot) { attack = { dir: [aimShot[0], aimShot[1]] }; aimShot = null; }
    else if (atkFireOnce || atkHeld || keys.has('atk')) { attack = { dir: null }; atkFireOnce = false; }
    const inp: PlayerInput = { move: [mx, my], attack, a1: pending.a1, a2: pending.a2, dash: pending.dash };
    pending.a1 = pending.a2 = pending.dash = false;
    return inp;
  };

  // ---- loop
  const skA1 = $('.sk[data-k="a1"]'), skA2 = $('.sk[data-k="a2"]'), skDash = $('.sk[data-k="dash"]');
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
      // aim line while dragging the attack button
      if (atkAim) {
        const p = match.views()[0];
        const [sx, sy] = toScreen(p.x, 1, p.z);
        aimLine.hidden = false;
        aimLine.style.transform = `translate(${sx}px, ${sy}px) rotate(${Math.atan2(atkAim[1], atkAim[0])}rad)`;
        inp.attack = null;
      } else aimLine.hidden = true;
      // screen drag directions are in screen space: x right, y down -> world x, z
      if (inp.attack?.dir) inp.attack.dir = [inp.attack.dir[0], inp.attack.dir[1]];
      match.update(dt, inp);
      const views = match.views();
      const p = views[0];
      camTarget.x += (p.x - camTarget.x) * Math.min(1, dt * 6);
      camTarget.z += (p.z - 1.0 - camTarget.z) * Math.min(1, dt * 6);
      for (const u of views) {
        const el = bars.get(u.id)!;
        el.hidden = !u.alive;
        if (!u.alive) continue;
        const [sx, sy] = toScreen(u.x, 1.95, u.z);
        el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        el.querySelector('b')!.textContent = String(u.hp);
        (el.querySelector('i s') as HTMLElement).style.width = `${(100 * u.hp) / u.maxHp}%`;
        const heat = el.querySelector('u s') as HTMLElement | null;
        if (heat) { heat.style.width = `${u.overheated ? 100 : (100 * u.heat) / 6}%`; heat.parentElement!.classList.toggle('hot', u.overheated); }
      }
      s0.textContent = String(Math.floor(match.score[0]));
      s1.textContent = String(Math.floor(match.score[1]));
      const left = Math.max(0, Math.ceil(MATCH.seconds - match.time));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      const zo = match.zoneOwner;
      zoneEl.textContent = zo === 0 ? 'Круг ваш' : zo === 1 ? 'Круг у соперников' : zo === -2 ? 'Круг спорный' : 'Круг ничей';
      zoneBar.dataset.owner = String(zo);
      (zoneBar.querySelector('.z0') as HTMLElement).style.width = `${match.score[0]}%`;
      (zoneBar.querySelector('.z1') as HTMLElement).style.width = `${match.score[1]}%`;
      deadEl.hidden = p.alive || match.ended;
      if (!p.alive) deadEl.querySelector('b')!.textContent = String(Math.ceil(p.respawnIn));
      const cd = match.cooldowns();
      setCd(skA1, cd.a1, cd.a1Max); setCd(skA2, cd.a2, cd.a2Max); setCd(skDash, cd.dash, cd.dashMax);
      (window as unknown as { __match: unknown }).__match = { score: match.score, time: match.time, ended: match.ended, units: views.map((u) => ({ hero: u.hero.id, team: u.team, hp: u.hp, alive: u.alive, x: +u.x.toFixed(2), z: +u.z.toFixed(2) })) };
    }
    placeCamera();
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
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
