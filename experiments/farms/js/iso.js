// Tiny isometric drawing kit for static "3D" game props (Canvas 2D).
// World: x to the right-down, y to the left-down, z up. Light comes from the top-left:
// top faces are brightest, the front-left (y+) face is mid, the front-right (x+) face is dark.

export const C30 = Math.cos(Math.PI / 6);
export const INK = '#12142c';

export function hex2rgb(h) {
  if (h.startsWith('rgb')) return h.match(/[\d.]+/g).slice(0, 3).map(Number);
  const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${(A[0] + (B[0] - A[0]) * t) | 0},${(A[1] + (B[1] - A[1]) * t) | 0},${(A[2] + (B[2] - A[2]) * t) | 0})`;
}
export const shade = (c, k) => (k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#0a0c1e', -k));

export class Iso {
  constructor(ctx, ox, oy, s = 1) { this.ctx = ctx; this.ox = ox; this.oy = oy; this.s = s; }
  P(x, y, z) { return [this.ox + (x - y) * C30 * this.s, this.oy + ((x + y) * 0.5 - z) * this.s]; }

  poly(pts3, fill, ink = 2, inkCol = INK) {
    const c = this.ctx;
    c.beginPath();
    pts3.forEach((p, i) => { const q = this.P(...p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (ink) { c.lineJoin = 'round'; c.strokeStyle = inkCol; c.lineWidth = ink * this.s; c.stroke(); }
  }
  line(a, b, col, w) {
    const c = this.ctx, p = this.P(...a), q = this.P(...b);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.strokeStyle = col; c.lineWidth = w * this.s; c.lineCap = 'round'; c.stroke();
  }
  grad(a3, b3, stops) {
    const p = this.P(...a3), q = this.P(...b3);
    const g = this.ctx.createLinearGradient(p[0], p[1], q[0], q[1]);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    return g;
  }

  /** Shaded box. Returns face helpers for placing details. */
  box(x, y, z, w, d, h, col, o = {}) {
    const top = o.top ?? shade(col, 0.3), left = shade(col, -0.04), right = shade(col, -0.2);
    const X = x + w, Y = y + d, Z = z + h;
    // front-left face (y = Y)
    this.poly([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], this.grad([x, Y, Z], [x, Y, z], [[0, shade(left, 0.08)], [1, shade(left, -0.12)]]), 2.2);
    // front-right face (x = X)
    this.poly([[X, Y, z], [X, y, z], [X, y, Z], [X, Y, Z]], this.grad([X, Y, Z], [X, y, z], [[0, shade(right, 0.1)], [1, shade(right, -0.08)]]), 2.2);
    // top
    this.poly([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], this.grad([x, y, Z], [X, Y, Z], [[0, shade(top, 0.12)], [1, top]]), 2.2);
    // bevel highlights on the two front top edges + the vertical front corner
    if (!o.flat) {
      this.line([x + 1.5, Y, Z - 1.2], [X - 1.5, Y, Z - 1.2], 'rgba(255,255,255,0.55)', 1.3);
      this.line([X, Y - 1.5, Z - 1.2], [X, y + 1.5, Z - 1.2], 'rgba(255,255,255,0.35)', 1.1);
      this.line([X, Y, z + 1.5], [X, Y, Z - 1.5], 'rgba(255,255,255,0.4)', 1.1);
    }
    const b = { x, y, z, w, d, h };
    return {
      ...b,
      L: (u, v) => [x + u * w, Y, z + v * h],      // point on the front-left face
      R: (u, v) => [X, y + u * d, z + v * h],      // point on the front-right face
      T: (u, v) => [x + u * w, y + v * d, Z],      // point on the top
    };
  }
  /** Rectangle on a face: f is a face mapper (b.L / b.R / b.T). */
  rect(f, u0, v0, u1, v1, fill, ink = 1.4) { this.poly([f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)], fill, ink); }

  /** Iso ellipse path (horizontal circle) */
  ell(cx, cy, cz, r, from = 0, to = Math.PI * 2, move = true) {
    const c = this.ctx, N = 40;
    for (let i = 0; i <= N; i++) {
      const t = from + (to - from) * (i / N);
      const p = this.P(cx + Math.cos(t) * r, cy + Math.sin(t) * r, cz);
      i === 0 && move ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]);
    }
  }
  /** Vertical cylinder */
  cyl(x, y, z, r, h, col, o = {}) {
    const c = this.ctx;
    // silhouette sides of an iso circle sit at t = -45deg (right) and 135deg (left);
    // the front half runs through t = 45deg (towards the viewer)
    const a = -Math.PI / 4, b = (3 * Math.PI) / 4;
    const pa = this.P(x + Math.cos(a) * r, y + Math.sin(a) * r, z), pb = this.P(x + Math.cos(b) * r, y + Math.sin(b) * r, z);
    c.beginPath();
    this.ell(x, y, z, r, a, b);            // bottom front arc, right -> left
    this.ell(x, y, z + h, r, b, a, false); // top front arc back, left -> right
    c.closePath();
    const g = c.createLinearGradient(pb[0], 0, pa[0], 0);
    g.addColorStop(0, shade(col, 0.1)); g.addColorStop(0.35, shade(col, 0.32)); g.addColorStop(0.75, shade(col, -0.1)); g.addColorStop(1, shade(col, -0.26));
    c.fillStyle = g; c.fill(); c.strokeStyle = INK; c.lineWidth = 2.2 * this.s; c.stroke();
    if (!o.open) {
      c.beginPath(); this.ell(x, y, z + h, r); c.closePath();
      c.fillStyle = o.top ?? shade(col, 0.3); c.fill(); c.lineWidth = 2 * this.s; c.stroke();
    }
  }

  /** Thick pipe along a 3D polyline (round joins read as bends) */
  pipe(pts3, r, col) {
    const c = this.ctx, pts = pts3.map((p) => this.P(...p));
    const path = () => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); };
    c.lineJoin = 'round'; c.lineCap = 'round';
    path(); c.strokeStyle = INK; c.lineWidth = (2 * r + 4.4) * this.s; c.stroke();
    path(); c.strokeStyle = shade(col, -0.25); c.lineWidth = 2 * r * this.s; c.stroke();
    path(); c.strokeStyle = col; c.lineWidth = 1.3 * r * this.s; c.stroke();
    c.save(); c.translate(0, -r * 0.42 * this.s);
    path(); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 0.4 * r * this.s; c.stroke();
    c.restore();
  }
  /** Ring flange on a pipe at a 3D point */
  flange(p3, r, col) {
    const c = this.ctx, [sx, sy] = this.P(...p3);
    c.beginPath(); c.ellipse(sx, sy, r * 0.62 * this.s, r * 1.15 * this.s, 0, 0, Math.PI * 2);
    c.fillStyle = shade(col, -0.1); c.fill(); c.strokeStyle = INK; c.lineWidth = 2 * this.s; c.stroke();
  }

  glow(p3, r, rgb, a = 0.6) {
    const c = this.ctx, [sx, sy] = this.P(...p3);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, r * this.s);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(sx, sy, r * this.s, 0, Math.PI * 2); c.fill(); c.restore();
  }
  dot(p3, r, col, ink = true) {
    const c = this.ctx, [sx, sy] = this.P(...p3);
    c.beginPath(); c.arc(sx, sy, r * this.s, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    if (ink) { c.strokeStyle = INK; c.lineWidth = 1 * this.s; c.stroke(); }
  }
  rivet(p3, r = 1.6) {
    const c = this.ctx, [sx, sy] = this.P(...p3);
    c.beginPath(); c.arc(sx, sy, r * this.s, 0, Math.PI * 2); c.fillStyle = '#6d7594'; c.fill();
    c.beginPath(); c.arc(sx - r * 0.3 * this.s, sy - r * 0.3 * this.s, r * 0.45 * this.s, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
  }

  /** Glowing crystal (hex prism with a pointed tip), standing at p3, tilted in screen space. */
  crystal(p3, h, w, tilt, col) {
    const c = this.ctx, [sx, sy] = this.P(...p3);
    c.save(); c.translate(sx, sy); c.rotate(tilt); c.scale(this.s, this.s);
    const L = [[-w, 0], [-w, -h * 0.72], [0, -h], [w, -h * 0.72], [w, 0], [0, w * 0.45]];
    c.beginPath(); L.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath();
    const g = c.createLinearGradient(-w, -h, w, 0);
    g.addColorStop(0, shade(col, 0.75)); g.addColorStop(0.45, shade(col, 0.2)); g.addColorStop(1, shade(col, -0.35));
    c.fillStyle = g; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();
    // facets
    c.beginPath(); c.moveTo(0, -h); c.lineTo(-w * 0.15, -h * 0.72); c.lineTo(-w * 0.15, 0.4 * w); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.moveTo(-w * 0.15, -h * 0.72); c.lineTo(w, -h * 0.72); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.stroke();
    c.beginPath(); c.moveTo(w * 0.35, -h * 0.68); c.lineTo(w * 0.35, -h * 0.1); c.lineTo(w, 0); c.lineTo(w, -h * 0.72); c.closePath();
    c.fillStyle = 'rgba(30,0,60,0.22)'; c.fill();
    c.beginPath(); c.moveTo(-w * 0.62, -h * 0.66); c.lineTo(-w * 0.62, -h * 0.2); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.6; c.stroke();
    c.restore();
  }
}
