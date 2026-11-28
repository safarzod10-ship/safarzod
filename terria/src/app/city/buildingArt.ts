/**
 * Procedural top-down building art, painted once with Canvas 2D (like the
 * tree atlas): light from the top-left, soft shadows to the bottom-right, so
 * buildings sit in the same world as the trees. Every type has its own lot
 * (fields, yards, plazas) and gets denser and taller with each level.
 *
 * Coordinates inside a painter are metres from the lot's top-left corner;
 * the canvas is pre-scaled by PX_PER_M and offset by PAD.
 */
import { BUILDINGS, CELL_M, type BuildingType } from '../../game/config.ts';

export const PX_PER_M = 2.5;
/** Margin (metres) around the lot for overhangs and shadows. */
export const PAD_M = 3;
export const SHADOW_M = 12;

type Ctx = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHADOW = 'rgba(22, 44, 30, 0.30)';
const C = {
  grass: '#a9c47c',
  grassDark: '#8fb066',
  lawn: '#b9d08a',
  paving: '#ddd7c6',
  pavingDark: '#cbc3ad',
  path: '#d8ccaa',
  dirt: '#c7ae84',
  dirtDark: '#a98f66',
  asphalt: '#9a9b95',
  wall: '#efe9dc',
  roofs: ['#b5563f', '#9c4a37', '#c46b46', '#6b7d8a', '#4f6472', '#c9963f', '#3f7d86', '#8a5a44'],
  slate: '#5a6b78',
  teal: '#2f7d85',
  white: '#f1efe8',
  water: '#5aa7bf',
  leaf: ['#5f8f45', '#4f7f3c', '#6d9c4d', '#577f3e'],
};

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Shadow of a box of the given height (metres), cast to the bottom-right. */
function boxShadow(ctx: Ctx, x: number, y: number, w: number, h: number, height: number): void {
  const d = height * 0.55;
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w + d, y + d);
  ctx.lineTo(x + w + d, y + h + d);
  ctx.lineTo(x + d, y + h + d);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = SHADOW;
  ctx.fill();
}

function circleShadow(ctx: Ctx, x: number, y: number, r: number, height: number): void {
  const d = height * 0.55;
  ctx.beginPath();
  ctx.ellipse(x + d * 0.8, y + d * 0.8, r * 1.02, r * 1.02, 0, 0, Math.PI * 2);
  ctx.fillStyle = SHADOW;
  ctx.fill();
}

/** Gable roof; the ridge runs along the longer side. */
function gable(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, height: number): void {
  boxShadow(ctx, x, y, w, h, height);
  const lit = shade(color, 0.16);
  const dark = shade(color, -0.22);
  if (w >= h) {
    rect(ctx, x, y, w, h / 2, lit);
    rect(ctx, x, y + h / 2, w, h / 2, dark);
    rect(ctx, x, y + h / 2 - 0.25, w, 0.5, shade(color, 0.3));
  } else {
    rect(ctx, x, y, w / 2, h, lit);
    rect(ctx, x + w / 2, y, w / 2, h, dark);
    rect(ctx, x + w / 2 - 0.25, y, 0.5, h, shade(color, 0.3));
  }
  ctx.strokeStyle = shade(color, -0.4);
  ctx.lineWidth = 0.35;
  ctx.strokeRect(x, y, w, h);
}

/** Hip roof (four slopes). */
function hip(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, height: number): void {
  boxShadow(ctx, x, y, w, h, height);
  const inset = Math.min(w, h) / 2;
  const cx0 = x + inset;
  const cx1 = x + w - inset;
  const cy = y + h / 2;
  const tri = (pts: number[], fill: string): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (w >= h) {
    tri([x, y, x + w, y, cx1, cy, cx0, cy], shade(color, 0.2)); // north, lit
    tri([x, y + h, x + w, y + h, cx1, cy, cx0, cy], shade(color, -0.25)); // south
    tri([x, y, cx0, cy, x, y + h], shade(color, 0.05)); // west
    tri([x + w, y, cx1, cy, x + w, y + h], shade(color, -0.12)); // east
  } else {
    const cx = x + w / 2;
    const cy0 = y + inset;
    const cy1 = y + h - inset;
    tri([x, y, x + w, y, cx, cy0], shade(color, 0.2));
    tri([x, y + h, x + w, y + h, cx, cy1], shade(color, -0.25));
    tri([x, y, cx, cy0, cx, cy1, x, y + h], shade(color, 0.05));
    tri([x + w, y, cx, cy0, cx, cy1, x + w, y + h], shade(color, -0.12));
  }
  ctx.strokeStyle = shade(color, -0.4);
  ctx.lineWidth = 0.35;
  ctx.strokeRect(x, y, w, h);
}

/** Flat roof with parapet and a few rooftop boxes. */
function flat(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, height: number, r: () => number): void {
  boxShadow(ctx, x, y, w, h, height);
  rect(ctx, x, y, w, h, shade(color, -0.12));
  rect(ctx, x + 0.8, y + 0.8, w - 1.6, h - 1.6, color);
  ctx.fillStyle = shade(color, 0.25);
  ctx.fillRect(x + 0.8, y + 0.8, w - 1.6, 0.6);
  ctx.fillRect(x + 0.8, y + 0.8, 0.6, h - 1.6);
  const n = Math.max(1, Math.floor((w * h) / 120));
  for (let i = 0; i < n; i++) {
    const bw = 1.5 + r() * 2.5;
    const bh = 1.5 + r() * 2;
    const bx = x + 2 + r() * Math.max(0.1, w - 4 - bw);
    const by = y + 2 + r() * Math.max(0.1, h - 4 - bh);
    boxShadow(ctx, bx, by, bw, bh, 1.2);
    rect(ctx, bx, by, bw, bh, shade(color, 0.3));
  }
}

function tree(ctx: Ctx, x: number, y: number, rad: number, r: () => number): void {
  circleShadow(ctx, x, y, rad, rad * 1.4);
  const base = C.leaf[Math.floor(r() * C.leaf.length)];
  const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
  g.addColorStop(0, shade(base, 0.28));
  g.addColorStop(0.7, base);
  g.addColorStop(1, shade(base, -0.25));
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, a: string, b: string, step: number, vertical: boolean): void {
  rect(ctx, x, y, w, h, a);
  ctx.fillStyle = b;
  if (vertical) for (let s = x; s < x + w; s += step * 2) ctx.fillRect(s, y, Math.min(step, x + w - s), h);
  else for (let s = y; s < y + h; s += step * 2) ctx.fillRect(x, s, w, Math.min(step, y + h - s));
}

function lotBase(ctx: Ctx, size: number, fill: string, edge?: string): void {
  rrect(ctx, 0.4, 0.4, size - 0.8, size - 0.8, 1.6, fill);
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(0.4, 0.4, size - 0.8, size - 0.8, 1.6);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ painters

function paintHouse(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  if (lvl <= 3) {
    lotBase(ctx, s, C.lawn, 'rgba(90,110,60,0.35)');
    // a street through the block
    rect(ctx, 0, s / 2 - 2, s, 4, C.path);
    rect(ctx, s / 2 - 1.5, 0, 3, s, C.path);
    const per = lvl === 1 ? 1 : 2;
    const cell = s / 2;
    let k = 0;
    for (let qy = 0; qy < 2; qy++)
      for (let qx = 0; qx < 2; qx++) {
        for (let i = 0; i < per; i++) {
          if (lvl === 1 && k++ % 4 === 3) continue;
          const big = lvl === 3;
          const w = big ? 15 + r() * 4 : 9 + r() * 3;
          const h = big ? 10 + r() * 3 : 7 + r() * 2;
          const ox = qx * cell + 3 + (per === 2 ? (i ? cell - w - 6 : 0) : (cell - w - 4) * r());
          const oy = qy * cell + 3 + (per === 2 ? (i ? cell - h - 7 : 2) : 3 + r() * 6);
          const roof = C.roofs[Math.floor(r() * 6)];
          // garden with a tree and a fence line
          tree(ctx, qx * cell + 4 + r() * (cell - 8), qy * cell + cell - 6 - r() * 4, 2.2 + r() * 1.2, r);
          (r() > 0.5 ? gable : hip)(ctx, ox, oy, w, h, roof, big ? 8 : 5);
        }
      }
    return;
  }
  // levels 4-5: apartment blocks around a green courtyard
  lotBase(ctx, s, C.paving, 'rgba(120,110,90,0.35)');
  rrect(ctx, 12, 12, s - 24, s - 24, 2, C.lawn);
  for (let i = 0; i < 6; i++) tree(ctx, 16 + r() * (s - 32), 16 + r() * (s - 32), 2.5 + r() * 1.5, r);
  const hgt = lvl === 4 ? 16 : 26;
  const col = lvl === 4 ? '#c9bfa8' : '#b8b1a3';
  const d = 9;
  if (lvl === 4) {
    flat(ctx, 3, 3, s - 20, d, col, hgt, r);
    flat(ctx, s - 3 - d, 3, d, s - 22, col, hgt, r);
    flat(ctx, 3, s - 3 - d, s - 30, d, shade(col, -0.05), hgt * 0.8, r);
  } else {
    flat(ctx, 3, 3, s - 6, d, col, hgt, r);
    flat(ctx, s - 3 - d, 3 + d, d, s - 6 - 2 * d, col, hgt, r);
    flat(ctx, 3, s - 3 - d, s - 6, d, col, hgt, r);
    flat(ctx, 3, 3 + d, d, s - 6 - 2 * d, shade(col, -0.04), hgt * 0.9, r);
  }
}

function paintFarm(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, '#b7c98a');
  const crops = [
    ['#d9bf62', '#cdb054'],
    ['#9cbf5c', '#8db150'],
    ['#b48a5a', '#a37b4e'],
    ['#c9d36f', '#b9c562'],
  ];
  // fields fill more of the lot as the farm grows
  const plots = [
    [2, 2, 44, 44],
    [50, 2, 44, 28],
    [2, 50, 28, 44],
    [50, 34, 44, 26],
    [34, 64, 60, 30],
  ];
  const n = Math.min(plots.length, 1 + lvl);
  for (let i = 0; i < n; i++) {
    const [x, y, w, h] = plots[i];
    const c = crops[(i + Math.floor(r() * 4)) % crops.length];
    stripes(ctx, x, y, w, h, c[0], c[1], 1.6, i % 2 === 0);
    ctx.strokeStyle = 'rgba(90,80,40,0.35)';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(x, y, w, h);
  }
  // farmyard
  const fx = lvl >= 4 ? 4 : 30;
  const fy = lvl >= 4 ? 64 : 52;
  rrect(ctx, fx, fy, 28, 28, 1.5, C.dirt);
  gable(ctx, fx + 3, fy + 4, 15, 9, '#9c3f2f', 7);
  hip(ctx, fx + 4, fy + 17, 9, 7, C.roofs[3], 4);
  const silos = Math.min(4, lvl);
  for (let i = 0; i < silos; i++) {
    const cx = fx + 22;
    const cy = fy + 5 + i * 6;
    circleShadow(ctx, cx, cy, 2.4, 10);
    const g = ctx.createRadialGradient(cx - 0.8, cy - 0.8, 0.2, cx, cy, 2.4);
    g.addColorStop(0, '#f2f0ea');
    g.addColorStop(1, '#9fa6a8');
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  if (lvl >= 4) {
    // greenhouses
    for (let i = 0; i < lvl - 2; i++) {
      const x = 36 + i * 12;
      boxShadow(ctx, x, 4 + (lvl >= 5 ? 0 : 0), 9, 20, 3);
      stripes(ctx, x, 4, 9, 20, 'rgba(230,240,240,0.92)', 'rgba(200,220,225,0.92)', 1, true);
    }
  }
  for (let i = 0; i < 3; i++) tree(ctx, fx + 2 + r() * 24, fy + 24 + r() * 3, 2, r);
}

function paintSawmill(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, '#cdb990', 'rgba(110,90,50,0.35)');
  // log piles
  const piles = 2 + lvl;
  for (let p = 0; p < piles; p++) {
    const px = 4 + (p % 3) * 19;
    const py = s - 22 + Math.floor(p / 3) * -18;
    for (let i = 0; i < 6; i++) {
      const y = py + i * 2.2;
      boxShadow(ctx, px, y, 15, 1.9, 1.5);
      rrect(ctx, px, y, 15, 1.9, 0.9, i % 2 ? '#8a5f39' : '#9b6b40');
      ctx.fillStyle = '#d8b47e';
      ctx.beginPath();
      ctx.arc(px + 15, y + 0.95, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const sheds = Math.min(3, 1 + Math.floor(lvl / 2));
  for (let i = 0; i < sheds; i++) gable(ctx, 4 + i * 19, 4, 16, 22, i === 0 ? C.slate : '#6b5b4b', 8);
  if (lvl >= 3) {
    // conveyor
    ctx.strokeStyle = '#4b4a46';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(12, 27);
    ctx.lineTo(12, s - 26);
    ctx.stroke();
  }
  tree(ctx, s - 6, 8, 3, r);
}

function paintQuarry(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, '#c6c0ad');
  const cx = s * 0.55;
  const cy = s * 0.5;
  const rings = 2 + lvl;
  for (let i = 0; i < rings; i++) {
    const k = 1 - i / (rings + 1);
    const rx = (s * 0.42) * k;
    const ry = (s * 0.36) * k;
    ctx.beginPath();
    for (let a = 0; a <= 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(t * 3 + i) + 0.04 * Math.cos(t * 5 + i * 2);
      const x = cx + Math.cos(t) * rx * wob;
      const y = cy + Math.sin(t) * ry * wob;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const v = 205 - i * (90 / rings);
    ctx.fillStyle = `rgb(${v}, ${v - 3}, ${v - 10})`;
    ctx.fill();
    // bench edge shadow (inner, bottom-right lit less)
    ctx.strokeStyle = 'rgba(60,58,50,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  // cut blocks
  for (let i = 0; i < 6 + lvl * 2; i++) {
    const x = 3 + r() * 14;
    const y = 4 + r() * (s - 10);
    boxShadow(ctx, x, y, 2.4, 2.4, 1.6);
    rect(ctx, x, y, 2.4, 2.4, shade('#d9d4c6', -r() * 0.2));
  }
  gable(ctx, 4, 4, 11, 7, C.roofs[5], 4);
}

function paintMine(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, '#a99f8c');
  // spoil heaps
  const heaps = 1 + Math.floor(lvl / 2);
  for (let i = 0; i < heaps; i++) {
    const hx = s - 14 - i * 6;
    const hy = s - 14 - i * 14;
    const rad = 9 - i;
    const g = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, rad);
    g.addColorStop(0, '#7a736a');
    g.addColorStop(1, '#3e3a35');
    circleShadow(ctx, hx, hy, rad, 4);
    ctx.beginPath();
    ctx.arc(hx, hy, rad, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
  // rails
  ctx.strokeStyle = '#4a4540';
  ctx.lineWidth = 0.5;
  for (const off of [0, 1.6]) {
    ctx.beginPath();
    ctx.moveTo(4, 30 + off);
    ctx.lineTo(s - 4, 30 + off);
    ctx.stroke();
  }
  for (let x = 4; x < s - 4; x += 2) rect(ctx, x, 29.4, 0.5, 2.8, '#6a5a48');
  // headframe
  const hx = 12;
  const hy = 10;
  boxShadow(ctx, hx, hy, 10, 10, 16 + lvl * 2);
  ctx.strokeStyle = '#3d4a52';
  ctx.lineWidth = 1;
  ctx.strokeRect(hx, hy, 10, 10);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + 10, hy + 10);
  ctx.moveTo(hx + 10, hy);
  ctx.lineTo(hx, hy + 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hx + 5, hy + 5, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#b4553c';
  ctx.fill();
  flat(ctx, 28, 6, 18, 12, '#8b8f8c', 6, r);
  if (lvl >= 3) flat(ctx, 28, 40, 14, 10, '#7f8682', 5, r);
}

function paintShop(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, C.paving, 'rgba(120,110,90,0.4)');
  // paving pattern
  ctx.strokeStyle = 'rgba(150,140,115,0.35)';
  ctx.lineWidth = 0.3;
  for (let i = 3; i < s; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i, 1);
    ctx.lineTo(i, s - 1);
    ctx.stroke();
  }
  const awn = [
    ['#c8553d', '#f4eee2'],
    ['#2f7d85', '#f4eee2'],
    ['#d9a62e', '#f4eee2'],
    ['#55805a', '#f4eee2'],
  ];
  const n = 2 + lvl * 2;
  for (let i = 0; i < n; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 3 + col * 11;
    const y = 4 + row * 12;
    if (y > s - 10) break;
    const a = awn[Math.floor(r() * awn.length)];
    boxShadow(ctx, x, y, 8, 6, 3);
    stripes(ctx, x, y, 8, 6, a[0], a[1], 1, true);
  }
  if (lvl >= 3) flat(ctx, s - 16, s - 14, 13, 11, '#d6cbb3', 8 + lvl, r);
  tree(ctx, s - 5, 5, 2.5, r);
}

function paintWarehouse(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, C.asphalt);
  const sheds = 1 + Math.min(3, Math.floor((lvl + 1) / 2));
  for (let i = 0; i < sheds; i++) {
    const x = 3 + i * 15;
    const w = 12;
    const h = s - 22;
    boxShadow(ctx, x, 3, w, h, 7);
    stripes(ctx, x, 3, w, h, '#8fa3ad', '#7e939e', 0.8, true);
    rect(ctx, x + w / 2 - 0.3, 3, 0.6, h, '#a9bbc3');
  }
  for (let i = 0; i < 5 + lvl * 3; i++) {
    const x = 3 + r() * (s - 8);
    const y = s - 16 + r() * 11;
    boxShadow(ctx, x, y, 2.6, 2.6, 2);
    rect(ctx, x, y, 2.6, 2.6, ['#b98c55', '#a7784a', '#6f8c9a'][Math.floor(r() * 3)]);
  }
}

function paintHospital(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, C.lawn);
  rect(ctx, 2, s - 14, s - 4, 11, C.asphalt);
  for (let i = 0; i < 6 + lvl; i++) rrect(ctx, 4 + i * 4.2, s - 12 + (i % 2) * 5, 2.2, 3.6, 0.8, ['#c94f3c', '#3d6f9e', '#e8e4da', '#5d6a72'][i % 4]);
  const hgt = 10 + lvl * 3;
  // H-shaped white block with a green stripe
  flat(ctx, 4, 4, 10, 36, C.white, hgt, r);
  flat(ctx, 30, 4, 10, 36, C.white, hgt, r);
  flat(ctx, 14, 16, 16, 10, '#e6e3da', hgt * 0.8, r);
  rect(ctx, 6, 6, 6, 1.2, '#4f9a6c');
  rect(ctx, 32, 6, 6, 1.2, '#4f9a6c');
  // helipad
  if (lvl >= 2) {
    ctx.beginPath();
    ctx.arc(s - 11, 12, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#7d8a86';
    ctx.fill();
    ctx.strokeStyle = '#f4f2ea';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = '#f4f2ea';
    ctx.fillRect(s - 14, 9, 1.2, 6);
    ctx.fillRect(s - 9.2, 9, 1.2, 6);
    ctx.fillRect(s - 14, 11.4, 6, 1.2);
  }
  for (let i = 0; i < 4; i++) tree(ctx, s - 18 + r() * 14, 24 + r() * 20, 2.4, r);
}

function paintFactory(ctx: Ctx, s: number, lvl: number, _r: () => number): void {
  lotBase(ctx, s, '#b9b6ab');
  const halls = 1 + Math.min(3, lvl);
  for (let i = 0; i < halls; i++) {
    const x = 4 + (i % 2) * 44;
    const y = 4 + Math.floor(i / 2) * 36;
    const w = 40;
    const h = 30;
    boxShadow(ctx, x, y, w, h, 9);
    // saw-tooth roof
    for (let t = 0; t < w; t += 4) {
      rect(ctx, x + t, y, 2.6, h, '#9aa3a6');
      rect(ctx, x + t + 2.6, y, 1.4, h, '#e2ecef');
    }
    ctx.strokeStyle = '#5d6669';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(x, y, w, h);
  }
  // chimneys with smoke
  const ch = 1 + Math.floor(lvl / 2);
  for (let i = 0; i < ch; i++) {
    const cx = s - 14 - i * 9;
    const cy = s - 18;
    circleShadow(ctx, cx, cy, 2, 24);
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#8c4e3c';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2725';
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(cx + 3 + k * 2.5, cy - 3 - k * 2.2, 2 + k * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,245,240,${0.55 - k * 0.11})`;
      ctx.fill();
    }
  }
  // pipes
  ctx.strokeStyle = '#7a8b92';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(44, 20);
  ctx.lineTo(48, 20);
  ctx.moveTo(24, 34);
  ctx.lineTo(24, 40);
  ctx.stroke();
}

function paintPark(ctx: Ctx, s: number, _lvl: number, r: () => number): void {
  lotBase(ctx, s, C.lawn);
  ctx.strokeStyle = C.path;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, s * 0.7);
  ctx.quadraticCurveTo(s * 0.5, s * 0.35, s - 1, s * 0.6);
  ctx.stroke();
  rect(ctx, s * 0.45, s * 0.42, 3, 1, '#7b5a3c');
  for (let i = 0; i < 4; i++) tree(ctx, 4 + r() * (s - 8), 4 + r() * (s - 8), 2.8 + r() * 1.6, r);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = ['#e7c64f', '#e48aa0', '#f2f0e8'][i % 3];
    ctx.beginPath();
    ctx.arc(3 + r() * (s - 6), 3 + r() * (s - 6), 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFountain(ctx: Ctx, s: number): void {
  lotBase(ctx, s, C.paving);
  const c = s / 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(c, c, s * 0.46 - i * 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? 'rgba(160,150,120,0.5)' : 'rgba(190,180,150,0.6)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  circleShadow(ctx, c, c, 9.5, 1.5);
  ctx.beginPath();
  ctx.arc(c, c, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = '#e9e4d6';
  ctx.fill();
  const g = ctx.createRadialGradient(c - 2, c - 2, 1, c, c, 8.5);
  g.addColorStop(0, '#bfe6ef');
  g.addColorStop(1, C.water);
  ctx.beginPath();
  ctx.arc(c, c, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 3.2, c + Math.sin(a) * 3.2, 0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(c, c, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = '#f7f4ec';
  ctx.fill();
}

function paintStatue(ctx: Ctx, s: number, _lvl: number, r: () => number): void {
  lotBase(ctx, s, C.paving);
  const c = s / 2;
  for (const [x, y] of [
    [3, 3],
    [s - 13, 3],
    [3, s - 13],
    [s - 13, s - 13],
  ]) {
    rrect(ctx, x, y, 10, 10, 2, '#86ab5c');
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = ['#d9534a', '#f0c84a', '#f4f1ea'][i % 3];
      ctx.beginPath();
      ctx.arc(x + 2 + r() * 6, y + 2 + r() * 6, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  boxShadow(ctx, c - 5, c - 5, 10, 10, 4);
  rect(ctx, c - 5, c - 5, 10, 10, '#d8d2c2');
  rect(ctx, c - 3.6, c - 3.6, 7.2, 7.2, '#c8c0ac');
  // bronze figure seen from above with a long shadow
  ctx.beginPath();
  ctx.moveTo(c + 1, c + 1);
  ctx.lineTo(c + 9, c + 9);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(c, c, 2.2, 1.6, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = '#6d5a3a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c - 0.6, c - 0.6, 1, 0, Math.PI * 2);
  ctx.fillStyle = '#8a7449';
  ctx.fill();
}

function paintTownhall(ctx: Ctx, s: number, lvl: number, r: () => number): void {
  lotBase(ctx, s, C.paving, 'rgba(120,110,90,0.45)');
  // square paving in a radial pattern
  ctx.strokeStyle = 'rgba(160,148,118,0.45)';
  ctx.lineWidth = 0.35;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.72, i * 3.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  const roof = lvl >= 6 ? '#3a7280' : C.teal;
  const hgt = 12 + lvl * 2.5;
  // main hall
  hip(ctx, 10, 6, s - 20, 18, roof, hgt);
  if (lvl >= 2) hip(ctx, 4, 10, 10, 26, roof, hgt * 0.8);
  if (lvl >= 3) hip(ctx, s - 14, 10, 10, 26, roof, hgt * 0.8);
  if (lvl >= 5) {
    gable(ctx, 4, 38, 14, 10, C.roofs[1], 8);
    gable(ctx, s - 18, 38, 14, 10, C.roofs[1], 8);
  }
  // tower with a dome
  const cx = s / 2;
  const cy = 15;
  circleShadow(ctx, cx, cy, 5, hgt + 10);
  const g = ctx.createRadialGradient(cx - 1.8, cy - 1.8, 0.5, cx, cy, 5);
  if (lvl >= 6) {
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.6, '#d9a93a');
    g.addColorStop(1, '#9a6f1d');
  } else {
    g.addColorStop(0, '#9fd2d4');
    g.addColorStop(0.6, '#3b8f95');
    g.addColorStop(1, '#245a60');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // flag
  ctx.fillStyle = '#c8553d';
  ctx.fillRect(cx + 0.3, cy - 9, 4, 2.4);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(cx - 0.2, cy - 9, 0.5, 9);
  for (let i = 0; i < 2 + lvl; i++) tree(ctx, 5 + r() * (s - 10), s - 6 - r() * 6, 2.2, r);
}

function paintConstruction(ctx: Ctx, s: number, r: () => number): void {
  lotBase(ctx, s, '#cdb58c', 'rgba(110,90,50,0.5)');
  // foundation and scaffolding grid
  const m = Math.max(3, s * 0.12);
  rect(ctx, m, m, s - 2 * m, s - 2 * m, '#b8a07a');
  ctx.strokeStyle = '#8a6a3c';
  ctx.lineWidth = 0.45;
  for (let x = m; x <= s - m + 0.01; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, m);
    ctx.lineTo(x, s - m);
    ctx.stroke();
  }
  for (let y = m; y <= s - m + 0.01; y += 3) {
    ctx.beginPath();
    ctx.moveTo(m, y);
    ctx.lineTo(s - m, y);
    ctx.stroke();
  }
  // material stacks
  for (let i = 0; i < 4; i++) {
    const x = 1.5 + r() * (s - 6);
    const y = s - m + 0.5 + r() * (m - 3.5);
    boxShadow(ctx, x, y, 3, 2, 1.5);
    rect(ctx, x, y, 3, 2, i % 2 ? '#9b6b40' : '#c9c2b0');
  }
  // crane
  ctx.strokeStyle = '#d99a2b';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(m + 2, m + 2);
  ctx.lineTo(s - m, m + s * 0.25);
  ctx.stroke();
  rect(ctx, m + 1, m + 1, 2.4, 2.4, '#d99a2b');
}

const PAINTERS: Record<BuildingType, (ctx: Ctx, s: number, lvl: number, r: () => number) => void> = {
  townhall: paintTownhall,
  house: paintHouse,
  farm: paintFarm,
  sawmill: paintSawmill,
  quarry: paintQuarry,
  mine: paintMine,
  shop: paintShop,
  warehouse: paintWarehouse,
  hospital: paintHospital,
  factory: paintFactory,
  park: paintPark,
  fountain: paintFountain,
  statue: paintStatue,
};

/** Pixel size of a tile (lot + padding) for a building type. */
export function tilePx(t: BuildingType): number {
  return Math.ceil((BUILDINGS[t].size * CELL_M + PAD_M * 2 + SHADOW_M) * PX_PER_M);
}

/**
 * Paint one building into ctx at (ox, oy) pixels. Level 0 = construction site.
 * `variant` changes the random details (roof colours, tree spots).
 */
export function paintBuilding(ctx: Ctx, ox: number, oy: number, t: BuildingType, lvl: number, variant: number, pxPerM = PX_PER_M): void {
  const size = BUILDINGS[t].size * CELL_M;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(pxPerM, pxPerM);
  ctx.translate(PAD_M, PAD_M);
  const r = rng((t.length * 7919 + lvl * 131 + variant * 977 + t.charCodeAt(0) * 31) >>> 0);
  if (lvl <= 0) paintConstruction(ctx, size, r);
  else PAINTERS[t](ctx, size, lvl, r);
  ctx.restore();
}

/** Stand-alone thumbnail for UI cards (CSS px square). */
export function thumbnail(t: BuildingType, lvl: number, cssPx: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(cssPx * dpr);
  c.style.width = c.style.height = `${cssPx}px`;
  const ctx = c.getContext('2d')!;
  const sizeM = BUILDINGS[t].size * CELL_M + PAD_M * 2 + SHADOW_M;
  paintBuilding(ctx, 0, 0, t, lvl, 1, c.width / sizeM);
  return c;
}
