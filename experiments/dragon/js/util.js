// Shared math / drawing helpers. No dependencies.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const remap = (v, a, b) => clamp((v - a) / (b - a));

export function lerpColor(c1, c2, t) {
  return [0, 1, 2, 3].map((i) => lerp(c1[i] ?? 1, c2[i] ?? 1, t));
}
export const rgba = (c, a = 1) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] ?? 1) * a})`;

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  return f;
}

/** Smooth pseudo-noise from incommensurate sines, range ~[-1,1]. */
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 1.0 + seed * 1.7) * 0.5 +
    Math.sin(t * 2.31 + seed * 3.1) * 0.3 +
    Math.sin(t * 4.97 + seed * 5.3) * 0.2
  );
}

// ---------- 2D affine transforms (a b c d e f like canvas) ----------
export class Mat {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
  }
  mul(m) {
    return new Mat(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }
  translate(x, y) { return this.mul(new Mat(1, 0, 0, 1, x, y)); }
  rotate(r) { const c = Math.cos(r), s = Math.sin(r); return this.mul(new Mat(c, s, -s, c, 0, 0)); }
  scale(x, y = x) { return this.mul(new Mat(x, 0, 0, y, 0, 0)); }
  apply(x, y) { return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f]; }
  angle() { return Math.atan2(this.b, this.a); }
  set(ctx) { ctx.setTransform(this.a, this.b, this.c, this.d, this.e, this.f); }
}

// ---------- spline paths ----------
/**
 * Build a smooth path through points with Catmull-Rom -> Bezier conversion.
 * A point may be [x, y] (smooth) or [x, y, 1] (sharp corner).
 */
export function splinePath(ctx, pts, closed = true, tension = 1) {
  const n = pts.length;
  if (n < 2) return;
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const tan = (i) => {
    const p = get(i);
    if (p[2]) return [0, 0];
    if (!closed && (i === 0 || i === n - 1)) return [0, 0];
    const a = get(i - 1), b = get(i + 1);
    return [((b[0] - a[0]) / 6) * tension, ((b[1] - a[1]) / 6) * tension];
  };
  ctx.moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i), p1 = get(i + 1);
    const t0 = tan(i), t1 = tan(i + 1);
    ctx.bezierCurveTo(p0[0] + t0[0], p0[1] + t0[1], p1[0] - t1[0], p1[1] - t1[1], p1[0], p1[1]);
  }
  if (closed) ctx.closePath();
}

/** Sample a Catmull-Rom curve through point objects; interpolates all numeric fields. */
export function sampleSpline(nodes, perSeg = 8) {
  const out = [];
  const n = nodes.length;
  const keys = Object.keys(nodes[0]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)], p1 = nodes[i], p2 = nodes[i + 1], p3 = nodes[Math.min(n - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const o = {};
      for (const key of keys) {
        const a = p0[key], b = p1[key], c = p2[key], d = p3[key];
        o[key] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      }
      out.push(o);
    }
  }
  out.push({ ...nodes[n - 1] });
  return out;
}

/** Stroke-behind-fill: draws a thick outline then fills over it (hides inner seams). */
export function inkFill(ctx, buildPath, fill, ink, width) {
  ctx.beginPath();
  buildPath(ctx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (width > 0) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width * 2;
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Two-bone IK. Returns joint position. bend = +1 / -1 picks the side. */
export function ik2(ax, ay, bx, by, l1, l2, bend = 1) {
  let dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy);
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return [ax + ux * a - uy * h * bend, ay + uy * a + ux * h * bend];
}

/** Critically-ish damped spring, integrated with fixed dt. */
export class Spring {
  constructor(value = 0, freq = 8, damping = 0.6) {
    this.x = value; this.v = 0; this.freq = freq; this.damp = damping;
  }
  step(target, dt) {
    const w = this.freq * TAU;
    const a = w * w * (target - this.x) - 2 * this.damp * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
