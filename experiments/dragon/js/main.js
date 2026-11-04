// Demo scene: 9:16 stage, idle loop, roar + fire sequence on button press.
import { Mat, TAU, clamp, lerp, wobble } from './util.js';
import { Dragon } from './dragon.js';
import { FX } from './fx.js';
import { samplePose, SEQ_DURATION, T } from './timeline.js';
import { DragonAudio } from './audio.js';

const W = 540, H = 960;          // logical stage size (9:16)
const STEP = 1 / 120;            // fixed simulation step
const PLACE = new Mat().translate(222, 800).scale(0.9); // dragon space -> stage

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const button = document.getElementById('play');
let dpr = 1;

const scene = {
  time: 0,          // simulated time
  seqStart: null,   // sim time when the sequence started
  dragon: new Dragon(),
  fx: new FX(),
  rings: [],
};

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
  if (scene.seqStart != null && s == null && scene.time > scene.seqStart) {
    scene.seqStart = null;
    onSequenceEnd();
  }
  const pose = samplePose(s);
  scene.dragon.update(dt, pose);
  const mouth = scene.dragon.mouth(PLACE);
  const nose = scene.dragon.nostril(PLACE);
  scene.mouth = mouth;
  scene.fx.step(dt, mouth, nose, pose.fire, pose.smoke);
  // roar shock rings
  if (pose.shake > 0.5 && pose.fire < 0.05) {
    scene.ringAcc = (scene.ringAcc || 0) + dt;
    if (scene.ringAcc > 0.16) { scene.ringAcc = 0; scene.rings.push({ x: mouth.x, y: mouth.y, dir: mouth.dir, age: 0 }); }
  }
  for (const r of scene.rings) r.age += dt;
  scene.rings = scene.rings.filter((r) => r.age < 0.55);
  scene.pose = pose;
}

let simAcc = 0;
function advance(dt) {
  simAcc += Math.min(dt, 0.25); // keeps real-time pace (and audio sync); clamps only tab switches
  while (simAcc >= STEP) { simAcc -= STEP; step(STEP); }
}

// ---------------------------------------------------------------- drawing
function drawBackground() {
  const fire = scene.fx.intensity;
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#9fcfdc');
  g.addColorStop(0.55, '#e4efe2');
  g.addColorStop(0.8, '#f6e9cf');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // soft sun disc behind the dragon
  g = ctx.createRadialGradient(270, 480, 20, 270, 480, 330);
  g.addColorStop(0, 'rgba(255,252,236,0.95)');
  g.addColorStop(0.55, 'rgba(255,248,225,0.45)');
  g.addColorStop(1, 'rgba(255,248,225,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // distant hills
  ctx.fillStyle = 'rgba(120,170,150,0.28)';
  ctx.beginPath(); ctx.moveTo(0, 760);
  ctx.bezierCurveTo(90, 690, 170, 700, 250, 735); ctx.bezierCurveTo(330, 765, 420, 680, 540, 720);
  ctx.lineTo(540, 800); ctx.lineTo(0, 800); ctx.fill();
  ctx.fillStyle = 'rgba(105,160,135,0.32)';
  ctx.beginPath(); ctx.moveTo(0, 780);
  ctx.bezierCurveTo(120, 740, 220, 760, 300, 772); ctx.bezierCurveTo(400, 786, 470, 750, 540, 760);
  ctx.lineTo(540, 820); ctx.lineTo(0, 820); ctx.fill();
  // ground
  g = ctx.createLinearGradient(0, 775, 0, H);
  g.addColorStop(0, '#e9d7b2'); g.addColorStop(1, '#d6bd92');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 790); ctx.quadraticCurveTo(270, 770, 540, 790); ctx.lineTo(540, H); ctx.lineTo(0, H); ctx.fill();
  // a few floating motes
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 14; i++) {
    const x = (i * 97.3 + scene.time * (6 + (i % 3) * 3)) % (W + 40) - 20;
    const y = 140 + ((i * 211.7) % 520) + Math.sin(scene.time * 0.7 + i) * 10;
    ctx.beginPath(); ctx.arc(x, y, 1.2 + (i % 3) * 0.7, 0, TAU); ctx.fill();
  }
  // contact shadow
  ctx.fillStyle = 'rgba(90,70,40,0.22)';
  ctx.beginPath(); ctx.ellipse(250, 797, 175, 15, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(90,70,40,0.18)';
  ctx.beginPath(); ctx.ellipse(250, 797, 120, 9, 0, 0, TAU); ctx.fill();
  // warm light from the fire on the ground
  if (fire > 0.01) {
    const m = scene.mouth;
    g = ctx.createRadialGradient(m.x + 120, 790, 10, m.x + 120, 790, 300);
    g.addColorStop(0, `rgba(255,150,60,${0.28 * fire})`); g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawRings() {
  ctx.save();
  ctx.lineCap = 'round';
  for (const r of scene.rings) {
    const k = r.age / 0.55;
    const rad = 26 + k * 150;
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - k)})`;
    ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(r.x - Math.cos(r.dir) * 20, r.y - Math.sin(r.dir) * 20, rad, r.dir - 0.55, r.dir + 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const view = new Mat(dpr, 0, 0, dpr, 0, 0);
  view.set(ctx);
  drawBackground();
  scene.dragon.draw(ctx, view.mul(PLACE), dpr * PLACE.a);
  view.set(ctx);
  scene.fx.drawGlow(ctx, scene.mouth);
  scene.fx.drawSmoke(ctx);
  scene.fx.drawFlames(ctx);
  scene.fx.drawSparks(ctx);
  drawRings();
  // subtle warm flash over the whole stage while breathing fire
  const I = scene.fx.intensity;
  if (I > 0.01) { ctx.fillStyle = `rgba(255,140,40,${0.07 * I})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- control
const audio = new DragonAudio();

function start(withSound = true) {
  scene.seqStart = scene.time + 0.05;
  button.disabled = true;
  button.classList.add('busy');
  if (withSound) audio.play(0.05);
}
function onSequenceEnd() {
  button.disabled = false;
  button.classList.remove('busy');
}
button.addEventListener('click', () => { if (scene.seqStart == null) start(true); });

const capture = new URLSearchParams(location.search).has('capture');
if (!capture) {
  resize();
  window.addEventListener('resize', () => resize());
  step(STEP); // build the rig before the first frame
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    advance((now - last) / 1000);
    last = now;
    render();
  };
  requestAnimationFrame(loop);
} else {
  // Deterministic frame-by-frame rendering for the video recorder.
  resize(2);
  window.__capture = {
    duration: SEQ_DURATION,
    phases: T,
    reset() { scene.time = 0; scene.seqStart = null; simAcc = 0; scene.dragon = new Dragon(); scene.fx.reset(); scene.rings = []; step(STEP); render(); },
    start() { start(false); },
    advance(dt) { while (dt > 1e-9) { const d = Math.min(dt, 0.05); advance(d); dt -= d; } render(); },
    pressVisual(on) { button.classList.toggle('pressed', on); },
    async audioWav(lead, tail) { return audio.renderWavBase64(lead, tail); },
  };
}
