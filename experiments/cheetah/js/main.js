// Demo scene: 9:16 stage, idle loop, lightning pounce + claw strike on button press.
import { Mat, TAU } from './util.js';
import { Cheetah } from './cheetah.js';
import { FX, GROUND_Y } from './fx.js';
import { samplePose, SEQ_DURATION, T } from './timeline.js';
import { CheetahAudio } from './audio.js';

const W = 540, H = 960;
const STEP = 1 / 120;
const SCALE = 1.0;
const PLACE = new Mat().translate(206, GROUND_Y).scale(SCALE);

const params = new URLSearchParams(location.search);
const TRANSPARENT = params.has('transparent');
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const button = document.getElementById('play');
const off = document.createElement('canvas');   // current frame of the cheetah (for afterimages)
const tint = document.createElement('canvas');  // tinted copy
let dpr = 1;

const scene = { time: 0, seqStart: null, cat: new Cheetah(), fx: new FX(), prevS: null, prevX: 0, speed: 0, trail: [] };

function resize(scale) {
  dpr = scale ?? Math.min(3, window.devicePixelRatio || 1) * (canvas.clientWidth / W || 1);
  for (const c of [canvas, off, tint]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
}
function seqTime() {
  if (scene.seqStart == null) return null;
  const s = scene.time - scene.seqStart;
  return s >= 0 && s <= SEQ_DURATION ? s : null;
}
const crossed = (a, b, t) => a != null && b != null && a < t && b >= t;

function step(dt) {
  scene.time += dt;
  const s = seqTime();
  if (scene.seqStart != null && s == null && scene.time > scene.seqStart) { scene.seqStart = null; onSequenceEnd(); }
  const pose = samplePose(s);
  scene.cat.update(dt, pose);
  const a = scene.cat.anchors(PLACE);
  const fx = scene.fx;
  const ps = scene.prevS;
  if (crossed(ps, s, T.pounce)) fx.kick(a.root[0] - 60, 22, 1);
  if (crossed(ps, s, T.land)) fx.kick(a.root[0] + 30, 16, -1);
  if (crossed(ps, s, T.slash1)) fx.slash(a.pawNear[0], a.pawNear[1]);
  if (crossed(ps, s, T.slash2)) fx.slash(a.pawFar[0] + 8, a.pawFar[1] - 6, true);
  if (crossed(ps, s, T.dashBack)) fx.kick(a.root[0] + 40, 16, -1);
  if (crossed(ps, s, T.home)) fx.kick(a.root[0], 14, 1);
  scene.prevS = s;
  const x = pose.rootX * SCALE;
  scene.speed = (x - scene.prevX) / dt;
  scene.prevX = x;
  // afterimage trail (root positions, newest first)
  scene.trailAcc = (scene.trailAcc || 0) + dt;
  if (scene.trailAcc >= 1 / 60) {
    scene.trailAcc = 0;
    scene.trail.unshift({ x, y: pose.rootY * SCALE, fast: Math.abs(scene.speed) > 260 });
    scene.trail.length = Math.min(scene.trail.length, 8);
  }
  fx.step(dt, a, pose, scene.speed);
  scene.pose = pose;
}
let simAcc = 0;
function advance(dt) {
  simAcc += Math.min(dt, 0.25);
  while (simAcc >= STEP) { simAcc -= STEP; step(STEP); }
}

// ---------------------------------------------------------------- drawing
function drawBackground() {
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e1028'); g.addColorStop(0.55, '#22204a'); g.addColorStop(0.8, '#2c2752');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(260, 560, 20, 260, 560, 330);
  g.addColorStop(0, 'rgba(255,190,110,0.32)'); g.addColorStop(0.55, 'rgba(230,140,80,0.12)'); g.addColorStop(1, 'rgba(200,120,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(14,12,36,0.55)';
  ctx.beginPath(); ctx.moveTo(0, 762); ctx.bezierCurveTo(100, 704, 180, 716, 260, 740); ctx.bezierCurveTo(340, 764, 430, 698, 540, 726); ctx.lineTo(540, 810); ctx.lineTo(0, 810); ctx.fill();
  g = ctx.createLinearGradient(0, 780, 0, H);
  g.addColorStop(0, '#2b2650'); g.addColorStop(1, '#13112a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 792); ctx.quadraticCurveTo(270, 776, 540, 792); ctx.lineTo(540, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = 'rgba(255,220,170,0.5)';
  for (let i = 0; i < 16; i++) {
    const x = (i * 97.3 + scene.time * (5 + (i % 3) * 3)) % (W + 40) - 20;
    const y = 120 + ((i * 211.7) % 540) + Math.sin(scene.time * 0.7 + i) * 10;
    ctx.beginPath(); ctx.arc(x, y, 1.1 + (i % 3) * 0.6, 0, TAU); ctx.fill();
  }
}
function drawShadow() {
  const x = 206 + scene.prevX, lift = Math.max(0, -(scene.pose?.rootY || 0)) / 46;
  ctx.fillStyle = `rgba(4,4,16,${0.45 * (1 - lift * 0.5)})`;
  ctx.beginPath(); ctx.ellipse(x - 8, GROUND_Y - 2, 170 * (1 - lift * 0.25), 12, 0, 0, TAU); ctx.fill();
}

function render() {
  const view = new Mat(dpr, 0, 0, dpr, 0, 0);
  view.set(ctx);
  if (TRANSPARENT) ctx.clearRect(0, 0, W, H); else drawBackground();
  drawShadow();
  scene.fx.drawBack(ctx);
  // draw the cheetah into an offscreen layer, then trail + main image
  const octx = off.getContext('2d');
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, off.width, off.height);
  scene.cat.draw(octx, view.mul(PLACE), dpr * SCALE);
  const ghosts = scene.trail.filter((g, i) => i > 0 && g.fast);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ghosts.length) {
    const tctx = tint.getContext('2d');
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, tint.width, tint.height); tctx.drawImage(off, 0, 0);
    tctx.globalCompositeOperation = 'source-atop'; tctx.fillStyle = 'rgba(90,220,255,0.75)'; tctx.fillRect(0, 0, tint.width, tint.height);
    const now = scene.trail[0];
    scene.trail.forEach((g, i) => {
      if (i === 0 || !g.fast) return;
      ctx.globalAlpha = 0.42 * (1 - i / scene.trail.length);
      ctx.drawImage(tint, (g.x - now.x) * dpr * 2.2, (g.y - now.y) * dpr);
    });
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(off, 0, 0);
  view.set(ctx);
  scene.fx.drawFront(ctx, W, H);
}

// ---------------------------------------------------------------- control
const audio = new CheetahAudio();
function start(withSound = true) {
  scene.seqStart = scene.time + 0.05;
  button.disabled = true; button.classList.add('busy');
  if (withSound) audio.play(0.05);
}
function onSequenceEnd() { button.disabled = false; button.classList.remove('busy'); }
button.addEventListener('click', () => { if (scene.seqStart == null) start(true); });

if (!params.has('capture')) {
  resize();
  window.addEventListener('resize', () => resize());
  step(STEP);
  let last = performance.now();
  const loop = (now) => { requestAnimationFrame(loop); advance((now - last) / 1000); last = now; render(); };
  requestAnimationFrame(loop);
} else {
  resize(2);
  window.__capture = {
    duration: SEQ_DURATION,
    phases: T,
    reset() { scene.time = 0; scene.seqStart = null; scene.prevS = null; scene.prevX = 0; scene.trail = []; simAcc = 0; scene.cat = new Cheetah(); scene.fx.reset(); step(STEP); render(); },
    start() { start(false); },
    advance(dt) { while (dt > 1e-9) { const d = Math.min(dt, 0.05); advance(d); dt -= d; } render(); },
    pressVisual(on) { button.classList.toggle('pressed', on); },
    async audioWav(lead, tail) { return audio.renderWavBase64(lead, tail); },
  };
}
