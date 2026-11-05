// Robo-dog effects: charge-up particles, twin eye lasers, impact sparks, scorch
// marks on the ground and cooling steam. Logical stage units (540 x 960);
// deterministic (seeded RNG + fixed step) so the video capture is exact.

import { TAU, clamp, lerp, rng } from './util.js';
import { glowRGB } from './dog.js';

export const GROUND_Y = 800;

export class FX {
  constructor() { this.reset(); }

  reset() {
    this.rand = rng(4242);
    this.time = 0;
    this.charge = []; this.sparks = []; this.smoke = []; this.scorch = [];
    this.acc = { charge: 0, spark: 0, smoke: 0, scorch: 0, steam: 0 };
    this.beams = [];
    this.power = 0;
  }

  /** Ray from an eye to the ground or to the edge of the stage. */
  static trace(o, dir, W, H) {
    const dx = Math.cos(dir), dy = Math.sin(dir);
    let t = 2000, hit = false;
    if (dy > 0.01) { const tg = (GROUND_Y - o.y) / dy; if (tg < t) { t = tg; hit = true; } }
    const tx = dx > 0 ? (W + 60 - o.x) / dx : 2000;
    if (tx < t) { t = tx; hit = false; }
    return { x: o.x + dx * t, y: o.y + dy * t, hit };
  }

  step(dt, eyes, pose, W, H) {
    const R = this.rand;
    this.time += dt;
    this.power = lerp(this.power, pose.laser, 1 - Math.exp(-dt * 30));
    const sources = [eyes.near, eyes.far];

    // charge: sparks converge into both eyes
    if (pose.charge > 0.02 && pose.laser < 0.5) {
      this.acc.charge += dt * 90 * pose.charge;
      while (this.acc.charge >= 1) {
        this.acc.charge -= 1;
        const src = sources[R() < 0.65 ? 0 : 1];
        const a = R() * TAU, d = R.range(45, 95);
        this.charge.push({ x: src.x + Math.cos(a) * d, y: src.y + Math.sin(a) * d, tx: src, life: R.range(0.25, 0.45), age: 0, size: R.range(1.2, 2.6) });
      }
    }
    for (const c of this.charge) {
      c.age += dt;
      const k = clamp(c.age / c.life);
      c.px = c.x; c.py = c.y;
      c.x = lerp(c.x, c.tx.x, k * 0.35); c.y = lerp(c.y, c.tx.y, k * 0.35);
    }
    this.charge = this.charge.filter((c) => c.age < c.life);

    // beams
    this.beams = [];
    if (this.power > 0.02) {
      const wob = Math.sin(this.time * 40) * 0.004;
      for (const [i, src] of sources.entries()) {
        const dir = eyes.dir + wob + (i ? -0.012 : 0);
        const end = FX.trace(src, dir, W, H);
        this.beams.push({ o: src, end, dir, far: i === 1 });
        if (end.hit && i === 0) {
          // impact: sparks + smoke + scorch trail
          this.acc.spark += dt * 160 * this.power;
          while (this.acc.spark >= 1) {
            this.acc.spark -= 1;
            const a = -Math.PI / 2 + (R() - 0.5) * 2.2 + (dir > 0 ? -0.4 : 0.4) * 0;
            const sp = R.range(150, 420);
            this.sparks.push({ x: end.x, y: end.y - 2, vx: Math.cos(a) * sp - Math.cos(dir) * 60, vy: Math.sin(a) * sp, age: 0, life: R.range(0.3, 0.75), size: R.range(1.2, 2.8) });
          }
          this.acc.smoke += dt * 22 * this.power;
          while (this.acc.smoke >= 1) {
            this.acc.smoke -= 1;
            this.smoke.push({ x: end.x + R.range(-8, 8), y: end.y - 6, vx: R.range(-20, 20), vy: R.range(-70, -30), age: 0, life: R.range(0.9, 1.6), r0: R.range(6, 10), r1: R.range(22, 36), dark: 1 });
          }
          this.acc.scorch += dt;
          if (this.acc.scorch > 0.012) { this.acc.scorch = 0; this.scorch.push({ x: end.x, age: 0, w: R.range(9, 13) }); }
        }
      }
    }
    // cooling steam from the eyes
    if (pose.steam > 0.02) {
      this.acc.steam += dt * 34 * pose.steam;
      while (this.acc.steam >= 1) {
        this.acc.steam -= 1;
        const src = sources[R() < 0.6 ? 0 : 1];
        this.smoke.push({ x: src.x + R.range(-4, 4), y: src.y - 4, vx: R.range(-25, 25), vy: R.range(-80, -40), age: 0, life: R.range(0.7, 1.3), r0: R.range(4, 7), r1: R.range(14, 24), dark: 0 });
      }
    }
    for (const s of this.sparks) {
      s.age += dt; s.vy += 900 * dt; s.vx *= Math.exp(-dt * 1.5);
      s.px = s.x; s.py = s.y; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.y > GROUND_Y + 4 && s.vy > 0) { s.y = GROUND_Y + 4; s.vy *= -0.35; s.vx *= 0.6; }
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const m of this.smoke) {
      m.age += dt; m.vx *= Math.exp(-dt * 1.2); m.vy *= Math.exp(-dt * 0.8); m.vy -= 12 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
    }
    this.smoke = this.smoke.filter((m) => m.age < m.life);
    for (const sc of this.scorch) sc.age += dt;
    this.scorch = this.scorch.filter((sc) => sc.age < 3.2);
  }

  drawScorch(ctx) {
    for (const sc of this.scorch) {
      const k = sc.age / 3.2;
      const heat = clamp(1 - sc.age / 0.9);
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = '#05060d';
      ctx.beginPath(); ctx.ellipse(sc.x, GROUND_Y + 3, sc.w, 3.2, 0, 0, TAU); ctx.fill();
      if (heat > 0) {
        ctx.globalAlpha = heat;
        ctx.fillStyle = `rgb(255,${(90 + heat * 140) | 0},${(60 + heat * 120) | 0})`;
        ctx.beginPath(); ctx.ellipse(sc.x, GROUND_Y + 3, sc.w * 0.55, 1.6, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawCharge(ctx) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    const [r, g, b] = glowRGB(1);
    for (const c of this.charge) {
      const a = Math.sin(Math.PI * clamp(c.age / c.life));
      ctx.strokeStyle = `rgba(${r},${g | 0},${b | 0},${a})`; ctx.lineWidth = c.size;
      ctx.beginPath(); ctx.moveTo(c.px ?? c.x, c.py ?? c.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.fillStyle = `rgba(255,220,230,${a})`; ctx.beginPath(); ctx.arc(c.x, c.y, c.size * 0.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawBeams(ctx) {
    if (!this.beams.length) return;
    const P = this.power;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const bm of this.beams) {
      const { o, end } = bm;
      const fl = 0.85 + 0.15 * Math.sin(this.time * 63 + (bm.far ? 2 : 0)) * Math.sin(this.time * 37);
      const w = (bm.far ? 0.7 : 1) * P * fl;
      const line = (lw, col) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(end.x, end.y); ctx.stroke(); };
      line(26 * w, 'rgba(255,40,80,0.16)');
      line(14 * w, 'rgba(255,50,90,0.35)');
      line(7 * w, 'rgba(255,90,120,0.8)');
      line(3 * w, 'rgba(255,235,240,1)');
      // ripples travelling along the beam
      const len = Math.hypot(end.x - o.x, end.y - o.y);
      for (let i = 0; i < 6; i++) {
        const u = ((this.time * 2.6 + i / 6) % 1);
        const x = lerp(o.x, end.x, u), y = lerp(o.y, end.y, u);
        ctx.fillStyle = `rgba(255,170,190,${0.5 * w * (1 - u)})`;
        ctx.beginPath(); ctx.arc(x, y, 4.5 * w + 1, 0, TAU); ctx.fill();
      }
      // eye flare
      let g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, 34 * w + 4);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * w})`); g.addColorStop(0.3, `rgba(255,70,110,${0.6 * w})`); g.addColorStop(1, 'rgba(255,40,80,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, 34 * w + 4, 0, TAU); ctx.fill();
      // impact flare
      if (end.hit && len > 1) {
        const rr = (bm.far ? 26 : 42) * w * (0.85 + 0.3 * Math.sin(this.time * 47));
        g = ctx.createRadialGradient(end.x, end.y, 1, end.x, end.y, rr);
        g.addColorStop(0, `rgba(255,255,255,${w})`); g.addColorStop(0.3, `rgba(255,120,90,${0.8 * w})`); g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(end.x, end.y, rr, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  drawSparks(ctx) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const k = s.age / s.life;
      ctx.strokeStyle = k < 0.35 ? `rgba(255,240,220,${1 - k})` : `rgba(255,${(150 - k * 90) | 0},${(90 - k * 50) | 0},${1 - k})`;
      ctx.lineWidth = s.size * (1 - k * 0.5);
      ctx.beginPath(); ctx.moveTo(s.px ?? s.x, s.py ?? s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.restore();
  }

  drawSmoke(ctx) {
    for (const m of this.smoke) {
      const k = m.age / m.life;
      const r = lerp(m.r0, m.r1, 1 - Math.pow(1 - k, 2));
      const a = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (m.dark ? 0.4 : 0.6) * (1 - k * 0.7);
      if (a < 0.01) continue;
      const c = m.dark ? '70,74,96' : '214,222,240';
      const g = ctx.createRadialGradient(m.x - r * 0.25, m.y - r * 0.3, r * 0.1, m.x, m.y, r);
      g.addColorStop(0, m.dark ? `rgba(130,135,160,${a})` : `rgba(250,252,255,${a})`);
      g.addColorStop(0.5, `rgba(${c},${a * 0.85})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
    }
  }
}
