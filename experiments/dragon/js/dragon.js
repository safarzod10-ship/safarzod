// Procedurally drawn, skeletal-rigged cartoon ROBOT dragon.
//
// Dragon space: origin on the ground under the body, x to the right (the
// dragon faces right), y down, 1 unit ~ 1 px at scale 1.
//
// Rig:
//   spine  : tail (10 segments) -> hips -> belly -> chest -> neck (4) -> head
//            rendered as ONE continuous armoured tube with separate back/belly
//            widths, segment seams, rivets and a steel belly.
//   legs   : 4 legs, 2-bone IK, feet stay planted; joint discs at hip/knee/ankle.
//   wings  : strut arm + 4 finger rods + panelled membrane, near & far.
//   head   : armoured skull, hinged lower jaw driven by a hydraulic piston,
//            bellows at the mouth corner, a fully modelled mouth interior
//            (far jaw wall + far teeth, ribbed palate, segmented tongue,
//            flamethrower nozzle in the throat), lens eye with a shutter lid,
//            chrome antenna horns, vents, chest reactor.

import { DEG, TAU, Mat, clamp, lerp, smooth, wobble, splinePath, sampleSpline, inkFill, ik2, Spring } from './util.js';

const C = {
  // violet crystal-robot armour (palette after the reference art)
  ink: '#1c0b33',
  body: '#5a2fb4',
  bodyLight: '#a07cf0',
  bodyDark: '#351876',
  spec: '#f1e6ff',
  far: '#45238e',
  farDark: '#2b1260',
  belly: '#d2c8ea',
  bellyDark: '#9a8cc0',
  plate: '#7a6aa6',
  spike: '#a35cf0',
  spikeLight: '#e7b6ff',
  spikeDark: '#5f2aa8',
  horn: '#e6def5',
  hornShade: '#9d92bb',
  claw: '#ebe4f7',
  memb: '#b13cf0',
  membLight: '#f39bff',
  membDark: '#7a24b8',
  steel: '#6c6382',
  steelLight: '#c3badb',
  steelDark: '#3c3452',
  tooth: '#f2eefa',
  eyeGlass: '#150a24',
};
// glow colour: calm magenta -> charged electric blue (blue fire)
const glowRGB = (k) => [lerp(236, 90, k), lerp(96, 185, k), lerp(255, 255, k)];
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
      // steel edge on the fin
      ctx.beginPath(); ctx.moveTo(lerp(ax, tipx, 0.15), lerp(ay, tipy, 0.15)); ctx.lineTo(lerp(ax, tipx, 0.85), lerp(ay, tipy, 0.85));
      ctx.strokeStyle = C.spikeLight; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
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

    // metallic specular streak along the back
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...D(p, p.wt * 0.6)));
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.55; ctx.lineWidth = 2.6; ctx.stroke(); ctx.globalAlpha = 1;
    // longitudinal panel line
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...D(p, p.wt * 0.12)));
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
    // armour segment seams + rivets
    let nextSeam = 14;
    for (const p of pts) {
      if (p.s < nextSeam || p.s > total - 26) continue;
      const [x1, y1] = D(p, p.wt * 1.1);
      const [x2, y2] = V(p, p.wb * (1 - p.bf));
      const bend = -(p.wt + p.wb) * 0.12;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2 + p.tx * bend, (y1 + y2) / 2 + p.ty * bend, x2, y2);
      ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.8; ctx.stroke();
      // light edge on the plate in front of the seam (bevel)
      ctx.beginPath(); ctx.moveTo(x1 + p.tx * 2.2, y1 + p.ty * 2.2);
      ctx.quadraticCurveTo((x1 + x2) / 2 + p.tx * (bend + 2.2), (y1 + y2) / 2 + p.ty * (bend + 2.2), x2 + p.tx * 2.2, y2 + p.ty * 2.2);
      ctx.strokeStyle = C.bodyLight; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalAlpha = 1;
      if (p.wt > 12) {
        const r = clamp(p.wt * 0.05, 1.3, 2.4);
        for (const f of [0.75, 0.3]) {
          const [rx, ry] = D(p, p.wt * f);
          const cx = rx - p.tx * 5, cy = ry - p.ty * 5;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = C.bodyDark; ctx.fill();
          ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.5, 0, TAU); ctx.fillStyle = C.spec; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      nextSeam = p.s + clamp((p.wt + p.wb) * 0.33, 9, 24);
    }

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
      g.addColorStop(0, `rgba(90,180,255,${0.85 * glow * fl})`);
      g.addColorStop(1, 'rgba(60,120,255,0)');
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
    // energy conduit along the neck (heats up before the fire)
    if (glow > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      let started = false;
      for (const p of pts) { if (p.s < total - 120) continue; const q = V(p, p.wb * (1 - p.bf)); started ? ctx.lineTo(...q) : ctx.moveTo(...q); started = true; }
      ctx.strokeStyle = `rgba(90,190,255,${0.9 * glow})`; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    this.bodyPts = pts;
    // chest reactor on the steel belly plates
    const ci = pts.findIndex((p) => p.s > total - 150);
    if (ci > 0) {
      const p = pts[ci];
      const [cx, cy] = V(p, p.wb * 0.62);
      this.reactor(ctx, cx, cy, 13);
    }
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
    this.joint(ctx, 4, 0, 6);
    base.set(ctx);
  }

  // ---------------------------------------------------------------- mech parts
  /** Steel joint disc with a bolt. Uses the current transform. */
  joint(ctx, x, y, r, far = false) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, far ? '#8a989f' : C.steelLight); g.addColorStop(1, far ? C.steelDark : C.steel);
    inkFill(ctx, (c) => c.arc(x, y, r, 0, TAU), g, C.ink, 1.6);
    ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, TAU); ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fillStyle = C.steelDark; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.2, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
  }

  /** Glowing chest reactor: cyan idle pulse, charges to orange before the fire. */
  reactor(ctx, x, y, r) {
    const p = this.pose;
    const k = clamp(p.glow + p.angry * 0.35);
    const [cr, cg, cb] = glowRGB(k);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * (3 + p.glow * 20));
    inkFill(ctx, (c) => c.arc(x, y, r + 4, 0, TAU), C.steel, C.ink, 1.8);
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, TAU); ctx.strokeStyle = C.steelLight; ctx.lineWidth = 1.2; ctx.stroke();
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r + 1.6), y + Math.sin(a) * (r + 1.6), 0.9, 0, TAU); ctx.fillStyle = C.steelDark; ctx.fill(); }
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, `rgb(${cr | 0},${cg | 0},${cb | 0})`); g.addColorStop(1, `rgb(${cr * 0.35 | 0},${cg * 0.35 | 0},${cb * 0.35 | 0})`);
    inkFill(ctx, (c) => c.arc(x, y, r, 0, TAU), g, C.ink, 1.2);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const h = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
    h.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${0.45 * pulse})`); h.addColorStop(1, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
    ctx.restore();
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
    ctx.globalAlpha = 1;
    // armour seam on the thigh + actuator joints
    ctx.save(); ctx.translate(lerp(hip.x, kx, 0.42), lerp(hip.y, ky, 0.42)); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-30, 22); ctx.quadraticCurveTo(-8, -6, 30, -14);
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-34, -14); ctx.quadraticCurveTo(-6, -34, 24, -24);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = far ? 0.2 : 0.5; ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    this.joint(ctx, lerp(hip.x, kx, 0.3), lerp(hip.y, ky, 0.3), 13, far);
    this.joint(ctx, kx, ky, 9, far);
    this.joint(ctx, ank.x, ank.y, 6.5, far);
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
    // forearm armour seam + joints
    ctx.beginPath(); ctx.moveTo(lerp(ex, wr.x, 0.25) + 6, lerp(ey, wr.y, 0.25)); ctx.lineTo(lerp(ex, wr.x, 0.8) + 4, lerp(ey, wr.y, 0.8));
    ctx.strokeStyle = C.spec; ctx.globalAlpha = far ? 0.2 : 0.5; ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;
    this.joint(ctx, lerp(sh.x, ex, 0.32), lerp(sh.y, ey, 0.32), 11, far);
    this.joint(ctx, ex, ey, 8.5, far);
    this.joint(ctx, wr.x, wr.y, 6, far);
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
    g.addColorStop(0, far ? 'rgba(255,170,255,0.35)' : 'rgba(255,190,255,0.7)');
    g.addColorStop(0.55, 'rgba(230,110,255,0.12)');
    g.addColorStop(1, 'rgba(40,10,70,0.4)');
    ctx.fillStyle = g; ctx.fillRect(wrist[0] - 260, wrist[1] - 260, 520, 520);
    // armour panels: concentric seams between the finger rods
    for (const t of [0.42, 0.7]) {
      const q = tips.map((tp) => [lerp(wrist[0], tp[0], t), lerp(wrist[1], tp[1], t)]);
      ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < 4; i++) {
        const mx = (q[i - 1][0] + q[i][0]) / 2, my = (q[i - 1][1] + q[i][1]) / 2;
        ctx.quadraticCurveTo(lerp(mx, wrist[0], 0.12), lerp(my, wrist[1], 0.12), q[i][0], q[i][1]);
      }
      ctx.strokeStyle = far ? 'rgba(40,5,70,0.45)' : 'rgba(60,10,90,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = far ? 'rgba(255,170,255,0.3)' : 'rgba(255,200,255,0.6)'; ctx.lineWidth = 1.1;
      ctx.save(); ctx.translate(1.6, 1.6); ctx.stroke(); ctx.restore();
    }
    // a rivet in the middle of each panel
    for (let i = 0; i < 3; i++) for (const t of [0.3, 0.56, 0.82]) {
      const mx = (tips[i][0] + tips[i + 1][0]) / 2, my = (tips[i][1] + tips[i + 1][1]) / 2;
      ctx.beginPath(); ctx.arc(lerp(wrist[0], mx, t), lerp(wrist[1], my, t), 1.6, 0, TAU);
      ctx.fillStyle = far ? 'rgba(40,5,70,0.5)' : 'rgba(60,10,90,0.55)'; ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const mx = (tips[i][0] + tips[i + 1][0]) / 2, my = (tips[i][1] + tips[i + 1][1]) / 2;
      ctx.beginPath(); ctx.moveTo(lerp(wrist[0], mx, 0.12), lerp(wrist[1], my, 0.12));
      ctx.quadraticCurveTo(lerp(wrist[0], mx, 0.5) + 6, lerp(wrist[1], my, 0.5) - 4, lerp(wrist[0], mx, 0.9), lerp(wrist[1], my, 0.9));
      ctx.strokeStyle = far ? 'rgba(240,120,255,0.25)' : 'rgba(250,150,255,0.55)'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = far ? 'rgba(255,230,255,0.2)' : 'rgba(255,240,255,0.5)'; ctx.lineWidth = 0.9; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
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
    // thumb claw
    const ta = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
    this.claw(ctx, wrist[0] + Math.cos(ta) * 4, wrist[1] + Math.sin(ta) * 4, ta - 0.5, 13);
    // joints
    for (let i = 0; i < 4; i++) this.joint(ctx, knuck[i][0], knuck[i][1], 3.4, far);
    this.joint(ctx, elbow[0], elbow[1], 7, far);
    this.joint(ctx, wrist[0], wrist[1], 7.5, far);
    this.joint(ctx, root.x, root.y, 10, far);
    // navigation lights on the finger tips
    const [lr, lg, lb] = glowRGB(clamp(this.pose.angry * 0.5 + this.pose.glow));
    const blinkL = 0.55 + 0.45 * Math.sin(this.time * 4 + (far ? 1.5 : 0));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const tp of [tips[0], tips[2]]) {
      const g = ctx.createRadialGradient(tp[0], tp[1], 0.5, tp[0], tp[1], 9);
      g.addColorStop(0, `rgba(255,255,255,${blinkL * (far ? 0.5 : 0.9)})`);
      g.addColorStop(0.3, `rgba(${lr | 0},${lg | 0},${lb | 0},${blinkL * (far ? 0.4 : 0.7)})`);
      g.addColorStop(1, `rgba(${lr | 0},${lg | 0},${lb | 0},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tp[0], tp[1], 9, 0, TAU); ctx.fill();
    }
    ctx.restore();
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
    const S = Math.hypot(hm.a, hm.b); // px per head unit (for identity-space strokes)
    this.headWorld = hm; this.jawWorld = jm;
    const I = () => ctx.setTransform(1, 0, 0, 1, 0, 0);

    // --- back elements: far antenna, fins
    hm.set(ctx);
    this.horn(ctx, 30, -74, 0.8, true);
    this.frills(ctx);

    // --- mouth interior: what you see through the open jaws
    const upperLip = [[22, 16], [44, 15], [80, 13], [108, 11], [134, 9], [152, 4]];
    const lowerTop = [[150, 9], [134, 11], [108, 13], [80, 14], [44, 15], [22, 16]];
    if (jaw > 0.004) this.mouthInterior(ctx, hm, jm, upperLip, lowerTop, S);

    // --- lower jaw (armoured)
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
    // jaw armour: steel ribs underneath, a seam and a sheen
    ctx.strokeStyle = C.plate; ctx.lineWidth = 1.5;
    for (let x = 30; x < 136; x += 15) { ctx.beginPath(); ctx.moveTo(x, 34 - x * 0.06); ctx.lineTo(x - 3, 46 - x * 0.08); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(98, 13); ctx.quadraticCurveTo(94, 24, 98, 33);
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, 22); ctx.quadraticCurveTo(80, 20, 140, 16);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.45; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
    for (const [x, y] of [[88, 24], [108, 22]]) this.rivet(ctx, x, y);
    // lower teeth (hidden behind the upper jaw when closed)
    for (const [x, len] of [[56, 9], [72, 10], [88, 10], [104, 11], [120, 10]]) this.tooth(ctx, x, 14.5 - (x - 22) * 0.02, len, -1);

    // --- upper teeth (behind the lip, hanging down)
    hm.set(ctx);
    for (const [x, len] of [[46, 9], [60, 11], [74, 10], [88, 11], [102, 11], [118, 18], [138, 11]]) this.tooth(ctx, x, 11 - (x - 22) * 0.02, len, 1);

    // --- bellows at the mouth corner (flexible pleated rubber between the jaws)
    if (jaw > 0.02) {
      I();
      const e0 = hm.apply(28, 14), e1 = jm.apply(28, 17), e2 = jm.apply(4, 30), e3 = hm.apply(0, 16);
      const mid = hm.apply(18, 16 + jaw * 24);
      const bel = (c) => { c.moveTo(...e0); c.quadraticCurveTo(mid[0], mid[1], e1[0], e1[1]); c.lineTo(...e2); c.lineTo(...e3); c.closePath(); };
      ctx.beginPath(); bel(ctx); ctx.fillStyle = '#26333a'; ctx.fill();
      ctx.save(); ctx.beginPath(); bel(ctx); ctx.clip();
      for (let x = 6; x <= 26; x += 5) {
        const u = hm.apply(x, 14), l = jm.apply(x, 18);
        ctx.beginPath(); ctx.moveTo(...u); ctx.lineTo(...l);
        ctx.strokeStyle = '#56656d'; ctx.lineWidth = 2.2 * S; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(u[0] + S, u[1] + S); ctx.lineTo(l[0] + S, l[1] + S);
        ctx.strokeStyle = '#141d22'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(...e0); ctx.quadraticCurveTo(mid[0], mid[1], e1[0], e1[1]);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2.6 * S; ctx.stroke();
    }

    // --- armoured skull
    hm.set(ctx);
    const skull = (c) => splinePath(c, [
      [-4, 32], [-32, 20], [-46, -8], [-40, -46], [-14, -74], [24, -84], [60, -78], [86, -58],
      [106, -45], [126, -41], [141, -44], [154, -34], [158, -15], [154, 3, 1], [136, 10], [108, 12],
      [80, 14], [44, 16], [22, 18], [8, 30],
    ]);
    inkFill(ctx, skull, C.body, C.ink, INK_W);
    ctx.save(); ctx.beginPath(); skull(ctx); ctx.clip();
    ctx.filter = this.blur(4);
    ctx.fillStyle = C.bodyDark; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(70, 22, 110, 18, -0.04, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-22, 10, 22, 34, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bodyLight; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(10, -58, 38, 15, -0.25, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(112, -34, 34, 7, -0.1, 0, TAU); ctx.fill();
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    // metal sheen
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-26, -56); ctx.quadraticCurveTo(4, -78, 44, -76);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.7; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(98, -42); ctx.quadraticCurveTo(122, -36, 146, -38);
    ctx.lineWidth = 2.2; ctx.stroke(); ctx.globalAlpha = 1;
    // armour plate seams
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(94, -54); ctx.quadraticCurveTo(84, -22, 92, 12); ctx.stroke();      // snout plate
    ctx.beginPath(); ctx.moveTo(-42, 2); ctx.quadraticCurveTo(-8, -10, 30, 12); ctx.stroke();       // cheek plate
    ctx.beginPath(); ctx.moveTo(-30, -60); ctx.quadraticCurveTo(-18, -40, -38, -20); ctx.stroke(); // cranium plate
    ctx.globalAlpha = 1;
    ctx.restore();
    for (const [x, y] of [[100, -36], [102, -10], [-30, -2], [0, -8], [-26, -48], [124, -26]]) this.rivet(ctx, x, y);
    // cooling vents behind the eye
    const [vr, vg, vb] = glowRGB(clamp(p.glow + angry * 0.4));
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.translate(-22 + i * 9, -34 + i * 3); ctx.rotate(0.35);
      inkFill(ctx, (c) => c.roundRect(-2.6, -10, 5.2, 20, 2.6), '#142027', C.ink, 1.2);
      ctx.fillStyle = `rgba(${vr | 0},${vg | 0},${vb | 0},${0.35 + 0.55 * p.glow})`;
      ctx.fillRect(-1, -7, 2, 14);
      ctx.restore();
    }
    // lip line accent
    ctx.beginPath(); ctx.moveTo(152, 4); ctx.quadraticCurveTo(100, 16, 22, 17);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4; ctx.stroke();

    // lower front fang shows over the lip
    jm.set(ctx);
    this.tooth(ctx, 136, 11, 10, -1);

    // --- jaw hydraulics: piston from the cheek to the jaw + hinge disc
    I();
    const pa = hm.apply(30, -6), pb = jm.apply(22, 36);
    const pd = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const ux = (pb[0] - pa[0]) / pd, uy = (pb[1] - pa[1]) / pd;
    const housing = 24 * S;
    const hb = [pa[0] + ux * housing, pa[1] + uy * housing];
    ctx.lineCap = 'round';
    const rod = (a, b, w, col) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = C.ink; ctx.lineWidth = (w + 3.2) * S; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w * S; ctx.stroke(); };
    rod(hb, pb, 4.4, '#dfe7ea');
    ctx.beginPath(); ctx.moveTo(hb[0] - uy * S, hb[1] + ux * S); ctx.lineTo(pb[0] - uy * S, pb[1] + ux * S);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 * S; ctx.stroke();
    rod(pa, hb, 9, C.steel);
    ctx.beginPath(); ctx.moveTo(pa[0] - uy * 2.2 * S, pa[1] + ux * 2.2 * S); ctx.lineTo(hb[0] - uy * 2.2 * S, hb[1] + ux * 2.2 * S);
    ctx.strokeStyle = C.steelLight; ctx.lineWidth = 2 * S; ctx.stroke();
    hm.set(ctx);
    this.joint(ctx, 30, -6, 6);
    jm.set(ctx);
    this.joint(ctx, 22, 36, 5.5);
    hm.set(ctx);
    this.joint(ctx, hinge[0], hinge[1], 11);

    // nostril vents (both visible: head slightly turned to the viewer)
    const flare = 1 + p.inhale * 0.4 + p.angry * 0.15;
    for (const [x, y, rx, ry, rot, al] of [[145, -34, 6.5, 3, -0.4, 1], [135, -40, 4.5, 2.2, -0.3, 0.85]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = al;
      inkFill(ctx, (c) => c.ellipse(0, 0, rx * flare, ry * flare, 0, 0, TAU), '#142027', C.ink, 1.2);
      ctx.fillStyle = `rgba(${vr | 0},${vg | 0},${vb | 0},${0.3 + 0.6 * p.glow})`;
      ctx.beginPath(); ctx.ellipse(0, 0.5, rx * flare * 0.6, ry * flare * 0.4, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // eye + brow + antenna
    this.eye(ctx, hm, angry);
    hm.set(ctx);
    this.horn(ctx, 10, -74, 0.95, false);
  }

  /** Inside of the mouth, seen through the open jaws (never an empty black hole). */
  mouthInterior(ctx, hm, jm, upperLip, lowerTop, S) {
    const p = this.pose;
    const lw = lowerTop.map(([x, y]) => jm.apply(x, y));
    const up = upperLip.map(([x, y]) => hm.apply(x, y));
    const cavity = (c) => {
      c.moveTo(...hm.apply(4, 18));
      up.forEach((q) => c.lineTo(q[0], q[1]));
      lw.forEach((q) => c.lineTo(q[0], q[1]));
      c.closePath();
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); cavity(ctx); ctx.clip();

    // 1) far inner wall only at the back of the mouth (cheek + throat). In front of
    //    it the jaws are open: the background behind the head shows through the gap.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const wallUp = upperLip.filter(([x]) => x <= 80).map(([x, y]) => hm.apply(x, y));
    const wallLo = lowerTop.filter(([x]) => x <= 80).map(([x, y]) => jm.apply(x, y));
    const A = hm.apply(84, 13), B = jm.apply(70, 15), H0 = hm.apply(4, 18);
    const ctl = [lerp((A[0] + B[0]) / 2, H0[0], 0.3), lerp((A[1] + B[1]) / 2, H0[1], 0.3)];
    const wall = (c) => {
      c.moveTo(...H0);
      wallUp.forEach((q) => c.lineTo(q[0], q[1]));
      c.lineTo(...A);
      c.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]);
      wallLo.forEach((q) => c.lineTo(q[0], q[1]));
      c.closePath();
    };
    const [wx0, wy0] = hm.apply(10, 22), [wx1, wy1] = hm.apply(84, 22);
    let g = ctx.createLinearGradient(wx0, wy0, wx1, wy1);
    g.addColorStop(0, '#26333a'); g.addColorStop(1, '#6f8089');
    ctx.beginPath(); wall(ctx); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.beginPath(); wall(ctx); ctx.clip();
    for (const x of [40, 62]) {
      const a = hm.apply(x, 12), b = jm.apply(x - 4, 16);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b);
      ctx.strokeStyle = 'rgba(15,25,30,0.6)'; ctx.lineWidth = 1.6 * S; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0] + 1.6 * S, a[1]); ctx.lineTo(b[0] + 1.6 * S, b[1]);
      ctx.strokeStyle = 'rgba(190,205,212,0.3)'; ctx.lineWidth = 1 * S; ctx.stroke();
    }
    ctx.restore();
    // edge of the far cheek plate
    ctx.beginPath(); ctx.moveTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2 * S; ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = 'rgba(200,215,222,0.45)'; ctx.lineWidth = 1 * S;
    ctx.save(); ctx.translate(-1.5 * S, 0); ctx.beginPath(); ctx.moveTo(...A); ctx.quadraticCurveTo(ctl[0], ctl[1], B[0], B[1]); ctx.stroke(); ctx.restore();

    // 2) ribbed palate under the upper jaw
    hm.set(ctx);
    ctx.beginPath();
    upperLip.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, y - 2));
    for (let i = upperLip.length - 1; i >= 0; i--) ctx.lineTo(upperLip[i][0] - 2, upperLip[i][1] + 7);
    ctx.closePath();
    ctx.fillStyle = '#8796a0'; ctx.fill();
    ctx.strokeStyle = 'rgba(30,42,48,0.7)'; ctx.lineWidth = 1.4;
    for (let x = 34; x < 148; x += 9) { ctx.beginPath(); ctx.moveTo(x, 14 - (x - 22) * 0.07); ctx.lineTo(x - 2, 20 - (x - 22) * 0.07); ctx.stroke(); }
    ctx.beginPath(); upperLip.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x - 2, y + 7));
    ctx.strokeStyle = 'rgba(20,30,36,0.8)'; ctx.lineWidth = 1.8; ctx.stroke();

    // 3) teeth of the FAR side of the jaws (darker, slightly offset)
    for (const [x, len] of [[52, 8], [66, 10], [80, 9], [94, 10], [110, 14], [128, 9]]) this.tooth(ctx, x, 19 - (x - 22) * 0.03, len, 1, true);
    jm.set(ctx);
    // floor of the mouth (steel tray) + far lower teeth
    ctx.beginPath();
    lowerTop.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, y + 2));
    for (let i = lowerTop.length - 1; i >= 0; i--) ctx.lineTo(lowerTop[i][0] - 2, lowerTop[i][1] - 6);
    ctx.closePath(); ctx.fillStyle = '#6d7c85'; ctx.fill();
    ctx.beginPath(); lowerTop.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x - 2, y - 6)); ctx.strokeStyle = 'rgba(20,30,36,0.8)'; ctx.lineWidth = 1.6; ctx.stroke();
    for (const [x, len] of [[54, 8], [70, 9], [86, 9], [102, 10], [118, 9]]) this.tooth(ctx, x - 5, 7 - (x - 22) * 0.02, len, -1, true);

    // 4) segmented tongue
    const tongue = (c) => splinePath(c, [[18, 26], [30, 8], [62, 4], [96, 6], [114, 10], [100, 19], [60, 22]]);
    const tg = ctx.createLinearGradient(0, -2, 0, 22);
    tg.addColorStop(0, p.glow > 0.3 ? '#8fc4ff' : '#c58ae6'); tg.addColorStop(1, '#4a2470');
    inkFill(ctx, tongue, tg, C.ink, 1.4);
    ctx.save(); ctx.beginPath(); tongue(ctx); ctx.clip();
    for (let x = 38; x < 120; x += 14) {
      ctx.beginPath(); ctx.moveTo(x, -4); ctx.quadraticCurveTo(x + 4, 10, x, 24);
      ctx.strokeStyle = 'rgba(30,10,50,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 2.5, -4); ctx.quadraticCurveTo(x + 6.5, 10, x + 2.5, 24);
      ctx.strokeStyle = 'rgba(240,210,255,0.35)'; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(36, 9); ctx.quadraticCurveTo(74, 5, 106, 9);
    ctx.strokeStyle = 'rgba(245,225,255,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();

    // 6) depth: soft shadow at the back of the throat + under the upper jaw
    ctx.filter = this.blur(3);
    ctx.fillStyle = 'rgba(8,14,18,0.45)';
    ctx.beginPath(); ctx.ellipse(26, 24, 16, 14, 0, 0, TAU); ctx.fill();
    ctx.filter = 'none';

    // 5) flamethrower nozzle deep in the throat
    hm.set(ctx);
    const open = clamp(this.jaw / 0.45);
    const nx = 52, ny = 27, nr = 10 * (0.35 + 0.65 * open);
    const k = clamp(p.glow * 1.2);
    const [cr, cg, cb] = glowRGB(Math.max(k, p.angry * 0.6));
    inkFill(ctx, (c) => c.arc(nx, ny, nr + 4, 0, TAU), C.steel, C.ink, 1.4);
    ctx.beginPath(); ctx.arc(nx, ny, nr + 2, 0, TAU); ctx.strokeStyle = C.steelLight; ctx.lineWidth = 1; ctx.stroke();
    const ng = ctx.createRadialGradient(nx, ny, 0.5, nx, ny, nr);
    ng.addColorStop(0, `rgba(255,255,255,${0.35 + 0.65 * k})`);
    ng.addColorStop(0.4, `rgba(${cr | 0},${cg | 0},${cb | 0},${0.55 + 0.45 * k})`);
    ng.addColorStop(1, '#10181c');
    ctx.beginPath(); ctx.arc(nx, ny, nr, 0, TAU); ctx.fillStyle = ng; ctx.fill();

    // 7) fire light filling the mouth while charging / breathing fire
    if (p.glow > 0.01) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const [cx, cy] = hm.apply(50, 26);
      const fl = 0.8 + 0.2 * Math.sin(this.time * 29);
      const rg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 120 * S);
      rg.addColorStop(0, `rgba(200,240,255,${0.9 * p.glow * fl})`);
      rg.addColorStop(0.35, `rgba(60,150,255,${0.55 * p.glow * fl})`);
      rg.addColorStop(1, 'rgba(40,80,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rg; ctx.fillRect(cx - 400, cy - 400, 800, 800);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  rivet(ctx, x, y, r = 2.1) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = C.bodyDark; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, TAU); ctx.fillStyle = C.spec; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
  }

  tooth(ctx, x, y, len, dir, far = false) {
    const w = Math.max(3.2, len * 0.42);
    const shape = (c) => {
      c.moveTo(x - w, y - dir * 3);
      c.quadraticCurveTo(x - w * 0.6, y + dir * len * 0.7, x + w * 0.15, y + dir * len);
      c.quadraticCurveTo(x + w * 0.9, y + dir * len * 0.4, x + w, y - dir * 3);
      c.closePath();
    };
    inkFill(ctx, shape, far ? '#9eabb2' : C.tooth, C.ink, far ? 1 : 1.3);
    // chrome: darker half + sharp edge glint
    ctx.beginPath();
    ctx.moveTo(x + w * 0.15, y + dir * len); ctx.quadraticCurveTo(x + w * 0.9, y + dir * len * 0.4, x + w, y - dir * 3); ctx.lineTo(x + w * 0.2, y - dir * 3); ctx.closePath();
    ctx.fillStyle = far ? 'rgba(40,55,62,0.35)' : 'rgba(110,128,138,0.45)'; ctx.fill();
  }

  horn(ctx, x, y, s, far) {
    // chrome antenna-horn with ring bands
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const shape = (c) => splinePath(c, [[18, 8], [10, -12], [-8, -30], [-34, -42], [-62, -44, 1], [-38, -30], [-22, -14], [-14, 8]]);
    const g = ctx.createLinearGradient(-10, -40, 10, 0);
    if (far) { g.addColorStop(0, '#b3c0c6'); g.addColorStop(1, '#6d7c84'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#d6dfe3'); g.addColorStop(0.55, '#8d9ca4'); g.addColorStop(1, '#c9d3d8'); }
    inkFill(ctx, shape, g, C.ink, INK_W * 0.9);
    ctx.save(); ctx.beginPath(); shape(ctx); ctx.clip();
    ctx.fillStyle = far ? 'rgba(40,55,62,0.35)' : 'rgba(80,98,108,0.4)';
    ctx.beginPath(); splinePath(ctx, [[-62, -44, 1], [-38, -32], [-20, -18], [-6, 2], [30, 30], [-40, 30]]); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const u = 0.16 + i * 0.22;
      const ax = lerp(14, -50, u), ay = lerp(-2, -40, u), bx = lerp(-16, -52, u), by = lerp(6, -36, u);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2 - 3, (ay + by) / 2 + 3, bx, by);
      ctx.strokeStyle = far ? '#4d5b62' : C.steelDark; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.save(); ctx.translate(2, -1.5); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    if (!far) {
      ctx.beginPath(); ctx.moveTo(6, -12); ctx.quadraticCurveTo(-14, -30, -42, -38);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke();
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
    ctx.strokeStyle = C.spikeLight; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-28, -2); ctx.lineTo(-58, 2 + sw); ctx.moveTo(-28, -28); ctx.lineTo(-56, -44 + sw); ctx.stroke();
  }

  eye(ctx, hm, angry) {
    // camera-lens eye: steel bezel, dark glass, glowing iris ring, shutter lid
    const p = this.pose;
    const m = hm.translate(62, -36).rotate(-0.1);
    m.set(ctx);
    const rx = 24, ry = 23;
    const glass = (c) => c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    const bez = ctx.createLinearGradient(-rx, -ry, rx, ry);
    bez.addColorStop(0, C.steelLight); bez.addColorStop(1, C.steelDark);
    inkFill(ctx, (c) => c.ellipse(0, 1, rx + 6, ry + 6, 0, 0, TAU), bez, C.ink, 2);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2; ctx.beginPath(); ctx.arc(Math.cos(a) * (rx + 3), 1 + Math.sin(a) * (ry + 3), 1.1, 0, TAU); ctx.fillStyle = C.steelDark; ctx.fill(); }
    inkFill(ctx, glass, C.eyeGlass, C.ink, 2.2);
    ctx.save(); ctx.beginPath(); glass(ctx); ctx.clip();
    const lookX = 5 + p.reach * 2, lookY = -1 + (p.inhale > 0.2 ? 2 : 0);
    const [r, g, b] = glowRGB(clamp(p.glow));
    const ir = 16.5;
    const ig = ctx.createRadialGradient(lookX, lookY, 2, lookX, lookY, ir);
    ig.addColorStop(0, '#ffffff');
    ig.addColorStop(0.3, `rgb(${r | 0},${g | 0},${b | 0})`);
    ig.addColorStop(0.8, `rgb(${r * 0.55 | 0},${g * 0.55 | 0},${b * 0.55 | 0})`);
    ig.addColorStop(1, `rgb(${r * 0.2 | 0},${g * 0.2 | 0},${b * 0.2 | 0})`);
    ctx.beginPath(); ctx.arc(lookX, lookY, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
    // lens rings + aperture blades
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (const rr of [7, 11.5, 15]) { ctx.beginPath(); ctx.arc(lookX, lookY, rr, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(lookX + Math.cos(a) * 7.5, lookY + Math.sin(a) * 7.5); ctx.lineTo(lookX + Math.cos(a + 0.5) * 14.5, lookY + Math.sin(a + 0.5) * 14.5); ctx.stroke(); }
    const pw = lerp(5.4, 2.4, angry) + p.glow * 0.6;
    ctx.beginPath(); ctx.ellipse(lookX + 1, lookY, pw, 11, 0, 0, TAU); ctx.fillStyle = '#05080a'; ctx.fill();
    // glass reflections
    ctx.beginPath(); ctx.ellipse(-8, -10, 10, 5, -0.6, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lookX + 6, lookY + 7, 2, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    if (p.glow > 0.01) { ctx.fillStyle = `rgba(120,200,255,${0.6 * p.glow})`; ctx.beginPath(); ctx.arc(lookX + 8, lookY - 4, 3, 0, TAU); ctx.fill(); }
    // shutter lid (anger lowers its front, blinking closes it)
    const close = Math.max(this.blink, p.inhale * 0.35);
    const lidY = lerp(-ry - 9, ry + 2, close * 0.97);
    const tilt = angry * 9;
    const lid = (c) => {
      c.moveTo(-rx - 4, -ry - 10);
      c.lineTo(rx + 4, -ry - 10);
      c.lineTo(rx + 4, lidY + tilt + 6 - (1 - close) * 4);
      c.quadraticCurveTo(0, lidY + tilt * 0.4 + 6 + close * 8, -rx - 4, lidY - tilt * 0.5 + 2);
      c.closePath();
    };
    ctx.beginPath(); lid(ctx); ctx.fillStyle = C.body; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-rx - 4, lidY - tilt * 0.5 - 3); ctx.quadraticCurveTo(0, lidY + tilt * 0.4 + 1 + close * 8, rx + 4, lidY + tilt + 1 - (1 - close) * 4);
    ctx.strokeStyle = C.bodyLight; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    // lower lid plate
    ctx.beginPath(); ctx.ellipse(0, ry + 14 - angry * 3, rx + 6, 10, 0, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineTo(rx + 8, ry + 20); ctx.lineTo(-rx - 8, ry + 20); ctx.closePath();
    ctx.fillStyle = C.steel; ctx.fill();
    ctx.restore();
    ctx.beginPath(); glass(ctx); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.6; ctx.stroke();
    // lens glow halo
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const h = ctx.createRadialGradient(lookX, lookY, 4, lookX, lookY, 34);
    h.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.25 + 0.2 * angry})`); h.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(lookX, lookY, 34, 0, TAU); ctx.fill();
    ctx.restore();
    // brow plate
    const bA = -0.1 + angry * 0.3;
    ctx.save(); ctx.translate(2, -ry - 7 + angry * 6); ctx.rotate(bA);
    inkFill(ctx, (c) => splinePath(c, [[-30, 6], [-24, -6], [0, -12], [26, -6], [34, 2, 1], [8, 4], [-14, 8]]), C.body, C.ink, INK_W * 0.85);
    ctx.beginPath(); ctx.moveTo(-22, -4); ctx.quadraticCurveTo(0, -10, 22, -4);
    ctx.strokeStyle = C.spec; ctx.globalAlpha = 0.75; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    this.rivet(ctx, -16, 2, 1.7); this.rivet(ctx, 14, 0, 1.7);
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
