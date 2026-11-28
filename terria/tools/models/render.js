/**
 * Browser side of the model renderer: builds one model, renders it with an
 * orthographic camera from the game's fixed angle, returns a PNG and the
 * pixel where the lot centre (world origin) lands.
 */
import * as THREE from 'three';
import { catalogue, rng } from './models.js';

const ELEV = (40 * Math.PI) / 180; // must match CAMERA.tilt = sin(40 deg)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const items = new Map(catalogue().map((i) => [i.key, i]));
window.modelKeys = [...items.keys()];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** @param pxPerM output pixels per metre (before supersampling) */
window.renderModel = (key, pxPerM, ss) => {
  const item = items.get(key);
  const scene = new THREE.Scene();
  const model = item.build(rng(hash(key)));
  scene.add(model);

  // light: sun from the front-left (south-west) so facades facing the camera
  // are lit; shadows fall back and to the right
  scene.add(new THREE.HemisphereLight('#fdfbf5', '#9c8f74', 1.15));
  const sun = new THREE.DirectionalLight('#fff3df', 2.5);
  const sunDir = new THREE.Vector3(-1, 1.35, 0.55).normalize();
  sun.position.copy(sunDir.clone().multiplyScalar(300));
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  const sc = sun.shadow.camera;
  sc.left = -90;
  sc.right = 90;
  sc.top = 90;
  sc.bottom = -90;
  sc.near = 1;
  sc.far = 700;
  scene.add(sun);
  scene.add(sun.target);

  // transparent ground that only shows shadows
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // frame: model bounds + its shadow (falls south-east)
  const b = new THREE.Box3().setFromObject(model);
  const h = Math.max(0, b.max.y);
  const shadowLen = h * (Math.hypot(sunDir.x, sunDir.z) / sunDir.y);
  const pts = [];
  for (const x of [b.min.x, b.max.x + shadowLen * 0.85])
    for (const z of [b.min.z - shadowLen * 0.5, b.max.z])
      for (const y of [Math.min(0, b.min.y), b.max.y]) pts.push([x, y, z]);
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  const cos = Math.cos(ELEV);
  const sin = Math.sin(ELEV);
  for (const [x, y, z] of pts) {
    const up = y * cos - z * sin;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.max(top, up);
    bottom = Math.min(bottom, up);
  }
  const m = 2;
  left -= m;
  top += m;
  const k = pxPerM * ss;
  const W = Math.ceil((right + m - left) * k);
  const H = Math.ceil((top - (bottom - m)) * k);
  right = left + W / k;
  bottom = top - H / k;

  const cam = new THREE.OrthographicCamera(left, right, top, bottom, 1, 2000);
  cam.position.set(0, Math.sin(ELEV) * 800, Math.cos(ELEV) * 800);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();

  renderer.setSize(W, H, false);
  renderer.render(scene, cam);
  const png = renderer.domElement.toDataURL('image/png');

  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  // pixel of the lot centre (origin) in the full-resolution image
  return { png, w: W, h: H, ax: -left * k, ay: top * k };
};
window.modelsReady = true;
