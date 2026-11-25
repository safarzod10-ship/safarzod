/**
 * DVOR character test scene (standalone, NOT the game UI).
 * All three characters wander a neutral test arena, run, attack, use abilities, get hit,
 * fall and celebrate, so every clip and LOD switch is exercised at once.
 *
 * URL params:
 *   count=3        number of characters (cycles through the three; >3 = stress test)
 *   tex=auto|png|ktx2   texture variant (auto = KTX2 when the GPU supports a compressed format)
 *   lod=auto|0|1   LOD policy;  lodpx=150  switch height in CSS px for lod=auto
 *   lambert=1      MeshLambertMaterial instead of MeshStandardMaterial (weak GPUs)
 *   dpr=1.5        max device pixel ratio;  aa=0  disable MSAA
 *   ui=0           hide the test overlay
 */
import * as THREE from 'three';
import {
  CHARACTER_IDS,
  CLIP_NAMES,
  CharacterInstance,
  CharacterLibrary,
  type ClipName,
} from './characters';

const q = new URLSearchParams(location.search);
const COUNT = Math.max(1, Number(q.get('count') ?? 3));
const LOD_MODE = q.get('lod') ?? 'auto';
const LOD_PX = Number(q.get('lodpx') ?? 150);
const LAMBERT = q.get('lambert') === '1';
const DPR = Math.min(devicePixelRatio, Number(q.get('dpr') ?? 1.5));
const SHOW_UI = q.get('ui') !== '0';
const ARENA = 7; // half size in metres

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: q.get('aa') !== '0', powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9d4cc);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb4a796, 2.3));
const sun = new THREE.DirectionalLight(0xfff8f0, 1.9);
sun.position.set(4, 10, 6);
scene.add(sun);

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfc8bd';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#bdb5a8';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ARENA, ARENA);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA * 2, ARENA * 2).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: gridTexture() }),
);
scene.add(ground);

// cheap blob shadow: one shared texture, one quad per character
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

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 80);
function placeCamera(): void {
  // top-down arena camera at 55 degrees; distance fits the arena on portrait phones too
  const aspect = innerWidth / innerHeight;
  const dist = aspect < 1 ? 19 / Math.max(aspect, 0.45) * 0.62 : 15;
  const el = THREE.MathUtils.degToRad(55);
  camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
  camera.lookAt(0, 0, 0.6);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
placeCamera();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  placeCamera();
});

// ------------------------------------------------------------------ overlay (test only)
const ui = document.createElement('div');
ui.id = 'hud';
ui.hidden = !SHOW_UI;
document.body.appendChild(ui);
const statsEl = document.createElement('pre');
ui.appendChild(statsEl);
const buttons = document.createElement('div');
buttons.className = 'buttons';
ui.appendChild(buttons);

// ------------------------------------------------------------------ actors
interface Actor {
  inst: CharacterInstance;
  shadow: THREE.Mesh;
  target: THREE.Vector3;
  speed: number;
  state: 'move' | 'act' | 'down';
  timer: number;
}
const actors: Actor[] = [];
const loadInfo: Record<string, { ms: number; bytes: number; ktx2: boolean }> = {};

const lib = new CharacterLibrary(renderer, {
  baseUrl: './models/',
  transcoderPath: './basis/',
  textures: (q.get('tex') as 'auto' | 'png' | 'ktx2') ?? 'auto',
});

const SPEED: Record<string, number> = { CH_Technik: 4.5, CH_Tank: 3.8, CH_Sprinter: 5.6 };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function pickTarget(a: Actor): void {
  a.target.set(rand(-ARENA + 1, ARENA - 1), 0, rand(-ARENA + 1, ARENA - 1));
  a.state = 'move';
  a.inst.play('Run', 0.15);
}

function doAction(a: Actor, clip?: ClipName): void {
  const pool: ClipName[] = ['Attack', 'Attack', 'Ability', 'Hit', 'Idle', 'Victory', 'Defeat'];
  const c = clip ?? pool[Math.floor(Math.random() * pool.length)];
  a.state = c === 'Defeat' ? 'down' : 'act';
  a.inst.play(c, 0.12);
  // looping clips are held for a while, one-shots end via the mixer 'finished' event
  a.timer = c === 'Idle' ? 1.4 : c === 'Victory' ? 2.2 : c === 'Defeat' ? 3.2 : 99;
}

async function spawn(): Promise<void> {
  const ids = Array.from({ length: COUNT }, (_, i) => CHARACTER_IDS[i % CHARACTER_IDS.length]);
  const unique = [...new Set(ids)];
  const t0 = performance.now();
  const assets = await Promise.all(unique.map((id) => lib.load(id)));
  for (const a of assets) loadInfo[a.id] = { ms: Math.round(a.loadMs), bytes: a.bytes, ktx2: a.usedKtx2 };
  loadInfo.total = { ms: Math.round(performance.now() - t0), bytes: assets.reduce((s, a) => s + a.bytes, 0), ktx2: lib.ktx2Enabled };

  ids.forEach((id, i) => {
    const asset = assets[unique.indexOf(id)];
    const inst = new CharacterInstance(asset, { lodSwitchPx: LOD_PX, lambert: LAMBERT });
    if (LOD_MODE !== 'auto') inst.setLod(Number(LOD_MODE));
    else inst.setLod(null);
    const ang = (i / COUNT) * Math.PI * 2;
    inst.root.position.set(Math.cos(ang) * 2.5, 0, Math.sin(ang) * 2.5);
    scene.add(inst.root);
    const shadow = new THREE.Mesh(blobGeo, blobMat);
    shadow.position.y = 0.01;
    scene.add(shadow);
    const actor: Actor = { inst, shadow, target: new THREE.Vector3(), speed: SPEED[id], state: 'move', timer: 0 };
    inst.onFinished((name) => {
      if (name === 'Defeat') return; // stays down until its timer runs out
      pickTarget(actor);
    });
    pickTarget(actor);
    actors.push(actor);
  });

  for (const clip of CLIP_NAMES) {
    const b = document.createElement('button');
    b.textContent = clip;
    b.onclick = () => actors.forEach((a) => doAction(a, clip));
    buttons.appendChild(b);
  }
  const lodBtn = document.createElement('button');
  let lodState = LOD_MODE;
  lodBtn.textContent = `LOD: ${lodState}`;
  lodBtn.onclick = () => {
    lodState = lodState === 'auto' ? '0' : lodState === '0' ? '1' : 'auto';
    actors.forEach((a) => a.inst.setLod(lodState === 'auto' ? null : Number(lodState)));
    lodBtn.textContent = `LOD: ${lodState}`;
  };
  buttons.appendChild(lodBtn);
  const goBtn = document.createElement('button');
  goBtn.textContent = 'Run';
  goBtn.onclick = () => actors.forEach(pickTarget);
  buttons.appendChild(goBtn);
}

// ------------------------------------------------------------------ loop + metrics
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const frameTimes: number[] = [];
const cpuTimes: number[] = [];
let lastReport = performance.now();
const metrics = { fps: 0, frameMsAvg: 0, frameMsP95: 0, cpuMsAvg: 0, calls: 0, triangles: 0, lods: [] as number[] };

function update(dt: number): void {
  for (const a of actors) {
    const r = a.inst.root;
    if (a.state === 'move') {
      tmp.subVectors(a.target, r.position);
      tmp.y = 0;
      const d = tmp.length();
      if (d < 0.25) {
        doAction(a);
      } else {
        tmp.multiplyScalar(1 / d);
        r.position.addScaledVector(tmp, Math.min(d, a.speed * dt));
        const yaw = Math.atan2(tmp.x, tmp.z); // characters face +Z in glTF space
        let diff = yaw - r.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.rotation.y += diff * Math.min(1, dt * 12);
      }
    } else {
      a.timer -= dt;
      if (a.timer <= 0) pickTarget(a);
    }
    a.inst.update(dt);
    a.inst.updateLod(camera, innerHeight);
    a.shadow.position.x = r.position.x;
    a.shadow.position.z = r.position.z;
  }
}

renderer.setAnimationLoop(() => {
  const t0 = performance.now();
  const dt = Math.min(clock.getDelta(), 1 / 15);
  update(dt);
  renderer.info.reset();
  renderer.render(scene, camera);
  const t1 = performance.now();
  cpuTimes.push(t1 - t0);
  frameTimes.push(dt * 1000);
  if (t1 - lastReport > 1000 && frameTimes.length > 5) {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    metrics.fps = +(1000 / (frameTimes.reduce((s, x) => s + x, 0) / frameTimes.length)).toFixed(1);
    metrics.frameMsAvg = +(frameTimes.reduce((s, x) => s + x, 0) / frameTimes.length).toFixed(2);
    metrics.frameMsP95 = +sorted[Math.floor(sorted.length * 0.95)].toFixed(2);
    metrics.cpuMsAvg = +(cpuTimes.reduce((s, x) => s + x, 0) / cpuTimes.length).toFixed(2);
    metrics.calls = renderer.info.render.calls;
    metrics.triangles = renderer.info.render.triangles;
    metrics.lods = actors.map((a) => a.inst.lod);
    frameTimes.length = 0;
    cpuTimes.length = 0;
    lastReport = t1;
    const kb = (b: number) => (b / 1024).toFixed(0) + ' KB';
    statsEl.textContent =
      `FPS ${metrics.fps}  кадр ${metrics.frameMsAvg} мс (p95 ${metrics.frameMsP95})  CPU ${metrics.cpuMsAvg} мс\n` +
      `draw calls ${metrics.calls}  треугольники ${metrics.triangles}  LOD [${metrics.lods.join(',')}]\n` +
      Object.entries(loadInfo).map(([k, v]) => `${k}: ${kb(v.bytes)} за ${v.ms} мс${v.ktx2 ? ' KTX2' : ''}`).join('\n');
  }
});

(window as any).__dvor = { metrics, loadInfo, actors, ready: false };
spawn()
  .then(() => ((window as any).__dvor.ready = true))
  .catch((e) => {
    statsEl.textContent = 'Ошибка загрузки: ' + e;
    console.error(e);
  });
