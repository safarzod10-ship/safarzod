/**
 * Procedural low-poly 3D models of every TERRIA building, level by level.
 * Runs in the browser (headless Chromium) with three.js; see render.mjs.
 *
 * Units are metres. The lot is centred on the origin, x = east, z = south,
 * y = up. A lot of N cells is N * 16 m on a side.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ helpers

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true, ...opts });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Box standing on y0 with its footprint centred on (x, z). */
function box(g, w, h, d, color, x = 0, z = 0, y0 = 0, opts) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' || typeof color === 'number' ? mat(color, opts) : color, x, y0 + h / 2, z);
  g.add(m);
  return m;
}

function cyl(g, r, h, color, x = 0, z = 0, y0 = 0, seg = 12, rTop = r) {
  const m = mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat(color), x, y0 + h / 2, z);
  g.add(m);
  return m;
}

function sphere(g, r, color, x, y, z, seg = 7) {
  const m = mesh(new THREE.IcosahedronGeometry(r, 1), mat(color), x, y, z);
  g.add(m);
  return m;
}

function cone(g, r, h, color, x = 0, z = 0, y0 = 0, seg = 7) {
  const m = mesh(new THREE.ConeGeometry(r, h, seg), mat(color), x, y0 + h / 2, z);
  g.add(m);
  return m;
}

/** Flat plate (yard, field, paving) slightly above the ground. */
function plate(g, w, d, color, x = 0, z = 0, h = 0.25, opts) {
  const m = box(g, w, h, d, color, x, z, 0, opts);
  m.castShadow = false;
  return m;
}

/** Gable roof: ridge along x (or z when alongZ). */
function gable(g, w, d, h, color, x, z, y0, alongZ = false, overhang = 0.6) {
  const W = (alongZ ? d : w) + overhang * 2;
  const D = (alongZ ? w : d) + overhang * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-D / 2, 0);
  shape.lineTo(D / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(-D / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  geo.translate(0, 0, -W / 2);
  const m = mesh(geo, mat(color), x, y0, z);
  m.rotation.y = alongZ ? 0 : Math.PI / 2;
  g.add(m);
  return m;
}

/** Hip-ish pyramid roof. */
function pyramid(g, w, d, h, color, x, z, y0) {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  const m = mesh(geo, mat(color), x, y0 + h / 2, z);
  m.scale.set(w + 1, h, d + 1);
  g.add(m);
  return m;
}

/** Rows of windows on the south (+z) and east (+x) faces of a box. */
function windows(g, w, h, d, x, z, y0, floors, opts = {}) {
  const color = opts.color ?? '#2c3e50';
  const frame = opts.frame ?? null;
  const fh = h / floors;
  const ww = opts.ww ?? 1.6;
  const gap = opts.gap ?? 3.4;
  const glass = mat(color, { roughness: 0.25, metalness: 0.2 });
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh + fh * 0.55;
    const nS = Math.max(1, Math.floor((w - 1) / gap));
    for (let i = 0; i < nS; i++) {
      const wx = x - w / 2 + (w / nS) * (i + 0.5);
      g.add(mesh(new THREE.BoxGeometry(ww, fh * 0.45, 0.25), glass, wx, y, z + d / 2 + 0.05, false));
      if (frame) g.add(mesh(new THREE.BoxGeometry(ww + 0.5, 0.25, 0.4), mat(frame), wx, y - fh * 0.25, z + d / 2 + 0.1, false));
    }
    const nE = Math.max(1, Math.floor((d - 1) / gap));
    for (let i = 0; i < nE; i++) {
      const wz = z - d / 2 + (d / nE) * (i + 0.5);
      g.add(mesh(new THREE.BoxGeometry(0.25, fh * 0.45, ww), glass, x + w / 2 + 0.05, y, wz, false));
    }
  }
}

function door(g, x, z, y0 = 0, color = '#5b3a24') {
  g.add(mesh(new THREE.BoxGeometry(1.6, 2.4, 0.3), mat(color), x, y0 + 1.2, z, false));
}

export function tree(g, x, z, s = 1, kind = 0, r = Math.random) {
  const trunk = '#6b4a2f';
  const greens = ['#3f7d3a', '#4d8f3c', '#2f6b3a', '#5d9b45'];
  const c = greens[Math.floor(r() * greens.length)];
  if (kind === 1) {
    // conifer
    cyl(g, 0.4 * s, 2 * s, trunk, x, z, 0, 6);
    cone(g, 3.2 * s, 5 * s, '#2e5e36', x, z, 1.5 * s);
    cone(g, 2.4 * s, 4.2 * s, '#356b3c', x, z, 4 * s);
    cone(g, 1.5 * s, 3.2 * s, '#3c7743', x, z, 6.4 * s);
  } else if (kind === 2) {
    // poplar
    cyl(g, 0.35 * s, 2.5 * s, trunk, x, z, 0, 6);
    const m = sphere(g, 2.2 * s, c, x, 6.5 * s, z);
    m.scale.set(1, 2.3, 1);
  } else {
    cyl(g, 0.45 * s, 3 * s, trunk, x, z, 0, 6);
    sphere(g, 3.2 * s, c, x, 5.2 * s, z);
    sphere(g, 2.4 * s, c, x + 1.6 * s, 4.6 * s, z + 0.8 * s);
    sphere(g, 2.2 * s, c, x - 1.5 * s, 4.8 * s, z - 0.6 * s);
  }
}

function fence(g, x0, z0, x1, z1, color = '#d8cbb0') {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const m = mesh(new THREE.BoxGeometry(len, 1, 0.25), mat(color), (x0 + x1) / 2, 0.5, (z0 + z1) / 2);
  m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  g.add(m);
}

function car(g, x, z, r, alongZ = false) {
  const colors = ['#c0392b', '#2471a3', '#e5e7e9', '#1c2833', '#d4ac0d', '#239b56'];
  const c = colors[Math.floor(r() * colors.length)];
  const w = alongZ ? 2 : 4.4;
  const d = alongZ ? 4.4 : 2;
  box(g, w, 1, d, c, x, z, 0.3);
  box(g, alongZ ? 1.8 : 2.4, 0.8, alongZ ? 2.4 : 1.8, '#d6eaf8', x, z, 1.3, { roughness: 0.3 });
}

function stripes(colors, n = 16, size = 128, vertical = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    if (vertical) ctx.fillRect((i * size) / n, 0, size / n + 1, size);
    else ctx.fillRect(0, (i * size) / n, size, size / n + 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function field(g, w, d, kind, x, z) {
  const sets = {
    wheat: ['#d9b44a', '#c9a23c'],
    green: ['#7fae4c', '#6c9a3f'],
    plowed: ['#8a6342', '#77553a'],
    flowers: ['#d9a3c4', '#7fae4c'],
    cabbage: ['#9ccc65', '#5d8a3a'],
  };
  const m = new THREE.MeshStandardMaterial({ map: stripes(sets[kind], 18, 128, true), roughness: 0.95 });
  const p = mesh(new THREE.BoxGeometry(w, 0.35, d), m, x, 0.18, z, false);
  g.add(p);
  return p;
}

/** Stack of logs along x. */
function logs(g, x, z, n, len = 7) {
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 4);
    const m = mesh(new THREE.CylinderGeometry(0.55, 0.55, len, 8), mat(i % 2 ? '#8b5e3c' : '#7a5234'), x, 0.6 + row * 1, z - 1.6 + (i % 4) * 1.1 + row * 0.5);
    m.rotation.z = Math.PI / 2;
    g.add(m);
  }
}

function crates(g, x, z, n, r) {
  for (let i = 0; i < n; i++) box(g, 2, 2, 2, r() < 0.5 ? '#b5835a' : '#a0714c', x + (i % 3) * 2.2, z + Math.floor(i / 3) * 2.2, (i % 2) * 0);
}

function container(g, x, z, color, alongZ = false, y0 = 0) {
  return box(g, alongZ ? 2.5 : 12, 2.6, alongZ ? 12 : 2.5, color, x, z, y0);
}

function flag(g, x, z, h = 12, color = '#c0392b') {
  cyl(g, 0.15, h, '#cfd8dc', x, z, 0, 5);
  box(g, 3.2, 2, 0.1, color, x + 1.7, z, h - 2.3);
}

function chimney(g, x, z, h, r = 1.2, color = '#8e4a3a') {
  cyl(g, r, h, color, x, z, 0, 10, r * 0.8);
  cyl(g, r * 0.85, 0.8, '#3b3b3b', x, z, h, 10);
}

// ------------------------------------------------------------------ buildings

const WALLS = ['#efe3cf', '#f3ead9', '#e8d6bb', '#f5efe6', '#e6dccb'];
const ROOFS = ['#b04a35', '#9c3f2e', '#7f4a35', '#5f6b75', '#a65a3a'];
const BRICK = ['#a65640', '#9a4f3b', '#b56a4d', '#8d4a39'];

function cottage(g, x, z, r, w = 12, d = 10, h = 5) {
  const wall = WALLS[Math.floor(r() * WALLS.length)];
  const roof = ROOFS[Math.floor(r() * ROOFS.length)];
  box(g, w, h, d, wall, x, z);
  gable(g, w, d, Math.min(w, d) * 0.42, roof, x, z, h, r() < 0.5);
  windows(g, w, h, d, x, z, 0, 1, { gap: 3.6, frame: '#ffffff' });
  door(g, x + w / 4, z + d / 2 + 0.1);
  if (r() < 0.7) box(g, 0.9, 2.2, 0.9, '#7b4b3a', x - w / 4, z - d / 6, h + 1.2);
}

function apartment(g, x, z, w, d, floors, r, wall, roofDetails = true) {
  const fh = 3.2;
  const h = floors * fh;
  box(g, w, h, d, wall, x, z);
  box(g, w + 0.6, 0.7, d + 0.6, '#5f6468', x, z, h);
  windows(g, w, h, d, x, z, 0, floors, { gap: 3.2, frame: '#f2f2f2' });
  door(g, x, z + d / 2 + 0.1);
  if (roofDetails) {
    for (let i = 0; i < 3; i++) box(g, 2, 1.2, 2, '#9ea7ad', x - w / 3 + i * (w / 3), z - d / 4 + r() * 2, h + 0.7);
  }
  return h;
}

function house(level, r) {
  const g = new THREE.Group();
  const S = 64;
  plate(g, S - 2, S - 2, level >= 4 ? '#b7b9b4' : '#8fb874');
  if (level === 1) {
    plate(g, 4, S - 4, '#cdbf9f', 0, 0, 0.32);
    cottage(g, -15, -14, r);
    cottage(g, 15, -15, r, 13, 10);
    cottage(g, -15, 14, r, 11, 9);
    box(g, 4, 2.4, 5, '#a0714c', -24, -2);
    for (let i = 0; i < 4; i++) field(g, 7, 6, i % 2 ? 'cabbage' : 'green', 12 + (i % 2) * 9, 12 + Math.floor(i / 2) * 9);
    fence(g, -30, 30, 30, 30);
    fence(g, -30, -30, -30, 30);
    tree(g, -24, -22, 0.8, 0, r);
    tree(g, 24, 2, 0.8, 0, r);
    tree(g, -22, 4, 0.7, 2, r);
  } else if (level === 2) {
    plate(g, 5, S - 4, '#cdbf9f', 0, 0, 0.32);
    for (const [x, z] of [[-14, -14], [15, -14], [-14, 14], [15, 14]]) {
      cottage(g, x, z, r, 14, 11, 7.5);
      box(g, 5, 3, 6, '#d0c7b8', x + (x < 0 ? 9 : -9), z - 2);
    }
    tree(g, -27, 0, 0.8, 0, r);
    tree(g, 27, 0, 0.8, 2, r);
    car(g, 6, 2, r, true);
  } else if (level === 3) {
    for (const z of [-15, 15]) {
      const wall = WALLS[Math.floor(r() * WALLS.length)];
      box(g, 48, 9, 11, wall, 0, z);
      for (let i = 0; i < 5; i++) gable(g, 9.6, 11, 3.6, ROOFS[i % 3], -19.2 + i * 9.6, z, 9, true, 0.3);
      windows(g, 48, 9, 11, 0, z, 0, 2, { gap: 3.2, frame: '#ffffff' });
    }
    plate(g, S - 6, 10, '#8fb874', 0, 0, 0.32);
    for (let i = 0; i < 4; i++) tree(g, -20 + i * 13, 0, 0.75, i % 3, r);
  } else if (level === 4) {
    plate(g, 22, 22, '#8fb874', 0, 0, 0.32);
    apartment(g, -16, -17, 26, 12, 4, r, BRICK[0]);
    apartment(g, 16, -17, 26, 12, 4, r, BRICK[2]);
    apartment(g, -17, 16, 12, 26, 4, r, BRICK[1]);
    box(g, 6, 0.3, 4, '#e2c26b', 6, 6);
    box(g, 1.2, 2.5, 1.2, '#d35400', 9, 4);
    tree(g, 4, -2, 0.7, 0, r);
    tree(g, 10, 8, 0.6, 0, r);
    for (let i = 0; i < 3; i++) car(g, 20, 6 + i * 6, r);
  } else {
    plate(g, 26, 26, '#8fb874', 2, 2, 0.32);
    apartment(g, -18, -12, 14, 34, 8, r, '#e9e4da');
    apartment(g, 10, -21, 34, 12, 7, r, '#dfe7ec');
    apartment(g, 20, 14, 14, 26, 6, r, '#efe1c9');
    // balconies
    for (let f = 1; f < 8; f++) box(g, 0.8, 0.3, 30, '#b0b7bd', -10.5, -12, f * 3.2);
    for (let i = 0; i < 4; i++) tree(g, -6 + (i % 2) * 10, 6 + Math.floor(i / 2) * 9, 0.7, i % 3, r);
    for (let i = 0; i < 4; i++) car(g, -22 + i * 5, 26, r, true);
  }
  return g;
}

function farm(level, r) {
  const g = new THREE.Group();
  const S = 96;
  plate(g, S - 2, S - 2, '#a3c27a', 0, 0, 0.15);
  const kinds = ['wheat', 'green', 'plowed', 'wheat', 'flowers', 'green', 'cabbage', 'wheat'];
  const nFields = [3, 4, 5, 6, 7][level - 1];
  const slots = [[-26, -26], [10, -30], [-26, 6], [28, 4], [-26, 34], [6, 34], [34, 34]];
  for (let i = 0; i < nFields; i++) field(g, 28, 24, kinds[i], slots[i][0], slots[i][1]);
  // farmyard
  plate(g, 34, 26, '#bfa77d', 26, -30, 0.3);
  // barn
  box(g, 16, 7, 10, '#a63b2c', 24, -34);
  gable(g, 16, 10, 5, '#5b5f63', 24, -34, 7);
  box(g, 4, 5, 0.3, '#ffffff', 24, -28.8);
  if (level >= 2) cyl(g, 3, 14, '#c9ced3', 38, -36, 0, 14), cone(g, 3.2, 3, '#8d9399', 38, -36, 14, 14);
  if (level >= 3) {
    box(g, 12, 3.5, 8, '#dfeff2', 14, -20, 0, { roughness: 0.2, transparent: true, opacity: 0.85 });
    gable(g, 12, 8, 2, '#cfe6ea', 14, -20, 3.5);
  }
  if (level >= 4) {
    cyl(g, 3, 14, '#c9ced3', 38, -26, 0, 14), cone(g, 3.2, 3, '#8d9399', 38, -26, 14, 14);
    box(g, 4, 2.2, 2.4, '#2e8b57', 18, -42), cyl(g, 1, 1, '#222', 17, -40.6, 0, 10);
  }
  if (level >= 5) {
    box(g, 8, 22, 8, '#d7d2c8', 4, -36);
    box(g, 9, 3, 9, '#9aa3a8', 4, -36, 22);
    box(g, 14, 4, 6, '#a63b2c', 4, -26);
  }
  tree(g, 44, -44, 0.8, 0, r);
  tree(g, 44, 14, 0.8, 2, r);
  return g;
}

function sawmill(level, r) {
  const g = new THREE.Group();
  const S = 64;
  plate(g, S - 2, S - 2, '#b49a73', 0, 0, 0.3);
  // open shed
  const shedW = [16, 20, 24, 26, 30][level - 1];
  box(g, shedW, 5, 12, '#8a5a3b', -8, -14);
  gable(g, shedW, 12, 3, '#6e4a33', -8, -14, 5);
  windows(g, shedW, 5, 12, -8, -14, 0, 1, { color: '#3a2a1f', gap: 5 });
  logs(g, 14, -18, 4 + level * 2);
  logs(g, 14, -6, 4 + level);
  for (let i = 0; i < 2 + level; i++) box(g, 8, 1 + (i % 3) * 0.6, 3, '#d8b27a', -22 + (i % 4) * 9, 14 + Math.floor(i / 4) * 5);
  box(g, 5, 2.2, 2.4, '#2e86c1', 2, 24, 0.4);
  box(g, 1.2, 3, 0.4, '#555', 4.5, 24, 1.2);
  tree(g, -26, 26, 0.7, 1, r);
  if (level >= 3) {
    box(g, 2, 2, 24, '#555', 8, 6, 2);
    box(g, 10, 7, 8, '#7b5a40', 18, 12);
    gable(g, 10, 8, 2.5, '#5c4636', 18, 12, 7);
  }
  if (level >= 4) {
    for (let i = 0; i < 2; i++) cyl(g, 3, 6, '#6d6d6d', -20 + i * 8, 22, 0, 12);
    chimney(g, -10, 24, 12, 0.9);
  }
  if (level >= 5) {
    box(g, 1, 16, 1, '#e0b000', 24, -26);
    box(g, 18, 1, 1, '#e0b000', 17, -26, 16);
    logs(g, -16, 2, 8);
  }
  tree(g, -26, -28, 0.8, 1, r);
  tree(g, 26, 26, 0.8, 1, r);
  return g;
}

/** Lot plate with a round hole (for pits). */
function plateWithHole(g, S, color, hx, hz, R) {
  const shape = new THREE.Shape();
  shape.moveTo(-S / 2, -S / 2);
  shape.lineTo(S / 2, -S / 2);
  shape.lineTo(S / 2, S / 2);
  shape.lineTo(-S / 2, S / 2);
  shape.lineTo(-S / 2, -S / 2);
  const hole = new THREE.Path();
  hole.absellipse(hx, hz, R, R * 0.8, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false, curveSegments: 24 });
  geo.rotateX(Math.PI / 2);
  const m = mesh(geo, mat(color), 0, 0.25, 0, false);
  g.add(m);
}

function quarry(level, r) {
  const g = new THREE.Group();
  const S = 64;
  const R = [15, 17, 19, 21, 23][level - 1];
  const steps = 2 + level;
  const cx = -5;
  const cz = -3;
  plateWithHole(g, S - 2, '#bdb3a2', cx, cz, R);
  // terraced pit: rings going down, inner walls seen from the camera
  const stepH = 2.2;
  for (let i = 0; i < steps; i++) {
    const r0 = R - (i * R) / (steps + 0.6);
    const r1 = R - ((i + 1) * R) / (steps + 0.6);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, stepH, 28, 1, true), mat(i % 2 ? '#9b8f7e' : '#a89c89', { side: THREE.DoubleSide }));
    wall.position.set(cx, -i * stepH - stepH / 2, cz);
    wall.scale.set(1, 1, 0.8);
    wall.receiveShadow = true;
    g.add(wall);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r1, r0, 28), mat(i % 2 ? '#c4b8a3' : '#b9ad98', { side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, -(i + 1) * stepH, cz);
    ring.scale.set(1, 0.8, 1);
    ring.receiveShadow = true;
    g.add(ring);
  }
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(R / (steps + 0.6), 20), mat('#7d9aa3'));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(cx, -steps * stepH - 0.05, cz);
  bottom.scale.set(1, 0.8, 1);
  g.add(bottom);
  // stone blocks
  for (let i = 0; i < 3 + level * 2; i++) box(g, 2.6, 2.4, 2.6, i % 2 ? '#d1cbbf' : '#c2bcae', 18 + (i % 3) * 3.2, 16 + Math.floor(i / 3) * 3.2, Math.floor(i / 9) * 2.4);
  // excavator on a terrace
  box(g, 5, 2, 3, '#e0a800', cx + 4, cz - R * 0.45, -stepH + 0.2);
  box(g, 2.5, 2, 2.5, '#e0a800', cx + 3, cz - R * 0.45, -stepH + 2.2);
  const arm = box(g, 7, 0.7, 0.7, '#e0a800', cx - 1, cz - R * 0.45, -stepH + 3.6);
  arm.rotation.z = -0.4;
  // dump truck
  box(g, 6, 2.4, 3, '#c0392b', 22, -22, 0.6);
  box(g, 2.4, 2.6, 3, '#f0b27a', 25.5, -22, 0.6);
  if (level >= 3) {
    const c = box(g, 20, 0.8, 1.6, '#555', 15, 4, 3);
    c.rotation.z = 0.25;
    box(g, 7, 6, 6, '#7c8a91', 25, 6);
    cone(g, 3.5, 4, '#b3aa9a', 25, 14, 0, 8);
  }
  if (level >= 4) {
    box(g, 1, 20, 1, '#d35400', -25, 24);
    box(g, 16, 1, 1, '#d35400', -18, 24, 20);
  }
  if (level >= 5) box(g, 12, 4, 8, '#95a5a6', -20, -26), gable(g, 12, 8, 2, '#6c7a7b', -20, -26, 4);
  return g;
}

function mine(level, r) {
  const g = new THREE.Group();
  plate(g, 62, 62, '#9c968c', 0, 0, 0.25);
  // headframe tower
  const H = [16, 20, 24, 26, 30][level - 1];
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const leg = box(g, 0.8, H, 0.8, '#5d6d7e', -12 + dx * 0.7, -10 + dz * 0.7);
    leg.rotation.z = dx * 0.02;
  }
  for (let y = 4; y < H; y += 4) box(g, 5, 0.5, 5, '#5d6d7e', -12, -10, y);
  cyl(g, 2.2, 0.8, '#34495e', -12, -10, H, 14);
  // winding house
  box(g, 14, 8, 10, '#7f8c8d', 6, -14);
  gable(g, 14, 10, 3, '#4d5656', 6, -14, 8);
  windows(g, 14, 8, 10, 6, -14, 0, 2, { gap: 3.4 });
  // spoil heap
  cone(g, 10 + level, 8 + level, '#4a4743', 18, 14, 0, 9);
  // rails and carts
  box(g, 30, 0.3, 2.4, '#6e5b4b', -4, 10);
  for (let i = 0; i < 1 + level; i++) box(g, 2.6, 1.6, 2, '#a04000', -16 + i * 5, 10, 0.5);
  if (level >= 3) chimney(g, 14, -24, 16, 1.1, '#7b7d7d');
  if (level >= 4) box(g, 12, 6, 8, '#95a5a6', -18, 22), gable(g, 12, 8, 2, '#6c7a7b', -18, 22, 6);
  if (level >= 5) for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(g, 0.7, 20, 0.7, '#5d6d7e', 22 + dx, -22 + dz);
  return g;
}

function awning(g, w, x, z, y, colors) {
  const m = new THREE.MeshStandardMaterial({ map: stripes(colors, 8, 64, true), roughness: 0.8 });
  const p = mesh(new THREE.BoxGeometry(w, 0.25, 3), m, x, y, z);
  p.rotation.x = 0.35;
  g.add(p);
}

function shop(level, r) {
  const g = new THREE.Group();
  const S = 48;
  plate(g, S - 2, S - 2, '#d9cdb8', 0, 0, 0.3);
  const palettes = [['#c0392b', '#ffffff'], ['#2471a3', '#ffffff'], ['#d4ac0d', '#ffffff'], ['#239b56', '#ffffff']];
  if (level <= 2) {
    const n = level === 1 ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const x = -15 + (i % 3) * 15;
      const z = -10 + Math.floor(i / 3) * 18;
      box(g, 6, 1.2, 3, '#a0714c', x, z);
      for (const dx of [-2.8, 2.8]) box(g, 0.25, 3, 0.25, '#7b5a40', x + dx, z + 1.3);
      awning(g, 7, x, z + 0.5, 3.3, palettes[i % 4]);
      crates(g, x - 2, z - 3, 2, r);
    }
    if (level === 2) {
      box(g, 14, 5, 9, '#f0e6d2', 0, -16);
      gable(g, 14, 9, 3, '#9c3f2e', 0, -16, 5);
      windows(g, 14, 5, 9, 0, -16, 0, 1, { frame: '#ffffff' });
    }
  } else {
    const floors = level - 1;
    box(g, 32, floors * 4, 18, level >= 5 ? '#dfe6e9' : '#f0e6d2', 0, -10);
    box(g, 32, 1, 18, '#7f8c8d', 0, -10, floors * 4);
    windows(g, 32, floors * 4, 18, 0, -10, 0, floors, { color: '#5dade2', gap: 4, ww: 3 });
    awning(g, 30, 0, 0, 3.6, palettes[level % 4]);
    box(g, 12, 2.4, 0.4, '#c0392b', 0, -0.8, floors * 4 - 2.8);
    if (level >= 4) box(g, 16, 0.4, 14, '#a9d5e8', 0, -10, floors * 4 + 1, { roughness: 0.2 });
    for (let i = 0; i < 4; i++) car(g, -15 + i * 6, 14, r, true);
    tree(g, 18, 14, 0.6, 0, r);
  }
  return g;
}

function warehouse(level, r) {
  const g = new THREE.Group();
  plate(g, 62, 62, '#a9a9a4', 0, 0, 0.25);
  if (level === 1) {
    box(g, 20, 6, 12, '#8a5a3b', -6, -10);
    gable(g, 20, 12, 3.5, '#6e4a33', -6, -10, 6);
    crates(g, 8, 6, 6, r);
  } else {
    const n = level >= 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const z = n === 2 ? -16 + i * 22 : -8;
      box(g, 40, 3, 16, '#b8c2c8', -4, z);
      const roof = mesh(new THREE.CylinderGeometry(8, 8, 40, 16, 1, false, 0, Math.PI), mat('#9aa7ae'), -4, 3, z);
      roof.rotation.z = Math.PI / 2;
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      g.add(roof);
      for (let k = 0; k < 4; k++) box(g, 4, 2.6, 0.3, '#5d6d7e', -18 + k * 9, z + 8.1);
    }
    const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#239b56'];
    for (let i = 0; i < level; i++) container(g, 22, -22 + i * 3, cols[i % 4]);
    if (level >= 4) for (let i = 0; i < 2; i++) box(g, 3, 3, 9, '#ecf0f1', 24 + i * 4, 18), box(g, 3, 2.4, 3, '#c0392b', 24 + i * 4, 24);
    if (level >= 5) {
      container(g, 22, -6, '#7d3c98');
      container(g, 22, -6, '#1abc9c', false, 2.6);
    }
  }
  return g;
}

function hospital(level, r) {
  const g = new THREE.Group();
  plate(g, 62, 62, '#c9d3cf', 0, 0, 0.25);
  const floors = 1 + level;
  const h = floors * 3.4;
  box(g, 34, h, 14, '#f4f6f6', -4, -10);
  windows(g, 34, h, 14, -4, -10, 0, floors, { color: '#5dade2', gap: 3.2 });
  box(g, 35, 0.8, 15, '#d5dbdb', -4, -10, h);
  // red cross on the roof and on the facade
  box(g, 8, 0.3, 2.4, '#c0392b', -4, -10, h + 0.8);
  box(g, 2.4, 0.3, 8, '#c0392b', -4, -10, h + 0.8);
  box(g, 3, 1, 0.3, '#c0392b', -4, -2.8, h - 2);
  box(g, 1, 3, 0.3, '#c0392b', -4, -2.8, h - 3);
  if (level >= 2) box(g, 12, h * 0.7, 20, '#eef2f2', 20, 0), windows(g, 12, h * 0.7, 20, 20, 0, 0, Math.max(1, floors - 1), { color: '#5dade2' });
  if (level >= 4) {
    cyl(g, 7, 0.4, '#7f8c8d', -16, 18, 0, 24);
    box(g, 6, 0.1, 1, '#ffffff', -16, 18, 0.45);
    box(g, 1, 0.1, 6, '#ffffff', -18.5, 18, 0.45);
    box(g, 1, 0.1, 6, '#ffffff', -13.5, 18, 0.45);
  }
  box(g, 5, 2.4, 2.4, '#ffffff', 6, 6, 0.3);
  box(g, 1.4, 0.4, 0.4, '#c0392b', 6, 6, 2.7);
  tree(g, 22, 24, 0.7, 0, r);
  tree(g, 4, 24, 0.7, 2, r);
  return g;
}

function factory(level, r) {
  const g = new THREE.Group();
  plate(g, 94, 94, '#a6a39b', 0, 0, 0.25);
  const halls = Math.min(3, 1 + Math.floor(level / 2));
  for (let i = 0; i < halls; i++) {
    const z = -28 + i * 24;
    box(g, 50, 9, 18, BRICK[i % BRICK.length], -12, z);
    for (let k = 0; k < 5; k++) {
      const m = mesh(new THREE.BoxGeometry(10, 3, 0.4), mat('#a9cce3', { roughness: 0.3 }), -32 + k * 10, 10.4, z + 1.5);
      m.rotation.x = -0.9;
      g.add(m);
      const s = mesh(new THREE.BoxGeometry(10, 4.2, 0.4), mat('#7f8c8d'), -32 + k * 10, 10.6, z - 1.8);
      s.rotation.x = 0.5;
      g.add(s);
    }
    windows(g, 50, 9, 18, -12, z, 0, 2, { color: '#34495e', gap: 4, ww: 2.2 });
  }
  const chimneys = 1 + Math.floor(level / 2);
  for (let i = 0; i < chimneys; i++) chimney(g, 26 + (i % 2) * 8, -30 + i * 10, 24 + level * 2, 1.6);
  for (let i = 0; i < Math.min(level, 4); i++) cyl(g, 4, 8, '#bdc3c7', 26 + Math.floor(i / 2) * 10, 16 + (i % 2) * 10, 0, 16);
  if (level >= 3) box(g, 30, 1.2, 1.2, '#7f8c8d', 12, 26, 6);
  for (let i = 0; i < Math.min(level, 3); i++) container(g, -30 + i * 14, 40, ['#c0392b', '#2471a3', '#d4ac0d'][i]);
  return g;
}

function townhall(level, r) {
  const g = new THREE.Group();
  plate(g, 62, 62, '#d6cdb9', 0, 0, 0.3);
  if (level === 1) {
    box(g, 22, 6, 14, '#9b6b45', 0, -6);
    gable(g, 22, 14, 5, '#6b3e2a', 0, -6, 6);
    windows(g, 22, 6, 14, 0, -6, 0, 1, { color: '#3a2a1f', frame: '#e8d6bb' });
    door(g, 0, 1.2);
    flag(g, 14, 10, 11);
    tree(g, -20, 18, 0.8, 0, r);
  } else {
    const W = [0, 26, 30, 36, 44, 50][level - 1];
    const floors = level >= 4 ? 3 : 2;
    const h = floors * 4.2;
    const stone = level >= 5 ? '#efe9dd' : '#e2d8c6';
    box(g, W, h, 18, stone, 0, -8);
    box(g, W + 1, 1, 19, level >= 4 ? '#6f7a80' : '#c7bba5', 0, -8, h);
    windows(g, W, h, 18, 0, -8, 0, floors, { color: '#2c3e50', frame: '#ffffff', gap: 3.6 });
    // portico with columns
    if (level >= 3) {
      box(g, 14, 0.8, 5, '#d8cfbf', 0, 3, 0);
      for (let i = 0; i < 6; i++) cyl(g, 0.6, h - 1, '#f4f1ea', -6 + i * 2.4, 4.5, 0.8, 10);
      const ped = gable(g, 14, 5, 3, '#e8e1d3', 0, 3.5, h, false, 0.2);
      ped.scale.y = 1;
    } else {
      door(g, 0, 1.2);
    }
    if (level === 2 || level === 3) pyramid(g, W, 18, 4, '#7f3b2e', 0, -8, h + 1);
    // clock tower / dome
    if (level >= 3 && level <= 4) {
      box(g, 6, 10, 6, stone, 0, -10, h);
      cyl(g, 1.6, 0.3, '#ffffff', 0, -6.8, h + 6).rotation.x = Math.PI / 2;
      pyramid(g, 6, 6, 5, '#2c3e50', 0, -10, h + 10);
    }
    if (level >= 5) {
      cyl(g, 7, 4, stone, 0, -8, h + 1, 20);
      const dome = mesh(new THREE.SphereGeometry(7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(level === 6 ? '#d4ac0d' : '#4a7a8c', { metalness: level === 6 ? 0.6 : 0.1, roughness: 0.4 }), 0, h + 5, -8);
      dome.castShadow = true;
      g.add(dome);
      cyl(g, 0.3, 4, '#d4ac0d', 0, -8, h + 12, 6);
      // wings
      box(g, 12, h - 3, 14, stone, -W / 2 - 4, -4);
      box(g, 12, h - 3, 14, stone, W / 2 + 4, -4);
      windows(g, 12, h - 3, 14, W / 2 + 4, -4, 0, floors - 1, { frame: '#ffffff' });
    }
    if (level === 6) {
      cyl(g, 5, 0.8, '#bfc9ca', 0, 20, 0, 20);
      cyl(g, 4.2, 0.5, '#5dade2', 0, 20, 0.6, 20);
      cyl(g, 0.6, 3, '#d5f5ff', 0, 20, 0.6, 8);
    }
    flag(g, -W / 2 + 2, 12, 14);
    flag(g, W / 2 - 2, 12, 14, '#2471a3');
    tree(g, -24, 22, 0.8, 0, r);
    tree(g, 24, 22, 0.8, 0, r);
  }
  return g;
}

function park(r) {
  const g = new THREE.Group();
  plate(g, 31, 31, '#7fb35f', 0, 0, 0.25);
  plate(g, 3, 31, '#d9cbaa', 0, 0, 0.32);
  plate(g, 31, 3, '#d9cbaa', 0, 0, 0.32);
  tree(g, -8, -8, 0.7, 0, r);
  tree(g, 8, -9, 0.6, 2, r);
  tree(g, -9, 8, 0.6, 1, r);
  tree(g, 9, 9, 0.7, 0, r);
  for (const [x, z] of [[-3, 5], [4, -4]]) box(g, 2.4, 0.6, 0.8, '#8b5e3c', x, z, 0.4);
  for (const [x, z, c] of [[-10, 2, '#e74c3c'], [10, -2, '#f1c40f']]) plate(g, 3, 3, c, x, z, 0.6);
  return g;
}

function fountain(r) {
  const g = new THREE.Group();
  plate(g, 31, 31, '#d8d2c4', 0, 0, 0.3);
  cyl(g, 10, 1.2, '#bfc9ca', 0, 0, 0, 28);
  cyl(g, 9.2, 1, '#4aa3d8', 0, 0, 0.5, 28);
  cyl(g, 2.2, 3, '#bfc9ca', 0, 0, 0, 14);
  cyl(g, 4, 0.6, '#bfc9ca', 0, 0, 3, 18);
  cyl(g, 0.6, 5, '#d6f2ff', 0, 0, 3.5, 8, 0.2);
  for (let i = 0; i < 4; i++) tree(g, (i % 2 ? 1 : -1) * 13, (i < 2 ? 1 : -1) * 13, 0.45, 0, r);
  return g;
}

function statue(r) {
  const g = new THREE.Group();
  plate(g, 46, 46, '#d8d2c4', 0, 0, 0.3);
  box(g, 8, 4, 8, '#bfb6a5', 0, 0);
  box(g, 6, 1, 6, '#a89f8f', 0, 0, 4);
  const bronze = '#8c6d3f';
  box(g, 1.6, 3, 1, bronze, -0.6, 0, 5, { metalness: 0.5, roughness: 0.5 });
  box(g, 1.6, 3, 1, bronze, 0.9, 0, 5, { metalness: 0.5, roughness: 0.5 });
  box(g, 3.4, 4, 1.8, bronze, 0.15, 0, 8, { metalness: 0.5, roughness: 0.5 });
  sphere(g, 1.1, bronze, 0.15, 13.2, 0);
  const arm = box(g, 0.7, 3.4, 0.7, bronze, 2.2, 0, 9.5, { metalness: 0.5 });
  arm.rotation.z = -0.9;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tree(g, Math.cos(a) * 17, Math.sin(a) * 17, 0.5, i % 2 ? 1 : 0, r);
  }
  return g;
}

/** Construction site of a given size (cells). */
function site(size, r) {
  const g = new THREE.Group();
  const S = size * 16;
  plate(g, S - 2, S - 2, '#b8956a', 0, 0, 0.3);
  const w = S * 0.6;
  box(g, w, 1, w * 0.7, '#a9a9a9', -S * 0.08, -S * 0.08);
  const h = Math.min(14, 4 + size * 2);
  // scaffolding
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 1; j++) box(g, 0.3, h, 0.3, '#d68910', -S * 0.08 - w / 2 + (w / 4) * i, -S * 0.08 + (j ? 1 : -1) * w * 0.35, 1);
  for (let y = 3; y < h; y += 3) {
    box(g, w, 0.3, 0.3, '#d68910', -S * 0.08, -S * 0.08 + w * 0.35, y);
    box(g, w, 0.3, 0.3, '#d68910', -S * 0.08, -S * 0.08 - w * 0.35, y);
  }
  // material piles
  logs(g, S * 0.3, S * 0.3, 4, 5);
  box(g, 3, 1.5, 3, '#c8c3b8', -S * 0.32, S * 0.32);
  if (size >= 4) {
    // tower crane
    box(g, 1.2, h + 12, 1.2, '#f1c40f', S * 0.32, -S * 0.3);
    box(g, S * 0.8, 1, 1, '#f1c40f', S * 0.05, -S * 0.3, h + 12);
    box(g, 4, 2, 2, '#7f8c8d', S * 0.4, -S * 0.3, h + 10.5);
  }
  return g;
}

/** Small crane shown on top of a building that is being upgraded. */
function crane() {
  const g = new THREE.Group();
  box(g, 1, 26, 1, '#f1c40f', 0, 0);
  box(g, 22, 0.9, 0.9, '#f1c40f', -8, 0, 26);
  box(g, 3, 1.6, 1.6, '#7f8c8d', 3, 0, 24.5);
  box(g, 0.15, 10, 0.15, '#333', -16, 0, 16);
  box(g, 2, 1.4, 2, '#b5835a', -16, 0, 15);
  return g;
}

// ------------------------------------------------------------------ catalogue

export const SIZES = { townhall: 4, house: 4, farm: 6, sawmill: 4, quarry: 4, mine: 4, shop: 3, warehouse: 4, hospital: 4, factory: 6, park: 2, fountain: 2, statue: 3 };

/** Every sprite to render: { key, build(r) }. */
export function catalogue() {
  const list = [];
  const add = (key, fn) => list.push({ key, build: fn });
  for (let l = 1; l <= 6; l++) add(`townhall:${l}`, (r) => townhall(l, r));
  const leveled = { house, farm, sawmill, quarry, mine, shop, warehouse, hospital, factory };
  for (const [t, fn] of Object.entries(leveled)) for (let l = 1; l <= 5; l++) add(`${t}:${l}`, (r) => fn(l, r));
  add('park:1', park);
  add('fountain:1', fountain);
  add('statue:1', statue);
  for (const s of [2, 3, 4, 6]) add(`site:${s}`, (r) => site(s, r));
  add('crane', () => crane());
  for (let v = 0; v < 4; v++)
    add(`tree:${v}`, (r) => {
      const g = new THREE.Group();
      // twice the usual size: the map scales trees down, so they stay crisp
      tree(g, 0, 0, 2, v === 2 ? 1 : v === 3 ? 2 : 0, r);
      return g;
    });
  return list;
}
