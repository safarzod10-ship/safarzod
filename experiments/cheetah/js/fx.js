// Robo-cheetah effects: energy claw slashes, sparks, dust kicks, speed lines,
// roar rings. Logical stage units; deterministic (seeded RNG, fixed step).

import { TAU, clamp, lerp, rng } from './util.js';

export const GROUND_Y = 800;

export class FX {
  constructor() { this.reset(); }
  reset() {
    this.rand = rng(909);
    this.time = 0;
    this.slashes = []; this.sparks = []; this.dust = []; this.lines = []; this.rings = []; this.waves = [];
    this.shake = 0;
    this.flash = 0;
    this.lineAcc = 0; this.ringAcc = 0;
  }

  /** Three parallel energy claw marks raking down-forward in front of the paw. */
  slash(x, y, flip = false) {
    const R = this.rand;
    for (let i = 0; i < 3; i++) {
      this.slashes.push({ x: x + 104 + i * 26, y: y - 245 + i * 10, len: 260 - Math.abs(i - 1) * 30, ang: (flip ? 1.38 : 1.48) + (i - 1) * 0.05, age: -i * 0.03, life: 0.7, bend: R.range(16, 24) });
    }
    for (let i = 0; i < 46; i++) {
      const a = R.range(-2.6, 0.4), sp = R.range(120, 520);
      this.sparks.push({ x: x + 120 + R.range(-30, 30), y: y - 40 + R.range(-80, 40), vx: Math.cos(a) * sp + 80, vy: Math.sin(a) * sp, age: 0, life: R.range(0.25, 0.6), size: R.range(1.2, 2.6) });
    }
    this.flash = 1;
    this.shake = 1;
    this.waves.push({ x: x + 120, age: 0 });
  }
  kick(x, n = 18, dir = 1) {
    const R = this.rand;
    for (let i = 0; i < n; i++) {
      this.dust.push({ x: x + R.range(-24, 24), y: GROUND_Y - 4, vx: R.range(-90, 90) - dir * R.range(40, 160), vy: R.range(-110, -30), age: 0, life: R.range(0.5, 0.9), r0: R.range(4, 7), r1: R.range(14, 24) });
    }
  }

  step(dt, a, pose, speed) {
    const R = this.rand;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.shake = Math.max(0, this.shake - dt * 4);
    for (const w of this.waves) w.age += dt;
    this.waves = this.waves.filter((w) => w.age < 0.5);
    for (const s of this.slashes) s.age += dt;
    this.slashes = this.slashes.filter((s) => s.age < s.life);
    for (const s of this.sparks) { s.age += dt; s.vy += 700 * dt; s.vx *= Math.exp(-dt * 2); s.px = s.x; s.py = s.y; s.x += s.vx * dt; s.y += s.vy * dt; }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const d of this.dust) { d.age += dt; d.vx *= Math.exp(-dt * 2.5); d.vy *= Math.exp(-dt * 2); d.vy += 30 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
    this.dust = this.dust.filter((d) => d.age < d.life);
    // speed lines while moving fast
    if (Math.abs(speed) > 250) {
      this.lineAcc += dt * 70;
      while (this.lineAcc >= 1) {
        this.lineAcc -= 1;
        this.lines.push({ x: a.root.x + R.range(-60, 140), y: a.root.y - R.range(20, 200), len: R.range(50, 140), dir: Math.sign(speed), age: 0, life: R.range(0.18, 0.32) });
      }
    }
    for (const l of this.lines) l.age += dt;
    this.lines = this.lines.filter((l) => l.age < l.life);
    // roar rings from the mouth
    if (pose.shake > 0.5 && pose.jaw > 0.6) {
      this.ringAcc += dt;
      if (this.ringAcc > 0.13) { this.ringAcc = 0; this.rings.push({ x: a.mouth[0], y: a.mouth[1], age: 0 }); }
    }
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.5);
  }

  drawBack(ctx) {
    // speed lines + dust behind the character
    ctx.save(); ctx.lineCap = 'round';
    for (const l of this.lines) {
      const k = l.age / l.life;
      ctx.strokeStyle = `rgba(200,240,255,${0.55 * (1 - k)})`; ctx.lineWidth = 2.2 * (1 - k) + 0.6;
      const x0 = l.x - l.dir * k * 60;
      ctx.beginPath(); ctx.moveTo(x0, l.y); ctx.lineTo(x0 - l.dir * l.len, l.y); ctx.stroke();
    }
    ctx.restore();
    for (const d of this.dust) {
      const k = d.age / d.life, r = lerp(d.r0, d.r1, 1 - Math.pow(1 - k, 2));
      const a = 0.45 * (1 - k);
      const g = ctx.createRadialGradient(d.x, d.y, 1, d.x, d.y, r);
      g.addColorStop(0, `rgba(170,160,190,${a})`); g.addColorStop(1, 'rgba(170,160,190,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, TAU); ctx.fill();
    }
  }

  drawFront(ctx, W, H) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    // claw slashes: a bright tapered stroke wipes in, then fades
    for (const s of this.slashes) {
      if (s.age < 0) continue;
      const wipe = clamp(s.age / 0.07), fade = 1 - clamp((s.age - 0.12) / (s.life - 0.12));
      const dx = Math.cos(s.ang), dy = Math.sin(s.ang), nx = -dy, ny = dx;
      const N = 14;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * wipe;
        const b = Math.sin(u * Math.PI) * s.bend;
        pts.push([s.x + dx * s.len * u + nx * b, s.y + dy * s.len * u + ny * b, Math.sin(Math.PI * (i / N))]);
      }
      for (const [w, col] of [[38, `rgba(60,200,255,${0.22 * fade})`], [18, `rgba(120,235,255,${0.65 * fade})`], [6.5, `rgba(245,255,255,${fade})`]]) {
        ctx.beginPath();
        pts.forEach(([x, y, t], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + nx * w * t * 0.5, y + ny * w * t * 0.5));
        for (let i = pts.length - 1; i >= 0; i--) { const [x, y, t] = pts[i]; ctx.lineTo(x - nx * w * t * 0.5, y - ny * w * t * 0.5); }
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      }
    }
    for (const s of this.sparks) {
      const k = s.age / s.life;
      ctx.strokeStyle = k < 0.35 ? `rgba(235,255,255,${1 - k})` : `rgba(120,${(230 - k * 60) | 0},255,${1 - k})`;
      ctx.lineWidth = s.size * (1 - k * 0.5);
      ctx.beginPath(); ctx.moveTo(s.px ?? s.x, s.py ?? s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.restore();
    // ground shockwave under each strike
    ctx.save(); ctx.lineCap = 'round';
    for (const w of this.waves) {
      const k = w.age / 0.5;
      ctx.strokeStyle = `rgba(140,235,255,${0.8 * (1 - k)})`; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(w.x, GROUND_Y, 20 + k * 150, 4 + k * 16, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // roar rings
    ctx.save(); ctx.lineCap = 'round';
    for (const r of this.rings) {
      const k = r.age / 0.5;
      ctx.strokeStyle = `rgba(255,236,190,${0.7 * (1 - k)})`; ctx.lineWidth = 4.5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x - 14, r.y, 20 + k * 130, -0.7, 0.5); ctx.stroke();
    }
    ctx.restore();
    if (this.flash > 0.01) { ctx.fillStyle = `rgba(150,230,255,${0.12 * this.flash})`; ctx.fillRect(0, 0, W, H); }
  }
}
