// NIGHT BLADE — original 2D one-hit-kill action game for a Telegram Mini App (HTML5 canvas, no dependencies).
// World units are "pixels" of a 360-wide virtual screen; everything is drawn in code (no image assets).
"use strict";

const TG = window.Telegram && window.Telegram.WebApp;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ------------------------------------------------------------------ constants
let VW = 240;                   // virtual screen width (zoomed in on portrait phones)
const ARENA = 900;              // street length
const GRAV = 1100;
const P = {                     // player tuning
  speed: 165, jump: 390, slashTime: 0.2, slashActive: [0.03, 0.15], slashCd: 0.3,
  reach: 40, rollTime: 0.34, rollSpeed: 300, rollCd: 0.65,
};
const ENEMY = {
  thug:   { speed: 70, wind: 0.42, reach: 26, cool: 0.7, score: 100, color: "#ff3d9a" },
  gunner: { speed: 60, wind: 0.65, cool: 1.5, keep: [80, 140], score: 150, color: "#ffc83d" },
  shield: { speed: 45, wind: 0.6, reach: 28, cool: 0.9, score: 250, color: "#4d8bff" },
};

// ------------------------------------------------------------------ canvas / scaling
const cv = $("game"), ctx = cv.getContext("2d");
let scale = 1, VH = 640, GROUND = 450, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  VW = w < h ? 230 : 420;         // portrait: big fighters; landscape/desktop: wider view
  scale = (w / VW) * dpr;
  VH = h * dpr / scale;
  GROUND = Math.round(VH * 0.64);
  buildBackground();
}
window.addEventListener("resize", resize);

// ------------------------------------------------------------------ background (pre-rendered parallax layers)
let bgLayers = [];
function buildBackground() {
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const defs = [
    { par: 0.15, base: GROUND - 40, min: 120, max: 300, col: "#1d1846", win: 0, neon: 0 },
    { par: 0.35, base: GROUND - 10, min: 70, max: 220, col: "#14102f", win: 0.18, neon: 0.25 },
    { par: 0.6, base: GROUND, min: 40, max: 150, col: "#0c0a1f", win: 0.25, neon: 0.45 },
  ];
  bgLayers = defs.map((d) => {
    const w = Math.ceil(VW + ARENA * d.par + 40), h = Math.ceil(GROUND + 2);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    let x = -10;
    while (x < w) {
      const bw = 34 + r() * 70, bh = d.min + r() * (d.max - d.min), y = d.base - bh;
      g.fillStyle = d.col; g.fillRect(x, y, bw, bh + 200);
      if (d.win) for (let wy = y + 8; wy < d.base - 8; wy += 12) for (let wx = x + 5; wx < x + bw - 6; wx += 9)
        if (r() < d.win) { g.fillStyle = r() < 0.5 ? "#38e8ff" : "#ffd9a0"; g.globalAlpha = 0.25 + r() * 0.5; g.fillRect(wx, wy, 4, 6); g.globalAlpha = 1; }
      if (d.neon && r() < d.neon) {
        g.fillStyle = r() < 0.5 ? "#ff3d9a" : "#38e8ff"; g.shadowColor = g.fillStyle; g.shadowBlur = 8;
        g.fillRect(x + bw * 0.2, y + 10, bw * 0.6, 5); g.shadowBlur = 0;
      }
      x += bw + 3;
    }
    return { canvas: c, par: d.par };
  });
}

// ------------------------------------------------------------------ input
const keys = { left: false, right: false, jump: false, slash: false, roll: false };
const pressed = { jump: false, slash: false, roll: false };   // edge-triggered
function setKey(k, down) {
  if (down && !keys[k] && k in pressed) pressed[k] = true;
  keys[k] = down;
}
const keyMap = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "jump", KeyW: "jump", Space: "jump",
  KeyJ: "slash", KeyX: "slash", Enter: "slash", KeyK: "roll", ShiftLeft: "roll", KeyC: "roll" };
window.addEventListener("keydown", (e) => { const k = keyMap[e.code]; if (k) { setKey(k, true); e.preventDefault(); } if (e.code === "Escape") togglePause(); });
window.addEventListener("keyup", (e) => { const k = keyMap[e.code]; if (k) setKey(k, false); });
document.querySelectorAll("#controls .cb").forEach((el) => {
  const k = el.dataset.k;
  const on = (e) => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add("act"); setKey(k, true); };
  const off = (e) => { e.preventDefault(); el.classList.remove("act"); setKey(k, false); };
  el.addEventListener("pointerdown", on); el.addEventListener("pointerup", off);
  el.addEventListener("pointercancel", off); el.addEventListener("lostpointercapture", off);
});

// ------------------------------------------------------------------ haptics / feedback
const haptic = {
  light() { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred("light"); },
  heavy() { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred("heavy"); },
  fail() { TG && TG.HapticFeedback && TG.HapticFeedback.notificationOccurred("error"); },
  ok() { TG && TG.HapticFeedback && TG.HapticFeedback.notificationOccurred("success"); },
};

// ------------------------------------------------------------------ game state
let state = "menu";            // menu | play | pause | dead | result
let player, enemies, bullets, parts, cam, shake, hitStop, timeScale;
let score, combo, comboT, wave, waveQueue, spawnT, waveClearT, runTime, kills, log;
let run = { id: null, stake: 0 };

function newPlayer() {
  return { x: ARENA / 2, y: GROUND, vx: 0, vy: 0, face: 1, onGround: true, slashT: 0, slashCd: 0, rollT: 0, rollCd: 0,
    dead: false, deadT: 0, anim: 0, scarf: [] };
}

function resetRun() {
  player = newPlayer(); enemies = []; bullets = []; parts = [];
  cam = clamp(player.x - VW / 2, 0, ARENA - VW); shake = 0; hitStop = 0; timeScale = 1;
  score = 0; combo = 0; comboT = 0; wave = 0; waveQueue = []; spawnT = 1.0; waveClearT = 0; runTime = 0; kills = 0; log = [];
  nextWave();
}

function nextWave() {
  wave++;
  const n = 2 + wave;
  waveQueue = [];
  for (let i = 0; i < n; i++) {
    let t = "thug";
    if (wave >= 2 && Math.random() < 0.35) t = "gunner";
    if (wave >= 4 && Math.random() < 0.22) t = "shield";
    waveQueue.push(t);
  }
  spawnT = 1.2;
  if (state === "play") banner("ВОЛНА " + wave);
  $("wave").textContent = "ВОЛНА " + wave;
  log.push(["w", wave, +runTime.toFixed(2)]);
}

function spawn(type) {
  const left = Math.random() < 0.5;
  let x = left ? cam - 24 : cam + VW + 24;
  x = clamp(x, 12, ARENA - 12);
  if (Math.abs(x - player.x) < 90) x = player.x + (left ? -1 : 1) * 160;
  x = clamp(x, 12, ARENA - 12);
  enemies.push({ type, x, y: GROUND, vx: 0, face: x < player.x ? 1 : -1, state: "walk", t: 0, cd: rnd(0.2, 0.8), deadT: 0, anim: rnd(0, 6) });
}

// ------------------------------------------------------------------ particles
function burst(x, y, color, n, speed, life, grav = 600, size = 2) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), s = rnd(speed * 0.3, speed);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: rnd(life * 0.5, life), max: life, color, grav, size });
  }
}
function blood(x, y, dir) {
  for (let i = 0; i < 26; i++) parts.push({ x, y, vx: dir * rnd(40, 260) + rnd(-40, 40), vy: rnd(-260, -40), life: rnd(0.4, 1.1), max: 1.1, color: pick(["#ff2b3b", "#c3101f", "#ff5a4a"]), grav: 900, size: rnd(1.5, 3), stick: true });
}

// ------------------------------------------------------------------ combat helpers
function addScore(base) {
  combo++; comboT = 2.5;
  const mult = 1 + Math.floor((combo - 1) / 3) * 0.5;
  const pts = Math.round(base * mult);
  score += pts;
  return pts;
}
function killEnemy(e, dir, how) {
  if (e.state === "dead") return;
  e.state = "dead"; e.deadT = 0; e.vx = dir * 160; e.vy = -160;
  blood(e.x, e.y - 18, dir);
  const pts = addScore(ENEMY[e.type].score + (how === "deflect" ? 200 : 0));
  floatText(e.x, e.y - 44, "+" + pts, how === "deflect" ? "#38e8ff" : "#fff");
  kills++; hitStop = 0.06; shake = Math.max(shake, 5); haptic.light();
  log.push(["k", e.type, how, +runTime.toFixed(2)]);
}
function killPlayer(dir) {
  if (player.dead || player.rollT > 0) return;
  player.dead = true; player.deadT = 0; player.vx = dir * 120; player.vy = -220;
  blood(player.x, player.y - 18, dir);
  shake = 12; timeScale = 0.3; haptic.fail();
  log.push(["d", +runTime.toFixed(2)]);
  state = "dead";
}
const floats = [];
function floatText(x, y, text, color) { floats.push({ x, y, text, color, t: 0 }); }

// ------------------------------------------------------------------ update
function update(dt) {
  if (hitStop > 0) { hitStop -= dt; return; }
  dt *= timeScale;
  runTime += dt;
  const p = player;

  // --- player
  p.slashCd -= dt; p.rollCd -= dt; p.anim += dt;
  if (!p.dead) {
    if (p.rollT > 0) {
      p.rollT -= dt; p.vx = p.face * P.rollSpeed;
      if (Math.random() < 0.6) parts.push({ x: p.x, y: p.y - 6, vx: -p.face * 30, vy: -10, life: 0.25, max: 0.25, color: "#38e8ff", grav: 0, size: 2 });
    } else {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir) p.face = dir;
      const target = dir * P.speed * (p.slashT > 0 && p.onGround ? 0.35 : 1);
      p.vx += (target - p.vx) * Math.min(1, dt * (p.onGround ? 18 : 8));
      if (pressed.roll && p.rollCd <= 0 && p.onGround) { p.rollT = P.rollTime; p.rollCd = P.rollCd; p.slashT = 0; haptic.light(); }
      if (pressed.jump && p.onGround) { p.vy = -P.jump; p.onGround = false; burst(p.x, p.y, "#8890c8", 6, 60, 0.3, 200); }
      if (!keys.jump && p.vy < -140) p.vy = -140;                 // short hop when released early
      if (pressed.slash && p.slashCd <= 0) { p.slashT = P.slashTime; p.slashCd = P.slashCd; p.hitSet = new Set(); haptic.light(); }
    }
  } else {
    p.deadT += dt; p.vx *= 0.96;
  }
  pressed.jump = pressed.slash = pressed.roll = false;
  if (!p.onGround || p.dead) p.vy += GRAV * dt;
  p.x = clamp(p.x + p.vx * dt, 10, ARENA - 10);
  p.y += p.vy * dt;
  if (p.y >= GROUND) { if (!p.onGround && p.vy > 200) burst(p.x, GROUND, "#8890c8", 5, 50, 0.25, 200); p.y = GROUND; p.vy = 0; p.onGround = true; }
  if (p.slashT > 0) p.slashT -= dt;
  p.scarf.unshift({ x: p.x - p.face * 4, y: p.y - 26 }); if (p.scarf.length > 7) p.scarf.pop();

  // slash hitbox
  const sa = P.slashTime - p.slashT;
  const slashOn = !p.dead && p.slashT > 0 && sa >= P.slashActive[0] && sa <= P.slashActive[1];
  const sx0 = p.face > 0 ? p.x + 4 : p.x - P.reach, sx1 = p.face > 0 ? p.x + P.reach : p.x - 4, sy0 = p.y - 44, sy1 = p.y + 2;

  // --- enemies
  for (const e of enemies) {
    const D = ENEMY[e.type];
    e.anim += dt;
    if (e.state === "dead") { e.deadT += dt; e.vy += GRAV * dt; e.x += e.vx * dt; e.y = Math.min(GROUND, e.y + e.vy * dt); e.vx *= 0.94; continue; }
    const dx = p.x - e.x, adx = Math.abs(dx);
    e.cd -= dt; e.t += dt;
    if (e.state !== "wind" && e.state !== "attack") {
      const want = dx > 0 ? 1 : -1;
      // the shield bearer turns slowly: rolling past him opens his back for a moment
      if (want !== e.face) { e.turnT = (e.turnT || 0) + dt; if (e.type !== "shield" || e.turnT > 0.45) { e.face = want; e.turnT = 0; } }
      else e.turnT = 0;
    }
    if (e.type === "gunner") {
      if (e.state === "walk") {
        let want = 0;
        if (adx < D.keep[0]) want = -e.face; else if (adx > D.keep[1]) want = e.face;
        e.vx = want * D.speed;
        if (adx < 170 && e.cd <= 0 && !p.dead) { e.state = "wind"; e.t = 0; e.vx = 0; }
      } else if (e.state === "wind" && e.t >= D.wind) {
        bullets.push({ x: e.x + e.face * 14, y: e.y - 24, vx: e.face * 230, own: "enemy", life: 3 });
        burst(e.x + e.face * 16, e.y - 24, "#ffe08a", 5, 80, 0.15, 0);
        e.state = "walk"; e.cd = D.cool + rnd(0, 0.6);
      }
    } else {
      if (e.state === "walk") {
        e.vx = adx > D.reach - 4 ? e.face * D.speed : 0;
        if (adx < D.reach + 6 && e.cd <= 0 && !p.dead && Math.abs(p.y - e.y) < 30) { e.state = "wind"; e.t = 0; e.vx = 0; }
      } else if (e.state === "wind" && e.t >= D.wind) { e.state = "attack"; e.t = 0; }
      else if (e.state === "attack") {
        const hx0 = e.face > 0 ? e.x : e.x - D.reach, hx1 = e.face > 0 ? e.x + D.reach : e.x;
        if (e.t < 0.12 && p.x > hx0 - 6 && p.x < hx1 + 6 && p.y > e.y - 40) killPlayer(e.face);
        if (e.t >= 0.2) { e.state = "walk"; e.cd = D.cool + rnd(0, 0.4); }
      }
    }
    e.x = clamp(e.x + e.vx * dt, 8, ARENA - 8);

    // player slash vs enemy
    if (slashOn && !p.hitSet.has(e) && e.x > sx0 - 8 && e.x < sx1 + 8 && e.y - 34 < sy1 && e.y > sy0) {
      p.hitSet.add(e);
      const fromFront = e.type === "shield" && e.face === -p.face && e.state !== "attack";
      if (fromFront) {
        burst(e.x - e.face * -10, e.y - 22, "#ffffff", 10, 160, 0.2, 0, 1.5); shake = Math.max(shake, 3);
        p.vx = -p.face * 140; floatText(e.x, e.y - 46, "ЩИТ", "#9cc0ff"); haptic.heavy();
      } else killEnemy(e, p.face, "blade");
    }
  }
  // separate enemies a little so they do not stack
  for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) {
    const a = enemies[i], b = enemies[j];
    if (a.state === "dead" || b.state === "dead") continue;
    const d = b.x - a.x;
    if (Math.abs(d) < 14) { const push = (14 - Math.abs(d)) * 0.5 * (d >= 0 ? 1 : -1); a.x -= push; b.x += push; }
  }
  enemies = enemies.filter((e) => e.state !== "dead" || e.deadT < 6);

  // --- bullets
  for (const b of bullets) {
    b.x += b.vx * dt; b.life -= dt;
    if (b.own === "enemy") {
      if (slashOn && b.x > sx0 - 10 && b.x < sx1 + 10 && b.y > sy0 && b.y < sy1) {
        b.own = "player"; b.vx = -b.vx * 1.5; b.life = 2;
        burst(b.x, b.y, "#38e8ff", 12, 200, 0.25, 0, 1.5); hitStop = 0.05; shake = Math.max(shake, 4);
        floatText(b.x, b.y - 14, "ОТБИЛ!", "#38e8ff"); haptic.heavy(); log.push(["r", +runTime.toFixed(2)]);
      } else if (!p.dead && p.rollT <= 0 && Math.abs(b.x - p.x) < 8 && b.y > p.y - 40 && b.y < p.y) { killPlayer(Math.sign(b.vx)); b.life = 0; }
    } else {
      for (const e of enemies) if (e.state !== "dead" && Math.abs(b.x - e.x) < 10 && b.y > e.y - 40) { killEnemy(e, Math.sign(b.vx), "deflect"); b.life = 0; break; }
    }
    if (b.x < -20 || b.x > ARENA + 20) b.life = 0;
  }
  bullets = bullets.filter((b) => b.life > 0);

  // --- particles / floating text
  for (const q of parts) {
    q.life -= dt; q.vy += q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.stick && q.y >= GROUND + 1) { q.y = GROUND + rnd(0, 6); q.vx = 0; q.vy = 0; q.grav = 0; q.life = Math.max(q.life, 8); q.max = 8; q.stick = false; }
  }
  parts = parts.filter((q) => q.life > 0);
  if (parts.length > 900) parts.splice(0, parts.length - 900);
  for (const f of floats) f.t += dt;
  while (floats.length && floats[0].t > 0.9) floats.shift();

  // --- waves / combo
  comboT -= dt; if (comboT <= 0) combo = 0;
  if (state === "play") {
    spawnT -= dt;
    if (waveQueue.length && spawnT <= 0) { spawn(waveQueue.shift()); spawnT = Math.max(0.5, 1.4 - wave * 0.08); }
    const alive = enemies.some((e) => e.state !== "dead");
    if (!waveQueue.length && !alive) {
      waveClearT += dt;
      if (waveClearT > 1.2) { const b = 300 * wave; score += b; floatText(p.x, p.y - 60, "ВОЛНА +" + b, "#ffc83d"); waveClearT = 0; haptic.ok(); nextWave(); }
    }
  }
  if (state === "dead" && p.deadT > 1.1) finishRun();

  // --- camera
  const want = clamp(p.x - VW / 2 + p.face * 30, 0, ARENA - VW);
  cam += (want - cam) * Math.min(1, dt * 5);
  shake *= Math.pow(0.02, dt);
}

// ------------------------------------------------------------------ drawing
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, "#05061a"); sky.addColorStop(0.65, "#1d1240"); sky.addColorStop(1, "#43174a");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, GROUND + 1);
  // moon
  ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = "#cfe9ff"; ctx.shadowColor = "#8fd4ff"; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.arc(VW * 0.72 - cam * 0.05, GROUND * 0.3, 26, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  for (const l of bgLayers) ctx.drawImage(l.canvas, -Math.round(cam * l.par) - 10, 0);
  // street
  const g = ctx.createLinearGradient(0, GROUND, 0, VH);
  g.addColorStop(0, "#1a1733"); g.addColorStop(1, "#07060f");
  ctx.fillStyle = g; ctx.fillRect(0, GROUND, VW, VH - GROUND);
  ctx.fillStyle = "#ff3d9a"; ctx.globalAlpha = 0.7; ctx.fillRect(0, GROUND, VW, 2); ctx.globalAlpha = 1;
  ctx.fillStyle = "#2c2852";
  for (let x = -((cam * 1) % 60); x < VW; x += 60) ctx.fillRect(x, GROUND + 26, 30, 3);
  // arena ends: neon barriers
  for (const ex of [0, ARENA]) {
    const sx = ex - cam;
    if (sx > -20 && sx < VW + 20) { ctx.fillStyle = "#38e8ff"; ctx.shadowColor = "#38e8ff"; ctx.shadowBlur = 10; ctx.fillRect(sx - 2, GROUND - 60, 4, 60); ctx.shadowBlur = 0; }
  }
}

function drawFighter(x, y, face, o) {
  // o: { body, accent, pose: idle|run|wind|attack|slash|roll|air|dead, t, scarf }
  ctx.save(); ctx.translate(Math.round(x), Math.round(y));
  if (o.pose === "dead") { ctx.rotate(face * Math.min(1.45, o.t * 6)); }
  if (o.pose === "roll") { ctx.translate(0, -10); ctx.rotate(face * o.t * 18); ctx.translate(0, 10); }
  ctx.scale(face, 1);
  const bob = o.pose === "run" ? Math.abs(Math.sin(o.t * 14)) * 2 : o.pose === "idle" ? Math.sin(o.t * 3) * 0.6 : 0;
  const leg = o.pose === "run" ? Math.sin(o.t * 14) * 5 : 0;
  // shadow
  if (o.pose !== "dead") { ctx.fillStyle = "#0008"; ctx.beginPath(); ctx.ellipse(0, 1, 10, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
  // legs
  ctx.fillStyle = "#0b0b16";
  ctx.fillRect(-5 + leg * 0.6, -14, 4, 14); ctx.fillRect(1 - leg * 0.6, -14, 4, 14);
  // torso
  ctx.fillStyle = o.body; ctx.fillRect(-6, -30 - bob, 12, 17);
  ctx.fillStyle = o.accent; ctx.fillRect(-6, -18 - bob, 12, 2);
  // head
  ctx.fillStyle = "#e8c4a0"; ctx.fillRect(-4, -38 - bob, 8, 8);
  ctx.fillStyle = o.hair || "#0b0b16"; ctx.fillRect(-5, -40 - bob, 10, 4); ctx.fillRect(-5, -38 - bob, 2, 4);
  ctx.fillStyle = "#111"; ctx.fillRect(2, -35 - bob, 2, 2);
  // arm + weapon
  ctx.fillStyle = o.body;
  if (o.weapon === "gun") {
    ctx.fillRect(2, -27 - bob, 10, 3); ctx.fillStyle = "#222"; ctx.fillRect(10, -29 - bob, 8, 4);
  } else if (o.weapon === "shield") {
    ctx.fillStyle = "#9cc0ff"; ctx.fillRect(7, -34 - bob, 5, 26); ctx.fillStyle = "#4d8bff"; ctx.fillRect(8, -32 - bob, 3, 22);
  } else if (o.weapon === "pipe") {
    const ang = o.pose === "wind" ? -2.2 : o.pose === "attack" ? 0.4 : -0.8;
    ctx.save(); ctx.translate(4, -26 - bob); ctx.rotate(ang); ctx.fillStyle = "#9a9aa8"; ctx.fillRect(0, -1.5, 20, 3); ctx.restore();
  } else if (o.weapon === "katana" && o.pose !== "slash") {
    ctx.save(); ctx.translate(-2, -24 - bob); ctx.rotate(-2.4); ctx.fillStyle = "#dfe6ff"; ctx.fillRect(0, -1, 24, 2); ctx.fillStyle = "#ff3d9a"; ctx.fillRect(-3, -1.5, 4, 3); ctx.restore();
  }
  ctx.restore();
}

function draw() {
  const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
  ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);
  ctx.imageSmoothingEnabled = false;
  drawBackground();
  ctx.save(); ctx.translate(-Math.round(cam), 0);

  // sticky blood under everything
  for (const q of parts) if (q.grav === 0 && q.max === 8) { ctx.globalAlpha = Math.min(1, q.life / 2); ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, q.size + 1, 1.5); }
  ctx.globalAlpha = 1;

  // enemies
  for (const e of enemies) {
    const D = ENEMY[e.type];
    let pose = e.state === "dead" ? "dead" : e.state === "wind" ? "wind" : e.state === "attack" ? "attack" : Math.abs(e.vx) > 5 ? "run" : "idle";
    drawFighter(e.x, e.y, e.face, { body: D.color, accent: "#111", pose, t: e.state === "dead" ? e.deadT : e.anim, hair: "#2a1a10",
      weapon: e.type === "gunner" ? "gun" : e.type === "shield" ? "shield" : "pipe" });
    if (e.state === "wind") {                       // telegraph: glint over the head / laser sight
      const k = e.t / D.wind;
      if (e.type === "gunner") { ctx.strokeStyle = `rgba(255,48,69,${0.25 + k * 0.6})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(e.x + e.face * 16, e.y - 25); ctx.lineTo(e.x + e.face * 180, e.y - 25); ctx.stroke(); }
      ctx.fillStyle = "#ff3045"; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(e.t * 40); ctx.fillRect(e.x - 1, e.y - 52, 3, 7); ctx.fillRect(e.x - 1, e.y - 43, 3, 2); ctx.globalAlpha = 1;
    }
  }

  // player
  const p = player;
  if (p.scarf.length > 1 && !p.dead) {
    ctx.strokeStyle = "#ff3045"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p.scarf[0].x, p.scarf[0].y);
    for (let i = 1; i < p.scarf.length; i++) ctx.lineTo(p.scarf[i].x - p.face * i * 2, p.scarf[i].y + Math.sin(p.anim * 12 + i) * 1.5 + i * 0.6);
    ctx.stroke();
  }
  const ppose = p.dead ? "dead" : p.rollT > 0 ? "roll" : p.slashT > 0 ? "slash" : !p.onGround ? "air" : Math.abs(p.vx) > 20 ? "run" : "idle";
  if (p.rollT > 0) ctx.globalAlpha = 0.65;
  drawFighter(p.x, p.y, p.face, { body: "#1a1f3d", accent: "#38e8ff", pose: ppose, t: p.dead ? p.deadT : p.rollT > 0 ? P.rollTime - p.rollT : p.anim, weapon: "katana" });
  ctx.globalAlpha = 1;
  if (p.slashT > 0 && !p.dead) {                    // katana arc
    const k = 1 - p.slashT / P.slashTime;
    ctx.save(); ctx.translate(p.x, p.y - 22); ctx.scale(p.face, 1);
    ctx.strokeStyle = `rgba(56,232,255,${1 - k})`; ctx.lineWidth = 5; ctx.shadowColor = "#38e8ff"; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(4, 0, P.reach - 8, -1.3 + k * 0.6, 0.9 + k * 0.5); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // bullets
  for (const b of bullets) {
    ctx.fillStyle = b.own === "enemy" ? "#ffe08a" : "#38e8ff"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    ctx.fillRect(b.x - 4, b.y - 1, 8, 2); ctx.shadowBlur = 0;
  }
  // flying particles
  for (const q of parts) if (!(q.grav === 0 && q.max === 8)) { ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, q.size, q.size); }
  ctx.globalAlpha = 1;
  // floating score text
  ctx.font = "bold 11px system-ui,sans-serif"; ctx.textAlign = "center";
  for (const f of floats) { ctx.globalAlpha = 1 - f.t / 0.9; ctx.fillStyle = "#000"; ctx.fillText(f.text, f.x + 1, f.y - f.t * 26 + 1); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - f.t * 26); }
  ctx.globalAlpha = 1;
  ctx.restore();

  // rain + vignette (screen space)
  ctx.strokeStyle = "#8fa6ff22"; ctx.lineWidth = 1; ctx.beginPath();
  const t = performance.now() / 1000;
  for (let i = 0; i < 60; i++) { const x = ((i * 53.7 + t * 40) % (VW + 40)) - 20, y = ((i * 97.3 + t * 520) % (VH + 40)) - 20; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 10); }
  ctx.stroke();
  if (state === "dead") { ctx.fillStyle = `rgba(120,0,10,${Math.min(0.35, player.deadT * 0.4)})`; ctx.fillRect(0, 0, VW, VH); }
}

// ------------------------------------------------------------------ HUD / screens
function show(id, on) { $(id).classList.toggle("on", on); }
let bannerTimer = 0;
function banner(text) { const b = $("banner"); b.textContent = text; b.style.opacity = 1; clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.style.opacity = 0), 1100); }
function drawHud() {
  $("score").textContent = score;
  const m = 1 + Math.floor((combo - 1) / 3) * 0.5;
  $("combo").textContent = combo >= 2 ? `КОМБО ${combo}` + (m > 1 ? `  ×${m}` : "") : "";
}

let stake = 0, profile = { balance: 0, best: 0, packs: [] };
const STAKES = [0, 10, 25, 50];
function renderMenu() {
  $("balance").textContent = profile.balance + " ⭐";
  $("best").textContent = "Рекорд: " + profile.best;
  $("stakes").innerHTML = STAKES.map((s) => `<button data-s="${s}" class="${s === stake ? "sel" : ""}">${s ? s + " ⭐" : "Без"}</button>`).join("");
  $("stakes").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { stake = +b.dataset.s; renderMenu(); haptic.light(); }));
  $("multTable").innerHTML = Api.table.filter((r) => r.min > 0).map((r) => `<div>от ${r.min}<b>×${r.mult}</b></div>`).join("");
  $("playBtn").textContent = stake > profile.balance ? "НЕ ХВАТАЕТ ЗВЁЗД" : "ИГРАТЬ";
  $("playBtn").disabled = stake > profile.balance;
  $("packs").innerHTML = (profile.packs || []).map((a) => `<button data-a="${a}">+${a} ⭐</button>`).join("");
  $("packs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => topUp(+b.dataset.a)));
}

function setStatus(t) { $("status").textContent = t || ""; }
async function refreshProfile() {
  try { profile = await Api.getProfile(); setStatus(""); } catch (e) { setStatus(e.message); }
  renderMenu();
}
async function topUp(amount) {
  haptic.light();
  try {
    setStatus("Оплата…");
    const st = await Api.topUp(amount);
    if (st === "paid") {
      setStatus("Зачисляем…");
      const before = profile.balance;
      for (let i = 0; i < 10 && profile.balance <= before; i++) { await new Promise((r) => setTimeout(r, 1000)); await refreshProfile(); }
      haptic.ok(); setStatus(profile.balance > before ? "Зачислено" : "Платёж принят, баланс обновится");
    } else setStatus(st === "cancelled" ? "" : st === "failed" ? "Оплата не прошла" : "");
  } catch (e) { setStatus(e.message); }
}

async function startRun() {
  try {
    const r = await Api.startRun(stake);
    run = { id: r.runId, stake };
    profile.balance = r.balance;
  } catch (e) { setStatus(e.message); show("result", false); show("menu", true); return; }
  resetRun();
  state = "play"; banner("ВОЛНА " + wave);
  show("menu", false); show("result", false); show("pause", false); show("hud", true); show("controls", true);
  TG && TG.BackButton && TG.BackButton.hide();
}

async function finishRun() {
  if (state === "result") return;
  state = "result";
  show("hud", false); show("controls", false);
  let r;
  try { r = await Api.finishRun(run.id, run.stake, score, log); }
  catch (e) { r = { mult: 0, payout: 0, balance: profile.balance, best: profile.best }; setStatus(e.message); }
  profile.balance = r.balance; profile.best = r.best;
  $("rScore").textContent = score;
  $("rDetail").textContent = `Волна ${wave} · убито ${kills} · ${runTime.toFixed(0)} с`;
  $("rMult").textContent = "×" + r.mult;
  $("rMult").className = "big " + (r.mult >= 1 ? "win" : "lose");
  $("rPay").textContent = run.stake ? (r.payout ? "+" + r.payout + " ⭐" : "0 ⭐") : "без ставки";
  show("result", true);
  if (r.payout > run.stake) haptic.ok();
  TG && TG.BackButton && TG.BackButton.show();
}

function togglePause() {
  if (state === "play") { state = "pause"; show("pause", true); show("controls", false); }
  else if (state === "pause") { state = "play"; show("pause", false); show("controls", true); }
}
async function toMenu() {
  state = "menu"; show("result", false); show("pause", false); show("hud", false); show("controls", false); show("menu", true);
  await refreshProfile();
  TG && TG.BackButton && TG.BackButton.hide();
  resetRun(); waveQueue = []; enemies = []; banner("");
}

$("playBtn").addEventListener("click", startRun);
$("againBtn").addEventListener("click", startRun);
$("menuBtn").addEventListener("click", toMenu);
$("pauseBtn").addEventListener("click", togglePause);
$("resumeBtn").addEventListener("click", togglePause);
$("quitBtn").addEventListener("click", () => { show("pause", false); state = "play"; player.rollT = 0; killPlayer(-player.face); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") togglePause(); });

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (state === "play" || state === "dead" || state === "menu") update(state === "menu" ? dt * 0.5 : dt);
  draw();
  if (state === "play" || state === "dead") drawHud();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
(async function boot() {
  if (TG) {
    TG.ready(); TG.expand();
    TG.disableVerticalSwipes && TG.disableVerticalSwipes();
    TG.setHeaderColor && TG.setHeaderColor("#0b0d1f"); TG.setBackgroundColor && TG.setBackgroundColor("#0b0d1f");
    TG.BackButton && TG.BackButton.onClick(() => (state === "result" ? toMenu() : togglePause()));
    const u = TG.initDataUnsafe && TG.initDataUnsafe.user;
    if (u && u.first_name) $("hello").textContent = `${u.first_name}, один удар — одна жизнь. Режь, отбивай пули, уходи рывком.`;
  }
  resize();
  resetRun(); waveQueue = [];          // menu background: empty street
  renderMenu(); requestAnimationFrame(frame);
  await refreshProfile();
})();
