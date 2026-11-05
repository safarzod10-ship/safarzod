// Demo scene: 9:16 stage, idle loop, eye-laser attack on button press.
import { Mat, TAU, clamp } from './util.js';
import { Dog } from './dog.js';
import { FX, GROUND_Y } from './fx.js';
import { samplePose, SEQ_DURATION, T } from './timeline.js';
import { DogAudio } from './audio.js';

const W = 540, H = 960;
const STEP = 1 / 120;
const PLACE = new Mat().translate(200, GROUND_Y).scale(1.22); // dog space -> stage

const params = new URLSearchParams(location.search);
const TRANSPARENT = params.has('transparent');
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const button = document.getElementById('play');
let dpr = 1;

const scene = { time: 0, seqStart: null, dog: new Dog(), fx: new FX() };

function resize(scale) {
  dpr = scale ?? Math.min(3, window.devicePixelRatio || 1) * (canvas.clientWidth / W || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
function seqTime() {
  if (scene.seqStart == null) return null;
  const s = scene.time - scene.seqStart;
  return s >= 0 && s <= SEQ_DURATION ? s : null;
}
function step(dt) {
  scene.time += dt;
  const s = seqTime();
  if (scene.seqStart != null && s == null && scene.time > scene.seqStart) { scene.seqStart = null; onSequenceEnd(); }
  const pose = samplePose(s);
  scene.dog.update(dt, pose);
  scene.eyes = scene.dog.eyes(PLACE);
  scene.fx.step(dt, scene.eyes, pose, W, H);
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
  g.addColorStop(0, '#0d1029'); g.addColorStop(0.55, '#1d2350'); g.addColorStop(0.8, '#262d63');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(250, 560, 20, 250, 560, 330);
  g.addColorStop(0, 'rgba(120,150,255,0.45)'); g.addColorStop(0.55, 'rgba(90,110,240,0.18)'); g.addColorStop(1, 'rgba(80,100,230,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(12,16,44,0.5)';
  ctx.beginPath(); ctx.moveTo(0, 760); ctx.bezierCurveTo(90, 700, 170, 712, 250, 738); ctx.bezierCurveTo(330, 764, 420, 690, 540, 724); ctx.lineTo(540, 810); ctx.lineTo(0, 810); ctx.fill();
  g = ctx.createLinearGradient(0, 780, 0, H);
  g.addColorStop(0, '#232a5a'); g.addColorStop(1, '#0f132d');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 792); ctx.quadraticCurveTo(270, 776, 540, 792); ctx.lineTo(540, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = 'rgba(160,190,255,0.55)';
  for (let i = 0; i < 16; i++) {
    const x = (i * 97.3 + scene.time * (5 + (i % 3) * 3)) % (W + 40) - 20;
    const y = 120 + ((i * 211.7) % 540) + Math.sin(scene.time * 0.7 + i) * 10;
    ctx.beginPath(); ctx.arc(x, y, 1.1 + (i % 3) * 0.6, 0, TAU); ctx.fill();
  }
  drawShadow();
}
function drawShadow() {
  ctx.fillStyle = 'rgba(4,6,20,0.45)';
  ctx.beginPath(); ctx.ellipse(195, GROUND_Y - 2, 180, 13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(4,6,20,0.3)';
  ctx.beginPath(); ctx.ellipse(195, GROUND_Y - 2, 120, 8, 0, 0, TAU); ctx.fill();
}

function render() {
  const view = new Mat(dpr, 0, 0, dpr, 0, 0);
  view.set(ctx);
  if (TRANSPARENT) { ctx.clearRect(0, 0, W, H); drawShadow(); } else drawBackground();
  scene.fx.drawScorch(ctx);
  // red laser light spilling on the ground
  const P = scene.fx.power;
  if (P > 0.01 && !TRANSPARENT) {
    const b = scene.fx.beams[0];
    const x = b && b.end.hit ? b.end.x : 470;
    const g = ctx.createRadialGradient(x, GROUND_Y, 10, x, GROUND_Y, 260);
    g.addColorStop(0, `rgba(255,60,90,${0.35 * P})`); g.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  scene.dog.draw(ctx, view.mul(PLACE), dpr * PLACE.a);
  view.set(ctx);
  scene.fx.drawSmoke(ctx);
  scene.fx.drawCharge(ctx);
  scene.fx.drawBeams(ctx);
  scene.fx.drawSparks(ctx);
  if (P > 0.01 && !TRANSPARENT) { ctx.fillStyle = `rgba(255,50,90,${0.06 * P})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- control
const audio = new DogAudio();
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
    reset() { scene.time = 0; scene.seqStart = null; simAcc = 0; scene.dog = new Dog(); scene.fx.reset(); step(STEP); render(); },
    start() { start(false); },
    advance(dt) { while (dt > 1e-9) { const d = Math.min(dt, 0.05); advance(d); dt -= d; } render(); },
    pressVisual(on) { button.classList.toggle('pressed', on); },
    async audioWav(lead, tail) { return audio.renderWavBase64(lead, tail); },
  };
}
