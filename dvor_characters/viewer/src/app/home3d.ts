/**
 * Home screen hero: the selected hero's 3D model idling on a lit spot. Drag to turn the hero.
 * Uses the models preloaded by the boot screen (assets.ts), so it appears at once.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { heroById, type HeroId } from './data';
import { load } from './assets';

export interface HomeStage { setHero(id: HeroId): void; dispose(): void }

/** Clips in the GLBs start at t > 0 in places; shift once (shared with the match, flagged in userData). */
function shiftClips(g: GLTF): void {
  for (const c of g.animations) {
    if (c.userData.shifted) continue;
    const t0 = Math.min(...c.tracks.map((t) => t.times[0]));
    if (t0 > 0) { for (const t of c.tracks) { t.times = t.times.slice(); t.shift(-t0); } c.resetDuration(); }
    c.userData.shifted = true;
  }
}

export function createHomeStage(host: HTMLElement, first: HeroId): HomeStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4ea, 0x3a3040, 2.1));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
  key.position.set(-2, 4, 5);
  const rim = new THREE.DirectionalLight(0xff8a2a, 2.6);   // warm back light from the street lamp
  rim.position.set(2.5, 3, -4);
  scene.add(key, rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

  let hero: THREE.Object3D | null = null, mixer: THREE.AnimationMixer | null = null;
  let yaw = 0.35, spin = 0, token = 0, height = 1.75;
  const frame = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // fit the whole body (with a little headroom) whatever the box shape is
    const fitH = height * 1.12, fitW = 1.3;
    const dist = Math.max(fitH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), fitW / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.aspect);
    camera.position.set(0, height * 0.55, dist + 0.2);
    camera.lookAt(0, height * 0.5, 0);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(frame);
  ro.observe(host);

  const setHero = (id: HeroId) => {
    const my = ++token;
    load(heroById(id).model).then((g) => {
      if (my !== token || !alive) return;
      shiftClips(g);
      if (hero) scene.remove(hero);
      hero = cloneSkinned(g.scene);
      const meshes: THREE.Mesh[] = [];
      hero.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; meshes.push(m); } });
      meshes.sort((a, b) => a.name.localeCompare(b.name)).forEach((m, i) => (m.visible = i === 0));
      mixer = new THREE.AnimationMixer(hero);
      const idle = g.animations.find((c) => c.name === 'Idle');
      if (idle) mixer.clipAction(idle).play();
      scene.add(hero);
      hero.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(meshes[0] ?? hero);
      height = Math.max(1.2, box.max.y);
      frame();
      // small hop when the hero appears
      appearAt = clock.elapsedTime;
    }).catch(() => {});
  };

  // drag to turn
  let dragX: number | null = null;
  const down = (e: PointerEvent) => { dragX = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (dragX === null) return; spin = (e.clientX - dragX) * 0.012; yaw += spin; dragX = e.clientX; };
  const up = () => { dragX = null; };
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', up);

  let alive = true, appearAt = -9;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    mixer?.update(dt);
    if (dragX === null) { spin *= 0.92; yaw += spin; yaw += (0.35 - yaw) * dt * 0.8; }
    if (hero) {
      hero.rotation.y = yaw;
      const k = Math.min(1, (clock.elapsedTime - appearAt) / 0.35);
      hero.position.y = 0.12 * Math.sin(k * Math.PI) * (1 - k);
      hero.scale.setScalar(0.92 + 0.08 * (1 - (1 - k) ** 3));
    }
    renderer.render(scene, camera);
  });
  setHero(first);
  frame();

  return {
    setHero,
    dispose() {
      alive = false;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
