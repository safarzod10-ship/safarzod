// Custom particle system: cartoon flame stream, sparks/embers, smoke puffs.
// All coordinates are logical canvas units (540 x 960). Simulation is
// deterministic (seeded RNG + fixed time step) so the video capture is exact.

import { TAU, clamp, lerp, rng } from './util.js';

const FLAME_LAYERS = [
  // [colour, radius factor fn(heat)]  drawn back-to-front => cel-shaded flame
  ['#1a2fb8', (h) => clamp(h * 2.6) * (0.55 + 0.45 * h)],
  ['#2a6bff', (h) => Math.min(clamp(h * 2.6) * (0.55 + 0.45 * h) * 0.9, clamp(h * 1.25 + 0.05))],
  ['#3fb2ff', (h) => clamp(h * 1.45 - 0.22)],
  ['#9eeaff', (h) => clamp(h * 1.7 - 0.62)],
  ['#f2fdff', (h) => clamp(h * 2.1 - 1.25)],
];

export class FX {
  constructor() { this.reset(); }

  reset() {
    this.rand = rng(1337);
    this.flames = [];
    this.sparks = [];
    this.smoke = [];
    this.emitAcc = 0; this.sparkAcc = 0; this.smokeAcc = 0;
    this.intensity = 0;
    this.time = 0;
    this.lastMouth = null;
  }

  /**
   * @param dt fixed step
   * @param mouth {x,y,dir,gap} in logical units
   * @param fire 0..1 emission strength
   * @param smoke 0..1 smoke emission
   */
  step(dt, mouth, nostril, fire, smoke) {
    const R = this.rand;
    this.time += dt;
    this.intensity = lerp(this.intensity, fire, 1 - Math.exp(-dt * 14));

    // ---------- emit flames from inside the open mouth
    if (fire > 0.02) {
      this.emitAcc += dt * 300 * fire;
      const prev = this.lastMouth || mouth;
      let n = 0;
      const total = Math.floor(this.emitAcc);
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const u = total > 1 ? n / (total - 1) : 1; n++;
        // interpolate emitter along the frame so a sweeping head leaves no gaps
        const ex = lerp(prev.x, mouth.x, u), ey = lerp(prev.y, mouth.y, u);
        const dir = mouth.dir + (R() - 0.5) * 0.26 + Math.sin(this.time * 7) * 0.05 + Math.sin(this.time * 2.3) * 0.04;
        const sp = R.range(540, 680);
        this.flames.push({
          x: ex + Math.cos(mouth.dir) * R.range(-4, 6), y: ey + Math.sin(mouth.dir) * R.range(-4, 6),
          vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
          age: R() * 0.02, life: R.range(0.6, 0.95),
          r0: R.range(6, 10) * Math.max(0.6, Math.min(1.3, mouth.gap / 26)), r1: R.range(36, 80) * (R() < 0.15 ? 1.35 : 1),
          seed: R() * 100, spin: R.range(-2, 2),
        });
      }
      // sparks / embers
      this.sparkAcc += dt * 70 * fire;
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        const dir = mouth.dir + (R() - 0.5) * 0.5;
        const sp = R.range(380, 760);
        this.sparks.push({
          x: mouth.x, y: mouth.y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
          age: 0, life: R.range(0.45, 1.1), size: R.range(1.4, 3.2), seed: R() * 100,
        });
      }
    }
    this.lastMouth = { ...mouth };

    // ---------- smoke puffs after the fire (mouth + nostrils)
    if (smoke > 0.02) {
      this.smokeAcc += dt * 60 * smoke;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        const src = R() < 0.6 ? mouth : nostril;
        const dir = src.dir - 0.25 + (R() - 0.5) * 0.7;
        const sp = R.range(40, 110);
        this.smoke.push({
          x: src.x + R.range(-4, 4), y: src.y + R.range(-4, 4),
          vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp - 25,
          age: 0, life: R.range(1.0, 1.8), r0: R.range(7, 12), r1: R.range(28, 46), seed: R() * 100,
        });
      }
    }

    // ---------- integrate
    const dying = fire < 0.15 ? 1.6 : 0; // once the breath stops the stream burns out quickly
    for (const f of this.flames) {
      f.age += dt * (1 + dying);
      const k = f.age / f.life;
      const drag = Math.exp(-dt * (1.4 + k * 3.2));
      f.vx *= drag; f.vy *= drag;
      f.vy -= 820 * dt * k * k;        // buoyancy: flames billow upward as they cool
      // turbulence
      f.vx += Math.sin(f.seed + this.time * 13 + f.y * 0.03) * 900 * dt * k;
      f.vy += Math.cos(f.seed * 1.3 + this.time * 11 + f.x * 0.03) * 900 * dt * k;
      f.x += f.vx * dt; f.y += f.vy * dt;
      // a hot flame spawns a few trailing smoke wisps at the end of its life
      if (k > 0.82 && !f.smoked && this.rand() < 0.08) {
        f.smoked = true;
        this.smoke.push({ x: f.x, y: f.y, vx: f.vx * 0.2, vy: f.vy * 0.2 - 30, age: 0, life: 0.9, r0: f.r1 * 0.3, r1: f.r1 * 0.6, seed: f.seed, dark: 1 });
      }
    }
    this.flames = this.flames.filter((f) => f.age < f.life);
    for (const s of this.sparks) {
      s.age += dt;
      s.vx *= Math.exp(-dt * 1.4); s.vy *= Math.exp(-dt * 1.4);
      s.vy += 90 * dt; // slight gravity for embers
      s.vx += Math.sin(s.seed + this.time * 9) * 200 * dt;
      s.px = s.x; s.py = s.y;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const m of this.smoke) {
      m.age += dt;
      m.vx *= Math.exp(-dt * 1.2); m.vy *= Math.exp(-dt * 1.2);
      m.vy -= 22 * dt;
      m.vx += Math.sin(m.seed + this.time * 2) * 18 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
    }
    this.smoke = this.smoke.filter((m) => m.age < m.life);
  }

  // glow behind the flame (drawn before the dragon head so the head is lit)
  drawGlow(ctx, mouth) {
    const I = this.intensity;
    if (I < 0.01 || !this.flames.length) return;
    // centroid of the stream
    let cx = 0, cy = 0;
    for (const f of this.flames) { cx += f.x; cy += f.y; }
    cx /= this.flames.length; cy /= this.flames.length;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.85 + 0.15 * Math.sin(this.time * 31) * Math.sin(this.time * 17);
    let g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 330);
    g.addColorStop(0, `rgba(60,140,255,${0.36 * I * flick})`);
    g.addColorStop(0.5, `rgba(80,60,255,${0.14 * I * flick})`);
    g.addColorStop(1, 'rgba(60,40,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 340, cy - 340, 680, 680);
    g = ctx.createRadialGradient(mouth.x, mouth.y, 2, mouth.x, mouth.y, 90);
    g.addColorStop(0, `rgba(170,230,255,${0.6 * I * flick})`);
    g.addColorStop(1, 'rgba(60,140,255,0)');
    ctx.fillStyle = g; ctx.fillRect(mouth.x - 100, mouth.y - 100, 200, 200);
    ctx.restore();
  }

  drawFlames(ctx) {
    if (!this.flames.length) return;
    const fl = this.flames;
    // stretched blobs aligned with velocity: the stream keeps changing shape
    const blob = (f, rf) => {
      const k = f.age / f.life;
      const r = lerp(f.r0, f.r1, Math.pow(k, 0.7)) * rf * (1 - Math.pow(k, 6) * 0.6);
      if (r < 0.4) return;
      const v = Math.hypot(f.vx, f.vy);
      const a = Math.atan2(f.vy, f.vx);
      const st = 1 + clamp(v / 900, 0, 0.7);
      const wob = 1 + Math.sin(f.seed + this.time * 20) * 0.12;
      ctx.moveTo(f.x + Math.cos(a) * r * st, f.y + Math.sin(a) * r * st);
      ctx.ellipse(f.x, f.y, r * st * wob, r / Math.sqrt(st), a, 0, TAU);
    };
    ctx.save();
    for (let li = 0; li < FLAME_LAYERS.length; li++) {
      const [col, fn] = FLAME_LAYERS[li];
      ctx.beginPath();
      for (const f of fl) {
        const heat = 1 - f.age / f.life;
        const rf = fn(heat);
        if (rf > 0.01) blob(f, rf);
      }
      ctx.fillStyle = col;
      ctx.globalAlpha = li === 0 ? 0.92 : 1;
      ctx.fill();
    }
    // dark-red cel edge on the cooling tips gives the cartoon flame a crisp silhouette
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawSparks(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const k = s.age / s.life;
      const a = 1 - k;
      ctx.strokeStyle = k < 0.4 ? `rgba(220,245,255,${a})` : `rgba(${(120 - k * 60) | 0},${(200 - k * 80) | 0},255,${a})`;
      ctx.lineWidth = s.size * (1 - k * 0.5);
      ctx.beginPath();
      ctx.moveTo(s.px ?? s.x, s.py ?? s.y);
      ctx.lineTo(s.x + (s.x - (s.px ?? s.x)) * 1.5, s.y + (s.y - (s.py ?? s.y)) * 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSmoke(ctx) {
    if (!this.smoke.length) return;
    ctx.save();
    for (const m of this.smoke) {
      const k = m.age / m.life;
      const r = lerp(m.r0, m.r1, 1 - Math.pow(1 - k, 2));
      const a = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (m.dark ? 0.3 : 0.62) * (1 - k * 0.7);
      if (a <= 0.01) continue;
      const c = m.dark ? '110,100,140' : '200,196,222';
      const g = ctx.createRadialGradient(m.x - r * 0.25, m.y - r * 0.3, r * 0.1, m.x, m.y, r);
      g.addColorStop(0, `rgba(250,250,252,${a})`);
      g.addColorStop(0.45, `rgba(${c},${a * 0.9})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
