// Procedurally drawn, skeletal-rigged cartoon ROBO-CHEETAH (pet #3).
//
// Cheetah space: origin on the ground under the body, x to the right (faces right),
// y down. Same rendering language as the robo-dragon / robo-dog: ink outlines behind
// fills, armour seams, rivets, steel joint discs, lens eyes.
//
// Rig:
//   body   : rump -> hips -> tucked waist -> deep chest -> neck as ONE armoured tube,
//            dark "spot" plates that light up with electric charge
//   tail   : 10 segments, low with an upturned tip, dark rings
//   legs   : 4 long legs, 2-bone IK; stretch in the air, front paws strike (claws out)
//   head   : small round head, muzzle, hinged jaw (growl / roar), tear marks,
//            near + far lens eyes, round ears on springs
//   root   : whole-body offset for the pounce / dash back

import { DEG, TAU, Mat, clamp, lerp, rng, wobble, splinePath, sampleSpline, inkFill, ik2, Spring } from './util.js';

const C = {
  ink: '#1c1222',
  body: '#f2a52c',
  bodyLight: '#ffd982',
  bodyDark: '#b8650f',
  spec: '#fff6dc',
  far: '#cf8420',
  farDark: '#8f4c0c',
  belly: '#fbf0d6',
  bellyDark: '#d6bd8e',
  plate: '#b89a68',
  spot: '#2b1a12',
  steel: '#6c6a7c',
  steelLight: '#cfcbd9',
  steelDark: '#3c3a4c',
  nose: '#2a1712',
  tooth: '#f7f6ff',
  eyeGlass: '#0d0f1c',
};
const INK_W = 3.2;
// energy colour: calm teal -> charged electric cyan-white
export const glowRGB = (k) => [lerp(70, 150, k), lerp(220, 250, k), lerp(230, 255, k)];

export class Cheetah {
  constructor() {
    this.time = 0;
    this.pose = null;
    this.sHead = new Spring(0, 3.0, 0.45);
    this.sEars = new Spring(0, 3.6, 0.32);
    this.sCrouch = new Spring(0, 2.6, 0.7);
    this.sJaw = new Spring(0, 7.0, 0.6);
    this.sTail = new Spring(0, 1.4, 0.45);
    this.sExt = new Spring(0, 4.0, 0.7);
    this.blink = 0;
    this.nextBlink = 1.2;
  }

  update(dt, pose) {
    this.time += dt;
    this.pose = pose;
    const t = this.time;
    this.head = this.sHead.step(pose.head, dt);
    this.ears = this.sEars.step(pose.ears, dt);
    this.crouch = this.sCrouch.step(pose.crouch, dt);
    this.jaw = clamp(this.sJaw.step(pose.jaw, dt), 0, 1.05);
    this.tailK = this.sTail.step(pose.tail, dt);
    this.ext = this.sExt.step(pose.ext, dt);
    if (t > this.nextBlink) {
      const bt = t - this.nextBlink;
      this.blink = bt < 0.08 ? bt / 0.08 : bt < 0.18 ? 1 - (bt - 0.08) / 0.1 : 0;
      if (bt >= 0.18) { this.blink = 0; this.nextBlink = t + 2.4 + ((t * 5.71) % 1.5); }
    }
    if (pose.angry > 0.3) this.blink = 0;
    this.rig = this.buildRig();
  }

  buildRig() {
    const t = this.time, p = this.pose;
    const c = this.crouch, e = this.ext;
    const breath = Math.sin(t * TAU / 2.6);
    const wig = Math.sin(t * TAU * 6) * p.wiggle;
    const jit = (k, f = 43) => wobble(t * f, k) * p.shake;
    const root = { x: p.rootX, y: p.rootY };

    const H = { x: -70 + wig * 5 - e * 14 + jit(1), y: -122 + c * 16 - Math.abs(wig) * 2 - e * 6 + jit(2) };
    const M = { x: -16 - e * 2, y: -121 + c * 20 + breath * 0.6 - e * 4 };
    const Cc = { x: 36 - c * 4 + e * 12 + jit(3), y: -124 + c * 26 - breath * 1.4 - e * 8 + jit(4) };
    const puff = 1 + breath * 0.02;
    const nA = [-48 + c * 30 + e * 22, -58 + c * 36 + e * 26].map((a) => a * DEG);
    const N1 = { x: Cc.x + Math.cos(nA[0]) * 26, y: Cc.y + Math.sin(nA[0]) * 26 };
    const N2 = { x: N1.x + Math.cos(nA[1]) * 22, y: N1.y + Math.sin(nA[1]) * 22 };
    const spine = [
      { x: H.x - 30, y: H.y, wt: 11, wb: 12, bf: 0.45 },
      { x: H.x - 18, y: H.y, wt: 27, wb: 29, bf: 0.45 },
      { x: H.x, y: H.y, wt: 33 * puff, wb: 33 * puff, bf: 0.45 },
      { x: M.x, y: M.y, wt: 29 * puff, wb: 28 * puff, bf: 0.45 },
      { x: Cc.x, y: Cc.y, wt: 36 * puff, wb: 46 * puff, bf: 0.6 },
      { x: N1.x, y: N1.y, wt: 25, wb: 27, bf: 0.62 },
      { x: N2.x, y: N2.y, wt: 21, wb: 23, bf: 0.62 },
    ];
    const nod = Math.sin(t * TAU / 2.6 + 0.7) * 1.2 + wobble(t * 0.9, 4) * 1.4;
    const headAng = (this.head + nod - e * 8 + jit(20, 47) * 2.5) * DEG;
    const headMat = new Mat().translate(N2.x + jit(21) * 1.5, N2.y + jit(22) * 1.5).rotate(headAng).scale(1.28);
    const jawAng = this.jaw * 36 * DEG;

    // tail
    const rest = [150, 132, 116, 106, 104, 112, 132, 160, 190, 214];
    const tail = [{ x: H.x - 22, y: H.y - 18 }];
    for (let i = 0; i < rest.length; i++) {
      const u = i / (rest.length - 1);
      const sway = Math.sin(t * 1.8 - i * 0.45) * (2 + 8 * u);
      const flick = Math.sin(t * 9 - i * 0.8) * p.angry * 5 * u * u;
      const k = this.tailK;
      const a = (k >= 0 ? lerp(rest[i], 205 + i * 4, k * 0.75) : lerp(rest[i], 178 - u * 6, -k)) + sway + flick;
      const q = tail[tail.length - 1];
      tail.push({ x: q.x + Math.cos(a * DEG) * 12.5, y: q.y + Math.sin(a * DEG) * 12.5 });
    }

    // legs (+ stretch in the air, + front paw strikes)
    const raise = (pw, sh) => ({ x: sh.x + 62, y: sh.y - 6 });
    const leg = (hip, hock, paw, dx, dy) => ({ hip, hock: { x: hock.x + dx, y: hock.y + dy }, paw: { x: paw.x + dx, y: paw.y + dy } });
    const shN = { x: Cc.x - 6, y: Cc.y + 26 }, shF = { x: Cc.x + 10, y: Cc.y + 22 };
    const legs = {
      hindNear: leg({ x: H.x + 6, y: H.y + 14 }, { x: -96, y: -40 }, { x: -84, y: -9 }, -46 * e, -32 * e),
      hindFar: leg({ x: H.x + 22, y: H.y + 10 }, { x: -76, y: -42 }, { x: -64, y: -10 }, -40 * e, -28 * e),
      frontNear: leg(shN, { x: 58, y: -22 }, { x: 66, y: -9 }, 44 * e, -50 * e),
      frontFar: leg(shF, { x: 80, y: -24 }, { x: 88, y: -10 }, 40 * e, -44 * e),
    };
    for (const [key, k] of [['frontNear', p.paw1], ['frontFar', p.paw2]]) {
      if (k <= 0.001) continue;
      const L = legs[key], up = raise(k, L.hip);
      L.hock = { x: lerp(L.hock.x, up.x, k), y: lerp(L.hock.y, up.y, k) };
      L.paw = { x: lerp(L.paw.x, up.x + 16, k), y: lerp(L.paw.y, up.y + 6, k) };
      L.strike = k;
    }
    return { root, spine, headMat, headAng, jawAng, tail, legs, H, M, Cc };
  }

  // =====================================================================
  draw(ctx, base, k) {
    this.k = k;
    const R = this.rig;
    const b = base.translate(R.root.x, R.root.y);
    this.base = b;
    this.drawTail(ctx, b);
    this.drawHindLeg(ctx, b, R.legs.hindFar, true);
    this.drawFrontLeg(ctx, b, R.legs.frontFar, true);
    this.drawBody(ctx, b);
    this.drawHindLeg(ctx, b, R.legs.hindNear, false);
    this.drawFrontLeg(ctx, b, R.legs.frontNear, false);
    this.drawHead(ctx, b);
    this.drawArcs(ctx, b);
  }

  blur(px) { return `blur(${(px * this.k).toFixed(2)}px)`; }
  energy() { return glowRGB(clamp(this.pose.charge)); }

  joint(ctx, x, y, r, far = false) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, far ? '#8f8c9e' : C.steelLight); g.addColorStop(1, far ? C.steelDark : C.steel);
    inkFill(ctx, (c) => c.arc(x, y, r, 0, TAU), g, C.ink, 1.6);
    ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, TAU); ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fillStyle = C.steelDark; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.2, 0, TAU); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
  }
  rivet(ctx, x, y, r = 1.9) {
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
  /** A dark armour spot; glows with the electric charge. */
  spot(ctx, x, y, r, ang, far = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, TAU); ctx.fillStyle = far ? '#1d120c' : C.spot; ctx.fill();
    const ch = this.pose.charge;
    if (ch > 0.02) {
      const [er, eg, eb] = this.energy();
      const pulse = 0.7 + 0.3 * Math.sin(this.time * 22 + x * 0.3);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r * 0.42, 0, 0, TAU);
      ctx.fillStyle = `rgba(${er | 0},${eg | 0},${eb | 0},${ch * pulse * (far ? 0.6 : 1)})`; ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.35, r * 0.2, 0, 0, TAU); ctx.fillStyle = 'rgba(255,240,210,0.35)'; ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- tail
  drawTail(ctx, base) {
    base.set(ctx);
    const pts = this.rig.tail, n = pts.length;
    const r = (i) => lerp(8.5, 5, i / (n - 1));
    const pieces = [];
    for (let i = 0; i < n - 1; i++) pieces.push((c) => this.capsule(c, pts[i].x, pts[i].y, r(i), pts[i + 1].x, pts[i + 1].y, r(i + 1)));
    this.limbGroup(ctx, pieces, C.body, () => {
      // dark rings + black tip
      for (let i = 5; i < n - 1; i++) {
        if (i % 2 === 0 || i >= n - 2) {
          ctx.beginPath(); this.capsule(ctx, lerp(pts[i].x, pts[i + 1].x, 0.15), lerp(pts[i].y, pts[i + 1].y, 0.15), r(i) + 1, lerp(pts[i].x, pts[i + 1].x, i >= n - 2 ? 1.2 : 0.6), lerp(pts[i].y, pts[i + 1].y, i >= n - 2 ? 1.2 : 0.6), r(i + 1) + 1);
          ctx.fillStyle = C.spot; ctx.fill();
        }
      }
      for (let i = 1; i < 5; i++) this.spot(ctx, pts[i].x, pts[i].y - 2, 3.2, 0);
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q.x - 2, q.y - 3));
      ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    });
    this.joint(ctx, pts[0].x, pts[0].y, 6.5);
  }

  // ---------------------------------------------------------------- body
  drawBody(ctx, base) {
    const R = this.rig;
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
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.5; ctx.fill();
    ctx.beginPath();
    for (const q of pts) ctx.lineTo(...D(q, q.wt * 0.85));
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; ctx.lineTo(...D(q, q.wt * 0.4)); }
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.75; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // spots (deterministic layout along the spine)
    const r = rng(7);
    let ns = 14, row = 0;
    for (const q of pts) {
      if (q.s < ns || q.s > total - 26) continue;
      row++;
      for (const f of [0.75, 0.22]) {
        const off = q.wt * (f + (row % 2) * 0.1) - (f < 0.5 ? q.wb * 0.1 : 0);
        const [x, y] = D(q, off);
        this.spot(ctx, x + r.range(-3, 3), y, clamp(q.wt * 0.13, 2.6, 4.6) * r.range(0.85, 1.15), Math.atan2(q.ty, q.tx) + r.range(-0.4, 0.4));
      }
      ns = q.s + 15;
    }
    // specular + seams
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...D(q, q.wt * 0.62)));
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.6; ctx.lineWidth = 2.6; ctx.stroke(); ctx.globalAlpha = 1;
    let next = 30;
    for (const q of pts) {
      if (q.s < next || q.s > total - 30) continue;
      const [x1, y1] = D(q, q.wt * 1.1), [x2, y2] = V(q, q.wb * (1 - q.bf));
      const bend = -(q.wt + q.wb) * 0.12;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 + q.tx * bend, (y1 + y2) / 2 + q.ty * bend, x2, y2);
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
      const [rx, ry] = D(q, q.wt * 0.5);
      this.rivet(ctx, rx - q.tx * 5, ry - q.ty * 5);
      next = q.s + 40;
    }
    // cream belly
    const bellyPath = (c) => {
      pts.forEach((q, i) => (i ? c.lineTo : c.moveTo).call(c, ...V(q, q.wb * (1 - q.bf))));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(...V(pts[i], pts[i].wb * 1.4 + 4));
      c.closePath();
    };
    ctx.beginPath(); bellyPath(ctx); ctx.fillStyle = C.belly; ctx.fill();
    ctx.filter = this.blur(3);
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(q, q.wb * 0.8)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(...V(pts[i], pts[i].wb * 1.3));
    ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.8; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.strokeStyle = C.plate; ctx.lineWidth = 1.5;
    let np = 10;
    for (const q of pts) {
      if (q.s < np || q.s > total - 6) continue;
      const [x1, y1] = V(q, q.wb * (1 - q.bf) + 1), [x2, y2] = V(q, q.wb * 1.05);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      np = q.s + 12;
    }
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(q, q.wb * (1 - q.bf))));
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    // energy conduit along the spine (speed meter)
    const ch = this.pose.charge;
    const [er, eg, eb] = this.energy();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); pts.forEach((q, i) => { if (q.s < 30 || q.s > total - 40) return; const pt = D(q, q.wt * 0.9); ctx.lineTo(...pt); });
    ctx.strokeStyle = C.ink; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = ch > 0.02 ? `rgb(${er | 0},${eg | 0},${eb | 0})` : '#3a3550'; ctx.lineWidth = 2.6; ctx.stroke();
    if (ch > 0.02) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(${er | 0},${eg | 0},${eb | 0},${0.35 * ch})`; ctx.lineWidth = 9; ctx.stroke(); }
    ctx.restore();
    this.bodyPts = pts;
  }

  // ---------------------------------------------------------------- legs
  paw(c, x, y) {
    c.moveTo(x - 13, y + 8);
    c.bezierCurveTo(x - 16, y - 3, x - 9, y - 9, x - 1, y - 9);
    c.bezierCurveTo(x + 10, y - 9, x + 16, y - 3, x + 16, y + 4);
    c.bezierCurveTo(x + 16, y + 8, x + 12, y + 8, x + 9, y + 8);
    c.closePath();
  }
  claws(ctx, x, y, k) {
    if (k < 0.05) return;
    const [er, eg, eb] = this.energy();
    for (const [dx, dy] of [[12, 0], [15, 5], [9, 7]]) {
      ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(0.5);
      inkFill(ctx, (c) => { c.moveTo(0, -2.5); c.quadraticCurveTo(9 * k, -3, 12 * k, 3); c.quadraticCurveTo(6 * k, 2.5, 0, 2.5); c.closePath(); }, `rgb(${er | 0},${eg | 0},${eb | 0})`, C.ink, 1.2);
      ctx.restore();
    }
  }
  pawDetails(ctx, x, y, far) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.globalAlpha = far ? 0.5 : 0.75;
    for (const dx of [4, 10]) { ctx.beginPath(); ctx.moveTo(x + dx, y + 7); ctx.quadraticCurveTo(x + dx - 1, y + 1, x + dx - 4, y - 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  drawHindLeg(ctx, base, L, far) {
    base.set(ctx);
    const { hip, hock, paw } = L;
    const [kx, ky] = ik2(hip.x, hip.y, hock.x, hock.y, 54, 50, -1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ky - hip.y, kx - hip.x);
    const thigh = (c) => { c.save(); c.translate(lerp(hip.x, kx, 0.42), lerp(hip.y, ky, 0.42)); c.rotate(ang); c.ellipse(0, 0, 34, 22, 0, 0, TAU); c.restore(); };
    const shin = (c) => this.capsule(c, kx, ky, 11, hock.x, hock.y, 7.5);
    const meta = (c) => this.capsule(c, hock.x, hock.y, 7.5, paw.x - 3, paw.y - 3, 7.5);
    const pw = (c) => this.paw(c, paw.x, paw.y);
    this.limbGroup(ctx, [meta, pw, shin, thigh], fill, () => {
      ctx.filter = this.blur(4);
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.5) - 6, lerp(hip.y, ky, 0.5) + 18, 30, 10, ang, 0, TAU); ctx.fill();
      if (!far) { ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.35) - 4, lerp(hip.y, ky, 0.35) - 10, 18, 8, ang - 0.4, 0, TAU); ctx.fill(); }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
      this.spot(ctx, lerp(hip.x, kx, 0.55), lerp(hip.y, ky, 0.55) - 4, 3.6, ang, far);
      this.spot(ctx, lerp(hip.x, kx, 0.2) + 8, lerp(hip.y, ky, 0.2) + 10, 3.2, ang, far);
      this.spot(ctx, lerp(kx, hock.x, 0.5) + 2, lerp(ky, hock.y, 0.5), 2.6, ang, far);
    });
    this.pawDetails(ctx, paw.x, paw.y, far);
    this.joint(ctx, lerp(hip.x, kx, 0.3), lerp(hip.y, ky, 0.3), 10, far);
    this.joint(ctx, kx, ky, 7, far);
    this.joint(ctx, hock.x, hock.y, 5, far);
    L.knee = { x: kx, y: ky };
  }
  drawFrontLeg(ctx, base, L, far) {
    base.set(ctx);
    const { hip: sh, hock: wr, paw } = L;
    const [ex, ey] = ik2(sh.x, sh.y, wr.x, wr.y, 50, 50, 1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ey - sh.y, ex - sh.x);
    const upper = (c) => { c.save(); c.translate(lerp(sh.x, ex, 0.42), lerp(sh.y, ey, 0.42)); c.rotate(ang); c.ellipse(0, 0, 30, 17, 0, 0, TAU); c.restore(); };
    const fore = (c) => this.capsule(c, ex, ey, 10, wr.x, wr.y, 8);
    const pw = (c) => this.paw(c, paw.x, paw.y);
    this.claws(ctx, paw.x, paw.y, Math.max(L.strike || 0, this.pose.charge * 0.6));
    this.limbGroup(ctx, [pw, fore, upper], fill, () => {
      ctx.filter = this.blur(4);
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(ex - 6, (ey + wr.y) / 2, 7, 22, 0.1, 0, TAU); ctx.fill();
      if (!far) { ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.ellipse(lerp(sh.x, ex, 0.35) + 4, lerp(sh.y, ey, 0.35) - 7, 13, 6, ang - 0.3, 0, TAU); ctx.fill(); }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
      this.spot(ctx, lerp(sh.x, ex, 0.5), lerp(sh.y, ey, 0.5), 3.4, ang, far);
      this.spot(ctx, lerp(ex, wr.x, 0.45) + 2, lerp(ey, wr.y, 0.45), 2.6, ang, far);
    });
    this.pawDetails(ctx, paw.x, paw.y, far);
    this.joint(ctx, lerp(sh.x, ex, 0.3), lerp(sh.y, ey, 0.3), 9, far);
    this.joint(ctx, ex, ey, 6.5, far);
    this.joint(ctx, wr.x, wr.y, 5, far);
    L.elbow = { x: ex, y: ey };
  }

  // ---------------------------------------------------------------- head
  ear(ctx, x, y, ang, far) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const shape = (c) => splinePath(c, [[-11, 4], [-14, -9], [-9, -21], [0, -25], [9, -19], [12, -6], [11, 4]]);
    inkFill(ctx, shape, far ? C.far : C.body, C.ink, INK_W * 0.85);
    ctx.save(); ctx.beginPath(); shape(ctx); ctx.clip();
    ctx.beginPath(); splinePath(ctx, [[-6, 2], [-8, -9], [-4, -18], [2, -19], [6, -10], [6, 2]]); ctx.fillStyle = far ? '#4a2c14' : C.spot; ctx.fill();
    const [er, eg, eb] = this.energy();
    ctx.beginPath(); ctx.moveTo(-1, 0); ctx.quadraticCurveTo(-3, -10, -1, -16);
    ctx.strokeStyle = `rgba(${er | 0},${eg | 0},${eb | 0},${far ? 0.5 : 0.9})`; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  drawHead(ctx, base) {
    const R = this.rig, p = this.pose;
    const hm = base.mul(R.headMat);
    const hinge = [12, 16];
    const jm = hm.translate(hinge[0], hinge[1]).rotate(R.jawAng).translate(-hinge[0], -hinge[1]);
    const S = Math.hypot(hm.a, hm.b);
    this.headWorld = hm;
    const e = this.ears;
    const earAng = (e >= 0 ? lerp(-10, 4, e) : lerp(-10, -62, -e)) * DEG;

    hm.set(ctx);
    this.ear(ctx, 8, -42, earAng + 0.15, true);

    // mouth interior: throat wall at the back, gap shows the background
    const upperLip = [[20, 14], [40, 11], [58, 8], [68, 4]];
    const lowerTop = [[62, 7], [40, 11], [20, 14]];
    if (R.jawAng > 0.01) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cav = (c) => { c.moveTo(...hm.apply(6, 18)); upperLip.forEach(([x, y]) => c.lineTo(...hm.apply(x, y))); lowerTop.forEach(([x, y]) => c.lineTo(...jm.apply(x, y))); c.closePath(); };
      ctx.beginPath(); cav(ctx); ctx.clip();
      const A = hm.apply(42, 11), B = jm.apply(36, 12), H0 = hm.apply(6, 18);
      const ctl = [lerp((A[0] + B[0]) / 2, H0[0], 0.3), lerp((A[1] + B[1]) / 2, H0[1], 0.3)];
      ctx.beginPath(); ctx.moveTo(...H0); ctx.lineTo(...hm.apply(20, 14)); ctx.lineTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]); ctx.lineTo(...jm.apply(20, 14)); ctx.closePath();
      const wg = ctx.createLinearGradient(...hm.apply(8, 18), ...hm.apply(42, 18));
      wg.addColorStop(0, '#2a1c26'); wg.addColorStop(1, '#7a5a5a');
      ctx.fillStyle = wg; ctx.fill();
      ctx.beginPath(); ctx.moveTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8 * S; ctx.stroke();
      jm.set(ctx);
      inkFill(ctx, (c) => splinePath(c, [[18, 14], [34, 8], [52, 7], [58, 10], [50, 14], [30, 15]]), '#e8708e', C.ink, 1.2);
      hm.set(ctx);
      for (const x of [36, 48]) this.tooth(ctx, x - 3, 15 - (x - 20) * 0.08, 5, 1, true);
      ctx.restore();
    }

    // lower jaw
    jm.set(ctx);
    const jawShape = (c) => splinePath(c, [[18, 13, 1], [40, 11], [62, 7, 1], [66, 11], [60, 18], [40, 22], [20, 22], [4, 18], [8, 13]]);
    inkFill(ctx, jawShape, C.belly, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); jawShape(ctx); ctx.clip();
    ctx.filter = this.blur(2); ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(38, 22, 30, 4, 0, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.restore();
    this.tooth(ctx, 52, 9, 6, -1);

    // skull
    hm.set(ctx);
    const skull = (c) => splinePath(c, [
      [-16, 24], [-32, 8], [-36, -14], [-28, -34], [-8, -46], [18, -48], [38, -40], [50, -28],
      [60, -23], [70, -17], [73, -7], [69, 3, 1], [56, 8], [40, 10], [22, 14], [6, 26],
    ]);
    inkFill(ctx, skull, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); skull(ctx); ctx.clip();
    // cream muzzle + cheek
    ctx.beginPath(); splinePath(ctx, [[10, 30], [16, 4], [34, -6], [50, -12], [64, -14], [80, -12], [80, 30]]); ctx.fillStyle = C.belly; ctx.fill();
    ctx.filter = this.blur(4);
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.ellipse(-18, 10, 22, 20, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.ellipse(-2, -36, 28, 10, -0.2, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(-26, -28); ctx.quadraticCurveTo(-6, -46, 22, -44);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.75; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    for (const [x, y, r] of [[-20, -18, 2.6], [-8, -30, 2.4], [6, -38, 2.2], [-26, -2, 2.2], [-14, -6, 2], [20, -36, 1.8]]) this.spot(ctx, x, y, r, 0.3);
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-34, 2); ctx.quadraticCurveTo(-10, -4, 10, 12); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    // tear marks (the cheetah's signature), near and far side
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(32, -12); ctx.quadraticCurveTo(38, -2, 36, 10);
    ctx.strokeStyle = C.spot; ctx.lineWidth = 3.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, -18); ctx.quadraticCurveTo(56, -10, 56, -2);
    ctx.lineWidth = 2.4; ctx.stroke();
    // whisker studs, mouth line, nose
    for (const [x, y] of [[48, -4], [55, -6], [52, 1], [60, -1]]) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, TAU); ctx.fillStyle = C.plate; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(68, 4); ctx.quadraticCurveTo(46, 12, 22, 15); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(66, -8); ctx.lineTo(66, 3); ctx.lineWidth = 1.6; ctx.stroke();
    this.tooth(ctx, 56, 8, 6, 1);
    inkFill(ctx, (c) => splinePath(c, [[60, -23], [70, -21], [75, -14], [71, -8], [64, -9], [59, -15]]), C.nose, C.ink, 1.4);
    ctx.beginPath(); ctx.ellipse(66, -19, 4, 1.8, -0.1, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
    this.joint(ctx, hinge[0], hinge[1], 6.5);

    this.eye(ctx, hm.translate(44, -26), true);
    this.eye(ctx, hm.translate(22, -20), false);
    hm.set(ctx);
    this.ear(ctx, -12, -38, earAng - 0.05, false);
    this.joint(ctx, -12, -38, 5);
  }

  tooth(ctx, x, y, len, dir, far = false) {
    const w = Math.max(2.6, len * 0.45);
    inkFill(ctx, (c) => { c.moveTo(x - w, y - dir * 2); c.quadraticCurveTo(x - w * 0.5, y + dir * len * 0.7, x + w * 0.1, y + dir * len); c.quadraticCurveTo(x + w * 0.8, y + dir * len * 0.4, x + w, y - dir * 2); c.closePath(); },
      far ? '#b0aec4' : C.tooth, C.ink, 1.1);
  }

  eye(ctx, m, far) {
    const p = this.pose;
    m.set(ctx);
    ctx.save(); far ? ctx.scale(0.55, 0.85) : ctx.scale(1, 1);
    const rx = 12.5, ry = 13;
    if (far) inkFill(ctx, (c) => c.ellipse(0, 2, rx + 8, ry + 8, 0, 0, TAU), C.body, C.ink, 2.2);
    const bez = ctx.createLinearGradient(-rx, -ry, rx, ry);
    bez.addColorStop(0, C.steelLight); bez.addColorStop(1, C.steelDark);
    inkFill(ctx, (c) => c.ellipse(0, 1, rx + 4, ry + 4, 0, 0, TAU), bez, C.ink, 1.8);
    const glass = (c) => c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    inkFill(ctx, glass, C.eyeGlass, C.ink, 1.8);
    ctx.save(); ctx.beginPath(); glass(ctx); ctx.clip();
    // amber cat iris that turns electric when charged
    const k = clamp(p.charge);
    const col = [lerp(255, 150, k), lerp(196, 250, k), lerp(60, 255, k)];
    const lx = 3, ly = 0, ir = 10.5;
    const ig = ctx.createRadialGradient(lx, ly, 1, lx, ly, ir);
    ig.addColorStop(0, '#fff'); ig.addColorStop(0.3, `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`);
    ig.addColorStop(0.85, `rgb(${col[0] * 0.5 | 0},${col[1] * 0.5 | 0},${col[2] * 0.5 | 0})`); ig.addColorStop(1, '#120c10');
    ctx.beginPath(); ctx.arc(lx, ly, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(lx, ly, 7, 0, TAU); ctx.stroke();
    const pw = lerp(3.6, 1.4, Math.max(p.angry * 0.7, k));
    ctx.beginPath(); ctx.ellipse(lx + 1, ly, pw, 8.5, 0, 0, TAU); ctx.fillStyle = '#05060a'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-5, -5, 4.5, 3, -0.6, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx + 4, ly + 5, 1.4, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    const close = this.blink;
    const lidY = lerp(-ry - 6, ry + 2, close * 0.97);
    const tilt = p.angry * 6;
    ctx.beginPath(); ctx.moveTo(-rx - 4, -ry - 6); ctx.lineTo(rx + 4, -ry - 6);
    ctx.lineTo(rx + 4, lidY + tilt + 4 - (1 - close) * 3);
    ctx.quadraticCurveTo(0, lidY + tilt * 0.4 + 3 + close * 5, -rx - 4, lidY - tilt * 0.5 + 2);
    ctx.closePath(); ctx.fillStyle = C.body; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    ctx.beginPath(); glass(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hr = 20 + k * 10;
    const h = ctx.createRadialGradient(lx, ly, 2, lx, ly, hr);
    h.addColorStop(0, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${0.25 + 0.4 * k})`); h.addColorStop(1, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},0)`);
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(lx, ly, hr, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(0, -ry - 5 + p.angry * 4); ctx.rotate(-0.1 + p.angry * 0.3);
    inkFill(ctx, (c) => splinePath(c, [[-17, 4], [-13, -4], [0, -7], [15, -3], [19, 2, 1], [5, 2], [-8, 5]]), C.body, C.ink, INK_W * 0.75);
    ctx.restore();
    ctx.restore();
  }

  // electric arcs running over the legs and spine while charged
  drawArcs(ctx, base) {
    const ch = this.pose.charge;
    if (ch < 0.05) return;
    base.set(ctx);
    const R = this.rig, L = R.legs;
    const r = rng(Math.floor(this.time * 30) + 11);
    const [er, eg, eb] = this.energy();
    const paths = [];
    for (const key of ['hindNear', 'frontNear']) {
      const l = L[key];
      const mid = l.knee || l.elbow;
      if (mid) paths.push([l.hip, mid, l.hock, l.paw]);
    }
    if (this.bodyPts) paths.push(this.bodyPts.filter((_, i) => i % 6 === 0).map((q) => ({ x: q.x + q.nx * q.wt * 0.9, y: q.y + q.ny * q.wt * 0.9 })));
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const pts of paths) {
      if (r() > 0.45 + ch * 0.5) continue;
      ctx.beginPath();
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const n = 4;
        for (let j = 0; j <= n; j++) {
          const u = j / n;
          const x = lerp(a.x, b.x, u) + (j && j < n ? r.range(-6, 6) : 0), y = lerp(a.y, b.y, u) + (j && j < n ? r.range(-6, 6) : 0);
          i === 0 && j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = `rgba(${er | 0},${eg | 0},${eb | 0},${0.35 * ch})`; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = `rgba(235,255,255,${0.9 * ch})`; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- anchors
  /** Stage-space positions used by the FX: near front paw, head, root. */
  anchors(base) {
    const b = base.translate(this.rig.root.x, this.rig.root.y);
    const pn = this.rig.legs.frontNear.paw, pf = this.rig.legs.frontFar.paw;
    const hm = b.mul(this.rig.headMat);
    return { pawNear: b.apply(pn.x, pn.y), pawFar: b.apply(pf.x, pf.y), mouth: hm.apply(66, 10), root: b.apply(0, 0) };
  }
}
