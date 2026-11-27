// Data-driven blocky-story engine. Loads ../<ep>/episode.json + timeline.json, exposes renderAt(t).
import * as THREE from 'three';

const W = 720, H = 1280;
const EP = new URLSearchParams(location.search).get('ep');
const E = await (await fetch(`../${EP}/episode.json`)).json();
const TL = await (await fetch(`../${EP}/timeline.json`)).json();
const LINES = TL.lines, SH = E.lines;

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const shotStart = LINES.map((l, i) => i === 0 ? 0 : (LINES[i - 1].end + l.start) / 2);
const shotEnd = i => i + 1 < LINES.length ? shotStart[i + 1] : TL.duration;
const shotOf = t => { let s = 0; for (let i = 0; i < LINES.length; i++) if (t >= shotStart[i]) s = i; return s; };

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('wrap').prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 400);

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra });
function box(w, h, d, m, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; parent.add(b); return b;
}
const grad = stops => canvasTex(4, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

// ---------- lighting presets ----------
const SKY = {
  day: grad([[0, '#3d8ff0'], [0.6, '#8fd0ff'], [1, '#dff3ff']]),
  evening: grad([[0, '#2a2f78'], [0.45, '#c8587a'], [0.75, '#ff9a5a'], [1, '#ffd08a']]),
  night: grad([[0, '#060a24'], [0.6, '#14205a'], [1, '#2b3f7a']]),
};
const hemi = new THREE.HemisphereLight(0xdff2ff, 0x5a7a3a, 1.25); scene.add(hemi);
// soft key light that travels with the camera (keeps faces readable at night)
const camFill = new THREE.PointLight(0xdfe6ff, 0, 40, 1.2); camera.add(camFill); camFill.position.set(1.5, 1.5, 0); scene.add(camera);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
sun.shadow.bias = -0.0005; scene.add(sun); scene.add(sun.target);
const LIGHT = {
  day: { sky: SKY.day, fog: 0xcfeaff, hemi: [0xdff2ff, 0x5a7a3a, 1.25], sun: [0xfff1d6, 2.4, [18, 30, 16]], exp: 1.05, lamp: 0.4 },
  evening: { sky: SKY.evening, fog: 0xe8a080, hemi: [0xffc8a8, 0x4a3a5a, 0.95], sun: [0xffa060, 2.0, [-30, 12, 10]], exp: 1.0, lamp: 1.2, fill: 0.8 },
  night: { sky: SKY.night, fog: 0x1a2550, hemi: [0x7a90d8, 0x202848, 1.25], sun: [0xb0c8ff, 1.5, [-12, 30, 18]], exp: 1.3, lamp: 2.6, fill: 2.2 },
};
scene.fog = new THREE.Fog(0xcfeaff, 60, 170);
const lampMats = [];
const INDOOR = {
  day: { hemi: [0xfff4e0, 0x7a5a3a, 1.35], sun: [0xfff1d6, 1.9, [10, 30, 18]], exp: 1.05, lamp: 0.8, win: [0xbfe6ff, 0x8fcfff, 0.6] },
  evening: { hemi: [0xffe2c0, 0x5a3a2a, 1.2], sun: [0xffc890, 1.7, [8, 28, 16]], exp: 1.05, lamp: 1.4, win: [0xff9a5a, 0xff8040, 0.6] },
  night: { hemi: [0xffdcb8, 0x3a2a2a, 1.05], sun: [0xffd09a, 1.5, [6, 26, 16]], exp: 1.08, lamp: 2.4, win: [0x0a1238, 0x101a50, 0.4] },
};
function setTime(name, loc) {
  if (loc === 'home') {
    const L = INDOOR[name] || INDOOR.day;
    scene.background = SKY[name] || SKY.day; scene.fog.color.setHex(0x2a2a2a);
    hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2];
    sun.color.setHex(L.sun[0]); sun.intensity = L.sun[1]; sun.position.set(...L.sun[2]);
    renderer.toneMappingExposure = L.exp; lampMats.forEach(m => m.emissiveIntensity = L.lamp); camFill.intensity = 0;
    homeWin.color.setHex(L.win[0]); homeWin.emissive.setHex(L.win[1]); homeWin.emissiveIntensity = L.win[2];
    return;
  }
  const L = LIGHT[name] || LIGHT.day;
  scene.background = L.sky; scene.fog.color.setHex(L.fog);
  hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2];
  sun.color.setHex(L.sun[0]); sun.intensity = L.sun[1]; sun.position.set(...L.sun[2]);
  renderer.toneMappingExposure = L.exp;
  lampMats.forEach(m => m.emissiveIntensity = L.lamp);
  camFill.intensity = L.fill || 0;
}

// ---------- world ----------
const grass = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#5cb84a'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (const [x, y] of [[32, 32], [96, 96], [96, 32], [32, 96]]) { g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
}, [80, 80]);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

function tree(x, z, s = 1, parent = scene) {
  box(1 * s, 4 * s, 1 * s, mat(0x7a4a26), x, 2 * s, z, parent);
  box(4.2 * s, 3.4 * s, 4.2 * s, mat(0x3f9a35), x, 5.4 * s, z, parent);
  box(2.8 * s, 2 * s, 2.8 * s, mat(0x4cb040), x, 7.6 * s, z, parent);
}
function bench(x, z, ry = 0, parent = scene) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
  box(4, 0.3, 1.2, mat(0xb07a44), 0, 1.2, 0, g); box(4, 1, 0.25, mat(0xb07a44), 0, 1.9, -0.5, g);
  box(0.3, 1.1, 1, mat(0x444444), -1.7, 0.55, 0, g); box(0.3, 1.1, 1, mat(0x444444), 1.7, 0.55, 0, g);
}
function lamp(x, z, parent = scene) {
  box(0.35, 7, 0.35, mat(0x333a44), x, 3.5, z, parent);
  const m = mat(0xfff3b0, { emissive: 0xffe680, emissiveIntensity: 0.4 }); lampMats.push(m);
  box(1.2, 0.5, 1.2, m, x, 7.2, z, parent, false);
}
// clouds (shared)
for (let i = 0; i < 9; i++) {
  const cg = new THREE.Group(); cg.position.set(-60 + i * 16 + rnd() * 6, 30 + rnd() * 10, -70 - rnd() * 30); scene.add(cg);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.3 });
  box(9, 2.5, 4, m, 0, 0, 0, cg, false); box(5, 2, 3.5, m, 1.5, 1.8, 0, cg, false);
}

const LOC = {};
const homeWin = mat(0xbfe6ff, { emissive: 0x8fcfff, emissiveIntensity: 0.5 });
// --- school yard ---
{
  const G = new THREE.Group(); scene.add(G); LOC.school = G;
  const tiles = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#c9c4bb'; g.fillRect(0, 0, w, h); g.strokeStyle = '#a9a39a'; g.lineWidth = 4; g.strokeRect(0, 0, w, h); }, [18, 9]);
  box(44, 0.2, 22, new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.9 }), 4, 0.1, -1, G, false);
  const wallTex = canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#f2dcb3'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 9; c++) {
      if (r === 1 && c === 4) continue;
      const x = 14 + c * 56, y = 18 + r * 72;
      g.fillStyle = '#ffffff'; g.fillRect(x - 3, y - 3, 40, 50); g.fillStyle = '#5ab6e8'; g.fillRect(x, y, 34, 44);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 3, y + 3, 8, 30);
    }
    g.fillStyle = '#8a4b2a'; g.fillRect(232, 92, 48, 68); g.fillStyle = '#e0b04a'; g.fillRect(268, 124, 6, 6);
  });
  const sm = mat(0xf2dcb3);
  const school = new THREE.Mesh(new THREE.BoxGeometry(40, 12.5, 9), [sm, sm, mat(0xb5462f), sm, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 }), sm]);
  school.position.set(4, 6.25, -17); school.castShadow = school.receiveShadow = true; G.add(school);
  box(42, 1, 10.5, mat(0xb5462f), 4, 13, -17, G);
  const sign = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#2c5fd6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#fff'; g.font = '900 78px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(E.schoolSign || 'ШКОЛА №7', w / 2, h / 2 + 4);
  });
  const bm = mat(0x2c5fd6);
  box(10, 2.5, 0.4, [bm, bm, bm, bm, new THREE.MeshStandardMaterial({ map: sign }), bm], 4, 14.6, -12, G);
  [[-16, -6], [-20, 6], [24, -6], [27, 8], [-26, -14], [34, -16], [-14, 18], [22, 20], [40, 2], [-34, 2]].forEach(([x, z]) => tree(x, z, 0.9 + rnd() * 0.4, G));
  bench(-11, -6, 0, G); bench(19, -6, 0, G); lamp(-8, 6, G); lamp(16, 6, G);
}
// --- park ---
{
  const G = new THREE.Group(); scene.add(G); LOC.park = G;
  const path = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#d8c08a'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(120,90,40,0.25)'; for (let i = 0; i < 40; i++) g.fillRect(rnd() * w, rnd() * h, 4, 4); }, [10, 3]);
  box(70, 0.15, 8, new THREE.MeshStandardMaterial({ map: path, roughness: 1 }), 0, 0.08, 1, G, false);
  const water = new THREE.Mesh(new THREE.BoxGeometry(22, 0.3, 12), mat(0x3aa0e8, { roughness: 0.15, metalness: 0.1 }));
  water.position.set(6, 0.1, -16); water.receiveShadow = true; G.add(water);
  box(24, 0.6, 1, mat(0x9a9a9a), 6, 0.3, -9.5, G); box(24, 0.6, 1, mat(0x9a9a9a), 6, 0.3, -22.5, G);
  for (let i = 0; i < 26; i++) { const x = -45 + i * 3.6; box(0.3, 1.4, 0.3, mat(0xffffff), x, 0.7, 6.5, G); }
  box(94, 0.25, 0.2, mat(0xffffff), 0, 1.2, 6.5, G);
  [[-14, -8], [-22, -3], [-30, -12], [20, -6], [26, -14], [34, -4], [-8, -24], [16, -30], [-40, -6], [42, -12], [-18, 14], [24, 14]].forEach(([x, z]) => tree(x, z, 0.9 + rnd() * 0.5, G));
  bench(-6, -3.5, 0, G); bench(10, -3.5, 0, G); lamp(-12, -3.2, G); lamp(2, -3.2, G); lamp(16, -3.2, G);
  for (let i = 0; i < 8; i++) { const c = [0xff5a7a, 0xffd23f, 0xb07aff][i % 3]; box(0.6, 0.6, 0.6, mat(c), -20 + i * 5 + rnd() * 2, 0.3, -6.5 - rnd(), G); }
}
// --- home (room interior seen from the front) ---
{
  const G = new THREE.Group(); scene.add(G); LOC.home = G;
  const floor = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#c08a55'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9a6a3a'; g.lineWidth = 3; for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }, [8, 6]);
  box(80, 0.2, 70, new THREE.MeshStandardMaterial({ map: floor, roughness: 0.8 }), 2, 0.1, 10, G, false);
  const wallP = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9fc7e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#8bb6db'; g.fillRect(0, 0, 64, h); }, [10, 3]);
  const wm = new THREE.MeshStandardMaterial({ map: wallP });
  box(80, 40, 0.5, wm, 2, 20, -16, G); box(0.5, 40, 70, wm, -18, 20, 10, G); box(0.5, 40, 70, wm, 22, 20, 10, G);
  box(80, 0.5, 70, mat(0xf4efe6), 2, 30, 10, G, false);
  box(80, 1.2, 0.3, mat(0xffffff), 2, 0.6, -15.7, G, false);
  const win = homeWin; box(7, 5, 0.3, win, 8, 7, -15.7, G, false);
  box(7.6, 0.4, 0.6, mat(0xffffff), 8, 4.4, -15.5, G);
  box(10, 1.4, 4.5, mat(0x7a4ab0), -8, 1.2, -12, G); box(10, 2.6, 1.2, mat(0x6a3aa0), -8, 2.4, -14, G); // sofa
  box(5, 0.3, 3, mat(0x8a5a2a), 4, 2.2, -6, G); for (const [dx, dz] of [[-2.2, -1.2], [2.2, -1.2], [-2.2, 1.2], [2.2, 1.2]]) box(0.3, 2.2, 0.3, mat(0x6a4a2a), 4 + dx, 1.1, -6 + dz, G);
  box(4, 3, 0.4, mat(0x111111), 12, 5, -15.6, G); // tv
  box(3, 8, 2, mat(0x8a5a2a), -13.5, 4, -8, G); // shelf
  lamp(14, -12, G);
}
function setLocation(name) { for (const k in LOC) LOC[k].visible = k === (name || 'school'); }

// ---------- faces ----------
const faceCache = new Map();
function faceTex(skin, expr, glasses) {
  const key = skin + expr + glasses;
  if (faceCache.has(key)) return faceCache.get(key);
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,120,120,0.25)';
    g.beginPath(); g.ellipse(48, 160, 22, 14, 0, 0, 7); g.ellipse(208, 160, 22, 14, 0, 0, 7); g.fill();
    g.lineCap = 'round'; g.strokeStyle = '#1a1a1a'; g.fillStyle = '#1a1a1a';
    const eyeY = 112;
    const brow = (dy, tilt) => { g.lineWidth = 9; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128 + s * 66, eyeY - 48 + dy - tilt); g.lineTo(128 + s * 26, eyeY - 48 + dy + tilt); g.stroke(); } };
    if (glasses && expr !== 'shock' && expr !== 'cry') {
      g.fillStyle = '#111'; g.beginPath(); g.roundRect(28, 86, 200, 52, 20); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(48, 96, 40, 8); g.fillRect(148, 96, 40, 8);
      if (expr === 'angry') brow(14, 12);
    } else if (expr === 'laugh' || expr === 'joy') {
      g.lineWidth = 11; for (const s of [-1, 1]) { g.beginPath(); g.arc(128 + s * 46, eyeY + 10, 22, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    } else if (expr === 'cry') {
      g.lineWidth = 10; for (const s of [-1, 1]) { g.beginPath(); g.arc(128 + s * 46, eyeY - 4, 20, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
      brow(2, -12); g.fillStyle = '#6fc3ff';
      for (const s of [-1, 1]) { g.fillRect(128 + s * 46 - 7, eyeY + 14, 14, 70); }
    } else {
      const ry = expr === 'shock' ? 34 : expr === 'angry' ? 24 : 30, rx = expr === 'shock' ? 25 : 22;
      for (const s of [-1, 1]) {
        g.fillStyle = '#1a1a1a'; g.beginPath(); g.ellipse(128 + s * 46, eyeY, rx, ry, 0, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(128 + s * 46 - 7, eyeY - 12, 9, 0, 7); g.fill();
        g.beginPath(); g.arc(128 + s * 46 + 8, eyeY + 10, 4, 0, 7); g.fill();
      }
      if (expr === 'sad') { brow(4, -10); g.fillStyle = '#6fc3ff'; g.beginPath(); g.ellipse(70, 158, 8, 14, 0, 0, 7); g.fill(); }
      if (expr === 'shock') brow(-14, 0);
      if (expr === 'angry') brow(14, 12);
      if (expr === 'think') { g.lineWidth = 9; g.beginPath(); g.moveTo(150, eyeY - 52); g.lineTo(196, eyeY - 60); g.stroke(); }
    }
    g.strokeStyle = '#1a1a1a'; g.fillStyle = '#5a1414'; g.lineWidth = 9;
    const my = 190;
    if (expr === 'neutral' || expr === 'think') { g.beginPath(); g.moveTo(104, my); g.lineTo(152, my); g.stroke(); }
    else if (expr === 'smile') { g.beginPath(); g.arc(128, my - 26, 34, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
    else if (expr === 'sad' || expr === 'cry') { g.beginPath(); g.arc(128, my + 26, 28, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); }
    else if (expr === 'angry') { g.beginPath(); g.moveTo(96, my + 6); g.lineTo(128, my - 6); g.lineTo(160, my + 6); g.stroke(); }
    else if (expr === 'smug') { g.beginPath(); g.moveTo(100, my); g.quadraticCurveTo(140, my + 6, 166, my - 16); g.stroke(); }
    else if (expr === 'shock') { g.beginPath(); g.ellipse(128, my + 6, 18, 24, 0, 0, 7); g.fill(); g.stroke(); }
    else {
      g.beginPath(); g.moveTo(84, my - 14); g.lineTo(172, my - 14); g.quadraticCurveTo(170, my + 42, 128, my + 44); g.quadraticCurveTo(86, my + 42, 84, my - 14); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(92, my - 10, 72, 12);
      g.fillStyle = '#e46a7a'; g.beginPath(); g.ellipse(128, my + 30, 20, 10, 0, 0, 7); g.fill();
    }
  });
  faceCache.set(key, t); return t;
}

// ---------- labels ----------
const labelCache = new Map();
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function heart(g, x, y, s, c) {
  g.fillStyle = c; g.beginPath(); g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 1.1, y - s * 0.45, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.45, x, y + s * 0.35); g.fill();
}
function labelTex(text, isHeart, color) {
  const key = text + isHeart + color;
  if (labelCache.has(key)) return labelCache.get(key);
  const t = canvasTex(640, 160, (g, w) => {
    g.font = '900 88px Inter'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const iconW = isHeart ? 96 : 0;
    let tw = g.measureText(text).width; const maxW = w - 90 - iconW;
    if (tw > maxW) { g.font = `900 ${Math.floor(88 * maxW / tw)}px Inter`; tw = maxW; }
    const pw = tw + iconW + 70, x0 = (w - pw) / 2;
    g.fillStyle = 'rgba(10,14,25,0.78)'; g.beginPath(); g.roundRect(x0, 14, pw, 132, 66); g.fill();
    g.lineWidth = 8; g.strokeStyle = color; g.stroke();
    if (isHeart) heart(g, x0 + 75, 92, 62, '#ff4d7d');
    g.lineWidth = 12; g.strokeStyle = '#000'; g.strokeText(text, x0 + 35 + iconW, 84);
    g.fillStyle = color; g.fillText(text, x0 + 35 + iconW, 84);
  });
  labelCache.set(key, t); return t;
}

// ---------- characters ----------
const PRESETS = {
  timur: { skin: '#ffcf9e', shirt: 0x2f7de1, pants: 0x1f2f5a, hair: 0x4a2a14, stripe: 0xffffff, hairStyle: 'spiky' },
  max: { skin: '#ffd9b0', shirt: 0xd8262e, pants: 0x161616, hair: 0xf3c64b, glasses: true, chain: true, cap: 0x111111 },
  liza: { skin: '#f1b98c', shirt: 0xff7ab6, pants: 0x6a4aa8, hair: 0x2a1a10, hairStyle: 'long' },
  artem: { skin: '#a8714a', shirt: 0x37b34a, pants: 0x3a3a3a, hair: 0x111111 },
  granny: { skin: '#ffd2a8', shirt: 0x8a57c9, pants: 0x8a57c9, hair: 0xdedede, hairStyle: 'bun', dress: true },
  mom: { skin: '#ffd2a8', shirt: 0x2fb3a0, pants: 0x2a3a6a, hair: 0x6a3a1a, hairStyle: 'long', dress: true },
  teacher: { skin: '#f5c7a0', shirt: 0xffffff, pants: 0x2a2a2a, hair: 0x3a2a1a, hairStyle: 'bun', glassesClear: true, tie: 0xc0392b },
  dad: { skin: '#e8b58a', shirt: 0x5a6a7a, pants: 0x2a2a3a, hair: 0x2a2a2a, beard: 0x2a2a2a },
  guard: { skin: '#e0a878', shirt: 0x2a3a5a, pants: 0x1a1a2a, hair: 0x2a2a2a, cap: 0x2a3a5a },
  kid: { skin: '#ffd9b0', shirt: 0xffb020, pants: 0x3a6ad0, hair: 0xb05a1a, small: true },
};
function makeChar(id, o) {
  const root = new THREE.Group(); scene.add(root);
  if (o.small) root.scale.setScalar(0.72);
  const skinM = mat(o.skin), shirtM = mat(o.shirt), pantsM = mat(o.pants), hairM = mat(o.hair);
  const legs = [-0.5, 0.5].map(x => { const p = new THREE.Group(); p.position.set(x, 2, 0); root.add(p); box(0.98, 2, 1, pantsM, 0, -1, 0, p); box(1, 0.35, 1.1, mat(0x2a2a2a), 0, -1.85, 0.05, p); return p; });
  const torso = new THREE.Group(); torso.position.set(0, 2, 0); root.add(torso);
  box(2, 2, 1, shirtM, 0, 1, 0, torso);
  if (o.stripe) box(2.02, 0.35, 1.02, mat(o.stripe), 0, 1.25, 0, torso);
  if (o.dress) box(2.3, 1, 1.3, shirtM, 0, -0.35, 0, torso);
  if (o.tie) box(0.3, 1.2, 0.08, mat(o.tie), 0, 1.2, 0.54, torso);
  if (o.chain) box(0.9, 0.9, 0.08, mat(0xffd23f, { metalness: 0.8, roughness: 0.3 }), 0, 1.2, 0.54, torso);
  const arms = [-1.5, 1.5].map(x => { const p = new THREE.Group(); p.position.set(x, 1.9, 0); torso.add(p); box(1, 2, 1, shirtM, 0, -0.55, 0, p); box(0.98, 0.7, 0.98, skinM, 0, -1.9, 0, p); return p; });
  const headG = new THREE.Group(); headG.position.set(0, 2.05, 0); torso.add(headG);
  const faceM = new THREE.MeshStandardMaterial({ map: faceTex(o.skin, 'neutral', o.glasses), roughness: 0.7 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), [skinM, skinM, skinM, skinM, faceM, skinM]);
  head.position.y = 0.8; head.castShadow = true; headG.add(head);
  const hs = o.hairStyle || 'short';
  box(1.62, 0.45, 1.62, hairM, 0, 1.72, -0.02, headG); box(1.62, 1.1, 0.35, hairM, 0, 1.15, -0.66, headG);
  if (hs === 'long') { box(1.7, 2.2, 0.5, hairM, 0, 0.6, -0.7, headG); box(0.3, 1.6, 1.4, hairM, -0.82, 0.9, -0.1, headG); box(0.3, 1.6, 1.4, hairM, 0.82, 0.9, -0.1, headG); }
  if (hs === 'bun') box(0.8, 0.7, 0.8, hairM, 0, 2.2, -0.4, headG);
  if (hs === 'spiky') for (let i = -1; i <= 1; i++) box(0.5, 0.5, 0.5, hairM, i * 0.5, 2.1, 0.1 * i, headG).rotation.z = i * 0.3;
  if (o.cap) { box(1.66, 0.4, 1.66, mat(o.cap), 0, 1.85, 0, headG); box(1.4, 0.12, 0.8, mat(o.cap), 0, 1.68, 1.05, headG); }
  if (o.beard) { box(1.52, 0.26, 0.2, mat(o.beard), 0, 0.12, 0.7, headG); box(0.2, 0.7, 0.2, mat(o.beard), -0.66, 0.4, 0.7, headG); box(0.2, 0.7, 0.2, mat(o.beard), 0.66, 0.4, 0.7, headG); }
  if (o.glassesClear) { const gm = mat(0x222222); box(0.5, 0.06, 0.05, gm, -0.35, 1.1, 0.77, headG); box(0.5, 0.06, 0.05, gm, 0.35, 1.1, 0.77, headG); box(0.06, 0.4, 0.05, gm, -0.6, 0.9, 0.77, headG); box(0.06, 0.4, 0.05, gm, 0.6, 0.9, 0.77, headG); box(0.06, 0.4, 0.05, gm, -0.1, 0.9, 0.77, headG); box(0.06, 0.4, 0.05, gm, 0.1, 0.9, 0.77, headG); }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex('0', false, '#fff'), depthTest: false, transparent: true }));
  label.renderOrder = 10; root.add(label);
  const bags = arms.map(a => box(0.8, 1, 0.6, mat(0xa8743f), 0, -2.6, 0.1, a));
  return { id, root, legs, arms, torso, headG, faceM, label, bags, o, phase: Object.keys(PRESETS).indexOf(o.preset) + rnd() * 3 };
}
function pose(c, p, t) {
  const [lL, lR] = c.legs, [aL, aR] = c.arms;
  for (const g of [lL, lR, aL, aR, c.torso, c.headG]) g.rotation.set(0, 0, 0);
  c.torso.position.set(0, 2, 0); lL.position.y = 2; lR.position.y = 2;
  const breathe = Math.sin(t * 2.2 + c.phase) * 0.04;
  aL.rotation.z = -0.05; aR.rotation.z = 0.05; c.torso.position.y += breathe * 0.3;
  c.headG.rotation.y = Math.sin(t * 0.7 + c.phase) * 0.06;
  const walkLegs = sp => { const s = Math.sin(t * sp); lL.rotation.x = s * 0.7; lR.rotation.x = -s * 0.7; aL.rotation.x = -s * 0.7; aR.rotation.x = s * 0.7; c.torso.position.y = 2 + Math.abs(Math.cos(t * sp)) * 0.12; return s; };
  if (p === 'walk') walkLegs(9);
  else if (p === 'run') { walkLegs(15); lL.rotation.x *= 1.3; lR.rotation.x *= 1.3; c.torso.rotation.x = 0.15; }
  else if (p === 'carry' || p === 'carrywalk') {
    if (p === 'carrywalk') walkLegs(9);
    aL.rotation.x = -0.25; aR.rotation.x = -0.25;
  } else if (p === 'laugh') {
    const k = Math.sin(t * 16);
    c.torso.rotation.x = -0.15 + k * 0.05; c.headG.rotation.x = -0.25 + k * 0.08;
    aL.rotation.x = -0.9; aR.rotation.x = -0.9; aL.rotation.z = 0.5; aR.rotation.z = -0.5;
    c.torso.position.y = 2 + Math.abs(k) * 0.12;
  } else if (p === 'point') {
    const k = Math.sin(t * 16);
    aR.rotation.x = -1.55; aR.rotation.z = 0.15; aL.rotation.x = -0.9; aL.rotation.z = 0.5;
    c.headG.rotation.x = -0.2 + k * 0.07; c.torso.position.y = 2 + Math.abs(k) * 0.1;
  } else if (p === 'sad') { c.headG.rotation.x = 0.28; c.torso.rotation.x = 0.06; }
  else if (p === 'cry') { c.headG.rotation.x = 0.35 + Math.sin(t * 12) * 0.04; aL.rotation.x = -2.3; aR.rotation.x = -2.3; aL.rotation.z = 0.55; aR.rotation.z = -0.55; c.torso.rotation.x = 0.12; }
  else if (p === 'shock') { c.headG.rotation.x = -0.12; aL.rotation.z = -0.55; aR.rotation.z = 0.55; aL.rotation.x = -0.2; aR.rotation.x = -0.2; }
  else if (p === 'angry') { const k = Math.sin(t * 20); aL.rotation.x = -0.5; aR.rotation.x = -1.2 + k * 0.25; c.torso.rotation.x = 0.1; c.headG.rotation.x = 0.1; }
  else if (p === 'cheer') { const k = Math.sin(t * 10); aL.rotation.z = -2.6 - k * 0.2; aR.rotation.z = 2.6 + k * 0.2; c.torso.position.y = 2 + Math.max(0, k) * 0.35; }
  else if (p === 'wave') aR.rotation.z = 2.5 + Math.sin(t * 10) * 0.35;
  else if (p === 'think') { aR.rotation.x = -2.2; aR.rotation.z = -0.5; c.headG.rotation.z = 0.15; }
  else if (p === 'hug') { aL.rotation.x = -1.5; aR.rotation.x = -1.5; aL.rotation.z = 0.5; aR.rotation.z = -0.5; }
  else if (p === 'give') { aR.rotation.x = -1.3; aL.rotation.x = -1.3; }
  else if (p === 'phone') { aR.rotation.x = -1.4; aR.rotation.z = -0.4; c.headG.rotation.x = 0.3; }
  else if (p === 'sit') {
    c.root.position.y = -0.8; lL.rotation.x = -1.5; lR.rotation.x = -1.5; c.torso.position.y = 2;
  }
  else if (p === 'facepalm') { aR.rotation.x = -2.4; aR.rotation.z = -0.3; c.headG.rotation.x = 0.25; }
  else if (p === 'shrug') { aL.rotation.z = -0.9; aR.rotation.z = 0.9; aL.rotation.x = -0.6; aR.rotation.x = -0.6; c.headG.rotation.z = 0.12; }
}

const CAST = {};
for (const [id, c] of Object.entries(E.cast)) {
  const look = { ...(PRESETS[c.preset] || {}), ...(c.look || {}), preset: c.preset };
  if (typeof look.shirt === 'string') look.shirt = parseInt(look.shirt.replace('#', ''), 16);
  CAST[id] = makeChar(id, look);
}

// props
const PROPS = (E.props || []).map(p => {
  const shapes = { wallet: [0.9, 0.2, 0.6, 0x7a4a26], phone: [0.5, 0.9, 0.12, 0x111111], box: [1.2, 1.2, 1.2, 0xc8954a], bag: [0.8, 1, 0.6, 0xa8743f], book: [0.9, 0.25, 1.2, 0xd03a3a], ball: [0.8, 0.8, 0.8, 0xff7a1a], letter: [0.9, 0.05, 0.6, 0xffffff], cake: [1.6, 1, 1.6, 0xffc0d0], gift: [1.2, 1.2, 1.2, 0xe0303a], money: [1.0, 0.3, 0.5, 0x4caf50] };
  const [w, h, d, col] = shapes[p.shape] || shapes.box;
  const m = box(...(p.size || [w, h, d]), mat(p.color ? parseInt(p.color.replace('#', ''), 16) : col), 0, 0, 0);
  if (p.shape === 'gift') box(1.25, 0.25, 0.3, mat(0xffd23f), 0, 0, 0, m);
  return { p, m };
});

// ---------- state over time ----------
function shotLoc(i) { for (let j = i; j >= 0; j--) if (SH[j].location) return SH[j].location; return E.location || 'school'; }
function shotTime(i) { for (let j = i; j >= 0; j--) if (SH[j].time) return SH[j].time; return E.time || 'day'; }
function stateAt(t, s) {
  const st = {};
  for (const [id, c] of Object.entries(E.cast)) st[id] = { pos: v3(c.pos[0], 0, c.pos[1]), face: c.faceTo ?? 'cam', label: c.label ?? null, hidden: !!c.hidden, moving: false, dir: null, labelPop: 1, sc: CAST[id].root.scale.y };
  for (let j = 0; j <= s; j++) {
    const acts = SH[j].acts || {}, t0 = shotStart[j], isCur = j === s;
    // location change resets everyone to explicit positions given in that shot
    for (const [id, a] of Object.entries(acts)) {
      const x = st[id]; if (!x) continue;
      if (a.pos) x.pos.set(a.pos[0], 0, a.pos[1]);
      if (a.hide !== undefined) x.hidden = a.hide;
      if (a.show) x.hidden = false;
      if (a.faceTo !== undefined) x.face = a.faceTo;
      if (a.moveTo) {
        const to = v3(a.moveTo[0], 0, a.moveTo[1]);
        const dist = x.pos.distanceTo(to), dur = a.walkTime || Math.max(0.6, dist / (a.run ? 6 : 3.4));
        const k = isCur ? clamp((t - t0 - (a.delay || 0)) / dur) : 1;
        x.dir = to.clone().sub(x.pos);
        if (isCur && k > 0 && k < 1) x.moving = a.run ? 'run' : 'walk';
        x.pos.lerp(to, k);
        if (isCur && k >= 1) x.dir = null;
        if (!isCur) x.dir = null;
      }
      if (a.label !== undefined) {
        const L = a.label;
        if (L && L.to !== undefined) {
          const dur = L.dur || 1.6, k = isCur ? easeOut((t - t0 - (L.delay ?? 0.3)) / dur) : 1;
          x.label = { ...L, value: lerp(L.from ?? 0, L.to, k) };
          if (isCur && k > 0 && k < 1) x.labelPop = 1 + 0.08 * Math.abs(Math.sin(t * 20));
        } else if (!(isCur && L && L.delay && t - t0 < L.delay)) x.label = L; // reveal at its delay, keep the previous label until then
        if (isCur && L && L.pop) { const pk = (t - t0 - (L.delay ?? 0)) ; if (pk > 0 && pk < 0.35) x.labelPop = 1 + 0.35 * (1 - pk / 0.35); }
      }
    }
  }
  return st;
}
function labelText(L) {
  if (!L) return null;
  if (L.value !== undefined) return fmt(L.value) + (L.suffix ?? '');
  return L.text ?? '';
}

// ---------- camera ----------
const headPos = (x, y = 4.9) => v3(x.pos.x, y * (x.sc || 1), x.pos.z);
function frontDir(x, others) {
  // direction the character "faces" for framing; 'cam' => world +z
  const f = x.face;
  if (f && f !== 'cam') {
    const tgt = Array.isArray(f) ? v3(f[0], 0, f[1]) : others[f]?.pos;
    if (tgt) { const d = tgt.clone().sub(x.pos); d.y = 0; if (d.length() > 0.01) return d.normalize(); }
  }
  return v3(0, 0, 1);
}
function placeCam(spec, st, k, t) {
  const [type, a, b] = (spec || 'wide').split(':');
  const visible = Object.entries(st).filter(([, x]) => !x.hidden);
  let pos, tgt, fov = 50;
  const push = lerp(1.06, 0.96, ease(k));
  if (type === 'close' || type === 'medium' || type === 'low') {
    const x = st[a]; let d = frontDir(x, st);
    if (x.face && x.face !== 'cam') { // talking to someone: 3/4 view so the partner does not block the lens
      const r1 = d.clone().applyAxisAngle(v3(0, 1, 0), 0.62), r2 = d.clone().applyAxisAngle(v3(0, 1, 0), -0.62);
      d = r1.z >= r2.z ? r1 : r2;
    }
    const side = v3(d.z, 0, -d.x);
    const dist = (type === 'close' ? 6.4 : type === 'low' ? 7.5 : 10.5) * push;
    fov = type === 'close' ? 40 : 46;
    const y = type === 'close' ? 5.6 : type === 'low' ? 2.2 : 5.4;
    pos = headPos(x, y).add(d.clone().multiplyScalar(dist)).add(side.multiplyScalar(type === 'close' ? 0.8 : 1.6));
    tgt = headPos(x, type === 'close' ? 5.6 : type === 'low' ? 5.6 : 4.9);
  } else if (type === 'over') {
    const A = st[a], B = st[b];
    const ab = B.pos.clone().sub(A.pos); ab.y = 0; const len = ab.length(); ab.normalize();
    let side = v3(ab.z, 0, -ab.x); if (side.z < 0) side.multiplyScalar(-1);
    pos = headPos(A, 6.0).add(ab.clone().multiplyScalar(-3.5 * push)).add(side.multiplyScalar(3.8));
    tgt = headPos(B, 5.0); fov = 40;
  } else if (type === 'two') {
    const A = st[a], B = st[b];
    const mid = A.pos.clone().add(B.pos).multiplyScalar(0.5);
    const ab = B.pos.clone().sub(A.pos); ab.y = 0; const len = ab.length();
    let n = v3(-ab.z, 0, ab.x).normalize(); if (n.z < 0) n.multiplyScalar(-1);
    n.add(ab.clone().normalize().multiplyScalar(0.55)).normalize(); // show A's face (A looks toward B)
    const dist = Math.max(8, (len * 0.9 + 2.8) / 2 / 0.262) * push;
    pos = mid.clone().add(n.multiplyScalar(dist)); pos.y = 6.2; tgt = v3(mid.x, 4.6, mid.z); fov = 50;
  } else {
    // wide / orbit / top: frame everybody visible (or the listed ids)
    const ids = a ? a.split(',') : visible.map(([id]) => id);
    const pts = ids.map(id => st[id]).filter(Boolean).map(x => x.pos);
    const box3 = new THREE.Box3().setFromPoints(pts.length ? pts : [v3(0, 0, 0)]);
    const c = box3.getCenter(v3(0, 0, 0)); const wdt = Math.max(box3.max.x - box3.min.x, 6) + 5;
    const dist = (wdt / 2 / 0.29) * push;
    if (type === 'orbit') {
      const ang = lerp(-0.35, 0.35, ease(k));
      pos = v3(c.x + Math.sin(ang) * dist, 7.5, c.z + Math.cos(ang) * dist);
    } else if (type === 'top') {
      pos = v3(c.x, dist * 0.9, c.z + dist * 0.45);
    } else pos = v3(c.x + dist * 0.12, 6.6, c.z + dist);
    tgt = v3(c.x, 4.2, c.z); fov = 54;
  }
  return { pos, tgt, fov };
}

// ---------- captions ----------
const cap = document.getElementById('cap'), hook = document.getElementById('hook'), flash = document.getElementById('flash');
const HL = (E.highlight || []).map(w => w.toUpperCase().replace(/Ё/g, 'Е'));
const chunks = [];
LINES.forEach(l => {
  const words = l.text.replace(/[«»"+]/g, '').split(/\s+/).filter(w => w && w !== '—' && w !== '-');
  const groups = []; let cur = [];
  for (const w of words) { cur.push(w); if (cur.join(' ').length > 10 || cur.length === 3 || /[.!?…]$/.test(w)) { groups.push(cur); cur = []; } }
  if (cur.length) groups.push(cur);
  const total = groups.reduce((s, g) => s + g.join(' ').length + 3, 0);
  let t = l.start;
  for (const g of groups) { const d = (l.end - l.start) * (g.join(' ').length + 3) / total; chunks.push({ words: g, s: t, e: t + d }); t += d; }
});
const isHL = w => { const u = w.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]/g, ''); return u.length > 2 && HL.some(h => u.startsWith(h.slice(0, Math.max(4, h.length - 2)))); };

// ---------- main ----------
window.renderAt = function (t) {
  const s = shotOf(t), t0 = shotStart[s], k = (t - t0) / (shotEnd(s) - t0);
  const shot = SH[s];
  setLocation(shotLoc(s)); setTime(shotTime(s), shotLoc(s));
  const st = stateAt(t, s);
  const acts = shot.acts || {};
  const cam = placeCam(shot.cam, st, k, t);
  let shake = shot.shake ? 0.08 * Math.sin(t * 45) * Math.max(0, 1 - (t - t0) / 0.8) : 0;
  camera.position.copy(cam.pos).add(v3(shake, shake * 0.6, 0));
  camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.lookAt(cam.tgt);

  for (const [id, c] of Object.entries(CAST)) {
    const x = st[id], a = acts[id] || {};
    c.root.visible = !x.hidden;
    c.root.position.copy(x.pos);
    // facing
    let look = null;
    if (x.moving && x.dir) look = x.pos.clone().add(x.dir);
    else if (x.face === 'cam') look = v3(camera.position.x, 0, camera.position.z);
    else if (Array.isArray(x.face)) look = v3(x.face[0], 0, x.face[1]);
    else if (st[x.face]) look = st[x.face].pos;
    if (look) c.root.rotation.y = Math.atan2(look.x - x.pos.x, look.z - x.pos.z);
    const p = x.moving ? (a.pose === 'carry' ? 'carrywalk' : x.moving) : (a.pose || 'idle');
    pose(c, p, t);
    let fe = a.face || 'neutral';
    if (a.faceAfter && t - t0 > a.faceAfter[0]) fe = a.faceAfter[1];
    c.faceM.map = faceTex(c.o.skin, fe, c.o.glasses && !['laugh', 'joy', 'shock', 'cry'].includes(fe));
    c.bags.forEach(b => b.visible = p === 'carry' || p === 'carrywalk');
    const txt = labelText(x.label);
    c.label.visible = !!txt && !x.hidden && E.labels !== false;
    if (txt) {
      c.label.material.map = labelTex(txt, !!x.label.heart, x.label.color || '#ffffff');
      const camD = camera.position.distanceTo(v3(x.pos.x, 6, x.pos.z));
      const short = txt.length <= 3;
      const sc = x.labelPop / (c.o.small ? 0.72 : 1) * (short ? 1.6 * clamp(camD / 14, 0.6, 1) : clamp(camD / 14, 0.42, 1)); // long labels shrink in close-ups; short ones (scores) stay big
      c.label.position.set(0, 7.1, 0); c.label.scale.set(3.6 * sc, 0.9 * sc, 1);
    }
  }
  for (const { p, m } of PROPS) {
    const vis = s >= (p.from ?? 0) && s <= (p.to ?? 999) && shotLoc(s) === (p.location || shotLoc(s));
    m.visible = vis;
    if (!vis) continue;
    const holder = p.holder && (p.holderFrom ?? 0) <= s ? CAST[p.holder] : null;
    if (holder) {
      holder.arms[1].updateWorldMatrix(true, false);
      m.position.copy(v3(0, -2.4, 0.5).applyMatrix4(holder.arms[1].matrixWorld));
      m.rotation.copy(holder.root.rotation);
    } else { m.position.set(...p.pos); m.rotation.set(0, p.ry || 0, 0); }
  }

  // overlays
  const ch = chunks.find(c => t >= c.s && t < c.e);
  if (ch && s < LINES.length) {
    const ck = (t - ch.s) / 0.12;
    const sc = ck < 1 ? lerp(0.6, 1.08, ck) : 1.08 - 0.08 * clamp(ck - 1);
    cap.innerHTML = ch.words.map(w => isHL(w) ? `<span class="hl">${w}</span>` : w).join(' ');
    cap.style.transform = `scale(${sc})`;
  } else cap.innerHTML = '';
  const last = LINES[LINES.length - 1];
  if (E.outro && t > last.end + 0.2) { cap.innerHTML = `<span class="hl">${E.outro}</span>`; cap.style.transform = `scale(${1 + 0.06 * Math.sin(t * 6)})`; }
  hook.innerHTML = s === 0 && E.hook ? `<span class="bg">${E.hook}</span>` : '';
  hook.style.transform = `scale(${1 + 0.04 * Math.sin(t * 5)})`;
  flash.style.opacity = shot.flash ? Math.max(0, 0.85 - (t - t0) * 3) : 0;
  renderer.render(scene, camera);
};
window.DURATION = TL.duration;
window.READY = true;
