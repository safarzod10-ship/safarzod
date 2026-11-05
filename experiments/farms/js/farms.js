// Three static isometric "mining farm" props for HomeBeast. Same income, different look.
// Style: light armoured panels with ink outlines (like the robo-pets), glowing accents.
import { Iso, shade, INK } from './iso.js';

const WHITE = '#dfe4f1';
const STEEL = '#3a405f';
const PIPE = '#9aa3c0';

function platform(I, accent, rgb) {
  const p = I.box(-130, -130, -18, 260, 260, 18, '#262c50', { top: '#323a68' });
  const c = I.ctx;
  // tech-floor grid on the top
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    I.line(p.T(t, 0), p.T(t, 1), 'rgba(140,160,255,0.16)', 1);
    I.line(p.T(0, t), p.T(1, t), 'rgba(140,160,255,0.16)', 1);
  }
  // inset border + glowing edge strips on the two front sides
  I.poly([p.T(0.03, 0.03), p.T(0.97, 0.03), p.T(0.97, 0.97), p.T(0.03, 0.97)], null, 1.4, 'rgba(160,180,255,0.35)');
  I.line(p.L(0.04, 0.5), p.L(0.96, 0.5), accent, 2.4);
  I.line(p.R(0.04, 0.5), p.R(0.96, 0.5), accent, 2.4);
  for (const q of [p.L(0.04, 0.5), p.L(0.96, 0.5), p.R(0.04, 0.5)]) I.glow(q, 16, rgb, 0.7);
  for (const u of [0.15, 0.85]) { I.rivet(p.L(u, 0.25), 1.8); I.rivet(p.R(u, 0.25), 1.8); }
  // soft ambient light pooled on the floor
  I.glow([0, 0, 0], 150, rgb, 0.16);
  return p;
}

/** Panel details: a dark screen with a glowing strip, vents, rivets. */
function screen(I, f, u0, v0, u1, v1, glowCol) {
  I.rect(f, u0, v0, u1, v1, '#232845', 1.6);
  I.rect(f, u0 + 0.04, v0 + 0.08, u1 - 0.04, v0 + 0.22 * (v1 - v0) + 0.08, glowCol, 0);
}
function vents(I, f, u0, u1, v0, v1, n) {
  for (let i = 0; i < n; i++) {
    const v = v0 + (v1 - v0) * (i / (n - 1));
    I.line(f(u0, v), f(u1, v), 'rgba(20,24,50,0.55)', 1.8);
  }
}
function seam(I, f, u) { I.line(f(u, 0.03), f(u, 0.97), 'rgba(20,24,50,0.35)', 1.2); }

// ---------------------------------------------------------------------------
export function crystalFarm(I) {
  const V = '#a855f7', VR = '168,85,247';
  platform(I, '#c084fc', VR);
  // back tall module
  const a = I.box(-80, -95, 0, 76, 62, 78, WHITE);
  screen(I, a.L, 0.14, 0.42, 0.86, 0.86, '#c084fc');
  vents(I, a.R, 0.18, 0.82, 0.3, 0.7, 6);
  seam(I, a.L, 0.5);
  I.cyl(-56, -70, 78, 10, 20, '#c9cfe0', { top: '#5b2d91' });
  I.cyl(-30, -70, 78, 8, 14, '#c9cfe0', { top: '#5b2d91' });
  I.glow([-56, -70, 98], 20, VR, 0.8);
  // front-left module with a crystal bed
  const b = I.box(-112, -18, 0, 62, 74, 48, WHITE);
  screen(I, b.L, 0.12, 0.35, 0.6, 0.8, '#c084fc');
  vents(I, b.R, 0.2, 0.8, 0.25, 0.75, 5);
  const bt = I.box(-104, -10, 48, 46, 58, 6, STEEL, { flat: true });
  // right module with a crystal bed
  const r = I.box(8, -84, 0, 84, 56, 42, WHITE);
  screen(I, r.L, 0.08, 0.3, 0.42, 0.8, '#c084fc');
  vents(I, r.L, 0.55, 0.92, 0.3, 0.8, 5);
  const rt = I.box(16, -76, 42, 66, 40, 6, STEEL, { flat: true });
  // pipes linking the modules (behind the central body)
  I.pipe([[-4, -68, 60], [12, -68, 60], [12, -68, 42]], 5, PIPE);
  I.flange([12, -68, 52], 7, PIPE);
  // crystals
  const cluster = (bx, f, list) => {
    for (const [u, v, h, w, t] of list) I.crystal(f(u, v), h, w, t, V);
    I.glow(f(0.5, 0.5), 60, VR, 0.55);
  };
  cluster(rt, rt.T, [[0.25, 0.3, 30, 7, -0.3], [0.5, 0.25, 44, 9, 0.05], [0.72, 0.4, 32, 7, 0.32], [0.38, 0.65, 26, 6, -0.15], [0.62, 0.7, 22, 6, 0.25]]);
  cluster(bt, bt.T, [[0.3, 0.3, 26, 6, -0.25], [0.55, 0.4, 38, 8, 0.1], [0.4, 0.72, 24, 6, -0.1], [0.75, 0.7, 20, 5, 0.3]]);
  // central machine body (front)
  const m = I.box(-40, -14, 0, 104, 66, 30, WHITE);
  I.rect(m.L, 0.04, 0.3, 0.96, 0.62, STEEL, 1.4);
  for (let i = 0; i < 9; i++) I.dot(m.L(0.1 + i * 0.1, 0.46), 1.8, i % 3 ? '#c084fc' : '#5ff0ff', false);
  vents(I, m.R, 0.15, 0.85, 0.3, 0.75, 4);
  for (const u of [0.06, 0.94]) I.rivet(m.L(u, 0.82));
  const hatch = I.box(-4, 0, 30, 34, 30, 8, '#c9cfe0');
  I.glow(hatch.T(0.5, 0.5), 24, VR, 0.6);
  I.rect(hatch.T, 0.2, 0.2, 0.8, 0.8, '#7c3aed', 1.2);
  // front pipe loop
  I.pipe([[-118, 64, 10], [-118, 76, 10], [70, 76, 10], [70, 40, 10]], 6, PIPE);
  for (const p of [[-60, 76, 10], [10, 76, 10]]) I.flange(p, 8.5, PIPE);
  I.pipe([[70, 40, 10], [64, 40, 10]], 6, PIPE);
}

// ---------------------------------------------------------------------------
export function serverFarm(I) {
  const B = '#3d8bfd', BR = '61,139,253';
  platform(I, '#60a5fa', BR);
  // cooling towers (back-left)
  for (const [x, y] of [[-92, -96], [-96, -46]]) {
    I.cyl(x, y, 0, 22, 66, WHITE, { open: true });
    const c = I.ctx;
    c.beginPath(); I.ell(x, y, 66, 22); c.closePath(); c.fillStyle = '#1e2442'; c.fill(); c.strokeStyle = INK; c.lineWidth = 2 * I.s; c.stroke();
    c.beginPath(); I.ell(x, y, 66, 15); c.strokeStyle = '#596184'; c.lineWidth = 1.6 * I.s; c.stroke();
    for (let k = 0; k < 4; k++) { const t = k * Math.PI / 2 + 0.4; I.line([x, y, 66], [x + Math.cos(t) * 14, y + Math.sin(t) * 14, 66], '#8f98ba', 3); }
    I.dot([x, y, 66], 3, '#cfd6ea');
    I.glow([x, y, 66], 26, BR, 0.35);
    for (const v of [16, 40]) { const ctx = I.ctx; ctx.beginPath(); I.ell(x, y, v, 22.2, -Math.PI / 4, 3 * Math.PI / 4); ctx.strokeStyle = 'rgba(20,24,50,0.4)'; ctx.lineWidth = 1.4 * I.s; ctx.stroke(); }
  }
  // row of server racks
  for (let i = 0; i < 4; i++) {
    const r = I.box(-52 + i * 36, -84, 0, 34, 40, 82, WHITE);
    I.rect(r.L, 0.1, 0.06, 0.9, 0.94, '#1b2140', 1.4);
    for (let k = 0; k < 9; k++) {
      const v = 0.12 + k * 0.09;
      I.rect(r.L, 0.16, v, 0.84, v + 0.06, '#2c3560', 0.8);
      I.dot(r.L(0.24, v + 0.03), 1.4, (k + i) % 4 === 0 ? '#4ade80' : '#5ff0ff', false);
      I.dot(r.L(0.34, v + 0.03), 1.4, '#60a5fa', false);
    }
    I.glow(r.L(0.5, 0.5), 34, BR, 0.32);
    vents(I, r.R, 0.2, 0.8, 0.2, 0.8, 7);
  }
  I.box(-56, -88, 82, 152, 48, 6, '#c9cfe0');
  // cable trays from the racks to the power unit
  I.pipe([[-30, -40, 4], [-30, 20, 4], [40, 20, 4]], 3.5, '#2f3658');
  I.pipe([[20, -40, 4], [20, 12, 4], [44, 12, 4]], 3.5, '#2f3658');
  I.pipe([[70, -40, 4], [70, 4, 4]], 3.5, '#2f3658');
  // big chiller unit (front-left) with fan grills on top
  const ch = I.box(-118, 4, 0, 86, 70, 34, WHITE);
  vents(I, ch.L, 0.08, 0.92, 0.25, 0.8, 6);
  vents(I, ch.R, 0.15, 0.85, 0.25, 0.8, 5);
  for (const [u, v] of [[0.28, 0.5], [0.72, 0.5]]) {
    const [x, y, z] = ch.T(u, v), c = I.ctx;
    c.beginPath(); I.ell(x, y, z, 17); c.closePath(); c.fillStyle = '#1e2442'; c.fill(); c.strokeStyle = INK; c.lineWidth = 2 * I.s; c.stroke();
    for (const rr of [12, 6]) { c.beginPath(); I.ell(x, y, z, rr); c.strokeStyle = '#59628a'; c.lineWidth = 1.3 * I.s; c.stroke(); }
    for (let k = 0; k < 3; k++) { const t = k * 2.094 + 0.5; I.line([x, y, z], [x + Math.cos(t) * 15, y + Math.sin(t) * 15, z], '#9aa3c0', 3.4); }
    I.dot([x, y, z], 2.6, '#cfd6ea');
  }
  // power unit with a screen (front-right)
  const pw = I.box(26, 4, 0, 72, 64, 46, WHITE);
  screen(I, pw.L, 0.12, 0.3, 0.88, 0.85, '#60a5fa');
  I.glow(pw.L(0.5, 0.6), 40, BR, 0.5);
  // lightning sign on the screen
  const c = I.ctx;
  c.beginPath(); [[0.52, 0.78], [0.42, 0.58], [0.5, 0.58], [0.44, 0.4], [0.58, 0.62], [0.5, 0.62], [0.56, 0.78]].forEach((uv, i) => { const p = I.P(...pw.L(...uv)); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
  c.closePath(); c.fillStyle = '#facc15'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.2 * I.s; c.stroke();
  vents(I, pw.R, 0.2, 0.8, 0.3, 0.75, 5);
  // antenna on the power unit
  I.line(pw.T(0.7, 0.3), [pw.T(0.7, 0.3)[0], pw.T(0.7, 0.3)[1], 46 + 38], INK, 4.4);
  I.line(pw.T(0.7, 0.3), [pw.T(0.7, 0.3)[0], pw.T(0.7, 0.3)[1], 46 + 38], '#c9cfe0', 2.2);
  I.dot([pw.T(0.7, 0.3)[0], pw.T(0.7, 0.3)[1], 86], 4, '#60a5fa');
  I.glow([pw.T(0.7, 0.3)[0], pw.T(0.7, 0.3)[1], 86], 18, BR, 0.9);
}

// ---------------------------------------------------------------------------
export function reactorFarm(I) {
  const T = '#2dd4bf', TR = '45,212,191';
  platform(I, '#5eead4', TR);
  // storage tanks (back)
  for (const [x, y] of [[-96, -92], [-40, -104]]) {
    I.cyl(x, y, 0, 20, 62, WHITE);
    const c = I.ctx;
    c.beginPath(); I.ell(x, y, 30, 20.2, -Math.PI / 4, 3 * Math.PI / 4); c.strokeStyle = T; c.lineWidth = 3 * I.s; c.stroke();
    I.cyl(x, y, 62, 8, 8, '#c9cfe0');
  }
  I.pipe([[-96, -70, 20], [-96, -40, 20], [-30, -40, 20]], 5, PIPE);
  I.pipe([[-40, -82, 14], [-40, -50, 14]], 5, PIPE);
  // right service module
  const s = I.box(36, -96, 0, 64, 52, 50, WHITE);
  screen(I, s.L, 0.12, 0.35, 0.88, 0.82, '#5eead4');
  vents(I, s.R, 0.2, 0.8, 0.25, 0.75, 5);
  I.pipe([[36, -60, 30], [24, -60, 30], [24, -36, 30]], 5, PIPE);
  // reactor: base, glass chamber with the core, cap
  const cx = 0, cy = -16;
  I.cyl(cx, cy, 0, 56, 22, WHITE);
  const c = I.ctx;
  for (let k = 0; k < 8; k++) { const t = -Math.PI / 4 + k * (Math.PI / 7); I.rivet([cx + Math.cos(t) * 54, cy + Math.sin(t) * 54, 11], 1.6); }
  // core inside (drawn before the glass)
  I.glow([cx, cy, 58], 70, TR, 0.75);
  I.crystal([cx, cy, 26], 64, 14, 0, T);
  I.crystal([cx - 14, cy + 10, 26], 34, 7, -0.35, T);
  I.crystal([cx + 14, cy + 10, 26], 30, 7, 0.35, T);
  // glass cylinder
  const a = -Math.PI / 4, b = (3 * Math.PI) / 4, r = 40, z0 = 22, z1 = 92;
  c.beginPath(); I.ell(cx, cy, z0, r, a, b); I.ell(cx, cy, z1, r, b, a, false); c.closePath();
  const pa = I.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0), pb = I.P(cx + Math.cos(b) * r, cy + Math.sin(b) * r, z0);
  const g = c.createLinearGradient(pb[0], 0, pa[0], 0);
  g.addColorStop(0, 'rgba(160,255,240,0.35)'); g.addColorStop(0.3, 'rgba(220,255,250,0.18)'); g.addColorStop(0.75, 'rgba(60,200,190,0.18)'); g.addColorStop(1, 'rgba(20,120,120,0.4)');
  c.fillStyle = g; c.fill(); c.strokeStyle = INK; c.lineWidth = 2.2 * I.s; c.stroke();
  // glass ribs + reflection
  for (const t of [Math.PI / 4 - 0.55, Math.PI / 4 + 0.55]) I.line([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z0], [cx + Math.cos(t) * r, cy + Math.sin(t) * r, z1], 'rgba(20,40,60,0.55)', 2);
  { const t = Math.PI / 4 + 1.15; I.line([cx + Math.cos(t) * r * 0.98, cy + Math.sin(t) * r * 0.98, z0 + 8], [cx + Math.cos(t) * r * 0.98, cy + Math.sin(t) * r * 0.98, z1 - 8], 'rgba(255,255,255,0.75)', 4); }
  // cap
  I.cyl(cx, cy, z1, 48, 14, WHITE);
  for (let k = 0; k < 6; k++) { const t = -Math.PI / 4 + 0.2 + k * (Math.PI / 6.2); I.dot([cx + Math.cos(t) * 48, cy + Math.sin(t) * 48, z1 + 7], 2.2, T, false); }
  I.cyl(cx, cy, z1 + 14, 16, 12, '#c9cfe0', { top: '#134e4a' });
  I.glow([cx, cy, z1 + 26], 34, TR, 0.9);
  I.crystal([cx, cy, z1 + 26], 18, 5, 0, T);
  // solar panels (front-left) on stands
  const panel = (x, y) => {
    I.line([x + 20, y + 16, 0], [x + 20, y + 16, 22], INK, 5); I.line([x + 20, y + 16, 0], [x + 20, y + 16, 22], '#9aa3c0', 2.6);
    const P = [[x, y, 34], [x + 44, y, 34], [x + 44, y + 34, 14], [x, y + 34, 14]];
    I.poly(P, I.grad(P[0], P[2], [[0, '#4c7dff'], [1, '#1d3a9e']]), 2.2);
    for (let k = 1; k < 4; k++) I.line([x + k * 11, y, 34], [x + k * 11, y + 34, 14], 'rgba(160,200,255,0.55)', 1.2);
    I.line([x, y + 17, 24], [x + 44, y + 17, 24], 'rgba(160,200,255,0.55)', 1.2);
    I.line([x + 2, y + 2, 33], [x + 42, y + 2, 33], '#facc15', 1.6);
  };
  panel(-120, 30);
  panel(-120, -22);
  // front pipe to the reactor base
  I.pipe([[-70, 70, 8], [30, 70, 8], [30, 30, 8]], 5.5, PIPE);
  I.flange([-20, 70, 8], 8, PIPE);
  // small control box in front-right
  const k = I.box(54, 30, 0, 44, 40, 30, WHITE);
  screen(I, k.L, 0.15, 0.35, 0.85, 0.82, '#5eead4');
  I.glow(k.L(0.5, 0.6), 26, TR, 0.5);
}

export const FARMS = { crystal: crystalFarm, server: serverFarm, reactor: reactorFarm };
