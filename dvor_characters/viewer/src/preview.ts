/**
 * Single-character preview used for turnaround screenshots and visual QA.
 * URL params: char=CH_Technik  view=front|back|side|threequarter|game  clip=Idle  t=0.0
 *             lod=0|1  tex=png|ktx2  bg=e7e3de  wire=0|1  play=0|1
 *             az=<deg> el=<deg>  any camera direction (az 0 = front, 90 = character's left side)
 *             bones=1  draw the skeleton on top (x-ray)
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
  if (q.get('normals') === '1') {
    for (const m of inst.lods) m.material = new THREE.MeshNormalMaterial();
  }
  if (q.get('wire') === '1') {
    for (const m of inst.lods) (m.material as THREE.MeshStandardMaterial).wireframe = true;
  }
  const h = inst.height;
  const ty = q.get('ty') ? Number(q.get('ty')) : view === 'face' ? 0.82 : 0.5;
  const zf = q.get('zf') ? Number(q.get('zf')) : view === 'face' ? 0.2 : 0.62;
  const target = new THREE.Vector3(0, h * ty, 0);
  const dist = (h * zf) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dirs: Record<string, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0.02, 1),
    face: new THREE.Vector3(0.35, 0.05, 1),
    back: new THREE.Vector3(0, 0.02, -1),
    side: new THREE.Vector3(1, 0.02, 0),
    threequarter: new THREE.Vector3(0.55, 0.12, 1),
    // game camera: 55 deg elevation, slight yaw, the size a phone shows it at
    game: new THREE.Vector3(0.36, Math.tan(THREE.MathUtils.degToRad(55)), 1),
  };
  let d = (dirs[view] ?? dirs.front).clone().normalize();
  if (q.get('az') !== null) {
    const az = THREE.MathUtils.degToRad(Number(q.get('az')));
    const el = THREE.MathUtils.degToRad(Number(q.get('el') ?? 8));
    d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  if (q.get('bones') === '1') {
    const sk = new THREE.SkeletonHelper(inst.root);
    (sk.material as THREE.LineBasicMaterial).depthTest = false;
    (sk.material as THREE.LineBasicMaterial).linewidth = 2;
    sk.renderOrder = 10;
    scene.add(sk);
  }
  camera.position.copy(target).addScaledVector(d, view === "game" ? 6.5 : dist);
  camera.lookAt(view === 'game' ? new THREE.Vector3(0, 0.5, 0) : target);

  // ---- measuring mode: orthographic front/side, metre grid, joint markers (Blender coords)
  let cam: THREE.Camera = camera;
  const measure = q.get('measure');
  if (measure) {
    const H = h * 1.08;
    const halfW = (H / 2) * (innerWidth / innerHeight);
    const oc = new THREE.OrthographicCamera(-halfW, halfW, H, 0, 0.01, 10);
    oc.position.set(measure === 'side' ? 3 : 0, -0.03, measure === 'side' ? 0 : 3);
    oc.lookAt(0, -0.03, 0);
    oc.updateProjectionMatrix();
    cam = oc;
    const pts: number[] = [];
    const step = Number(q.get('step') ?? 0.05);
    for (let v = 0; v <= H + 1e-6; v += step) {
      if (measure === 'side') pts.push(-1, v, -halfW, -1, v, halfW);
      else pts.push(-halfW, v, -1, halfW, v, -1);
    }
    for (let u = -Math.floor(halfW / step) * step; u <= halfW; u += step) {
      if (measure === 'side') pts.push(-1, 0, u, -1, H, u);
      else pts.push(u, 0, -1, u, H, -1);
    }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: 0x9a9088 }),
    );
    scene.add(grid);
    const marks = (q.get('marks') ?? '').split(';').filter(Boolean);
    for (const m of marks) {
      const [x, y, z] = m.split(',').map(Number); // Blender: x right(char left), y back, z up
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(Number(q.get('mr') ?? 0.009), 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0033, depthTest: false }),
      );
      s.renderOrder = 10;
      s.position.set(x, z, -y);
      scene.add(s);
    }
    // labels every 0.1 along both axes
    const lab = document.createElement('canvas');
    lab.width = innerWidth;
    lab.height = innerHeight;
    lab.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
    document.body.appendChild(lab);
    const g = lab.getContext('2d')!;
    g.font = '10px monospace';
    g.fillStyle = '#333';
    const toPx = (wx: number, wy: number, wz: number) => {
      const v = new THREE.Vector3(wx, wy, wz).project(oc);
      return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
    };
    for (let v = 0; v <= H; v += 0.1) {
      const [px, py] = toPx(measure === 'side' ? 0 : -halfW, v, measure === 'side' ? halfW : 0);
      g.fillText(v.toFixed(1), 2, py - 2);
      void px;
    }
    for (let u = -Math.floor(halfW / 0.1) * 0.1; u <= halfW; u += 0.1) {
      const [px] = toPx(measure === 'side' ? 0 : u, 0, measure === 'side' ? u : 0);
      // side view: screen right = Blender +Y (back) -> label with Blender y
      g.fillText((measure === 'side' ? -u : u).toFixed(1), px + 2, innerHeight - 4);
    }
  }

  if (play) {
    inst.play(clip, 0);
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      inst.update(clock.getDelta());
      renderer.render(scene, cam);
    });
  } else {
    if (q.get('rest') === '1' || asset.clips.size === 0) inst.mixer.stopAllAction();
    else inst.pose(clip, t);
    renderer.render(scene, cam);
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
