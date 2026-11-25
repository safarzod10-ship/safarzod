/**
 * Battle screen: the real 3D arena and characters (dist/MAP_Dvor.glb, USER_CH_*.glb) with the HUD
 * from the mockup. Only movement works (joystick / WASD); ability buttons are visual placeholders,
 * there are no enemies or damage yet.
 *
 * Assets: <html data-assets="b64"> (claude.ai artifact: no .glb hosting, no WebAssembly) loads
 * models/<id>.txt (base64 GLB without Meshopt); otherwise models/<id>.glb with the Meshopt decoder.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hitsCollider, insideCourtyard, type Collider } from '../arena';
import { HEROES, type Hero, type HeroId } from './data';
import { ICONS } from './icons';
import { haptic } from './tg';

const BASE = './models/';
const B64 = document.documentElement.dataset.assets === 'b64';
const BODY_R = 0.35;
const MATCH_SECONDS = 120;

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

type Clip = 'Idle' | 'Run';
class Unit {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = new Map<Clip, THREE.AnimationAction>();
  current: THREE.AnimationAction | null = null;
  ring: THREE.Mesh;
  bar: HTMLElement;
  constructor(readonly hero: Hero, gltf: GLTF, ringMat: THREE.Material, ringGeo: THREE.BufferGeometry, hud: HTMLElement, me: boolean) {
    this.root = cloneSkinned(gltf.scene);
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.frustumCulled = false; meshes.push(m); }
    });
    meshes.sort((a, b) => a.name.localeCompare(b.name)).forEach((m, i) => (m.visible = i === 0));
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const c of gltf.animations) {
      if (c.name !== 'Idle' && c.name !== 'Run') continue;
      const t0 = Math.min(...c.tracks.map((t) => t.times[0]));
      if (t0 > 0) {
        for (const t of c.tracks) { t.times = t.times.slice(); t.shift(-t0); }   // keys start at 1/30 s
        c.resetDuration();
      }
      this.actions.set(c.name, this.mixer.clipAction(c));
    }
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.y = 0.02;
    this.bar = document.createElement('div');
    this.bar.className = 'hp' + (me ? ' me' : '');
    this.bar.innerHTML = `<b>${hero.hp}</b><i></i>`;
    hud.appendChild(this.bar);
    this.play('Idle', 0);
  }
  play(name: Clip, fade = 0.15): void {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else this.current?.stop();
    this.current = next;
  }
}

export interface Battle { destroy(): void }

export function startBattle(root: HTMLElement, heroId: HeroId, onEnd: () => void): Battle {
  root.innerHTML = `
    <div class="battle-stage"></div>
    <div class="battle-hud">
      <div class="scorebar">
        <div class="team blue">${HEROES.map((h) => `<img src="${h.card}" alt="${h.name}">`).join('')}<span class="score">0</span></div>
        <div class="timer">2:00</div>
        <div class="team red"><span class="score">0</span>${('<span class="enemy">' + ICONS.person + '</span>').repeat(3)}</div>
      </div>
      <button class="exit" type="button" aria-label="Выйти из боя">${ICONS.close}</button>
      <div class="stick" role="application" aria-label="Джойстик"><span class="arr u"></span><span class="arr d"></span><span class="arr l"></span><span class="arr r"></span><div class="knob"></div></div>
      <div class="skills">
        <button type="button" class="sk run" aria-label="Рывок">${ICONS.run}</button>
        <button type="button" class="sk main" aria-label="Способность">${ICONS.turret}</button>
        <button type="button" class="sk cloud" aria-label="Дым">${ICONS.cloud}</button>
        <button type="button" class="sk aim" aria-label="Прицел">${ICONS.crosshair}</button>
      </div>
      <div class="battle-loading"><div class="bar"><i></i></div><p>Загружаю арену</p></div>
    </div>`;
  const stage = root.querySelector<HTMLElement>('.battle-stage')!;
  const hud = root.querySelector<HTMLElement>('.battle-hud')!;
  const loadEl = root.querySelector<HTMLElement>('.battle-loading')!;
  const loadBar = loadEl.querySelector<HTMLElement>('i')!;
  const timerEl = root.querySelector<HTMLElement>('.timer')!;
  const stickEl = root.querySelector<HTMLElement>('.stick')!;
  const knobEl = root.querySelector<HTMLElement>('.knob')!;
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
  const camTarget = new THREE.Vector3(0, 0, 3);
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
    const dist = camera.aspect < 1 ? 16 : 15;
    const el = THREE.MathUtils.degToRad(55);
    camera.position.set(camTarget.x, Math.sin(el) * dist, camTarget.z + Math.cos(el) * dist);
    camera.lookAt(camTarget.x, 0, camTarget.z + 0.6);
  };

  // team rings at the feet (blue = our team, as in the mockup)
  const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x2b9cf0, transparent: true, opacity: 0.9, depthWrite: false });
  const units: Unit[] = [];
  let colliders: Collider[] = [];
  let me: Unit | null = null;

  const sizes = new Map<string, number>();
  const expect: Record<string, number> = { MAP_Dvor: 760e3, USER_CH_Technik: 310e3, USER_CH_Tank: 290e3, USER_CH_Sprinter: 330e3 };
  const onBytes = (id: string, n: number) => {
    sizes.set(id, n);
    const total = Object.values(expect).reduce((a, b) => a + b, 0);
    const got = Object.keys(expect).reduce((a, k) => a + Math.min(sizes.get(k) ?? 0, expect[k]), 0);
    loadBar.style.width = `${Math.round((100 * got) / total)}%`;
  };

  (async () => {
    const [map, cols, ...chars] = await Promise.all([
      load('MAP_Dvor', onBytes),
      fetch(`${BASE}MAP_Dvor.colliders.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ...HEROES.map((h) => load(h.model, onBytes)),
    ]);
    if (!alive) return;
    const arena = map.scene.clone();
    arena.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      const m = o as THREE.Mesh;
      const mat = m.isMesh ? (m.material as THREE.MeshBasicMaterial) : null;
      if (mat?.map) mat.map.anisotropy = 4;
    });
    scene.add(arena);
    colliders = cols as Collider[];
    const spots: [number, number][] = [[0, 3.0], [-1.5, 3.4], [1.5, 3.4]];
    const order = [heroId, ...HEROES.map((h) => h.id).filter((id) => id !== heroId)];
    order.forEach((id, i) => {
      const hero = HEROES.find((h) => h.id === id)!;
      const u = new Unit(hero, chars[HEROES.indexOf(hero)], ringMat, ringGeo, hud, i === 0);
      u.root.position.set(spots[i][0], 0, spots[i][1]);
      u.root.rotation.y = Math.PI;
      scene.add(u.root, u.ring);
      units.push(u);
    });
    me = units[0];
    camTarget.set(me.root.position.x, 0, me.root.position.z);
    loadEl.hidden = true;
    startClock();
  })().catch((e) => {
    loadEl.querySelector('p')!.textContent = `Не удалось загрузить арену: ${e?.message ?? e}`;
  });

  // ---- input
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
  const keys = new Set<string>();
  const KEYMAP: Record<string, [number, number]> = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const kd = (e: KeyboardEvent) => { if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); } };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  root.querySelectorAll<HTMLButtonElement>('.sk').forEach((b) => b.addEventListener('pointerdown', () => {
    haptic('light');
    b.classList.remove('press');
    void b.offsetWidth;
    b.classList.add('press');
  }));
  root.querySelector('.exit')!.addEventListener('click', () => onEnd());

  const input = (): [number, number] => {
    if (stick.id >= 0) return [stick.x, stick.y];
    let x = 0, y = 0;
    for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
    const l = Math.hypot(x, y);
    return l ? [x / l, y / l] : [0, 0];
  };
  const free = (self: Unit, x: number, z: number) =>
    insideCourtyard(x, z, 0.45) && !hitsCollider(colliders, x, z, BODY_R) &&
    units.every((o) => o === self || Math.hypot(o.root.position.x - x, o.root.position.z - z) > BODY_R * 2);

  // ---- match clock (no rules yet: when it runs out the match ends)
  let endAt = 0;
  let clockTimer = 0;
  function startClock(): void {
    endAt = performance.now() + MATCH_SECONDS * 1000;
    clockTimer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (left === 0) onEnd();
    }, 250);
  }

  const v = new THREE.Vector3();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 1 / 15);
    if (me) {
      const [ix, iy] = input();
      const mag = Math.min(1, Math.hypot(ix, iy));
      if (mag > 0.15) {
        const speed = me.hero.runSpeed;   // constant run speed, foot-matched: the stick gives the direction
        const dx = (ix / mag) * speed * dt, dz = (-iy / mag) * speed * dt;
        const p = me.root.position;
        if (!free(me, p.x, p.z)) { p.x += dx; p.z += dz; }
        else if (free(me, p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
        else if (free(me, p.x + dx, p.z)) p.x += dx;
        else if (free(me, p.x, p.z + dz)) p.z += dz;
        let diff = Math.atan2(ix, -iy) - me.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        me.root.rotation.y += diff * Math.min(1, dt * 14);
        me.play('Run');
      } else {
        me.play('Idle');
      }
      camTarget.x += (me.root.position.x - camTarget.x) * Math.min(1, dt * 8);
      camTarget.z += (me.root.position.z - camTarget.z) * Math.min(1, dt * 8);
    }
    placeCamera();
    const W = stage.clientWidth, H = stage.clientHeight;
    for (const u of units) {
      u.mixer.update(dt);
      u.ring.position.set(u.root.position.x, 0.02, u.root.position.z);
      v.set(u.root.position.x, 1.85, u.root.position.z).project(camera);
      u.bar.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) translate(-50%, -100%)`;
    }
    renderer.render(scene, camera);
  });

  return {
    destroy() {
      alive = false;
      clearInterval(clockTimer);
      renderer.setAnimationLoop(null);
      ro.disconnect();
      removeEventListener('keydown', kd);
      removeEventListener('keyup', ku);
      renderer.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      root.innerHTML = '';
    },
  };
}
