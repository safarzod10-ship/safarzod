/**
 * Single-character preview used for turnaround screenshots and visual QA.
 * URL params: char=CH_Technik  view=front|back|side|threequarter|game  clip=Idle  t=0.0
 *             lod=0|1  tex=png|ktx2  bg=e7e3de  wire=0|1  play=0|1
 */
import * as THREE from 'three';
import { CharacterInstance, CharacterLibrary, type ClipName } from './characters';

const q = new URLSearchParams(location.search);
const char = q.get('char') ?? 'CH_Technik';
const view = q.get('view') ?? 'front';
const clip = (q.get('clip') ?? 'Idle') as ClipName;
const t = Number(q.get('t') ?? 0);
const lod = Number(q.get('lod') ?? 0);
const play = q.get('play') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#' + (q.get('bg') ?? 'e7e3de'));
scene.add(new THREE.HemisphereLight(0xffffff, 0xb4a796, 2.3));
const key = new THREE.DirectionalLight(0xfff8f0, 1.9);
key.position.set(2.5, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
rim.position.set(-3, 3, -4);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(0.75, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }),
);
ground.position.y = 0.002;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(view === 'game' ? 35 : 22, innerWidth / innerHeight, 0.05, 100);

const lib = new CharacterLibrary(renderer, {
  baseUrl: './models/',
  transcoderPath: './basis/',
  textures: (q.get('tex') as 'png' | 'ktx2') ?? 'png',
});

lib.load(char).then((asset) => {
  const inst = new CharacterInstance(asset);
  inst.setLod(lod);
  scene.add(inst.root);
  if (q.get('wire') === '1') {
    for (const m of inst.lods) (m.material as THREE.MeshStandardMaterial).wireframe = true;
  }
  const h = inst.height;
  const target = new THREE.Vector3(0, view === 'face' ? h * 0.82 : h * 0.5, 0);
  const dist = (h * (view === 'face' ? 0.2 : 0.62)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dirs: Record<string, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0.02, 1),
    face: new THREE.Vector3(0.35, 0.05, 1),
    back: new THREE.Vector3(0, 0.02, -1),
    side: new THREE.Vector3(1, 0.02, 0),
    threequarter: new THREE.Vector3(0.55, 0.12, 1),
    // game camera: 55 deg elevation, slight yaw, the size a phone shows it at
    game: new THREE.Vector3(0.36, Math.tan(THREE.MathUtils.degToRad(55)), 1),
  };
  const d = (dirs[view] ?? dirs.front).clone().normalize();
  camera.position.copy(target).addScaledVector(d, view === "game" ? 6.5 : dist);
  camera.lookAt(view === 'game' ? new THREE.Vector3(0, 0.5, 0) : target);

  if (play) {
    inst.play(clip, 0);
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      inst.update(clock.getDelta());
      renderer.render(scene, camera);
    });
  } else {
    inst.pose(clip, t);
    renderer.render(scene, camera);
  }
  const info = renderer.info.render;
  (window as any).__preview = {
    ready: true,
    calls: info.calls,
    triangles: info.triangles,
    height: h,
    ktx2: asset.usedKtx2,
    bytes: asset.bytes,
  };
});
