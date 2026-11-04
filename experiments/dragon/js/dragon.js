// Procedurally drawn, skeletal-rigged cartoon dragon.
//
// Dragon space: origin on the ground under the body, x to the right (the
// dragon faces right), y down, 1 unit ~ 1 px at scale 1.
//
// Rig:
//   spine  : tail (10 segments) -> hips -> belly -> chest -> neck (4) -> head
//            rendered as ONE continuous tube with separate back/belly widths,
//            so neck, torso and tail are a seamless silhouette.
//   legs   : 4 legs, 2-bone IK, feet stay planted while the body moves.
//   wings  : humerus, forearm, 4 fingers + membrane, near & far.
//   head   : skull, hinged lower jaw, cheek web, tongue, teeth, eye with
//            lids/pupil, brow, horns, frills.

import { DEG, TAU, Mat, clamp, lerp, smooth, wobble, splinePath, sampleSpline, inkFill, ik2, Spring } from './util.js';

const C = {
  ink: '#123222',
  body: '#3e9a4a',
  bodyLight: '#78cc62',
  bodyDark: '#256c35',
  far: '#2c7a3c',
  farDark: '#1f5c2e',
  belly: '#f3e9ac',
  bellyDark: '#d5c27a',
  plate: '#b49c55',
  spike: '#f3b23c',
  spikeLight: '#ffd877',
  spikeDark: '#cf7c22',
  horn: '#f7eed5',
  hornShade: '#d7c497',
  claw: '#f4ecd6',
  memb: '#3b8f63',
  membLight: '#8fd07a',
  membDark: '#226a49',
  mouth: '#5b1422',
  throat: '#24060c',
  tongue: '#e0566d',
  tongueDark: '#b33a52',
  tooth: '#fffdf4',
  eyeWhite: '#fffbea',
};
const INK_W = 3.2;

export class Dragon {
  constructor() {
    this.time = 0;
    this.pose = null;
    // follow-through springs
    this.sHead = new Spring(0, 2.6, 0.42);
    this.sReach = new Spring(0, 2.2, 0.55);
    this.sWing = new Spring(0, 1.5, 0.5);
    this.sTail = new Spring(0, 1.1, 0.45);
    this.sJaw = new Spring(0, 5.5, 0.62);
    this.sTense = new Spring(0, 2.0, 0.7);
    this.blink = 0;
    this.nextBlink = 1.7;
    this.rig = null;
  }

  /** Advance secondary motion with a fixed dt and rebuild the rig. */
  update(dt, pose) {
    this.time += dt;
    this.pose = pose;
    this.head = this.sHead.step(pose.head, dt);
    this.reach = this.sReach.step(pose.reach, dt);
    this.wing = this.sWing.step(pose.wings, dt);
    this.tail = this.sTail.step(pose.tail, dt);
    this.jaw = clamp(this.sJaw.step(pose.jaw, dt), 0, 1.05);
    this.tense = this.sTense.step(pose.tense, dt);

    // blinking (suppressed while roaring / breathing fire)
    if (this.time > this.nextBlink) {
      const bt = this.time - this.nextBlink;
      this.blink = bt < 0.09 ? bt / 0.09 : bt < 0.2 ? 1 - (bt - 0.09) / 0.11 : 0;
      if (bt >= 0.2) { this.blink = 0; this.nextBlink = this.time + 2.4 + ((this.time * 7.31) % 1.8); }
    }
    if (pose.angry > 0.5 && pose.inhale < 0.2) this.blink *= 0.0;
    this.rig = this.buildRig();
  }

  buildRig() {
    const t = this.time, p = this.pose;
    const tense = this.tense;
    const breath = Math.sin(t * TAU / 3.1);
    const inhale = p.inhale;
    const shake = p.shake;
    const jit = (k, f = 43) => wobble(t * f, k) * shake;
    // ---- torso (sitting, upright like a heraldic dragon)
    const H = { x: -40 + jit(1) * 1.2, y: -80 + breath * 0.5 + jit(2) * 1.2 };
    const Cc = { x: 10 + tense * 7 - inhale * 7 + jit(3) * 1.6, y: -186 - breath * 2.4 - inhale * 7 + tense * 3 + jit(4) * 1.6 };
    const M = { x: lerp(H.x, Cc.x, 0.5) + 6, y: lerp(H.y, Cc.y, 0.5) };
    const puff = 1 + breath * 0.02 + inhale * 0.07 + tense * 0.03;
    const bl = Math.hypot(Cc.x - H.x, Cc.y - H.y);
    const bd = { x: (Cc.x - H.x) / bl, y: (Cc.y - H.y) / bl };
    const nD = { x: bd.y, y: -bd.x }; // dorsal normal of the torso

    // ---- tail (built outward from the hips, curls up behind)
    const tailRest = [150, 156, 166, 179, 192, 208, 229, 253, 277, 296];
    const tailNodes = [];
    let tx = H.x, ty = H.y;
    const nT = tailRest.length, L = 22;
    for (let i = 0; i < nT; i++) {
      const u = (i + 1) / nT;
      const sway = Math.sin(t * 1.35 - i * 0.5) * (1.5 + 7 * u * u);
      const lift = this.tail * (i * 2.6) * u;
      const whip = Math.sin(t * 9 - i * 0.7) * shake * (1 + 6 * u) + Math.sin(t * 3.1 - i * 0.6) * tense * 3 * u;
      const a = (tailRest[i] + sway + lift + whip) * DEG;
      tx += Math.cos(a) * L; ty += Math.sin(a) * L;
      const w = Math.pow(1 - u, 0.75);
      tailNodes.push({ x: tx, y: ty, wt: 40 * w + 2.2, wb: 42 * w + 2.8, bf: 0.55, sp: 1 });
    }
    const tipDir = Math.atan2(ty - tailNodes[nT - 2].y, tx - tailNodes[nT - 2].x);

    // ---- neck (built upward from the chest)
    const r = this.reach;
    const neckA = [-64, -74, -70, -50].map((a, i) => a + r * [7, 12, 17, 22][i] + breath * 1.2 + tense * 3 + jit(10 + i) * 2);
    const neckL = [28, 26, 24, 20];
    const neck = [];
    let nx = Cc.x, ny = Cc.y;
    for (let i = 0; i < 4; i++) {
      nx += Math.cos(neckA[i] * DEG) * neckL[i];
      ny += Math.sin(neckA[i] * DEG) * neckL[i];
      neck.push({ x: nx, y: ny });
    }
    const neckW = [[36, 42], [31, 36], [28, 32], [27, 30]];

    const spine = [
      ...tailNodes.slice().reverse(),
      { x: H.x, y: H.y, wt: 50 * puff, wb: 54 * puff, bf: 0.46, sp: 1 },
      { x: M.x, y: M.y, wt: 44 * puff, wb: 62 * puff, bf: 0.44, sp: 1 },
      { x: Cc.x, y: Cc.y, wt: 40 * puff, wb: 52 * puff, bf: 0.52, sp: 1 },
      ...neck.map((n, i) => ({ x: n.x, y: n.y, wt: neckW[i][0] * (1 + inhale * 0.08), wb: neckW[i][1] * (1 + inhale * 0.12), bf: 0.62, sp: i < 3 ? 1 : 0 })),
    ];

    // ---- head
    const headPos = neck[3];
    const idleNod = Math.sin(t * TAU / 3.1 + 0.6) * 1.6 + wobble(t * 0.7, 3) * 1.5;
    const headAng = (6 + this.head + idleNod + jit(20, 47) * 3.2) * DEG;
    const headMat = new Mat()
      .translate(headPos.x + jit(21) * 2.2, headPos.y + jit(22) * 2.2)
      .rotate(headAng)
      .scale(1.04);
    const jawAng = this.jaw * 44 * DEG + Math.sin(t * 31) * shake * 2.2 * DEG;

    // ---- wings (root on the shoulders, trailing edge attached at the lower back)
    const at = (u, o) => ({ x: lerp(H.x, Cc.x, u) + nD.x * o, y: lerp(H.y, Cc.y, u) + nD.y * o });
    const wRoot = at(0.8, 30);
    const wAttach = at(0.22, 40);
    const w = clamp(this.wing, -0.1, 1.15);
    const flap = Math.sin(t * 5.2) * 0.05 * smooth(w) + Math.sin(t * 1.2) * 0.015;
    const wingPose = (far) => {
      const k = w + flap;
      const off = far ? 1 : 0;
      return {
        h: lerp(-118, -142, k) + off * 10,
        f: lerp(-152, -84, k) + off * 12 + jit(30 + off) * 1.5,
        hl: lerp(44, 62, k), fl: lerp(70, 100, k),
        fingers: [lerp(150, 238, k), lerp(130, 206, k), lerp(113, 176, k), lerp(99, 150, k)].map((a) => a + off * 10),
        lens: [lerp(112, 172, k), lerp(116, 160, k), lerp(108, 136, k), lerp(96, 104, k)],
      };
    };

    // ---- legs (feet planted on the ground)
    const sh = at(0.92, -30);
    const legs = {
      hindNear: { hip: { x: H.x + 12, y: H.y + 2 }, foot: { x: -44, y: -16 }, toe: { x: 30, y: -4 } },
      hindFar: { hip: { x: H.x + 30, y: H.y - 4 }, foot: { x: -18, y: -18 }, toe: { x: 54, y: -6 } },
      frontNear: { hip: { x: sh.x, y: sh.y }, foot: { x: 62, y: -22 }, toe: { x: 86, y: -3 } },
      frontFar: { hip: { x: sh.x + 16, y: sh.y - 8 }, foot: { x: 86, y: -24 }, toe: { x: 110, y: -5 } },
    };

    return { spine, tipDir, H, M, Cc, headMat, headAng, jawAng, wRoot, wAttach, wingPose, legs, breath };
  }

  // ======================================================================
  draw(ctx, base, k) {
    const R = this.rig;
    this.k = k; // px per unit (for blur radii)
    const far = { x: 26, y: -12 };
    this.drawWing(ctx, base, { x: R.wRoot.x + far.x, y: R.wRoot.y + far.y }, { x: R.wAttach.x + 18, y: R.wAttach.y - 6 }, R.wingPose(true), true);
    this.drawHindLeg(ctx, base, R.legs.hindFar, true);
    this.drawFrontLeg(ctx, base, R.legs.frontFar, true);
    this.drawBody(ctx, base);
    this.drawHindLeg(ctx, base, R.legs.hindNear, false);
    this.drawWing(ctx, base, R.wRoot, R.wAttach, R.wingPose(false), false);
    this.drawFrontLeg(ctx, base, R.legs.frontNear, false);
    this.drawHead(ctx, base);
  }

  blur(px) { return `blur(${(px * this.k).toFixed(2)}px)`; }

  // ---------------------------------------------------------------- body
  drawBody(ctx, base) {
    const R = this.rig;
    const pts = sampleSpline(R.spine, 7);
    // tangents, normals, arclength
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const p = pts[i];
      p.tx = dx / l; p.ty = dy / l;
      p.nx = dy / l; p.ny = -dx / l; // dorsal normal (up for a right-facing spine)
      if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      p.s = s;
    }
    const total = s;
    const D = (p, o) => [p.x + p.nx * o, p.y + p.ny * o];   // dorsal offset
    const V = (p, o) => [p.x - p.nx * o, p.y - p.ny * o];   // ventral offset
    const outline = (c) => {
      c.moveTo(...D(pts[0], pts[0].wt));
      for (const p of pts) c.lineTo(...D(p, p.wt));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(...V(pts[i], pts[i].wb));
      c.closePath();
    };
    base.set(ctx);

    // ---- dorsal spikes (drawn first so the body covers their bases)
    const spikeFrom = 18, spikeTo = total - 34;
    let next = spikeFrom, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (p.s < next || p.s > spikeTo || !p.sp) continue;
      const h = clamp(p.wt * 0.42, 5, 19) * (idx % 2 ? 0.86 : 1);
      const hw = h * 0.62;
      const [bx, by] = D(p, p.wt * 0.7);
      const tipx = bx + p.nx * (p.wt * 0.3 + h) - p.tx * h * 0.7;
      const tipy = by + p.ny * (p.wt * 0.3 + h) - p.ty * h * 0.7;
      const ax = bx - p.tx * hw * 1.2, ay = by - p.ty * hw * 1.2;
      const cx = bx + p.tx * hw, cy = by + p.ty * hw;
      inkFill(ctx, (c) => {
        c.moveTo(ax, ay);
        c.quadraticCurveTo(lerp(ax, tipx, 0.6) + p.nx * h * 0.1, lerp(ay, tipy, 0.6) + p.ny * h * 0.1, tipx, tipy);
        c.quadraticCurveTo(lerp(cx, tipx, 0.4) + p.nx * h * 0.35 + p.tx * h * 0.2, lerp(cy, tipy, 0.4) + p.ny * h * 0.35 + p.ty * h * 0.2, cx, cy);
        c.closePath();
      }, C.spike, C.ink, INK_W * 0.85);
      // spike shade
      ctx.beginPath();
      ctx.moveTo(lerp(bx, cx, 0.3), lerp(by, cy, 0.3));
      ctx.quadraticCurveTo(lerp(cx, tipx, 0.45) + p.nx * h * 0.25, lerp(cy, tipy, 0.45) + p.ny * h * 0.25, tipx, tipy);
      ctx.lineTo(lerp(bx, tipx, 0.3), lerp(by, tipy, 0.3));
      ctx.fillStyle = C.spikeDark; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
      next = p.s + clamp(p.wt * 0.55, 9, 26);
      idx++;
    }

    // ---- tail spade
    const tip = pts[0];
    this.drawSpade(ctx, base, tip.x, tip.y, R.tipDir);

    // ---- body silhouette
    inkFill(ctx, outline, C.body, C.ink, INK_W);

    ctx.save();
    ctx.beginPath(); outline(ctx); ctx.clip();

    // form shadow (lower half of the green part)
    ctx.filter = this.blur(5);
    ctx.beginPath();
    for (const p of pts) ctx.lineTo(...V(p, p.wb * (1 - p.bf) - 1));
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; ctx.lineTo(...V(q, q.wb * (1 - q.bf) - q.wb * 0.45 - q.wt * 0.05)); }
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.55; ctx.fill();
    // back highlight
    ctx.beginPath();
    for (const p of pts) { const e = Math.sin(Math.PI * clamp(p.s / total)); ctx.lineTo(...D(p, p.wt * 0.82)); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; const e = Math.pow(Math.sin(Math.PI * clamp(q.s / total)), 0.6); ctx.lineTo(...D(q, q.wt * (0.82 - 0.42 * e))); }
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.75; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;

    // rim light along the very top edge
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...D(p, p.wt * 0.9)));
    ctx.strokeStyle = '#b8ec8a'; ctx.globalAlpha = 0.35; ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;

    // scale marks
    ctx.strokeStyle = C.bodyDark; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.55;
    let row = 0;
    for (let i = 3; i < pts.length - 6; i += 3) {
      const p = pts[i];
      if (p.wt < 9) continue;
      row++;
      for (let j = 0; j < 2; j++) {
        const off = p.wt * (j ? 0.22 : 0.55) + (row % 2) * p.wt * 0.08;
        const [x, y] = D(p, off);
        const r = clamp(p.wt * 0.11, 2, 5);
        ctx.beginPath();
        ctx.arc(x, y, r, Math.atan2(p.ny, p.nx) + Math.PI * 0.35, Math.atan2(p.ny, p.nx) + Math.PI * 1.65, true);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // belly band
    const glow = this.pose.glow;
    const bellyPath = (c) => {
      pts.forEach((p, i) => (i ? c.lineTo : c.moveTo).call(c, ...V(p, p.wb * (1 - p.bf))));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(...V(pts[i], pts[i].wb * 1.4 + 4));
      c.closePath();
    };
    ctx.beginPath(); bellyPath(ctx); ctx.fillStyle = C.belly; ctx.fill();
    // throat glow while preparing fire
    if (glow > 0.01) {
      const nk = pts[pts.length - 1];
      const g = ctx.createRadialGradient(nk.x, nk.y + 10, 5, nk.x, nk.y + 10, 120);
      const fl = 0.75 + 0.25 * Math.sin(this.time * 23);
      g.addColorStop(0, `rgba(255,170,40,${0.85 * glow * fl})`);
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.save(); ctx.beginPath(); bellyPath(ctx); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(nk.x - 140, nk.y - 140, 280, 300); ctx.restore();
    }
    // belly shade near the bottom edge
    ctx.filter = this.blur(3);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(p, p.wb * 0.82)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(...V(pts[i], pts[i].wb * 1.3));
    ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.8; ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // belly plates
    ctx.strokeStyle = C.plate; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    let nextPlate = 6;
    for (const p of pts) {
      if (p.s < nextPlate || p.s > total - 8) continue;
      const [x1, y1] = V(p, p.wb * (1 - p.bf) + 1);
      const [x2, y2] = V(p, p.wb * 1.05);
      const bend = p.wb * p.bf * 0.25;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2 + p.tx * bend, (y1 + y2) / 2 + p.ty * bend, x2, y2);
      ctx.stroke();
      nextPlate = p.s + clamp(p.wb * p.bf * 0.62, 4, 17);
    }
    // belly edge line
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...V(p, p.wb * (1 - p.bf))));
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    this.bodyPts = pts;
  }

  drawSpade(ctx, base, x, y, dir) {
    const m = base.translate(x, y).rotate(dir);
    m.set(ctx);
    inkFill(ctx, (c) => splinePath(c, [[-6, 0], [6, -14], [26, -16], [44, 0, 1], [26, 16], [6, 14]]), C.spike, C.ink, INK_W * 0.9);
    ctx.beginPath(); splinePath(ctx, [[0, 0], [12, 3], [40, 1, 1], [26, 13], [8, 10]]);
    ctx.fillStyle = C.spikeDark; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(20, -1, 38, 0);
    ctx.strokeStyle = C.spikeDark; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(18, -8, 8, 2.6, -0.15, 0, TAU);
    ctx.fillStyle = C.spikeLight; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    base.set(ctx);
  }

  // ---------------------------------------------------------------- legs
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
    // merged silhouette: all inks first, then all fills
    ctx.lineJoin = 'round';
    for (const pc of pieces) { ctx.beginPath(); pc(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = INK_W * 2; ctx.stroke(); }
    for (const pc of pieces) { ctx.beginPath(); pc(ctx); ctx.fillStyle = fill; ctx.fill(); }
    if (shadeFn) {
      ctx.save();
      ctx.beginPath(); for (const pc of pieces) pc(ctx); ctx.clip();
      shadeFn();
      ctx.restore();
    }
  }

  claw(ctx, x, y, ang, len) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    inkFill(ctx, (c) => { c.moveTo(0, -3.6); c.quadraticCurveTo(len * 0.7, -4, len, 2.5); c.quadraticCurveTo(len * 0.55, 3.2, 0, 3.6); c.closePath(); }, C.claw, C.ink, 1.8);
    ctx.restore();
  }

  drawHindLeg(ctx, base, L, far) {
    base.set(ctx);
    const hip = L.hip, ank = L.foot, toe = L.toe;
    const [kx, ky] = ik2(hip.x, hip.y, ank.x, ank.y, 56, 50, -1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ky - hip.y, kx - hip.x);
    const thigh = (c) => {
      c.save();
      c.translate(lerp(hip.x, kx, 0.42), lerp(hip.y, ky, 0.42));
      c.rotate(ang);
      c.moveTo(-46, -6);
      c.bezierCurveTo(-46, -40, 12, -44, 34, -18);
      c.bezierCurveTo(48, -2, 44, 22, 26, 26);
      c.bezierCurveTo(4, 32, -46, 34, -46, -6);
      c.restore();
    };
    const shin = (c) => this.capsule(c, kx, ky, 17, ank.x, ank.y, 10);
    const meta = (c) => this.capsule(c, ank.x, ank.y, 10.5, toe.x - 8, toe.y - 6, 11);
    const foot = (c) => {
      c.moveTo(toe.x - 26, toe.y - 14);
      c.bezierCurveTo(toe.x - 12, toe.y - 22, toe.x + 12, toe.y - 18, toe.x + 18, toe.y - 4);
      c.bezierCurveTo(toe.x + 20, toe.y + 4, toe.x - 26, toe.y + 6, toe.x - 30, toe.y - 2);
      c.closePath();
    };
    // claws first (behind the toes)
    this.claw(ctx, toe.x + 12, toe.y - 3, 0.25, 13);
    this.claw(ctx, toe.x + 2, toe.y - 1, 0.35, 12);
    if (!far) this.claw(ctx, toe.x - 10, toe.y, 0.45, 10);
    this.limbGroup(ctx, [meta, foot, shin, thigh], fill, () => {
      ctx.filter = this.blur(4);
      // shade under the thigh and on the back of the shin
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.5) - 10, lerp(hip.y, ky, 0.5) + 26, 40, 16, ang, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ank.x - 6, ank.y + 4, 12, 26, 0.2, 0, TAU); ctx.fill();
      if (!far) {
        ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.ellipse(lerp(hip.x, kx, 0.38) - 4, lerp(hip.y, ky, 0.38) - 12, 26, 12, ang - 0.4, 0, TAU); ctx.fill();
      }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    });
    // toe separations
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.8;
    for (const dx of [-4, 7]) {
      ctx.beginPath(); ctx.moveTo(toe.x + dx, toe.y - 2); ctx.quadraticCurveTo(toe.x + dx - 1, toe.y - 8, toe.x + dx - 5, toe.y - 11); ctx.stroke();
    }
    // knee scale + thigh muscle line
    if (!far) {
      ctx.beginPath(); ctx.arc(kx + 2, ky - 2, 7, -2.3, 0.4); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawFrontLeg(ctx, base, L, far) {
    base.set(ctx);
    const sh = L.hip, wr = L.foot, toe = L.toe;
    const [ex, ey] = ik2(sh.x, sh.y, wr.x, wr.y, 68, 64, 1);
    const fill = far ? C.far : C.body;
    const ang = Math.atan2(ey - sh.y, ex - sh.x);
    const upper = (c) => {
      c.save(); c.translate(lerp(sh.x, ex, 0.4), lerp(sh.y, ey, 0.4)); c.rotate(ang);
      c.moveTo(-40, -20);
      c.bezierCurveTo(-26, -38, 26, -30, 38, -10);
      c.bezierCurveTo(46, 6, 36, 20, 24, 20);
      c.bezierCurveTo(4, 26, -46, 24, -40, -20);
      c.restore();
    };
    const fore = (c) => this.capsule(c, ex, ey, 16, wr.x, wr.y, 12);
    const paw = (c) => {
      c.moveTo(wr.x - 10, wr.y - 6);
      c.bezierCurveTo(wr.x + 2, wr.y - 14, toe.x + 2, toe.y - 18, toe.x + 12, toe.y - 4);
      c.bezierCurveTo(toe.x + 14, toe.y + 4, toe.x - 22, toe.y + 5, wr.x - 12, wr.y + 12);
      c.closePath();
    };
    this.claw(ctx, toe.x + 7, toe.y - 3, 0.3, 12);
    this.claw(ctx, toe.x - 3, toe.y - 1, 0.42, 11);
    if (!far) this.claw(ctx, toe.x - 14, toe.y, 0.5, 9);
    this.limbGroup(ctx, [paw, fore, upper], fill, () => {
      ctx.filter = this.blur(4);
      ctx.fillStyle = far ? C.farDark : C.bodyDark; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(ex - 8, (ey + wr.y) / 2, 10, 30, 0.1, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(lerp(sh.x, ex, 0.5), lerp(sh.y, ey, 0.5) + 18, 30, 10, ang, 0, TAU); ctx.fill();
      if (!far) {
        ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.ellipse(lerp(sh.x, ex, 0.35) + 6, lerp(sh.y, ey, 0.35) - 10, 18, 8, ang - 0.3, 0, TAU); ctx.fill();
      }
      ctx.filter = 'none'; ctx.globalAlpha = 1;
    });
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.8;
    for (const dx of [-8, 2]) {
      ctx.beginPath(); ctx.moveTo(toe.x + dx, toe.y - 2); ctx.quadraticCurveTo(toe.x + dx - 1, toe.y - 8, toe.x + dx - 5, toe.y - 10); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- wings
  drawWing(ctx, base, root, attach, wp, far) {
    base.set(ctx);
    const dir = (a, l) => [Math.cos(a * DEG) * l, Math.sin(a * DEG) * l];
    const [hx, hy] = dir(wp.h, wp.hl);
    const elbow = [root.x + hx, root.y + hy];
    const [fx, fy] = dir(wp.f, wp.fl);
    const wrist = [elbow[0] + fx, elbow[1] + fy];
    const tips = wp.fingers.map((a, i) => {
      const flutter = Math.sin(this.time * 3 + i) * 1.5;
      const [x, y] = dir(a + flutter, wp.lens[i]);
      return [wrist[0] + x, wrist[1] + y];
    });
    // knuckle points (fingers have a slight bend)
    const knuck = wp.fingers.map((a, i) => {
      const [x, y] = dir(a + 6, wp.lens[i] * 0.55);
      return [wrist[0] + x, wrist[1] + y];
    });
    const memb = far ? C.membDark : C.memb;
    const scallop = (c, a, b, depth) => {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      c.quadraticCurveTo(lerp(mx, wrist[0], depth), lerp(my, wrist[1], depth), b[0], b[1]);
    };
    const membrane = (c) => {
      c.moveTo(root.x, root.y);
      c.lineTo(elbow[0], elbow[1]);
      c.lineTo(wrist[0], wrist[1]);
      c.quadraticCurveTo(knuck[0][0], knuck[0][1] - 4, tips[0][0], tips[0][1]);
      for (let i = 1; i < 4; i++) scallop(c, tips[i - 1], tips[i], 0.22);
      const am = [(tips[3][0] + attach.x) / 2, (tips[3][1] + attach.y) / 2];
      c.quadraticCurveTo(lerp(am[0], wrist[0], 0.25), lerp(am[1], wrist[1], 0.25), attach.x, attach.y);
      c.closePath();
    };
    inkFill(ctx, membrane, memb, C.ink, INK_W);
    // membrane shading: lighter close to the arm, darker at trailing edge
    ctx.save();
    ctx.beginPath(); membrane(ctx); ctx.clip();
    const g = ctx.createRadialGradient(wrist[0], wrist[1], 10, wrist[0], wrist[1], 170);
    g.addColorStop(0, far ? 'rgba(120,190,110,0.35)' : 'rgba(160,225,130,0.55)');
    g.addColorStop(0.6, 'rgba(120,200,110,0.05)');
    g.addColorStop(1, 'rgba(10,40,25,0.35)');
    ctx.fillStyle = g; ctx.fillRect(wrist[0] - 260, wrist[1] - 260, 520, 520);
    // membrane folds: thin lines from wrist between fingers
    ctx.strokeStyle = far ? 'rgba(8,40,25,0.35)' : 'rgba(18,60,40,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const mx = (tips[i][0] + tips[i + 1][0]) / 2, my = (tips[i][1] + tips[i + 1][1]) / 2;
      ctx.beginPath(); ctx.moveTo(lerp(wrist[0], mx, 0.25), lerp(wrist[1], my, 0.25));
      ctx.quadraticCurveTo(lerp(wrist[0], mx, 0.55) + 4, lerp(wrist[1], my, 0.55) + 4, lerp(wrist[0], mx, 0.72), lerp(wrist[1], my, 0.72));
      ctx.stroke();
    }
    ctx.restore();
    // finger bones
    const bone = far ? C.far : C.body;
    for (let i = 3; i >= 0; i--) {
      const piece = (c) => {
        this.capsule(c, wrist[0], wrist[1], 5.5, knuck[i][0], knuck[i][1], 3.6);
        this.capsule(c, knuck[i][0], knuck[i][1], 3.6, tips[i][0], tips[i][1], 1.6);
      };
      this.limbGroup(ctx, [piece], bone);
    }
    // arm
    const arm = [
      (c) => this.capsule(c, root.x, root.y, 12, elbow[0], elbow[1], 8),
      (c) => this.capsule(c, elbow[0], elbow[1], 8, wrist[0], wrist[1], 5.5),
    ];
    this.limbGroup(ctx, arm, bone, () => {
      ctx.beginPath(); ctx.moveTo(root.x, root.y - 6); ctx.lineTo(elbow[0], elbow[1] - 4); ctx.lineTo(wrist[0], wrist[1] - 3);
      ctx.strokeStyle = far ? 'rgba(120,190,110,0.5)' : C.bodyLight; ctx.lineWidth = 4; ctx.stroke();
    });
    // thumb claw + wing tip claw
    const ta = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
    this.claw(ctx, wrist[0] + Math.cos(ta) * 4, wrist[1] + Math.sin(ta) * 4, ta - 0.5, 13);
    this.wingTips = tips;
  }

  // ---------------------------------------------------------------- head
  drawHead(ctx, base) {
    const R = this.rig, p = this.pose;
    const hm = base.mul(R.headMat);
    const jaw = R.jawAng;
    const hinge = [6, 20];
    const jm = hm.translate(hinge[0], hinge[1]).rotate(jaw).translate(-hinge[0], -hinge[1]);
    const angry = p.angry;
    this.headWorld = hm; this.jawWorld = jm;

    // --- back elements: far horn, frills
    hm.set(ctx);
    this.horn(ctx, 30, -74, 0.8, true);
    this.frills(ctx);

    // --- mouth interior
    const upperLip = [[22, 16], [44, 15], [80, 13], [108, 11], [134, 9], [152, 4]];
    const lowerTop = [[150, 9], [134, 11], [108, 13], [80, 14], [44, 15], [22, 16]];
    if (jaw > 0.004) {
      const lw = lowerTop.map(([x, y]) => jm.apply(x, y));
      const up = upperLip.map(([x, y]) => hm.apply(x, y));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cavity = (c) => {
        c.moveTo(...hm.apply(4, 18));
        up.forEach((q) => c.lineTo(q[0], q[1]));
        lw.forEach((q) => c.lineTo(q[0], q[1]));
        c.closePath();
      };
      ctx.beginPath(); cavity(ctx);
      const [gx, gy] = hm.apply(30, 22), [fx, fy] = hm.apply(140, 30);
      const g = ctx.createLinearGradient(gx, gy, fx, fy);
      g.addColorStop(0, C.throat); g.addColorStop(1, C.mouth);
      ctx.fillStyle = g; ctx.fill();
      if (p.glow > 0.01) {
        const [cx, cy] = hm.apply(60, 26);
        const fl = 0.8 + 0.2 * Math.sin(this.time * 29);
        const rg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 110 * Math.hypot(hm.a, hm.b));
        rg.addColorStop(0, `rgba(255,240,160,${p.glow * fl})`);
        rg.addColorStop(0.35, `rgba(255,160,40,${p.glow * 0.9 * fl})`);
        rg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.save(); ctx.beginPath(); cavity(ctx); ctx.clip();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = rg; ctx.fillRect(cx - 400, cy - 400, 800, 800); ctx.restore();
      }
      // gums along both jaws
      ctx.save(); ctx.beginPath(); cavity(ctx); ctx.clip();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = '#a8384c'; ctx.lineWidth = 9 * Math.hypot(hm.a, hm.b);
      ctx.beginPath(); up.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q[0], q[1])); ctx.stroke();
      ctx.beginPath(); lw.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q[0], q[1])); ctx.stroke();
      // palate ridges
      ctx.strokeStyle = 'rgba(150,40,60,0.6)'; ctx.lineWidth = 2 * Math.hypot(hm.a, hm.b);
      for (let x = 50; x < 130; x += 18) { const a = hm.apply(x, 13), b = jm.apply(x + 6, 15); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(lerp(a[0], b[0], 0.22), lerp(a[1], b[1], 0.22)); ctx.stroke(); }
      ctx.restore();
      // tongue (jaw space)
      jm.set(ctx);
      ctx.save(); ctx.beginPath(); ctx.setTransform(1, 0, 0, 1, 0, 0); cavity(ctx); ctx.clip(); jm.set(ctx);
      inkFill(ctx, (c) => splinePath(c, [[18, 26], [34, 4], [70, -3], [102, -1], [120, 8], [106, 20], [60, 24]]), p.glow > 0.3 ? '#f07050' : C.tongue, C.ink, 1.6);
      ctx.beginPath(); ctx.moveTo(44, 8); ctx.quadraticCurveTo(80, 2, 114, 8);
      ctx.strokeStyle = C.tongueDark; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }

    // --- lower jaw
    jm.set(ctx);
    const jawShape = (c) => splinePath(c, [[20, 15, 1], [80, 14], [120, 12], [148, 9, 1], [154, 17], [147, 29], [122, 38], [88, 44], [52, 46], [16, 42], [-8, 30], [-6, 18]]);
    inkFill(ctx, jawShape, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); jawShape(ctx); ctx.clip();
    ctx.beginPath(); splinePath(ctx, [[-20, 37], [40, 37], [96, 34], [138, 28], [165, 25], [165, 60], [-20, 60]]);
    ctx.fillStyle = C.belly; ctx.fill();
    ctx.beginPath(); splinePath(ctx, [[-20, 37], [40, 37], [96, 34], [138, 28], [165, 25]], false);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.filter = this.blur(3);
    ctx.fillStyle = C.bellyDark; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.ellipse(74, 51, 84, 7, -0.05, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(74, 29, 74, 5, -0.04, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // chin plates
    ctx.strokeStyle = C.plate; ctx.lineWidth = 1.5;
    for (let x = 30; x < 136; x += 15) { ctx.beginPath(); ctx.moveTo(x, 34 - x * 0.06); ctx.lineTo(x - 3, 46 - x * 0.08); ctx.stroke(); }
    ctx.restore();
    // lower teeth (hidden behind the upper jaw when closed)
    for (const [x, len] of [[56, 9], [72, 10], [88, 10], [104, 11], [120, 10]]) this.tooth(ctx, x, 14.5 - (x - 22) * 0.02, len, -1);

    // --- upper teeth (behind the lip, hanging down)
    hm.set(ctx);
    for (const [x, len] of [[46, 9], [60, 11], [74, 10], [88, 11], [102, 11], [118, 18], [138, 11]]) this.tooth(ctx, x, 11 - (x - 22) * 0.02, len, 1);

    // --- cheek web (skin connecting the jaws at the mouth corner)
    const cw = [hm.apply(46, 12), jm.apply(46, 17), jm.apply(4, 30), hm.apply(0, 16)];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (jaw > 0.02) {
      ctx.beginPath(); ctx.moveTo(...cw[0]);
      const mid = hm.apply(30, 16 + jaw * 30);
      ctx.quadraticCurveTo(mid[0], mid[1], cw[1][0], cw[1][1]);
      ctx.lineTo(...cw[2]); ctx.lineTo(...cw[3]); ctx.closePath();
      ctx.fillStyle = C.bodyDark; ctx.fill();
      ctx.beginPath(); ctx.moveTo(...cw[0]); ctx.quadraticCurveTo(mid[0], mid[1], cw[1][0], cw[1][1]);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2.6 * Math.hypot(hm.a, hm.b); ctx.stroke();
    }

    // --- skull
    hm.set(ctx);
    const skull = (c) => splinePath(c, [
      [-4, 32], [-32, 20], [-46, -8], [-40, -46], [-14, -74], [24, -84], [60, -78], [86, -58],
      [106, -45], [126, -41], [141, -44], [154, -34], [158, -15], [154, 3, 1], [136, 10], [108, 12],
      [80, 14], [44, 16], [22, 18], [8, 30],
    ]);
    inkFill(ctx, skull, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); skull(ctx); ctx.clip();
    ctx.filter = this.blur(4);
    // lower face shadow
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(70, 22, 110, 18, -0.04, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-22, 10, 22, 34, 0, 0, TAU); ctx.fill();
    // top-of-head + snout-plane highlights (3/4 view)
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(10, -58, 38, 15, -0.25, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(112, -34, 34, 7, -0.1, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // snout bridge line
    ctx.beginPath(); ctx.moveTo(90, -44); ctx.quadraticCurveTo(116, -30, 142, -30);
    ctx.strokeStyle = C.bodyDark; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    // scale dots on the forehead/snout
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.45;
    for (const [x, y, r] of [[98, -30, 2.4], [108, -22, 2], [120, -27, 2.2], [92, -18, 1.8], [-14, -30, 2.6], [-26, -14, 2.2], [-6, -46, 2.2]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.restore();

    // cheek muscle
    ctx.beginPath(); ctx.moveTo(30, 4); ctx.quadraticCurveTo(18, -12, -4, -8);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    // lip line accent
    ctx.beginPath(); ctx.moveTo(152, 4); ctx.quadraticCurveTo(100, 16, 22, 17);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4; ctx.stroke();

    // lower front fang shows over the lip (cute underbite)
    jm.set(ctx);
    this.tooth(ctx, 136, 11, 10, -1);

    // nostrils (both visible: head slightly turned to the viewer)
    hm.set(ctx);
    const flare = 1 + p.inhale * 0.5 + p.angry * 0.2;
    ctx.fillStyle = C.ink;
    ctx.save(); ctx.translate(145, -34); ctx.rotate(-0.4); ctx.beginPath(); ctx.ellipse(0, 0, 6 * flare, 3 * flare, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(135, -40); ctx.rotate(-0.3); ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.ellipse(0, 0, 4 * flare, 2 * flare, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(136, -26); ctx.quadraticCurveTo(146, -24, 154, -28);
    ctx.strokeStyle = C.bodyDark; ctx.lineWidth = 1.6; ctx.stroke();

    // eye + brow + horn
    this.eye(ctx, hm, angry);
    hm.set(ctx);
    this.horn(ctx, 10, -74, 0.95, false);
  }

  tooth(ctx, x, y, len, dir) {
    const w = Math.max(3.2, len * 0.42);
    inkFill(ctx, (c) => {
      c.moveTo(x - w, y - dir * 3);
      c.quadraticCurveTo(x - w * 0.6, y + dir * len * 0.7, x + w * 0.15, y + dir * len);
      c.quadraticCurveTo(x + w * 0.9, y + dir * len * 0.4, x + w, y - dir * 3);
      c.closePath();
    }, C.tooth, C.ink, 1.3);
  }

  horn(ctx, x, y, s, far) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const shape = (c) => splinePath(c, [[18, 8], [10, -12], [-8, -30], [-34, -42], [-62, -44, 1], [-38, -30], [-22, -14], [-14, 8]]);
    inkFill(ctx, shape, far ? C.hornShade : C.horn, C.ink, INK_W * 0.9);
    ctx.save(); ctx.beginPath(); shape(ctx); ctx.clip();
    ctx.fillStyle = far ? '#b9a679' : C.hornShade;
    ctx.beginPath(); splinePath(ctx, [[-62, -44, 1], [-38, -32], [-20, -18], [-6, 2], [30, 30], [-40, 30]]); ctx.fill();
    ctx.strokeStyle = far ? '#9d8a5f' : '#bfa877'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const u = 0.12 + i * 0.18;
      const ax = lerp(14, -50, u), ay = lerp(-2, -40, u), bx = lerp(-16, -52, u), by = lerp(6, -36, u);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 - 3, (ay + by) / 2 + 3, bx, by); ctx.stroke();
    }
    ctx.restore();
    if (!far) {
      ctx.beginPath(); ctx.moveTo(6, -12); ctx.quadraticCurveTo(-14, -30, -42, -38);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }

  frills(ctx) {
    const fin = (pts, col) => inkFill(ctx, (c) => splinePath(c, pts), col, C.ink, INK_W * 0.85);
    const sw = Math.sin(this.time * 2.1) * 2 + wobble(this.time * 40, 7) * this.pose.shake * 3;
    fin([[-20, 12], [-58, 24 + sw], [-48, 10, 1], [-66, 0 + sw], [-30, -10]], C.spike);
    fin([[-26, -16], [-60, -26 + sw], [-50, -32, 1], [-60, -50 + sw], [-20, -40]], C.spike);
    ctx.globalAlpha = 0.45;
    fin([[-30, 8], [-52, 18 + sw], [-40, 4]], C.spikeDark);
    ctx.globalAlpha = 1;
  }

  eye(ctx, hm, angry) {
    const p = this.pose;
    const m = hm.translate(62, -36).rotate(-0.1);
    m.set(ctx);
    const rx = 24, ry = 23;
    const white = (c) => c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    // socket shadow
    ctx.beginPath(); ctx.ellipse(-1, 2, rx + 6, ry + 6, 0, 0, TAU);
    ctx.fillStyle = 'rgba(20,70,35,0.55)'; ctx.fill();
    inkFill(ctx, white, C.eyeWhite, C.ink, 2.6);
    ctx.save(); ctx.beginPath(); white(ctx); ctx.clip();
    // iris / pupil, looking forward (and a bit at the viewer)
    const lookX = 5 + p.reach * 2, lookY = -1 + (p.inhale > 0.2 ? 2 : 0);
    const ir = 16;
    const ig = ctx.createRadialGradient(lookX - 2, lookY - 3, 2, lookX, lookY, ir);
    ig.addColorStop(0, '#fff3a0'); ig.addColorStop(0.45, '#ffc93a'); ig.addColorStop(0.85, '#e7811b'); ig.addColorStop(1, '#a6510f');
    ctx.beginPath(); ctx.arc(lookX, lookY, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
    ctx.strokeStyle = '#6b3208'; ctx.lineWidth = 1.6; ctx.stroke();
    // iris streaks
    ctx.strokeStyle = 'rgba(160,80,10,0.45)'; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      ctx.beginPath(); ctx.moveTo(lookX + Math.cos(a) * 6, lookY + Math.sin(a) * 6); ctx.lineTo(lookX + Math.cos(a) * 12.5, lookY + Math.sin(a) * 12.5); ctx.stroke();
    }
    const pw = lerp(5.2, 2.6, angry) + p.glow * 0.6;
    ctx.beginPath(); ctx.ellipse(lookX + 1, lookY, pw, 12, 0, 0, TAU); ctx.fillStyle = '#140a06'; ctx.fill();
    // highlights
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(lookX - 5, lookY - 6, 4.6, 3.8, -0.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(lookX + 5, lookY + 6, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    // fire reflection
    if (p.glow > 0.01) {
      ctx.fillStyle = `rgba(255,180,60,${0.5 * p.glow})`;
      ctx.beginPath(); ctx.arc(lookX + 7, lookY - 3, 3, 0, TAU); ctx.fill();
    }
    // upper eyelid (anger lowers its front, blinking closes it)
    const close = Math.max(this.blink, p.inhale * 0.35);
    const lidY = lerp(-ry - 9, ry + 2, close * 0.97);
    const tilt = angry * 9;
    ctx.beginPath();
    ctx.moveTo(-rx - 4, -ry - 10);
    ctx.lineTo(rx + 4, -ry - 10);
    ctx.lineTo(rx + 4, lidY + tilt + 6 - (1 - close) * 4);
    ctx.quadraticCurveTo(0, lidY + tilt * 0.4 + 6 + close * 8, -rx - 4, lidY - tilt * 0.5 + 2);
    ctx.closePath();
    ctx.fillStyle = C.body; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.6; ctx.stroke();
    // lower lid
    ctx.beginPath(); ctx.ellipse(0, ry + 14 - angry * 3, rx + 6, 10, 0, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineTo(rx + 8, ry + 20); ctx.lineTo(-rx - 8, ry + 20); ctx.closePath();
    ctx.fillStyle = C.body; ctx.fill();
    ctx.restore();
    ctx.beginPath(); white(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.8; ctx.stroke();
    // brow ridge
    const bA = -0.1 + angry * 0.3;
    ctx.save(); ctx.translate(2, -ry - 7 + angry * 6); ctx.rotate(bA);
    inkFill(ctx, (c) => splinePath(c, [[-30, 6], [-24, -6], [0, -12], [26, -6], [34, 2, 1], [8, 4], [-14, 8]]), C.body, C.ink, INK_W * 0.85);
    ctx.beginPath(); ctx.ellipse(-4, -5, 18, 3.5, 0, 0, TAU); ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------- anchors
  /** World (canvas) position + direction of the mouth for the fire emitter. */
  mouth(base) {
    const hm = base.mul(this.rig.headMat);
    const jm = hm.translate(6, 20).rotate(this.rig.jawAng).translate(-6, -20);
    const a = hm.apply(136, 8), b = jm.apply(136, 13);
    const inner = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const back = (() => { const u = hm.apply(70, 12), l = jm.apply(70, 14); return [(u[0] + l[0]) / 2, (u[1] + l[1]) / 2]; })();
    const dir = Math.atan2(inner[1] - back[1], inner[0] - back[0]);
    return { x: inner[0], y: inner[1], dir, gap: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  }
  nostril(base) {
    const hm = base.mul(this.rig.headMat);
    const q = hm.apply(145, -34); return { x: q[0], y: q[1], dir: hm.angle() - 0.6 };
  }
}
