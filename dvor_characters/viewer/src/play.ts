/**
 * "Пробежка по двору": drive one character over the arena map with a virtual joystick (touch/mouse)
 * or WASD / arrow keys. Standalone page for the claude.ai artifact: no WebAssembly (plain GLBs, no
 * Meshopt/KTX2), images decoded through <img> (createImageBitmap disabled before loading).
 *
 * Any stick tilt past the dead zone = full run at the character's foot-matched speed (RUN_SPEED), as
 * in arena games: a slowed-down Run clip looks like slow motion, not like walking.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { COURTYARD, hitsCollider, insideCourtyard, type Collider } from './arena';

const BASE = './models/';
const HEROES = [
  { id: 'USER_HERO_Technik', name: 'Техник', speed: 2.52, color: '#f08a24' },
  { id: 'USER_HERO_Sprinter', name: 'Спринтер', speed: 3.15, color: '#e0457b' },
  { id: 'USER_HERO_Tank', name: 'Танк', speed: 1.94, color: '#9aa649' },
  { id: 'USER_HERO_Sniper', name: 'Снайпер', speed: 2.5, color: '#8d7a4f' },
  { id: 'USER_HERO_Medic', name: 'Медик', speed: 2.89, color: '#d8382c' },
] as const;
const BODY_R = 0.35;

// ------------------------------------------------------------------ DOM
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const loadingEl = $('loading');
const loadBar = $('loadbar');
const pickEl = $('pick');
const stickEl = $('stick');
const knobEl = $('knob');
const speedEl = $('speed');

// ------------------------------------------------------------------ renderer / scene
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
function resize(): void {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
function placeCamera(): void {
  // the test scene's arena camera: 55 degrees from the south, follows the character
  const dist = camera.aspect < 1 ? 16 : 15;
  const el = THREE.MathUtils.degToRad(55);
  camera.position.set(camTarget.x, Math.sin(el) * dist, camTarget.z + Math.cos(el) * dist);
  camera.lookAt(camTarget.x, 0, camTarget.z + 0.6);
}

function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
const blobGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);

// ------------------------------------------------------------------ loading
// <img> decoding instead of createImageBitmap + fetch(blob:), which a strict page policy can refuse
(window as unknown as { createImageBitmap?: unknown }).createImageBitmap = undefined;
const loader = new GLTFLoader();
// Artifacts don't serve .glb, so each model ships as base64 text (scripts/artifact-assets.mjs).
let sizes: Record<string, number> = {};
const got = new Map<string, number>();
function showProgress(): void {
  let a = 0, b = 0;
  for (const [id, total] of Object.entries(sizes)) { a += Math.min(got.get(id) ?? 0, total); b += total; }
  loadBar.style.width = `${Math.round((100 * a) / Math.max(b, 1))}%`;
}
async function fetchText(id: string): Promise<string> {
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
    got.set(id, n);
    showProgress();
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder().decode(all);
}
function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function load(id: string): Promise<GLTF> {
  return loader.parseAsync(base64ToBuffer(await fetchText(id)), BASE);
}

type Clip = 'Idle' | 'Run';
class Hero {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = new Map<Clip, THREE.AnimationAction>();
  current: THREE.AnimationAction | null = null;
  shadow: THREE.Mesh;
  lods: THREE.Mesh[] = [];
  constructor(readonly def: (typeof HEROES)[number], gltf: GLTF) {
    this.root = cloneSkinned(gltf.scene);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      this.lods.push(m);
    });
    this.lods.sort((a, b) => a.name.localeCompare(b.name));
    this.lods.forEach((m, i) => (m.visible = i === 0));   // the camera is close enough for LOD0
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const c of gltf.animations) {
      if (c.name !== 'Idle' && c.name !== 'Run') continue;
      const t0 = Math.min(...c.tracks.map((t) => t.times[0]));   // Blender keys start at 1/30 s
      if (t0 > 0) {
        for (const t of c.tracks) { t.times = t.times.slice(); t.shift(-t0); }
        c.resetDuration();
      }
      this.actions.set(c.name, this.mixer.clipAction(c));
    }
    this.shadow = new THREE.Mesh(blobGeo, blobMat);
    this.shadow.position.y = 0.01;
    this.play('Idle', 0);
  }
  play(name: Clip, fade = 0.15): THREE.AnimationAction | null {
    const next = this.actions.get(name) ?? null;
    if (!next || next === this.current) return next;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else this.current?.stop();
    this.current = next;
    return next;
  }
  place(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.shadow.position.set(x, 0.01, z);
  }
}

const heroes: Hero[] = [];
let colliders: Collider[] = [];
let active = 0;

async function boot(): Promise<void> {
  sizes = await fetch(`${BASE}manifest.json`).then((r) => r.json()).catch(() => ({}));
  const [map, cols, ...chars] = await Promise.all([
    load('MAP_Dvor'),
    fetch(`${BASE}MAP_Dvor.colliders.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ...HEROES.map((h) => load(h.id)),
  ]);
  map.scene.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.MeshBasicMaterial) : null;
    if (mat?.map) mat.map.anisotropy = 4;
  });
  scene.add(map.scene);
  colliders = cols as Collider[];
  const start: [number, number][] = [[0, 3.0], [-1.5, 3.4], [1.5, 3.4]];   // just north of the south block
  HEROES.forEach((def, i) => {
    const h = new Hero(def, chars[i]);
    h.place(start[i][0], start[i][1], Math.PI);   // face the camera (+Z) at the start
    scene.add(h.root, h.shadow);
    heroes.push(h);
  });
  buildPicker();
  select(0);
  loadingEl.hidden = true;
}

// ------------------------------------------------------------------ character picker
function buildPicker(): void {
  HEROES.forEach((def, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `pick-${i}`;
    b.textContent = def.name;
    b.style.setProperty('--hero', def.color);
    b.addEventListener('click', () => select(i));
    pickEl.appendChild(b);
  });
}
function select(i: number): void {
  active = i;
  pickEl.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  document.documentElement.style.setProperty('--hero', HEROES[i].color);
  const p = heroes[i]?.root.position;
  if (p) camTarget.set(p.x, 0, p.z);
}

// ------------------------------------------------------------------ input: joystick + keys
const stick = { x: 0, y: 0, id: -1 };   // x right, y up, length <= 1
function stickCenter(): [number, number, number] {
  const r = stickEl.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2];
}
function moveStick(e: PointerEvent): void {
  const [cx, cy, R] = stickCenter();
  let dx = (e.clientX - cx) / R, dy = (cy - e.clientY) / R;
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  stick.x = dx;
  stick.y = dy;
  knobEl.style.transform = `translate(${dx * R * 0.62}px, ${-dy * R * 0.62}px)`;
}
function releaseStick(): void {
  stick.id = -1;
  stick.x = stick.y = 0;
  knobEl.style.transform = '';
  stickEl.classList.remove('on');
}
stickEl.addEventListener('pointerdown', (e) => {
  stick.id = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  stickEl.classList.add('on');
  moveStick(e);
  e.preventDefault();
});
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
stickEl.addEventListener('pointerup', (e) => { if (e.pointerId === stick.id) releaseStick(); });
stickEl.addEventListener('pointercancel', (e) => { if (e.pointerId === stick.id) releaseStick(); });
stickEl.addEventListener('lostpointercapture', releaseStick);

const keys = new Set<string>();
const KEYMAP: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') select(Number(e.code.slice(5)) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function input(): [number, number] {
  if (stick.id >= 0) return [stick.x, stick.y];
  let x = 0, y = 0;
  for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
  const l = Math.hypot(x, y);
  return l ? [x / l, y / l] : [0, 0];
}

// ------------------------------------------------------------------ movement
function free(self: Hero, x: number, z: number): boolean {
  if (!insideCourtyard(x, z, 0.45) || hitsCollider(colliders, x, z, BODY_R)) return false;
  return heroes.every((o) => o === self || Math.hypot(o.root.position.x - x, o.root.position.z - z) > BODY_R * 2);
}

const DEAD = 0.15;
function update(dt: number): void {
  const h = heroes[active];
  if (!h) return;
  const [ix, iy] = input();
  const mag = Math.min(1, Math.hypot(ix, iy));
  if (mag > DEAD) {
    const k = 1;   // constant run speed; the stick only gives the direction
    const speed = h.def.speed * k;
    const dx = (ix / mag) * speed * dt, dz = (-iy / mag) * speed * dt;   // screen up = north (-Z)
    const p = h.root.position;
    let moved = false;
    if (!free(h, p.x, p.z)) { p.x += dx; p.z += dz; moved = true; }   // never stuck inside something
    else if (free(h, p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; moved = true; }
    else if (free(h, p.x + dx, p.z)) { p.x += dx; moved = true; }        // slide along walls
    else if (free(h, p.x, p.z + dz)) { p.z += dz; moved = true; }
    const yaw = Math.atan2(ix, -iy);
    let diff = yaw - h.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    h.root.rotation.y += diff * Math.min(1, dt * 14);
    const run = h.play('Run');
    run?.setEffectiveTimeScale(moved ? k : 0.6);
    speedEl.textContent = `${(moved ? speed : 0).toFixed(1)} м/с`;
  } else {
    h.play('Idle');
    speedEl.textContent = '0.0 м/с';
  }
  for (const o of heroes) {
    o.mixer.update(dt);
    o.shadow.position.set(o.root.position.x, 0.01, o.root.position.z);
  }
  const p = h.root.position;
  camTarget.x += (p.x - camTarget.x) * Math.min(1, dt * 8);
  camTarget.z += (p.z - camTarget.z) * Math.min(1, dt * 8);
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  update(Math.min(timer.getDelta(), 1 / 15));
  placeCamera();
  renderer.render(scene, camera);
});

boot().catch((e) => {
  loadingEl.querySelector('p')!.textContent = `Не удалось загрузить модели: ${e?.message ?? e}`;
  console.error(e);
});
(window as unknown as { __play: unknown }).__play = { heroes, get active() { return active; }, COURTYARD };
