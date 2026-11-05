// Procedurally drawn, skeletal-rigged cartoon ROBO-DOG (pet #2).
//
// Dog space: origin on the ground under the body, x to the right (the dog faces
// right), y down, 1 unit ~ 1 px at scale 1. Same rendering language as the robo-dragon:
// ink outlines drawn behind fills, armour seams, rivets, steel joint discs, lens eyes.
//
// Rig:
//   body   : rump -> hips -> belly -> chest -> neck (2) as ONE armoured tube
//   tail   : 7-segment antenna tail with a glowing bulb, wags (spring-driven amplitude)
//   legs   : 4 legs, 2-bone IK, paws planted while the dog crouches
//   head   : round cranium, muzzle, hinged jaw (bark / pant), tongue, nose,
//            near + far lens eyes (both fire lasers), brow plates, spring ears
//   extras : collar with a glowing tag, back battery panel (charge indicator)

import { DEG, TAU, Mat, clamp, lerp, wobble, splinePath, sampleSpline, inkFill, ik2, Spring } from './util.js';

const C = {
  ink: '#0b1530',
  body: '#3f86ee',
  bodyLight: '#98c6ff',
  bodyDark: '#1f4aa6',
  spec: '#eef6ff',
  far: '#2f6cd0',
  farDark: '#1b3d86',
  belly: '#dfe6f4',
  bellyDark: '#9ba8c6',
  plate: '#7283a8',
  steel: '#6a7390',
  steelLight: '#c9d0e4',
  steelDark: '#39415e',
  accent: '#facc15',
  accentDark: '#c58a0c',
  nose: '#141a2e',
  tongue: '#ff7fa8',
  tongueDark: '#d84c7d',
  tooth: '#f4f7ff',
  eyeGlass: '#0a1020',
};
const INK_W = 3.2;
// glow colour: friendly cyan -> laser red
export const glowRGB = (k) => [lerp(94, 255, k), lerp(205, 52, k), lerp(255, 78, k)];

export class Dog {
  constructor() {
    this.time = 0;
    this.pose = null;
    this.sHead = new Spring(0, 2.8, 0.42);
    this.sTilt = new Spring(0, 2.4, 0.45);
    this.sEars = new Spring(0, 3.4, 0.3);   // floppy overshoot
    this.sCrouch = new Spring(0, 2.2, 0.7);
    this.sJaw = new Spring(0, 7.0, 0.55);
    this.sWag = new Spring(1, 1.2, 0.8);
    this.blink = 0;
    this.nextBlink = 1.4;
    this.rig = null;
  }

  update(dt, pose) {
    this.time += dt;
    this.pose = pose;
    const t = this.time;
    const wig = pose.wiggle;
    this.head = this.sHead.step(pose.head, dt);
    this.tilt = this.sTilt.step(pose.tilt, dt);
    this.ears = this.sEars.step(pose.ears + Math.sin(t * TAU * 7.5) * wig * 1.4, dt);
    this.crouch = this.sCrouch.step(pose.crouch, dt);
    this.wagAmp = this.sWag.step(pose.wag, dt);
    // idle panting while relaxed
    const relaxed = clamp(1 - pose.angry * 1.5 - pose.charge * 2);
    this.pant = relaxed;
    const pantJaw = relaxed * (0.16 + 0.05 * Math.sin(t * TAU * 2.4));
    this.jaw = clamp(this.sJaw.step(Math.max(pose.jaw, pantJaw), dt), 0, 1.05);
    if (t > this.nextBlink) {
      const bt = t - this.nextBlink;
      this.blink = bt < 0.08 ? bt / 0.08 : bt < 0.18 ? 1 - (bt - 0.08) / 0.1 : 0;
      if (bt >= 0.18) { this.blink = 0; this.nextBlink = t + 2.1 + ((t * 5.37) % 1.6); }
    }
    if (pose.charge > 0.05 || pose.laser > 0.05) this.blink = 0;
    this.rig = this.buildRig();
  }

  buildRig() {
    const t = this.time, p = this.pose;
    const c = this.crouch;
    const breath = Math.sin(t * TAU / 2.2);
    const wig = p.wiggle;
    const shake = p.shake;
    const jit = (k, f = 41) => wobble(t * f, k) * shake;
    const wx = Math.sin(t * TAU * 7.5) * wig;

    const H = { x: -62 + jit(1), y: -98 - c * 3 + jit(2) };
    const M = { x: -8 + wx * 3, y: -101 + c * 5 + breath * 0.6 };
    const Cc = { x: 44 + c * 3 + wx * 4 + jit(3) * 1.4, y: -100 + c * 15 - breath * 1.6 + jit(4) * 1.4 };
    const puff = 1 + breath * 0.025;
    const rump0 = { x: H.x - 40, y: H.y - 2 }, rump1 = { x: H.x - 27, y: H.y - 2 };
    // neck
    const nA = [-58 + c * 22 + wx * 6, -72 + c * 26 + wx * 8].map((a) => a * DEG);
    const N1 = { x: Cc.x + Math.cos(nA[0]) * 26, y: Cc.y + Math.sin(nA[0]) * 26 };
    const N2 = { x: N1.x + Math.cos(nA[1]) * 22, y: N1.y + Math.sin(nA[1]) * 22 };
    const spine = [
      { x: rump0.x, y: rump0.y, wt: 12, wb: 13, bf: 0.45 },
      { x: rump1.x, y: rump1.y, wt: 31, wb: 33, bf: 0.45 },
      { x: H.x, y: H.y, wt: 40 * puff, wb: 41 * puff, bf: 0.45 },
      { x: M.x, y: M.y, wt: 37 * puff, wb: 46 * puff, bf: 0.42 },
      { x: Cc.x, y: Cc.y, wt: 40 * puff, wb: 50 * puff, bf: 0.62 },
      { x: N1.x, y: N1.y, wt: 31, wb: 34, bf: 0.66 },
      { x: N2.x, y: N2.y, wt: 27, wb: 29, bf: 0.66 },
    ];

    // head
    const nod = Math.sin(t * TAU / 2.2 + 0.7) * 1.4 + wobble(t * 0.8, 5) * 1.6;
    const headAng = (this.head + this.tilt + nod + wx * 17 + jit(20, 47) * 2.5) * DEG;
    const headMat = new Mat().translate(N2.x + jit(21) * 1.6, N2.y + jit(22) * 1.6).rotate(headAng).scale(1.1);
    const jawAng = this.jaw * 34 * DEG;

    // tail: antenna segments from the top of the rump
    const tailBase = { x: rump1.x + 4, y: rump1.y - 26 };
    const tail = [tailBase];
    let ta = -128 * DEG;
    for (let i = 0; i < 7; i++) {
      const wag = Math.sin(t * TAU * 4.2 - i * 0.55) * 20 * this.wagAmp * (0.4 + i * 0.12) + wx * 12;
      ta += (i === 0 ? 0 : 7) * DEG + wag * DEG * 0.35;
      const prev = tail[tail.length - 1];
      tail.push({ x: prev.x + Math.cos(ta + (i === 0 ? wag * DEG * 0.6 : 0)) * 10, y: prev.y + Math.sin(ta + (i === 0 ? wag * DEG * 0.6 : 0)) * 10 });
    }

    const legs = {
      hindNear: { hip: { x: H.x + 6, y: H.y + 16 }, hock: { x: -84, y: -34 }, paw: { x: -72, y: -9 } },
      hindFar: { hip: { x: H.x + 22, y: H.y + 12 }, hock: { x: -62, y: -36 }, paw: { x: -50, y: -10 } },
      frontNear: { hip: { x: Cc.x - 4, y: Cc.y + 22 }, hock: { x: 60, y: -21 }, paw: { x: 68, y: -9 } },
      frontFar: { hip: { x: Cc.x + 10, y: Cc.y + 18 }, hock: { x: 82, y: -23 }, paw: { x: 90, y: -10 } },
    };
    return { spine, headMat, headAng, jawAng, tail, legs, H, M, Cc, N1, N2 };
  }

  // =====================================================================
  draw(ctx, base, k) {
    this.k = k;
    const R = this.rig;
    this.drawTail(ctx, base);
    this.drawHindLeg(ctx, base, R.legs.hindFar, true);
    this.drawFrontLeg(ctx, base, R.legs.frontFar, true);
    this.drawBody(ctx, base);
    this.drawHindLeg(ctx, base, R.legs.hindNear, false);
    this.drawFrontLeg(ctx, base, R.legs.frontNear, false);
    this.drawHead(ctx, base);
  }

  blur(px) { return `blur(${(px * this.k).toFixed(2)}px)`; }
  glow() { return glowRGB(clamp(this.pose.charge + this.pose.angry * 0.25)); }

  joint(ctx, x, y, r, far = false) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, far ? '#8c95ae' : C.steelLight); g.addColorStop(1, far ? C.steelDark : C.steel);
    inkFill(ctx, (c) => c.arc(x, y, r, 0, TAU), g, C.ink, 1.6);
    ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, TAU); ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fillStyle = C.steelDark; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.2, 0, TAU); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
  }
  rivet(ctx, x, y, r = 2) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = C.bodyDark; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, TAU); ctx.fillStyle = C.spec; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  }
  capsule(c, ax, ay, ra, bx, by, rb) {
    const d = Math.hypot(bx - ax, by - ay) || 1e-3;
    const f = Math.atan2(by - ay, bx - ax);
    const del = Math.asin(clamp((ra - rb) / d, -1, 1));
    c.moveTo(ax + Math.cos(f + Math.PI / 2 - del) * ra, ay + Math.sin(f + Math.PI / 2 - del) * ra);
    c.arc(ax, ay, ra, f + Math.PI / 2 - del, f + 1.5 * Math.PI + del);
    c.arc(bx, by, rb, f - Math.PI / 2 + del, f + Math.PI / 2 - del);
    c.closePath();
  }
  limbGroup(ctx, pieces, fill, shadeFn) {
    ctx.lineJoin = 'round';
    for (const pc of pieces) { ctx.beginPath(); pc(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = INK_W * 2; ctx.stroke(); }
    for (const pc of pieces) { ctx.beginPath(); pc(ctx); ctx.fillStyle = fill; ctx.fill(); }
    if (shadeFn) { ctx.save(); ctx.beginPath(); for (const pc of pieces) pc(ctx); ctx.clip(); shadeFn(); ctx.restore(); }
  }

  // ---------------------------------------------------------------- tail
  drawTail(ctx, base) {
    base.set(ctx);
    const pts = this.rig.tail;
    const n = pts.length;
    const pieces = [];
    for (let i = 0; i < n - 1; i++) {
      const r0 = lerp(9, 4, i / (n - 1)), r1 = lerp(9, 4, (i + 1) / (n - 1));
      pieces.push((c) => this.capsule(c, pts[i].x, pts[i].y, r0, pts[i + 1].x, pts[i + 1].y, r1));
    }
    this.limbGroup(ctx, pieces, C.body, () => {
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x - 2, q.y - 2));
      ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.55; ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;
    });
    for (let i = 1; i < n - 1; i += 2) {
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, lerp(8, 4, i / n), 0, TAU);
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // glowing bulb
    const tip = pts[n - 1];
    const [r, g, b] = this.glow();
    const pulse = 0.7 + 0.3 * Math.sin(this.time * (4 + this.pose.charge * 18));
    inkFill(ctx, (c) => c.arc(tip.x, tip.y, 7.5, 0, TAU), C.steel, C.ink, 1.6);
    const bg = ctx.createRadialGradient(tip.x - 1.5, tip.y - 1.5, 0.5, tip.x, tip.y, 5.5);
    bg.addColorStop(0, '#fff'); bg.addColorStop(0.45, `rgb(${r | 0},${g | 0},${b | 0})`); bg.addColorStop(1, `rgb(${r * 0.4 | 0},${g * 0.4 | 0},${b * 0.4 | 0})`);
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 5.5, 0, TAU); ctx.fillStyle = bg; ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const h = ctx.createRadialGradient(tip.x, tip.y, 2, tip.x, tip.y, 22);
    h.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.55 * pulse})`); h.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(tip.x, tip.y, 22, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- body
  drawBody(ctx, base) {
    const R = this.rig, p = this.pose;
    const pts = sampleSpline(R.spine, 8);
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const q = pts[i];
      q.tx = dx / l; q.ty = dy / l; q.nx = dy / l; q.ny = -dx / l;
      if (i > 0) s += Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y);
      q.s = s;
    }
    const total = s;
    const D = (q, o) => [q.x + q.nx * o, q.y + q.ny * o];
    const V = (q, o) => [q.x - q.nx * o, q.y - q.ny * o];
    const outline = (c) => {
      // rounded rump cap
      const q0 = pts[0];
      c.moveTo(...V(q0, q0.wb));
      c.arc(q0.x, q0.y, (q0.wt + q0.wb) / 2, Math.atan2(-q0.ny, -q0.nx), Math.atan2(q0.ny, q0.nx), false);
      for (const q of pts) c.lineTo(...D(q, q.wt));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(...V(pts[i], pts[i].wb));
      c.closePath();
    };
    base.set(ctx);
    inkFill(ctx, outline, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); outline(ctx); ctx.clip();
    ctx.filter = this.blur(5);
    ctx.beginPath();
    for (const q of pts) ctx.lineTo(...V(q, q.wb * (1 - q.bf) - 1));
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; ctx.lineTo(...V(q, q.wb * (1 - q.bf) - q.wb * 0.45)); }
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.55; ctx.fill();
    ctx.beginPath();
    for (const q of pts) ctx.lineTo(...D(q, q.wt * 0.85));
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; ctx.lineTo(...D(q, q.wt * 0.4)); }
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.75; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // specular streak
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...D(q, q.wt * 0.62)));
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.8; ctx.stroke(); ctx.globalAlpha = 1;
    // armour seams + rivets
    let next = 26;
    for (const q of pts) {
      if (q.s < next || q.s > total - 30) continue;
      const [x1, y1] = D(q, q.wt * 1.1), [x2, y2] = V(q, q.wb * (1 - q.bf));
      const bend = -(q.wt + q.wb) * 0.12;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 + q.tx * bend, (y1 + y2) / 2 + q.ty * bend, x2, y2);
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.8; ctx.stroke(); ctx.globalAlpha = 1;
      const [rx, ry] = D(q, q.wt * 0.3);
      this.rivet(ctx, rx - q.tx * 6, ry - q.ty * 6, 2);
      next = q.s + 34;
    }
    // silver belly + chest bib
    const bellyPath = (c) => {
      pts.forEach((q, i) => (i ? c.lineTo : c.moveTo).call(c, ...V(q, q.wb * (1 - q.bf))));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(...V(pts[i], pts[i].wb * 1.4 + 4));
      c.closePath();
    };
    ctx.beginPath(); bellyPath(ctx); ctx.fillStyle = C.belly; ctx.fill();
    ctx.filter = this.blur(3);
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(q, q.wb * 0.82)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(...V(pts[i], pts[i].wb * 1.3));
    ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.8; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.strokeStyle = C.plate; ctx.lineWidth = 1.6;
    let np = 10;
    for (const q of pts) {
      if (q.s < np || q.s > total - 6) continue;
      const [x1, y1] = V(q, q.wb * (1 - q.bf) + 1), [x2, y2] = V(q, q.wb * 1.05);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 + q.tx * 4, (y1 + y2) / 2 + q.ty * 4, x2, y2); ctx.stroke();
      np = q.s + 13;
    }
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(q, q.wb * (1 - q.bf))));
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();

    // back battery panel: lights show the laser charge
    const mi = pts.findIndex((q) => q.s > total * 0.42);
    const q = pts[mi];
    const [bx, by] = D(q, q.wt * 0.5);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(q.ty, q.tx));
    inkFill(ctx, (c) => c.roundRect(-22, -6, 44, 12, 5), C.steelDark, C.ink, 1.6);
    const lit = p.charge > 0.02 ? Math.ceil(p.charge * 3 - 0.001) : 1 + (Math.sin(this.time * 2.5) > 0 ? 1 : 0);
    const [r, g, b] = this.glow();
    for (let i = 0; i < 3; i++) {
      const on = i < lit;
      ctx.beginPath(); ctx.roundRect(-18 + i * 13, -3, 10, 6, 2.5);
      ctx.fillStyle = on ? `rgb(${r | 0},${g | 0},${b | 0})` : '#1b2238'; ctx.fill();
      if (on) { ctx.beginPath(); ctx.roundRect(-17 + i * 13, -2.4, 5, 1.8, 1); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill(); }
    }
    ctx.restore();

    // collar with a glowing tag
    const ci = pts.findIndex((q2) => q2.s > total - 40);
    const cq = pts[ci];
    const a = D(cq, cq.wt * 1.06), bb = V(cq, cq.wb * 1.06);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...a); ctx.quadraticCurveTo((a[0] + bb[0]) / 2 + cq.tx * 7, (a[1] + bb[1]) / 2 + cq.ty * 7, ...bb);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 15; ctx.stroke();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a[0] - cq.tx * 2, a[1] - cq.ty * 2 - 1); ctx.quadraticCurveTo((a[0] + bb[0]) / 2 + cq.tx * 5, (a[1] + bb[1]) / 2 + cq.ty * 5 - 1, bb[0] - cq.tx * 2, bb[1] - cq.ty * 2 - 1); ctx.stroke();
    for (const f of [0.3, 0.62]) this.rivet(ctx, lerp(a[0], bb[0], f) + cq.tx * 5, lerp(a[1], bb[1], f) + cq.ty * 5, 1.6);
    // tag (hex gem) hanging below the collar
    const swing = Math.sin(this.time * 3.1) * 0.25 + this.pose.wiggle * Math.sin(this.time * TAU * 7.5) * 0.6;
    ctx.save(); ctx.translate(bb[0] + cq.tx * 4, bb[1] + cq.ty * 4); ctx.rotate(swing);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 6); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    const hex = (c) => { for (let i = 0; i < 6; i++) { const an = i / 6 * TAU + Math.PI / 6; (i ? c.lineTo : c.moveTo).call(c, Math.cos(an) * 8, 14 + Math.sin(an) * 8); } c.closePath(); };
    const tg = ctx.createLinearGradient(-6, 6, 6, 22);
    tg.addColorStop(0, '#c9f2ff'); tg.addColorStop(0.5, `rgb(${r | 0},${g | 0},${b | 0})`); tg.addColorStop(1, `rgb(${r * 0.45 | 0},${g * 0.45 | 0},${b * 0.45 | 0})`);
    inkFill(ctx, hex, tg, C.ink, 1.6);
    ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(0, 7.5); ctx.lineTo(4, 10); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- legs
  paw(c, x, y, far) {
    c.moveTo(x - 17, y + 8);
    c.bezierCurveTo(x - 20, y - 4, x - 12, y - 11, x - 2, y - 11);
    c.bezierCurveTo(x + 12, y - 11, x + 20, y - 4, x + 20, y + 4);
    c.bezierCurveTo(x + 20, y + 9, x + 14, y + 9, x + 10, y + 9);
    c.lineTo(x - 14, y + 9);
    c.closePath();
  }
  pawDetails(ctx, x, y, far) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.7; ctx.globalAlpha = far ? 0.5 : 0.75;
    for (const dx of [5, 12]) { ctx.beginPath(); ctx.moveTo(x + dx, y + 8); ctx.quadraticCurveTo(x + dx - 1, y + 2, x + dx - 4, y - 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.roundRect(x - 14, y + 6, 32, 4, 2); ctx.fillStyle = far ? C.steelDark : C.steel; ctx.fill();
  }
  drawHindLeg(ctx, base, L, far) {
    base.set(ctx);
    const { hip, hock, paw } = L;
    const [kx, ky] = ik2(hip.x, hip.y, hock.x, hock.y, 48, 44, -1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ky - hip.y, kx - hip.x);
    const thigh = (c) => {
      c.save(); c.translate(lerp(hip.x, kx, 0.4), lerp(hip.y, ky, 0.4)); c.rotate(ang);
      c.ellipse(0, 0, 36, 27, 0, 0, TAU);
      c.restore();
    };
    const shin = (c) => this.capsule(c, kx, ky, 13, hock.x, hock.y, 9);
    const meta = (c) => this.capsule(c, hock.x, hock.y, 9, paw.x - 4, paw.y - 4, 9);
    const pw = (c) => this.paw(c, paw.x, paw.y, far);
    this.limbGroup(ctx, [meta, pw, shin, thigh], fill, () => {
      ctx.filter = this.blur(4);
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.5) - 8, lerp(hip.y, ky, 0.5) + 22, 32, 12, ang, 0, TAU); ctx.fill();
      if (!far) { ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.35) - 4, lerp(hip.y, ky, 0.35) - 12, 20, 9, ang - 0.4, 0, TAU); ctx.fill(); }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    });
    this.pawDetails(ctx, paw.x, paw.y, far);
    this.joint(ctx, lerp(hip.x, kx, 0.3), lerp(hip.y, ky, 0.3), 11, far);
    this.joint(ctx, kx, ky, 7.5, far);
    this.joint(ctx, hock.x, hock.y, 5.5, far);
  }
  drawFrontLeg(ctx, base, L, far) {
    base.set(ctx);
    const { hip: sh, hock: wr, paw } = L;
    const [ex, ey] = ik2(sh.x, sh.y, wr.x, wr.y, 42, 40, 1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ey - sh.y, ex - sh.x);
    const upper = (c) => { c.save(); c.translate(lerp(sh.x, ex, 0.42), lerp(sh.y, ey, 0.42)); c.rotate(ang); c.ellipse(0, 0, 28, 19, 0, 0, TAU); c.restore(); };
    const fore = (c) => this.capsule(c, ex, ey, 12, wr.x, wr.y, 10);
    const pw = (c) => this.paw(c, paw.x, paw.y, far);
    this.limbGroup(ctx, [pw, fore, upper], fill, () => {
      ctx.filter = this.blur(4);
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(ex - 7, (ey + wr.y) / 2, 8, 24, 0.1, 0, TAU); ctx.fill();
      if (!far) { ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.ellipse(lerp(sh.x, ex, 0.35) + 4, lerp(sh.y, ey, 0.35) - 8, 14, 7, ang - 0.3, 0, TAU); ctx.fill(); }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    });
    ctx.beginPath(); ctx.moveTo(lerp(ex, wr.x, 0.25) + 5, lerp(ey, wr.y, 0.25)); ctx.lineTo(lerp(ex, wr.x, 0.8) + 4, lerp(ey, wr.y, 0.8));
    ctx.strokeStyle = C.spec; ctx.globalAlpha = far ? 0.2 : 0.55; ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;
    this.pawDetails(ctx, paw.x, paw.y, far);
    this.joint(ctx, lerp(sh.x, ex, 0.3), lerp(sh.y, ey, 0.3), 10, far);
    this.joint(ctx, ex, ey, 7, far);
    this.joint(ctx, wr.x, wr.y, 5.5, far);
  }

  // ---------------------------------------------------------------- head
  ear(ctx, x, y, ang, far) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const shape = (c) => splinePath(c, [[-15, 6], [-21, -22], [-17, -50], [-8, -72, 1], [6, -48], [16, -20], [15, 6]]);
    inkFill(ctx, shape, far ? C.far : C.body, C.ink, INK_W * 0.9);
    ctx.save(); ctx.beginPath(); shape(ctx); ctx.clip();
    ctx.beginPath(); splinePath(ctx, [[-9, 0], [-13, -24], [-10, -50], [-7, -62, 1], [2, -44], [8, -18], [8, 0]]);
    ctx.fillStyle = far ? C.steelDark : C.steel; ctx.fill();
    const [r, g, b] = this.glow();
    ctx.beginPath(); ctx.moveTo(-3, -6); ctx.quadraticCurveTo(-6, -30, -6, -54);
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${far ? 0.5 : 0.9})`; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, -20); ctx.quadraticCurveTo(-16, -48, -9, -66);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = far ? 0.25 : 0.6; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();
    this.joint(ctx, x, y, far ? 6 : 7, far);
  }

  drawHead(ctx, base) {
    const R = this.rig, p = this.pose;
    const hm = base.mul(R.headMat);
    const hinge = [16, 20];
    const jm = hm.translate(hinge[0], hinge[1]).rotate(R.jawAng).translate(-hinge[0], -hinge[1]);
    const S = Math.hypot(hm.a, hm.b);
    this.headWorld = hm;
    const angry = p.angry;
    // ears: rest tilted back, perk = upright, -1 = flat back
    const e = this.ears;
    const earAng = (e >= 0 ? lerp(-20, -2, e) : lerp(-20, -78, -e)) * DEG;

    hm.set(ctx);
    this.ear(ctx, 14, -64, earAng + 0.12 - this.tilt * 0.6 * DEG, true);

    // mouth interior (jaw open): throat wall + far teeth; gap shows the background
    const upperLip = [[24, 16], [46, 14], [70, 12], [92, 8], [100, 5]];
    const lowerTop = [[94, 8], [70, 12], [46, 14], [24, 16]];
    if (R.jawAng > 0.01) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cav = (c) => { c.moveTo(...hm.apply(10, 20)); upperLip.forEach(([x, y]) => c.lineTo(...hm.apply(x, y))); lowerTop.forEach(([x, y]) => c.lineTo(...jm.apply(x, y))); c.closePath(); };
      ctx.beginPath(); cav(ctx); ctx.clip();
      const A = hm.apply(56, 13), B = jm.apply(48, 15), H0 = hm.apply(10, 20);
      const ctl = [lerp((A[0] + B[0]) / 2, H0[0], 0.3), lerp((A[1] + B[1]) / 2, H0[1], 0.3)];
      ctx.beginPath(); ctx.moveTo(...H0); [[24, 16], [46, 14]].forEach(([x, y]) => ctx.lineTo(...hm.apply(x, y)));
      ctx.lineTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]); [[46, 14], [24, 16]].forEach(([x, y]) => ctx.lineTo(...jm.apply(x, y))); ctx.closePath();
      const wg = ctx.createLinearGradient(...hm.apply(14, 22), ...hm.apply(56, 22));
      wg.addColorStop(0, '#202a44'); wg.addColorStop(1, '#5b6888');
      ctx.fillStyle = wg; ctx.fill();
      ctx.beginPath(); ctx.moveTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2 * S; ctx.stroke();
      hm.set(ctx);
      ctx.beginPath(); upperLip.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, y - 2));
      for (let i = upperLip.length - 1; i >= 0; i--) ctx.lineTo(upperLip[i][0] - 2, upperLip[i][1] + 6);
      ctx.closePath(); ctx.fillStyle = '#8a97b5'; ctx.fill();
      for (const x of [52, 66, 80]) this.tooth(ctx, x - 3, 18 - (x - 24) * 0.06, 6, 1, true);
      ctx.restore();
    }

    // lower jaw
    jm.set(ctx);
    const jawShape = (c) => splinePath(c, [[22, 15, 1], [60, 13], [92, 8, 1], [98, 13], [92, 23], [66, 29], [38, 31], [16, 29], [2, 22], [6, 16]]);
    inkFill(ctx, jawShape, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); jawShape(ctx); ctx.clip();
    ctx.beginPath(); splinePath(ctx, [[-10, 24], [40, 25], [80, 21], [104, 16], [104, 50], [-10, 50]]); ctx.fillStyle = C.belly; ctx.fill();
    ctx.beginPath(); splinePath(ctx, [[-10, 24], [40, 25], [80, 21], [104, 16]], false); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    this.tooth(ctx, 82, 10, 7, -1);

    // tongue (lolls out while panting, retracts when the dog gets serious)
    const tout = clamp(this.pant * 1.2) * clamp(this.jaw / 0.12);
    if (tout > 0.02) {
      const inP = [[26, 14], [50, 10], [76, 8], [86, 9], [88, 12], [86, 14], [84, 14], [80, 13], [70, 13], [50, 14], [30, 15]];
      const outP = [[26, 14], [52, 8], [82, 6], [100, 9], [108, 20], [106, 36], [98, 42], [91, 36], [90, 22], [70, 16], [40, 16]];
      const lick = Math.sin(this.time * TAU * 2.4) * 2;
      const tp = inP.map((q, i) => [lerp(q[0], outP[i][0], tout), lerp(q[1], outP[i][1] + (i >= 4 && i <= 7 ? lick : 0), tout)]);
      const tg = ctx.createLinearGradient(0, 0, 0, 40);
      tg.addColorStop(0, '#ffa3c2'); tg.addColorStop(1, C.tongueDark);
      inkFill(ctx, (c) => splinePath(c, tp), tg, C.ink, 1.6);
      ctx.beginPath(); ctx.moveTo(lerp(60, 92, tout), lerp(11, 12, tout)); ctx.quadraticCurveTo(lerp(78, 99, tout), lerp(12, 24, tout), lerp(82, 99, tout), lerp(13, 36, tout));
      ctx.strokeStyle = C.tongueDark; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(lerp(60, 96, tout), lerp(10, 16, tout), 6, 2, 0.6 * tout, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    }

    // skull
    hm.set(ctx);
    const skull = (c) => splinePath(c, [
      [-20, 30], [-42, 10], [-48, -20], [-38, -50], [-12, -68], [20, -70], [44, -58], [58, -42],
      [72, -32], [92, -30], [106, -25], [112, -12], [108, 2, 1], [94, 9], [70, 12], [44, 14], [24, 18], [6, 30],
    ]);
    inkFill(ctx, skull, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); skull(ctx); ctx.clip();
    // white muzzle plate + cheek (classic cartoon-dog face mask)
    ctx.beginPath(); splinePath(ctx, [[46, 30], [52, 0], [64, -22], [86, -26], [120, -20], [120, 30]]);
    ctx.fillStyle = C.belly; ctx.fill();
    ctx.beginPath(); splinePath(ctx, [[46, 30], [52, 0], [64, -22], [86, -26], [120, -20]], false);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.filter = this.blur(4);
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(-18, 14, 26, 22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(80, 12, 34, 6, -0.05, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, -52, 34, 13, -0.2, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(-30, -44); ctx.quadraticCurveTo(-4, -66, 30, -64);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.75; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    // seams
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.quadraticCurveTo(-10, -6, 14, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, -62); ctx.quadraticCurveTo(-10, -44, -30, -26); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    for (const [x, y] of [[-26, -10], [-4, -2], [-20, -46]]) this.rivet(ctx, x, y);
    // whisker studs
    for (const [x, y] of [[74, -4], [83, -8], [81, 1], [90, -2]]) { ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fillStyle = C.plate; ctx.fill(); }
    // mouth line + smile corner
    ctx.beginPath(); ctx.moveTo(100, 6); ctx.quadraticCurveTo(70, 14, 26, 17);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, 12); ctx.quadraticCurveTo(24, 18, 28, 23); ctx.stroke();
    // upper canine
    this.tooth(ctx, 86, 9, 7, 1);
    // nose
    const nose = (c) => splinePath(c, [[94, -32], [108, -30], [115, -21], [112, -12], [102, -11], [94, -16], [92, -26]]);
    inkFill(ctx, nose, C.nose, C.ink, 1.6);
    ctx.beginPath(); ctx.ellipse(103, -26, 6, 2.6, -0.1, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(110, -16, 2.2, 1.4, 0.6, 0, TAU); ctx.fillStyle = '#000'; ctx.fill();
    // jaw hinge
    this.joint(ctx, hinge[0], hinge[1], 8);

    // eyes: far eye peeks over the muzzle bridge (3/4 view), near eye is the big lens
    this.eye(ctx, hm.translate(62, -40), 0.62, true);
    this.eye(ctx, hm.translate(28, -30), 1, false);

    // near ear on top
    hm.set(ctx);
    this.ear(ctx, -8, -60, earAng - 0.05 + this.tilt * 0.9 * DEG, false);
  }

  tooth(ctx, x, y, len, dir, far = false) {
    const w = Math.max(3, len * 0.45);
    inkFill(ctx, (c) => { c.moveTo(x - w, y - dir * 2); c.quadraticCurveTo(x - w * 0.5, y + dir * len * 0.7, x + w * 0.1, y + dir * len); c.quadraticCurveTo(x + w * 0.8, y + dir * len * 0.4, x + w, y - dir * 2); c.closePath(); },
      far ? '#a3aec8' : C.tooth, C.ink, 1.2);
  }

  eye(ctx, m, s, far) {
    const p = this.pose;
    m.set(ctx);
    ctx.save(); ctx.scale(far ? s * 0.62 : s, s);
    const rx = 16, ry = 17;
    const angry = p.angry;
    if (far) inkFill(ctx, (c) => c.ellipse(0, 2, rx + 9, ry + 9, 0, 0, TAU), C.body, C.ink, 2.4);
    const bez = ctx.createLinearGradient(-rx, -ry, rx, ry);
    bez.addColorStop(0, C.steelLight); bez.addColorStop(1, C.steelDark);
    inkFill(ctx, (c) => c.ellipse(0, 1, rx + 5, ry + 5, 0, 0, TAU), bez, C.ink, 2);
    const glass = (c) => c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    inkFill(ctx, glass, C.eyeGlass, C.ink, 2);
    ctx.save(); ctx.beginPath(); glass(ctx); ctx.clip();
    const [r, g, b] = glowRGB(clamp(p.charge * 1.2 + angry * 0.15));
    const lx = 3, ly = 0;
    const ir = 12.5 + p.charge * 2;
    const ig = ctx.createRadialGradient(lx, ly, 1, lx, ly, ir);
    ig.addColorStop(0, '#fff'); ig.addColorStop(0.32, `rgb(${r | 0},${g | 0},${b | 0})`);
    ig.addColorStop(0.8, `rgb(${r * 0.5 | 0},${g * 0.5 | 0},${b * 0.5 | 0})`); ig.addColorStop(1, `rgb(${r * 0.18 | 0},${g * 0.18 | 0},${b * 0.18 | 0})`);
    ctx.beginPath(); ctx.arc(lx, ly, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (const rr of [6, 10]) { ctx.beginPath(); ctx.arc(lx, ly, rr, 0, TAU); ctx.stroke(); }
    // cute round pupil that shrinks when charging
    const pr = lerp(5.2, 2.2, Math.max(angry * 0.6, p.charge));
    ctx.beginPath(); ctx.arc(lx + 1, ly, pr, 0, TAU); ctx.fillStyle = p.charge > 0.5 ? '#fff' : '#05080f'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-6, -7, 6.5, 4, -0.6, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx + 5, ly + 6, 1.8, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    // shutter lid (blink + angry slant)
    const close = this.blink;
    const lidY = lerp(-ry - 8, ry + 2, close * 0.97);
    const tilt = angry * 7 + p.charge * 3;
    ctx.beginPath();
    ctx.moveTo(-rx - 4, -ry - 8); ctx.lineTo(rx + 4, -ry - 8);
    ctx.lineTo(rx + 4, lidY + tilt + 5 - (1 - close) * 4);
    ctx.quadraticCurveTo(0, lidY + tilt * 0.4 + 4 + close * 6, -rx - 4, lidY - tilt * 0.5 + 2);
    ctx.closePath(); ctx.fillStyle = C.body; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.restore();
    ctx.beginPath(); glass(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.stroke();
    // lens halo
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hr = 26 + p.charge * 16;
    const h = ctx.createRadialGradient(lx, ly, 3, lx, ly, hr);
    h.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.3 + 0.5 * p.charge})`); h.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(lx, ly, hr, 0, TAU); ctx.fill();
    ctx.restore();
    // brow plate
    ctx.save(); ctx.translate(0, -ry - 7 + angry * 5); ctx.rotate(-0.12 + angry * 0.32);
    inkFill(ctx, (c) => splinePath(c, [[-22, 5], [-17, -5], [0, -9], [20, -4], [25, 3, 1], [6, 3], [-10, 6]]), C.body, C.ink, INK_W * 0.8);
    ctx.beginPath(); ctx.moveTo(-15, -3); ctx.quadraticCurveTo(0, -7, 16, -3); ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.8; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- anchors
  /** Both eye centres in stage space + the beam direction (where the head looks). */
  eyes(base) {
    const hm = base.mul(this.rig.headMat);
    const a = hm.apply(31, -30), b = hm.apply(64, -40);
    return { near: { x: a[0], y: a[1] }, far: { x: b[0], y: b[1] }, dir: hm.angle(), mouth: hm.apply(100, 10) };
  }
}
