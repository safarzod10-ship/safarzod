/**
 * Battle screen: «Царь двора» 2 на 2 against bots (game/match.ts) on the real 3D arena and models.
 * Few controls, all functions: the hero fires by itself at the nearest enemy in sight; the joystick
 * appears wherever the left thumb touches; a double tap there is the dash; two ability buttons; a tap
 * on the arena shoots that way. HUD: score / timer, HP bars, damage and heal numbers, kill feed, result
 * screen with trophies and experience (progress.ts).
 *
 * Assets: <html data-assets="b64"> (claude.ai artifact: no .glb hosting, no WebAssembly) loads
 * models/<id>.txt (base64 GLB without Meshopt); otherwise models/<id>.glb with the Meshopt decoder.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { load, loadColliders } from './assets';
import { insideCourtyard, type Collider } from '../arena';
import { HEROES, heroById, type HeroId } from './data';
import { Match, lineup, type PlayerInput, type Team } from './game/match';
import { applyResult, botSkill, boostOf, loadProfile, rankOf, levelOf } from './progress';
import { postResult } from './api';
import { MATCH } from './game/kits';
import { ICONS, rankBadge } from './icons';
import { haptic, battleScreen, lockLandscape, inTelegram } from './tg';

export interface Battle { destroy(): void }

const ABILITY_ICONS: Record<HeroId, [string, string]> = {
  technik: [ICONS.turret, ICONS.cloud],
  tank: [ICONS.door, ICONS.ram],
  sprinter: [ICONS.speed, ICONS.wave],
  sniper: [ICONS.mine, ICONS.bullet],
  medic: [ICONS.medkit, ICONS.zone],
};

export function startBattle(root: HTMLElement, heroId: HeroId, onExit: () => void, firstBlue?: HeroId[]): Battle {
  const me = heroById(heroId);
  const [ic1, ic2] = ABILITY_ICONS[heroId];
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
      <div class="skills two">
        <button type="button" class="sk main" data-k="a1" aria-label="${me.name}: ${me.abilities[1]}">${ic1}<em></em></button>
        <button type="button" class="sk cloud" data-k="a2" aria-label="${me.name}: ${me.abilities[2]}">${ic2}<em></em></button>
      </div>
      <div class="hint" hidden><p><b>Атака — сама</b> по ближнему врагу</p><p><b>Двойной тап</b> под джойстиком — рывок</p><p><b>Веди пальцем справа</b> — поворот камеры</p></div>
      <div class="dead" hidden>Возвращение через <b>3</b></div>
      <div class="countdown" hidden></div>
      <div class="result" hidden></div>
      <div class="rotate" hidden>
        <div class="rotate-phone"><i></i></div>
        <h3>Поверни телефон</h3>
        <p>Бой идёт горизонтально</p>
        <button type="button" class="btn-main" id="fs" hidden>На весь экран</button>
        <button type="button" class="btn-ghost" id="portrait">Играть вертикально</button>
      </div>
      <div class="battle-loading"><div class="bar"><i></i></div><p>Загружаю арену</p></div>
    </div>`;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stage = $('.battle-stage'), hud = $('.battle-hud'), loadEl = $('.battle-loading'), loadBar = loadEl.querySelector<HTMLElement>('i')!;
  const timerEl = $('#timer'), s0 = $('#s0'), s1 = $('#s1');
  const feed = $('.feed'), deadEl = $('.dead'), cdEl = $('.countdown'), resEl = $('.result');
  const rotEl = $('.rotate'), hintEl = $('.hint'), zoneStick = $('.stick-zone');
  let alive = true;

  // ---- landscape: the battle waits (paused) while the screen is taller than wide
  battleScreen(true);
  let allowPortrait = false, locked = false, paused = false, waitingStart = false;
  const checkOrientation = () => {
    const portrait = (stage.clientHeight || innerHeight) > (stage.clientWidth || innerWidth);
    paused = portrait && !allowPortrait;
    rotEl.hidden = !paused;
    if (!portrait && !locked) { lockLandscape(); locked = true; }
    if (!paused && waitingStart) { waitingStart = false; beginCountdown(); }
  };
  const fsBtn = $('#fs');
  const canFs = !inTelegram() && !!document.fullscreenEnabled && !!(screen.orientation as { lock?: unknown } | undefined)?.lock;
  fsBtn.hidden = !canFs;
  fsBtn.addEventListener('click', async () => {
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as unknown as { lock(o: string): Promise<void> }).lock('landscape');
    } catch { /* not supported here (iPhone, embedded frame): the player turns the phone */ }
  });
  $('#portrait').addEventListener('click', () => { allowPortrait = true; checkOrientation(); });

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
  // third-person camera behind the player's hero; yaw = direction the camera looks (same convention as hero yaw)
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
  const camTarget = new THREE.Vector3(0, 0, 6);
  let camYaw = Math.PI, camYawGoal = Math.PI, lastLook = -9;
  const resize = () => {
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    checkOrientation();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  // screen shake from decaying trauma (gamedev-game-feel): hits add trauma, the offset is trauma^2
  let trauma = 0, shakeT = 0;
  const shake = (amount: number) => { trauma = Math.min(1, trauma + amount); };
  const placeCamera = (dt = 0) => {
    trauma = Math.max(0, trauma - dt * 1.6);
    shakeT += dt * 30;
    const k = trauma * trauma * 0.12;
    const ox = k * Math.sin(shakeT * 1.7), oy = k * Math.sin(shakeT * 2.3);
    let d = camYawGoal - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    camYaw += d * Math.min(1, dt * 10);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const far = camera.aspect < 1 ? 5.6 : 4.8, height = camera.aspect < 1 ? 3.3 : 2.7;
    // pull in while the spot behind is outside the courtyard (walls / buildings)
    let dist = far;
    while (dist > 1.4 && !insideCourtyard(camTarget.x - fx * dist, camTarget.z - fz * dist, 0.25)) dist -= 0.2;
    const h = height * (0.55 + 0.45 * dist / far);
    camera.position.set(camTarget.x - fx * dist + ox, h + oy, camTarget.z - fz * dist);
    camera.lookAt(camTarget.x + fx * 2.2 + ox, 0.7 + oy, camTarget.z + fz * 2.2);
  };

  let match: Match | null = null;
  const bars = new Map<number, HTMLElement>();
  const sizes = new Map<string, number>();
  const expect: Record<string, number> = { MAP_Dvor: 760e3, ...Object.fromEntries(HEROES.map((h) => [h.model, 400e3])) };
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
  const popNumber = (x: number, y: number, z: number, n: number, team: Team, heal = false) => {
    if (n <= 0) return;
    const [sx, sy] = toScreen(x, y, z);
    const el = document.createElement('span');
    el.className = `dmg ${heal ? 'heal' : team === 0 ? 'ours' : 'theirs'}`;
    el.textContent = heal ? `+${n}` : String(n);
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
  const showResult = (r: { winner: Team | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number; healed: number } }) => {
    haptic(r.winner === 0 ? 'success' : 'medium');
    const title = r.winner === 0 ? 'Победа!' : r.winner === 1 ? 'Поражение' : 'Ничья';
    const rw = applyResult(heroId, r);
    void postResult(rw.after, heroId);   // leaderboard (inside Telegram)
    const rank = rankOf(rw.after.trophies), lv = levelOf(rw.after.xp);
    resEl.className = `result ${r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw'}`;
    resEl.innerHTML = `
      <div class="result-card">
        <h2>${title}</h2>
        <p class="result-score"><span class="b">${r.score[0]}</span> : <span class="r">${r.score[1]}</span></p>
        <div class="result-reward">
          <span class="rr-badge">${rankBadge(rank.color, rank.dark)}</span>
          <span class="rr-text"><b>${rank.name}</b><span>${ICONS.trophy}${rw.after.trophies} <em class="${rw.trophies > 0 ? 'up' : rw.trophies < 0 ? 'down' : ''}">${rw.trophies > 0 ? '+' : ''}${rw.trophies}</em></span></span>
          <span class="rr-xp"><b>Ур. ${lv.level}</b><span>+${rw.xp} опыта</span><i><s style="width:${Math.round((100 * lv.into) / lv.need)}%"></s></i></span>
        </div>
        <p class="result-loot"><span>${ICONS.coin}+${rw.coins}</span>${rw.gems ? `<span>${ICONS.gem}+${rw.gems}</span>` : ''}</p>
        ${rw.rankUp ? `<p class="result-up">Новый ранг: <b>${rw.rankUp.name}</b></p>` : ''}${rw.levelUp ? `<p class="result-up">Новый уровень: <b>${rw.levelUp}</b></p>` : ''}
        <ul>
          <li><span>Выбито</span><b>${r.you.kills}</b></li>
          <li><span>Выбыл</span><b>${r.you.deaths}</b></li>
          <li><span>${r.you.healed > 0 ? 'Вылечено' : 'Урон'}</span><b>${(r.you.healed > 0 ? r.you.healed : r.you.dealt).toLocaleString('ru-RU')}</b></li>
        </ul>
        <div class="result-btns"><button type="button" class="btn-main" id="again">Ещё раз</button><button type="button" class="btn-ghost" id="home">На главную</button></div>
      </div>`;
    resEl.hidden = false;
    resEl.querySelector('#again')!.addEventListener('click', () => { haptic('light'); restart(); });
    resEl.querySelector('#home')!.addEventListener('click', () => { haptic('light'); onExit(); });
  };

  let assets: { map: GLTF; heroes: Record<HeroId, GLTF>; colliders: Collider[]; props?: GLTF } | null = null;
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
    const blue = firstBlue ?? lineup(heroId), red = lineup();
    firstBlue = undefined;
    root.querySelector('.team.blue .faces')!.innerHTML = blue.map((id) => `<img src="${heroById(id).card}" alt="${heroById(id).name}">`).join('');
    root.querySelector('.team.red .faces')!.innerHTML = red.map((id) => `<img src="${heroById(id).card}" alt="${heroById(id).name}">`).join('');
    match = new Match(scene, assets.heroes, assets.colliders, heroId, {
      damage: (x, y, z, n, team, heal) => popNumber(x, y, z, n, team, heal),
      kill: (k, vic) => { killFeed(k ? label(k) : null, label(vic), vic.team); if (vic.isPlayer) haptic('medium'); if (k?.isPlayer) { shake(0.35); haptic('light'); } },
      shake: (a) => shake(a),
      end: (r) => setTimeout(() => alive && showResult(r), 1200),
    }, assets.props, { blue, red, skill: botSkill(loadProfile().trophies), playerBoost: boostOf(heroId) });
    match.camera = camera;
    for (const u of match.views()) {
      const el = document.createElement('div');
      el.className = `hp ${u.team === 0 ? 'blue' : 'red'}${u.isPlayer ? ' me' : ''}`;
      el.innerHTML = `<b></b><i><s></s></i>${u.isPlayer && u.hero.id === 'technik' ? '<u><s></s></u>' : ''}`;
      hud.insertBefore(el, feed);
      bars.set(u.id, el);
    }
    const p = match.views()[0];
    camTarget.set(p.x, 0, p.z);
    camYaw = camYawGoal = p.team === 0 ? Math.PI : 0;
    if (paused) waitingStart = true; else beginCountdown();
  }
  function beginCountdown(): void {
    // 3-2-1
    cdEl.hidden = false;
    hintEl.hidden = false;
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [3, 2, 1, 0].map((n, i) => window.setTimeout(() => {
      cdEl.textContent = n ? String(n) : 'Бой!';
      cdEl.classList.remove('pop'); void cdEl.offsetWidth; cdEl.classList.add('pop');
      if (!n) { match?.start(); haptic('light'); countdownTimers.push(window.setTimeout(() => (cdEl.hidden = true), 700), window.setTimeout(() => (hintEl.hidden = true), 2500)); }
    }, i * 700));
  }
  function restart(): void { newMatch(); }

  (async () => {
    const [map, cols, props, ...chars] = await Promise.all([
      load('MAP_Dvor', onBytes),
      loadColliders(),
      load('PROPS', onBytes).catch(() => undefined),
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
    assets = { map, heroes, colliders: cols as Collider[], props: props as GLTF | undefined };
    loadEl.hidden = true;
    newMatch();
  })().catch((e) => {
    loadEl.querySelector('p')!.textContent = `Не удалось загрузить арену: ${e?.message ?? e}`;
  });

  // ---- input: floating joystick on the left half (appears under the thumb), double tap = dash
  const stick = { x: 0, y: 0, id: -1, cx: 0, cy: 0, lastTap: 0 };
  const stickEl = $('.stick'), knobEl = $('.knob');
  const pending = { a1: false, a2: false, dash: false };
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
    // centre the stick under the thumb (kept fully inside the zone)
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

  // ---- input: two ability buttons
  root.querySelectorAll<HTMLButtonElement>('.sk[data-k="a1"], .sk[data-k="a2"]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pending[b.dataset.k as 'a1' | 'a2'] = true;
      haptic('light');
      b.classList.remove('press'); void b.offsetWidth; b.classList.add('press');
    });
  });
  // keyboard: WASD / arrows, Space or J = shoot ahead, K/E = ability 1, L/Q = ability 2, Shift = dash
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
  // tap / click on the arena: shoot toward that point
  let aimShot: [number, number] | null = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const look = { id: -1, x: 0, x0: 0, y0: 0, moved: false };
  stage.addEventListener('pointerdown', (e) => {
    if (look.id >= 0) return;
    look.id = e.pointerId; look.x = look.x0 = e.clientX; look.y0 = e.clientY; look.moved = false;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== look.id) return;
    if (!look.moved && Math.hypot(e.clientX - look.x0, e.clientY - look.y0) > 10) look.moved = true;
    if (look.moved) { camYawGoal -= (e.clientX - look.x) * 0.009; lastLook = performance.now(); }
    look.x = e.clientX;
  });
  const lookUp = (e: PointerEvent) => {
    if (e.pointerId !== look.id) return;
    look.id = -1;
    if (look.moved || !match) return;
    // a tap (no drag): shoot toward that point
    const r = stage.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const p = match.views()[0];
    const dx = hit.x - p.x, dz = hit.z - p.z, l = Math.hypot(dx, dz) || 1;
    aimShot = [dx / l, dz / l];
  };
  stage.addEventListener('pointerup', lookUp);
  stage.addEventListener('pointercancel', lookUp);
  // inside Telegram its own «Назад» button leaves the battle; ours would only crowd the corner
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
    // stick up = where the camera looks; the match takes (x, -z)
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const wx = mx * rx + my * fx, wz = mx * rz + my * fz;
    // running forward slowly swings the camera behind the hero (unless the player is turning it)
    if (my > 0.35 && performance.now() - lastLook > 1200) {
      const head = Math.atan2(wx, wz);
      let d = head - camYawGoal; d = Math.atan2(Math.sin(d), Math.cos(d));
      camYawGoal += d * Math.min(1, 1.6 / 60);
    }
    const inp: PlayerInput = { move: [wx, -wz], attack, auto: true, a1: pending.a1, a2: pending.a2, dash: pending.dash };
    pending.a1 = pending.a2 = pending.dash = false;
    return inp;
  };

  // ---- loop
  const skA1 = $('.sk[data-k="a1"]'), skA2 = $('.sk[data-k="a2"]'), dashRing = $('.dash-ring');
  const setCd = (b: HTMLElement, left: number, max: number) => {
    b.style.setProperty('--cd', String(max ? left / max : 0));
    b.classList.toggle('cooling', left > 0.05);
    b.querySelector('em')!.textContent = left > 0.05 ? String(Math.ceil(left)) : '';
  };
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 1 / 15);
    if (match && !paused) {
      match.update(dt, readInput());
      const views = match.views();
      const p = views[0];
      camTarget.x += (p.x - camTarget.x) * Math.min(1, dt * 10);
      camTarget.z += (p.z - camTarget.z) * Math.min(1, dt * 10);
      for (const u of views) {
        const el = bars.get(u.id)!;
        el.hidden = !u.alive;
        if (!u.alive) continue;
        v.set(u.x, 1.95, u.z).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.2) { el.hidden = true; continue; }   // behind the camera / off screen
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
      timerEl.dataset.owner = String(zo);   // the timer pill takes the colour of whoever holds the circle
      deadEl.hidden = p.alive || match.ended;
      if (!p.alive) deadEl.querySelector('b')!.textContent = String(Math.ceil(p.respawnIn));
      const cd = match.cooldowns();
      setCd(skA1, cd.a1, cd.a1Max); setCd(skA2, cd.a2, cd.a2Max);
      dashRing.style.setProperty('--cd', String(cd.dashMax ? cd.dash / cd.dashMax : 0));
      (window as unknown as { __match: unknown }).__match = { score: match.score, time: match.time, ended: match.ended, units: views.map((u) => ({ hero: u.hero.id, team: u.team, hp: u.hp, alive: u.alive, x: +u.x.toFixed(2), z: +u.z.toFixed(2) })) };
    }
    placeCamera(paused ? 0 : dt);
    renderer.render(scene, camera);
  });

  return {
    destroy() {
      alive = false;
      battleScreen(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
