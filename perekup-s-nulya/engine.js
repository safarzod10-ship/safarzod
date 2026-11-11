// Shared engine for «Перекуп с нуля»: helpers, characters, backgrounds, HUD, subtitles, player.
// An episode defines: DUR, START_MONEY, HUD_FROM, HUD_PULSE, CUTS, COVER_T, SUBS, MONEY, SCENES, then calls startPlayer().
'use strict';
const W = 1080, H = 1920;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const F = 'Rubik, Arial, sans-serif';
const OL = '#161a24';

/* ---------- math helpers ---------- */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const P = (t, a, b) => clamp((t - a) / (b - a));
const eio = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const eout = k => 1 - Math.pow(1 - k, 3);
const back = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const pop = (t, a, d = .35) => t < a ? 0 : back(P(t, a, a + d));
const fade = (t, a, b, d = .25) => Math.min(P(t, a, a + d), 1 - P(t, b - d, b));
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const within = (t, a, b) => t >= a && t < b;

const SPK = {
  T: { name: 'Тимур', col: '#22b07d' },
  S: { name: 'Продавец', col: '#6b7280' },
  M: { name: 'Мастер', col: '#b7793f' },
  C: { name: 'Голос в трубке', col: '#e5484d' },
  R: { name: 'Рустам', col: '#a16207' },
  A: { name: 'Администратор ТЦ', col: '#e5484d' },
  K: { name: 'Покупатель', col: '#ea580c' },
  P: { name: 'Клиент', col: '#2563eb' },
  D: { name: 'Даня', col: '#ca8a04' },
  N: { name: 'Рассказчик', col: '#334155' },
  O: { name: 'Мама', col: '#a2577a' },
  F: { name: 'Отец', col: '#6b7280' },
  X: { name: 'Коллектор', col: '#111827' },
};
function talkAmt(who, t) {
  for (const s of SUBS) {
    if (window.ENV && s[2] === who && t >= s[0] && t < s[1]) {
      return clamp((window.ENV[Math.floor((window.OUT_T || 0) * 30)] || 0) * 1.3);
    }
    if (!window.ENV && s[2] === who && t >= s[0] + .05 && t < s[1] - .15) {
      return clamp(.25 + .75 * Math.abs(Math.sin(t * 12.5)) * (.55 + .45 * Math.sin(t * 3.3 + 1)));
    }
  }
  return 0;
}

/* ---------- money ---------- */
const money = t => START_MONEY + MONEY.reduce((s, e) => s + e.d * eout(P(t, e.t, e.t + .8)), 0);


/* ---------- drawing primitives ---------- */
function rr(x, y, w, h, r, fill, stroke, lw = 6) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function circ(x, y, r, fill, stroke, lw = 6) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function line(pts, col, lw) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function txt(s, x, y, size, col = '#fff', o = {}) {
  ctx.save();
  ctx.font = `${o.w || 800} ${size}px ${F}`;
  ctx.textAlign = o.al || 'center'; ctx.textBaseline = 'middle';
  if (o.a != null) ctx.globalAlpha *= o.a;
  if (o.st) { ctx.lineWidth = o.st; ctx.strokeStyle = o.sc || OL; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
  ctx.restore();
}
function tw(s, size, w = 800) { ctx.font = `${w} ${size}px ${F}`; return ctx.measureText(s).width; }
function at(x, y, s, rot, fn, a = 1) {
  if (s <= 0.001 || a <= 0.001) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(s, s); ctx.globalAlpha *= a; fn(); ctx.restore();
}
function shk(t, a, dur, amp) {
  if (t < a || t > a + dur) return [0, 0];
  const k = 1 - (t - a) / dur, f = Math.floor(t * 60);
  return [(hash(f) - .5) * 2 * amp * k, (hash(f + 99) - .5) * 2 * amp * k];
}
function cam(z, cx, cy, dx, dy, fn) {
  ctx.save(); ctx.translate(cx + dx, cy + dy); ctx.scale(z, z); ctx.translate(-cx, -cy); fn(); ctx.restore();
}
function check(x, y, s, k = 1, col = '#22c55e') {
  // animated checkmark, k = draw progress
  const p = [[-20, 0], [-6, 16], [24, -18]];
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
  const k1 = clamp(k * 2), k2 = clamp(k * 2 - 1);
  ctx.lineTo(lerp(p[0][0], p[1][0], k1), lerp(p[0][1], p[1][1], k1));
  if (k2 > 0) ctx.lineTo(lerp(p[1][0], p[2][0], k2), lerp(p[1][1], p[2][1], k2));
  ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}
function cross(x, y, r, col = '#ef4444', lw = 18) {
  line([x - r, y - r, x + r, y + r], col, lw); line([x + r, y - r, x - r, y + r], col, lw);
}
function phone(x, y, w, h, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0);
  rr(-w / 2, -h / 2, w, h, w * .18, o.body || '#1c2130', OL, o.lw || 5);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, o.s1 || '#5b8cff'); g.addColorStop(1, o.s2 || '#8f5bff');
  rr(-w / 2 + w * .09, -h / 2 + w * .09, w * .82, h - w * .18, w * .11, g);
  rr(-w * .14, -h / 2 + w * .12, w * .28, w * .07, w * .04, '#0b0d12');
  if (o.crack) {
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(2, w * .025);
    const cx = w * .12, cy = h * .12;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx - w * .3, cy - h * .18); ctx.lineTo(cx - w * .36, cy - h * .3);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + w * .26, cy - h * .05);
    ctx.moveTo(cx, cy); ctx.lineTo(cx - w * .12, cy + h * .22); ctx.lineTo(cx - w * .26, cy + h * .34);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + w * .2, cy + h * .2);
    ctx.stroke();
  }
  ctx.restore();
}
function note(x, y, rot, s = 1) {
  at(x, y, s, rot, () => {
    rr(-62, -32, 124, 64, 8, '#4caf6e', OL, 5);
    rr(-50, -21, 100, 42, 6, null, '#2e7d4a', 4);
    txt('₽', 0, 2, 34, '#1d5e36', { w: 900 });
  });
}
function coin(x, y, r) {
  circ(x, y, r, '#ffc93c', OL, r * .12);
  circ(x, y, r * .72, null, '#e0a400', r * .08);
  txt('₽', x, y + r * .04, r * 1.05, '#9a6a00', { w: 900 });
}
function cloud(x, y, w, h) {
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push([x + Math.cos(a) * w * .42, y + Math.sin(a) * h * .36, Math.min(w, h) * (.26 + hash(i) * .06)]);
  }
  pts.push([x, y, Math.min(w, h) * .42]);
  for (const p of pts) circ(p[0], p[1], p[2] + 6, OL);
  for (const p of pts) circ(p[0], p[1], p[2], '#fff');
}
function bubble(x, y, w, h, fill, tailX, tailDir = 1) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 28);
  ctx.moveTo(tailX - 18, y + h); ctx.lineTo(tailX + 14 * tailDir, y + h + 34); ctx.lineTo(tailX + 18, y + h);
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.stroke();
  ctx.fillStyle = fill; ctx.fillRect(tailX - 15, y + h - 8, 30, 10);
}
function faceId(x, y, s) {
  at(x, y, s, 0, () => {
    rr(-150, -150, 300, 300, 60, '#ffffff', OL, 10);
    const c = '#1f2937';
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      line([sx * 105, sy * 50, sx * 105, sy * 105, sx * 50, sy * 105], c, 16);
    }
    line([-38, -40, -38, -12], c, 16); line([38, -40, 38, -12], c, 16);
    line([4, -40, 4, 18, -10, 18], c, 12);
    ctx.beginPath(); ctx.moveTo(-42, 46); ctx.quadraticCurveTo(0, 76, 42, 46);
    ctx.strokeStyle = c; ctx.lineWidth = 14; ctx.stroke();
  });
}
function wrench(x, y, s, rot) {
  at(x, y, s, rot, () => {
    line([0, 20, 0, 120], OL, 40); line([0, 20, 0, 120], '#9aa4b2', 26);
    ctx.beginPath(); ctx.arc(0, 0, 34, -Math.PI * .3, Math.PI * 1.3);
    ctx.strokeStyle = OL; ctx.lineWidth = 34; ctx.stroke();
    ctx.strokeStyle = '#9aa4b2'; ctx.lineWidth = 22; ctx.stroke();
  });
}
function clock(x, y, r, t) {
  circ(x, y, r, '#fff', OL, 8);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    line([x + Math.cos(a) * r * .78, y + Math.sin(a) * r * .78, x + Math.cos(a) * r * .88, y + Math.sin(a) * r * .88], OL, 5);
  }
  const a1 = t * 6, a2 = t * .5;
  line([x, y, x + Math.sin(a1) * r * .7, y - Math.cos(a1) * r * .7], OL, 7);
  line([x, y, x + Math.sin(a2) * r * .45, y - Math.cos(a2) * r * .45], '#e5484d', 9);
  circ(x, y, 8, OL);
}
function shopFront(x, y, s, n) {
  at(x, y, s, 0, () => {
    rr(-90, -40, 180, 150, 10, '#fef3c7', OL, 6);
    rr(-60, 20, 50, 90, 6, '#93c5fd', OL, 5);
    rr(5, 20, 55, 50, 6, '#93c5fd', OL, 5);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#e5484d';
      ctx.fillRect(-90 + i * 30, -40, 30, 34);
    }
    ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.strokeRect(-90, -40, 180, 34);
    rr(-80, -92, 160, 46, 10, '#1f2937', OL, 5);
    txt('ТЕЛЕФОНЫ', 0, -68, 24, '#ffd23f', { w: 900 });
    circ(78, -96, 22, '#22b07d', OL, 5);
    txt(String(n), 78, -95, 26, '#fff', { w: 900 });
  });
}
function vignette(col, a) {
  const g = ctx.createRadialGradient(W / 2, H * .45, H * .2, W / 2, H * .45, H * .75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}
function stamp(s, x, y, size, col, k, rot = -.12) {
  if (k <= 0) return;
  const sc = lerp(2.2, 1, eout(clamp(k))), a = clamp(k * 3);
  at(x, y, sc, rot, () => {
    const w = tw(s, size, 900) + size * .9;
    rr(-w / 2, -size * .8, w, size * 1.6, 18, 'rgba(255,255,255,.92)', col, 12);
    txt(s, 0, size * .04, size, col, { w: 900 });
  }, a);
}

/* ---------- characters ---------- */
const TIMUR = { skin: '#f3c49c', shirt: '#22b07d', pants: '#2c3e66', hair: 'cap', capCol: '#e5484d', hairCol: '#3a2a1e', strings: true };
const SELLER = { skin: '#d9a77f', shirt: '#4b5563', pants: '#1f2937', hair: 'hood', hood: '#3d4451', glasses: 'sun', stubble: true };
const MASTER = { skin: '#e8b88e', shirt: '#eef2f7', pants: '#374151', hair: 'bald', apron: '#8b5e3c', glasses: 'round', mustache: '#6b625b', pocket: false };
const RUSTAM = { skin: '#d6a27a', shirt: '#5b3a29', pants: '#1f2937', hair: 'short', hairCol: '#1b1410', stubble: true, chain: true, collar: '#3f271b' };
const SCAMMER = { skin: '#e8b48c', shirt: '#f97316', pants: '#1f2937', hair: 'short', hairCol: '#d4a017' };
const CLIENT = { skin: '#e6b089', shirt: '#2563eb', pants: '#374151', hair: 'short', hairCol: '#6b7280', mustache: '#4b5563', glasses: 'round' };
const DANYA = { skin: '#f6cfa8', shirt: '#facc15', pants: '#1e3a8a', hair: 'short', hairCol: '#c2410c', strings: true };
const BUYER = { skin: '#f0c7a6', shirt: '#8b5cf6', pants: '#1e293b', hair: 'long', hairCol: '#4a2c1a' };

function arm(x, y, ab, sd, col) {
  const L = 60, a = ab[0], a2 = ab[0] + ab[1];
  const ex = x + sd * Math.sin(a) * L, ey = y + Math.cos(a) * L;
  const hx = ex + sd * Math.sin(a2) * L, hy = ey + Math.cos(a2) * L;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = OL; ctx.lineWidth = 36; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 24; ctx.stroke();
  return [hx, hy];
}
function person(o, t) {
  if (typeof STYLE !== 'undefined' && STYLE === '25d') return person25(o, t);
  const s = o.s || 1, ph = o.ph || 0, ex = o.expr || 'n';
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(s, s);
  if (o.rot) ctx.rotate(o.rot);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const walk = o.walk || 0, wp = t * (o.wspd || 10);
  const bob = (o.bob != null ? o.bob : Math.sin(t * 2.4 + ph) * 2.5) - Math.abs(Math.sin(wp)) * 12 * walk;
  // legs
  for (const sd of [-1, 1]) {
    const phs = wp + (sd > 0 ? 0 : Math.PI);
    const sw = Math.sin(phs) * 32 * walk;
    const fx = sd * 26 + sw, fy = -Math.max(0, Math.cos(phs)) * 16 * walk;
    line([sd * 24, -85, fx, fy - 10], OL, 38);
    line([sd * 24, -85, fx, fy - 10], o.pants, 26);
    ctx.beginPath(); ctx.ellipse(fx + sd * 8, fy - 6, 28, 14, 0, 0, Math.PI * 2);
    ctx.fillStyle = o.shoe || '#232838'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
  }
  ctx.translate(0, bob);
  // back layers
  if (o.hair === 'long') {
    ctx.beginPath(); ctx.ellipse(0, -282, 96, 122, 0, 0, Math.PI * 2);
    ctx.fillStyle = o.hairCol; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.stroke();
  }
  if (o.hair === 'hood') circ(0, -310, 96, o.hood, OL, 6);
  if (o.hair === 'cap') {
    ctx.beginPath(); ctx.ellipse(-82, -362, 40, 13, -.5, 0, Math.PI * 2);
    ctx.fillStyle = o.capCol; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
  }
  // body
  rr(-64, -250, 128, 180, [44, 44, 24, 24], o.shirt, OL, 6);
  if (o.apron) {
    rr(-46, -205, 92, 135, [12, 12, 18, 18], o.apron, OL, 5);
    rr(-24, -160, 48, 30, 8, null, 'rgba(0,0,0,.3)', 4);
  } else if (o.pocket !== false) {
    rr(-40, -150, 80, 48, 16, null, 'rgba(0,0,0,.22)', 5);
  }
  if (o.chain) { ctx.beginPath(); ctx.arc(0, -262, 34, Math.PI * .2, Math.PI * .8); ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 6; ctx.stroke(); }
  if (o.collar) { ctx.beginPath(); ctx.moveTo(-40, -246); ctx.lineTo(-8, -200); ctx.lineTo(-30, -250); ctx.moveTo(40, -246); ctx.lineTo(8, -200); ctx.lineTo(30, -250); ctx.fillStyle = o.collar; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 4; ctx.stroke(); }
  if (o.strings) { line([-14, -236, -17, -196], '#f5f5f5', 5); line([14, -236, 17, -196], '#f5f5f5', 5); }
  // arms
  const sleeve = o.shirt;
  const hL = arm(-56, -222, o.aL || [.14, .06], -1, sleeve);
  const hR = arm(56, -222, o.aR || [.14, .06], 1, sleeve);
  // ears + head
  circ(-73, -306, 15, o.skin, OL, 5); circ(73, -306, 15, o.skin, OL, 5);
  circ(0, -312, 76, o.skin, OL, 6);
  // hair front
  if (o.hair === 'cap') {
    ctx.beginPath(); ctx.arc(0, -320, 79, Math.PI * 1.04, Math.PI * 1.96); ctx.closePath();
    ctx.fillStyle = o.capCol; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.stroke();
    line([-74, -338, 74, -338], '#b8323a', 6);
    ctx.beginPath(); ctx.moveTo(-62, -334); ctx.quadraticCurveTo(-58, -300, -70, -290); ctx.lineTo(-74, -334);
    ctx.fillStyle = o.hairCol; ctx.fill();
    ctx.beginPath(); ctx.moveTo(62, -334); ctx.quadraticCurveTo(58, -300, 70, -290); ctx.lineTo(74, -334);
    ctx.fill();
  } else if (o.hair === 'hood') {
    ctx.beginPath(); ctx.arc(0, -312, 82, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = o.hood; ctx.lineWidth = 26; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -312, 70, Math.PI * 1.12, Math.PI * 1.88);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 8; ctx.stroke();
  } else if (o.hair === 'long') {
    ctx.beginPath(); ctx.arc(0, -318, 80, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(20, -360, -30, -340); ctx.quadraticCurveTo(-60, -320, -80, -312);
    ctx.fillStyle = o.hairCol; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
  } else if (o.hair === 'short') {
    ctx.beginPath(); ctx.arc(0, -318, 79, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(50, -352, 10, -350); ctx.quadraticCurveTo(-30, -356, -60, -330); ctx.closePath();
    ctx.fillStyle = o.hairCol; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
  } else if (o.hair === 'bald') {
    for (const sd of [-1, 1]) {
      ctx.beginPath(); ctx.arc(sd * 66, -306, 18, 0, Math.PI * 2); ctx.fillStyle = '#9a948e'; ctx.fill();
    }
    ctx.beginPath(); ctx.ellipse(-22, -366, 18, 8, -.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fill();
  }
  // face
  const lx = (o.lx || 0) * 7, ly = (o.ly || 0) * 6;
  const blink = ((t + ph * 1.7) % 3.9) < .13 && ex !== 's';
  for (const sd of [-1, 1]) {
    const cx = sd * 27, cy = -318;
    if (o.glasses === 'sun') continue;
    if (blink) { line([cx - 13, cy, cx + 13, cy], OL, 6); continue; }
    ctx.beginPath(); ctx.ellipse(cx, cy, 15, ex === 's' ? 21 : 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
    circ(cx + lx, cy + ly + 2, ex === 's' ? 6 : 8.5, OL);
    circ(cx + lx + 3, cy + ly - 2, 2.6, '#fff');
  }
  if (o.glasses === 'sun') {
    rr(-52, -334, 46, 30, 10, '#0f1117', OL, 4); rr(6, -334, 46, 30, 10, '#0f1117', OL, 4);
    line([-6, -322, 6, -322], OL, 5);
    line([-44, -326, -32, -326], 'rgba(255,255,255,.5)', 4); line([14, -326, 26, -326], 'rgba(255,255,255,.5)', 4);
  }
  if (o.glasses === 'round') {
    circ(-27, -318, 24, null, '#2b2f3a', 5); circ(27, -318, 24, null, '#2b2f3a', 5);
    line([-4, -320, 4, -320], '#2b2f3a', 5);
  }
  // brows
  const by = -347, bw = 15;
  for (const sd of [-1, 1]) {
    const cx = sd * 27;
    let p;
    switch (ex) {
      case 's': p = [cx - bw, by - 8, cx, by - 16, cx + bw, by - 8]; break;
      case 'h': p = [cx - bw, by + 2, cx, by - 6, cx + bw, by + 2]; break;
      case 'sad': case 'worry': p = [cx + sd * bw, by + 4, cx, by - 2, cx - sd * bw, by - 8]; break;
      case 'angry': p = [cx + sd * bw, by - 8, cx, by - 2, cx - sd * bw, by + 6]; break;
      case 'smirk': p = sd > 0 ? [cx - bw, by - 6, cx, by - 13, cx + bw, by - 8] : [cx - bw, by + 2, cx, by, cx + bw, by + 2]; break;
      default: p = [cx - bw, by, cx, by - 2, cx + bw, by];
    }
    if (o.glasses === 'sun') p = p.map((v, i) => i % 2 ? v - 6 : v);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[2], p[3], p[4], p[5]);
    ctx.strokeStyle = o.hair === 'bald' ? '#6b625b' : OL; ctx.lineWidth = 7; ctx.stroke();
  }
  // nose
  ctx.beginPath(); ctx.arc(0, -290, 8, Math.PI * .1, Math.PI * .9);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 4; ctx.stroke();
  if (o.stubble) for (let i = 0; i < 14; i++) circ(-34 + hash(i) * 68, -262 + hash(i + 7) * 30, 2, 'rgba(0,0,0,.25)');
  // mouth
  const tk = o.talk || 0;
  if (tk > .04) {
    ctx.beginPath(); ctx.ellipse(0, -258, 22, 6 + 20 * tk, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#6b1f2a'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
    if (tk > .3) { ctx.beginPath(); ctx.ellipse(0, -258 + 12 * tk, 11, 5 * tk, 0, 0, Math.PI * 2); ctx.fillStyle = '#e57373'; ctx.fill(); }
  } else {
    ctx.beginPath();
    switch (ex) {
      case 'h':
        ctx.moveTo(-24, -268); ctx.quadraticCurveTo(0, -238, 24, -268); ctx.closePath();
        ctx.fillStyle = '#6b1f2a'; ctx.fill(); break;
      case 'smirk': ctx.moveTo(-20, -262); ctx.quadraticCurveTo(6, -252, 26, -274); break;
      case 's': ctx.ellipse(0, -256, 11, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b1f2a'; ctx.fill(); break;
      case 'sad': case 'worry': ctx.moveTo(-18, -250); ctx.quadraticCurveTo(0, -266, 18, -250); break;
      case 'angry': ctx.moveTo(-18, -256); ctx.lineTo(18, -261); break;
      default: ctx.moveTo(-14, -262); ctx.quadraticCurveTo(0, -256, 14, -262);
    }
    ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.stroke();
  }
  if (o.mustache) {
    ctx.beginPath(); ctx.moveTo(0, -276);
    ctx.quadraticCurveTo(-30, -286, -40, -262); ctx.quadraticCurveTo(-20, -270, 0, -268);
    ctx.quadraticCurveTo(20, -270, 40, -262); ctx.quadraticCurveTo(30, -286, 0, -276);
    ctx.fillStyle = o.mustache; ctx.fill();
  }
  if (o.sweat) {
    const sy = -360 + ((t * 40) % 30);
    ctx.beginPath(); ctx.moveTo(86, sy - 22); ctx.quadraticCurveTo(100, sy, 86, sy + 6); ctx.quadraticCurveTo(72, sy, 86, sy - 22);
    ctx.fillStyle = '#7cc8ff'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 4; ctx.stroke();
  }
  // props + hands
  if (o.propL) o.propL(hL[0], hL[1]);
  if (o.propR) o.propR(hR[0], hR[1]);
  circ(hL[0], hL[1], 16, o.skin, OL, 5);
  circ(hR[0], hR[1], 16, o.skin, OL, 5);
  ctx.restore();
}
// common arm poses
const POSE = {
  idle: [.14, .06],
  hold: [.35, -1.95],          // phone at chest (right arm)
  ear: [1.25, 2.3],            // phone to ear (right arm)
  point: [1.45, .12],
  up: [2.6, .35],
  shrug: [.95, 1.75],
  finger: [.45, 2.75],
  watch: [.4, -2.0],
  give: [1.1, .2],
};
const holdPhone = (opt = {}) => (x, y) => phone(x, y - 28, 46, 82, Object.assign({ lw: 4 }, opt));

/* ---------- backgrounds ---------- */
function bgDark(t) {
  const g = ctx.createRadialGradient(W / 2, H * .42, 50, W / 2, H * .42, H * .8);
  g.addColorStop(0, '#26305c'); g.addColorStop(1, '#07080f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 12; i++) {
    const x = hash(i) * W + Math.sin(t * .3 + i) * 40;
    const y = ((hash(i + 20) * H - t * (30 + hash(i + 5) * 40)) % H + H) % H;
    ctx.save(); ctx.translate(x, y); ctx.rotate(hash(i + 9) * 6 + t * .2 * (hash(i + 3) - .5));
    ctx.globalAlpha = .08; rr(-40, -70, 80, 140, 16, null, '#fff', 5); ctx.restore();
  }
}
function bgRoom(night, t) {
  ctx.fillStyle = night ? '#252a47' : '#f2d6ac'; ctx.fillRect(0, 0, W, H);
  // wallpaper stripes
  ctx.fillStyle = night ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.18)';
  for (let x = 0; x < W; x += 90) ctx.fillRect(x, 0, 40, 1300);
  // window
  rr(600, 420, 360, 420, 14, '#fff', OL, 8);
  const sky = ctx.createLinearGradient(0, 430, 0, 830);
  if (night) { sky.addColorStop(0, '#0d1433'); sky.addColorStop(1, '#2b3a7a'); }
  else { sky.addColorStop(0, '#7cc4ff'); sky.addColorStop(1, '#cdeaff'); }
  rr(618, 438, 324, 384, 8, sky);
  if (night) {
    circ(870, 520, 34, '#fff7cc'); circ(884, 510, 30, '#0d1433');
    for (let i = 0; i < 9; i++) circ(640 + hash(i) * 280, 460 + hash(i + 4) * 300, 2.5 + (Math.sin(t * 3 + i) + 1), '#fff');
  } else {
    const cx = 700 + (t * 8) % 300;
    ctx.save(); ctx.beginPath(); ctx.rect(618, 438, 324, 384); ctx.clip();
    circ(cx, 560, 30, '#fff'); circ(cx + 34, 548, 36, '#fff'); circ(cx + 70, 562, 28, '#fff');
    ctx.restore();
  }
  line([780, 430, 780, 830], '#fff', 12); line([610, 630, 950, 630], '#fff', 12);
  // poster
  rr(110, 420, 220, 300, 10, night ? '#3b4470' : '#ffffff', OL, 6);
  phone(220, 560, 90, 160, { s1: '#ff7a59', s2: '#ffd23f' });
  txt('GOAL', 220, 680, 34, night ? '#ffd23f' : '#e5484d', { w: 900 });
  // floor
  ctx.fillStyle = night ? '#2d2438' : '#b98552'; ctx.fillRect(0, 1300, W, H - 1300);
  ctx.fillStyle = night ? '#3a2f47' : '#a5743f';
  for (let y = 1340; y < H; y += 80) ctx.fillRect(0, y, W, 6);
  ctx.fillStyle = night ? '#1b1f35' : '#e6c08c'; ctx.fillRect(0, 1286, W, 18);
  // desk
  rr(560, 1110, 440, 34, 8, night ? '#5a4636' : '#8a5a34', OL, 6);
  rr(590, 1144, 26, 160, 4, night ? '#4a3a2c' : '#734a2a', OL, 5);
  rr(944, 1144, 26, 160, 4, night ? '#4a3a2c' : '#734a2a', OL, 5);
  // laptop
  ctx.save(); ctx.translate(820, 1110);
  rr(-110, -150, 220, 150, 10, '#cbd5e1', OL, 6);
  rr(-96, -136, 192, 122, 6, night ? '#3b82f6' : '#1e293b');
  rr(-140, -12, 280, 16, 6, '#94a3b8', OL, 5);
  ctx.restore();
  if (night) { ctx.fillStyle = 'rgba(5,8,25,.35)'; ctx.fillRect(0, 0, W, H); }
}
function bgStreet(t) {
  const g = ctx.createLinearGradient(0, 0, 0, 1260);
  g.addColorStop(0, '#2b2a6b'); g.addColorStop(.55, '#a24f8c'); g.addColorStop(1, '#ff9a62');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 1260);
  // far buildings
  for (let i = 0; i < 9; i++) {
    const bx = i * 130 - 20, bh = 300 + hash(i) * 380, bw = 120;
    ctx.fillStyle = '#3a2d63'; ctx.fillRect(bx, 1260 - bh, bw, bh);
    for (let r = 0; r < bh / 60 - 1; r++) for (let c = 0; c < 3; c++) {
      if (hash(i * 31 + r * 7 + c) > .45) {
        ctx.fillStyle = hash(i + r + c * 3) > .5 ? '#ffd27a' : '#ffb85c';
        ctx.fillRect(bx + 16 + c * 34, 1260 - bh + 30 + r * 60, 20, 28);
      }
    }
  }
  // sidewalk
  ctx.fillStyle = '#7b8194'; ctx.fillRect(0, 1250, W, H - 1250);
  ctx.fillStyle = '#6a7084'; for (let x = 0; x < W; x += 140) ctx.fillRect(x, 1250, 6, H - 1250);
  ctx.fillStyle = '#9aa0b3'; ctx.fillRect(0, 1240, W, 16);
  // metro sign
  rr(905, 760, 22, 490, 6, '#4b5563', OL, 6);
  circ(916, 720, 70, '#e5484d', OL, 8);
  txt('М', 916, 724, 86, '#fff', { w: 900 });
  // lamp
  rr(95, 640, 18, 610, 6, '#374151', OL, 5);
  ctx.beginPath(); ctx.moveTo(60, 640); ctx.lineTo(148, 640); ctx.lineTo(128, 600); ctx.lineTo(80, 600); ctx.closePath();
  ctx.fillStyle = '#374151'; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = 5; ctx.stroke();
  const lg = ctx.createRadialGradient(104, 660, 10, 104, 660, 260);
  lg.addColorStop(0, 'rgba(255,220,140,.55)'); lg.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = lg; ctx.fillRect(0, 420, 400, 500);
}
function bgShop() {
  ctx.fillStyle = '#e9e3d5'; ctx.fillRect(0, 0, W, H);
  rr(90, 380, 900, 560, 14, '#c9a46f', OL, 8);
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  for (let x = 130; x < 970; x += 44) for (let y = 410; y < 920; y += 44) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
  wrench(220, 520, 1, -.4); wrench(840, 500, .8, .5);
  // screwdrivers
  for (const [x, c] of [[380, '#e5484d'], [430, '#3b82f6'], [480, '#ffd23f']]) {
    rr(x - 12, 470, 24, 90, 8, c, OL, 5); line([x, 560, x, 680], '#9aa4b2', 9);
  }
  // phones on shelf
  rr(560, 700, 360, 20, 4, '#7a5a3a', OL, 5);
  phone(610, 645, 48, 88, {}); phone(690, 645, 48, 88, { s1: '#22c55e', s2: '#0ea5e9' }); phone(770, 645, 48, 88, { s1: '#f97316', s2: '#ef4444' }); phone(850, 645, 48, 88, { crack: true });
  line([130, 300, 130, 330], OL, 5); line([290, 300, 290, 330], OL, 5);
  rr(70, 326, 280, 80, 12, '#1f2937', OL, 6);
  txt('РЕМОНТ', 210, 368, 44, '#ffd23f', { w: 900 });
  ctx.fillStyle = '#b8ab95'; ctx.fillRect(0, 1360, W, H - 1360);
}
function counter() {
  rr(470, 1150, 640, 40, 6, '#a07a55', OL, 7);
  rr(490, 1190, 600, 400, 0, '#6b4f3a', OL, 7);
  line([490, 1290, 1090, 1290], 'rgba(0,0,0,.2)', 6);
}
function bgBoard() {
  ctx.fillStyle = '#dfe7ef'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c3cfdc'; ctx.fillRect(0, 1340, W, H - 1340);
  rr(330, 360, 690, 860, 18, '#fbfdff', '#64748b', 16);
  rr(420, 1218, 510, 24, 6, '#94a3b8', OL, 4);
  rr(470, 1206, 70, 16, 6, '#e5484d'); rr(560, 1206, 70, 16, 6, '#3b82f6');
}

/* ---------- HUD ---------- */
function hud(t) {
  if (t < HUD_FROM) return;
  const a = P(t, HUD_FROM, HUD_FROM + .4);
  const v = money(t);
  let glow = null, pulse = 0;
  for (const e of MONEY) if (within(t, e.t, e.t + 1.4)) { glow = e.d < 0 ? '#ef4444' : '#22c55e'; pulse = 1 - P(t, e.t, e.t + 1.4); }
  if (HUD_PULSE && within(t, HUD_PULSE[0], HUD_PULSE[1])) { glow = '#ffd23f'; pulse = .5 + .5 * Math.sin(t * 10); }
  const sc = 1 + pulse * .08;
  at(540, 262, sc, 0, () => {
    if (glow) { ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 40; rr(-230, -50, 460, 100, 50, 'rgba(14,17,28,.92)', glow, 6); ctx.restore(); }
    else rr(-230, -50, 460, 100, 50, 'rgba(14,17,28,.88)', 'rgba(255,255,255,.18)', 4);
    coin(-170, 0, 34);
    txt('БАЛАНС', 30, -24, 22, 'rgba(255,255,255,.6)', { w: 600 });
    txt(fmt(v) + ' ₽', 30, 14, 50, v < 30000 ? '#ffffff' : '#ffffff', { w: 900 });
  }, a);
  const hasDays = typeof DAYS !== 'undefined' && DAYS.length;
  if (hasDays && t >= DAYS[0].t) {
    let cur = DAYS[0];
    for (const d of DAYS) if (t >= d.t) cur = d;
    const k = P(t, cur.t, cur.t + .45), sc = 1 + .3 * Math.sin(k * Math.PI);
    at(540, 350, sc, 0, () => {
      rr(-190, -34, 380, 68, 34, '#ffd23f', OL, 5);
      rr(-170, -18, 34, 34, 6, '#fff', OL, 4); line([-170, -8, -136, -8], '#e5484d', 6);
      txt('ДЕНЬ ' + cur.d + ' / ' + DAYS_TOTAL, 20, 3, 34, OL, { w: 900 });
    }, P(t, DAYS[0].t, DAYS[0].t + .3) * (typeof VOTE_AT === 'undefined' ? 1 : 1 - P(t, VOTE_AT, VOTE_AT + .3)));
  }
  for (const e of MONEY) {
    const k = P(t, e.t, e.t + 1.8);
    if (k > 0 && k < 1) {
      const s = (e.d > 0 ? '+' : '−') + fmt(Math.abs(e.d)) + ' ₽';
      txt(s, 540, (hasDays ? 440 : 370) + k * 50, 64, e.d > 0 ? '#4ade80' : '#ff5a5f', { w: 900, st: 12, a: 1 - k * k });
    }
  }
}

/* ---------- subtitles ---------- */
function subs(t) {
  const s = SUBS.find(x => t >= x[0] && t < x[1]);
  if (!s) return;
  const [a, b, who, text] = s;
  const k = eout(P(t, a, a + .2)) * (1 - P(t, b - .12, b));
  const size = 64, lh = 80, maxW = 900;
  // tokenize with emphasis
  const words = []; let em = false;
  for (const raw of text.split(' ')) {
    let w = raw, e0 = em;
    if (w.startsWith('*')) { w = w.slice(1); e0 = true; em = true; }
    if (w.includes('*')) { w = w.replace('*', ''); em = false; }
    words.push({ w, e: e0 });
  }
  ctx.font = `800 ${size}px ${F}`;
  const sp = ctx.measureText(' ').width;
  const lines = [[]]; let lw = 0;
  for (const wd of words) {
    wd.wd = ctx.measureText(wd.w).width;
    if (lw + wd.wd > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(wd); lw += wd.wd + sp;
  }
  const cy = 1450, top = cy - (lines.length - 1) * lh / 2;
  ctx.save(); ctx.globalAlpha = k;
  ctx.translate(540, cy); const sc = lerp(.86, 1, k); ctx.scale(sc, sc); ctx.translate(-540, -cy);
  if (who !== 'T') {
    const sp2 = SPK[who], nw = tw(sp2.name, 40, 800) + 48, ly = top - 84;
    rr(540 - nw / 2, ly - 30, nw, 60, 30, sp2.col, OL, 5);
    txt(sp2.name, 540, ly + 1, 40, '#fff', { w: 800 });
  }
  lines.forEach((ln, i) => {
    const total = ln.reduce((s2, w) => s2 + w.wd, 0) + sp * (ln.length - 1);
    let x = 540 - total / 2; const y = top + i * lh;
    for (const wd of ln) {
      ctx.font = `800 ${size}px ${F}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 15; ctx.strokeStyle = '#0b0d12'; ctx.strokeText(wd.w, x, y);
      ctx.fillStyle = wd.e ? '#ffd23f' : (who === 'T' ? '#ffffff' : '#e8ecf5'); ctx.fillText(wd.w, x, y);
      x += wd.wd + sp;
    }
  });
  ctx.restore();
}

/* ---------- transitions ---------- */
function wipe(t) {
  for (const b of CUTS) {
    const k = P(t, b - .3, b + .3);
    if (k <= 0 || k >= 1) continue;
    const x0 = lerp(-W * 1.1, W * 2.1, eio(k));
    ctx.save(); ctx.translate(x0, 0);
    ctx.beginPath(); ctx.moveTo(-W * .95, 0); ctx.lineTo(W * .75, 0); ctx.lineTo(W * .45, H); ctx.lineTo(-W * 1.25, H); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-W * .8, 0); ctx.lineTo(W * .6, 0); ctx.lineTo(W * .3, H); ctx.lineTo(-W * 1.1, H); ctx.closePath();
    ctx.fillStyle = '#10131c'; ctx.fill();
    ctx.restore();
  }
}

function frame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  const sc = SCENES.find(s => t >= s[0] && t < s[1]) || SCENES[SCENES.length - 1];
  ctx.save(); sc[2](t); ctx.restore();
  hud(t);
  subs(t);
  wipe(t);
}


/* ---------- shared props (episode 2+) ---------- */
function lockPhone(x, y, w, h, rot = 0) {
  phone(x, y, w, h, { s1: '#0f172a', s2: '#1e293b', rot });
  at(x, y - h * .06, w / 110, rot, () => {
    rr(-24, -10, 48, 40, 8, '#fff');
    ctx.beginPath(); ctx.arc(0, -10, 15, Math.PI, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.stroke();
    txt('Apple ID', 0, 58, 16, '#cbd5e1', { w: 600 });
  });
}
function star(x, y, r, col = '#fff') {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, rr2 = i % 2 ? r * .32 : r;
    ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
const paper = (x, y) => at(x, y - 44, 1, -.12, () => {
  rr(-36, -48, 72, 96, 6, '#fff', OL, 4);
  line([-22, -26, 22, -26], '#94a3b8', 4); line([-22, -8, 22, -8], '#94a3b8', 4); line([-22, 10, 14, 10], '#94a3b8', 4);
  check(-8, 28, .55, 1);
});
const earPhone = (x, y) => phone(x - 4, y - 40, 40, 74, { rot: -.25, lw: 4 });
function mallCard(x, y, k, t) {
  at(x, y, k, 0, () => {
    rr(-440, -240, 880, 480, 30, '#e8eef6', OL, 8);
    ctx.save(); ctx.beginPath(); ctx.roundRect(-440, -240, 880, 480, 30); ctx.clip();
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(-440, 80, 880, 200);
    for (let i = -4; i <= 4; i++) line([i * 110, 80, i * 220, 240], 'rgba(0,0,0,.08)', 4);
    // shops in background
    for (let i = 0; i < 4; i++) {
      rr(-420 + i * 215, -200, 195, 240, 8, ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0'][i], OL, 4);
      rr(-400 + i * 215, -130, 155, 150, 6, 'rgba(255,255,255,.7)');
    }
    // kiosk
    rr(-200, 0, 400, 170, 24, '#f8fafc', OL, 7);
    rr(-170, 30, 340, 70, 12, '#bae6fd', OL, 5);
    rr(-220, -40, 440, 50, 14, '#1f2937', OL, 6);
    txt('СДАЁТСЯ', 0, -14, 34, '#ff5a5f', { w: 900 });
    ctx.restore();
  });
}

const ringProp = t => (x, y) => {
  phone(x, y - 28, 46, 82, { s1: '#22c55e', s2: '#16a34a', lw: 4 });
  for (let i = 0; i < 2; i++) {
    const r = 50 + ((t * 80 + i * 30) % 60);
    ctx.beginPath(); ctx.arc(x, y - 28, r, -.6, .6); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 28, r, Math.PI - .6, Math.PI + .6); ctx.stroke();
  }
};
function callCard(t, a, b, top, name, y = 560) {
  const ck = pop(t, a, .3) * (1 - P(t, b - .3, b));
  if (ck <= 0) return;
  at(540, y, ck, 0, () => {
    rr(-300, -140, 600, 280, 40, 'rgba(20,24,38,.95)', '#fff', 5);
    txt(top, 0, -86, 30, '#9ca3af', { w: 600 });
    txt(name, 0, -30, 46, '#fff', { w: 800 });
    circ(-120, 70, 42, '#e5484d', OL, 5); circ(120, 70, 42, '#22c55e', OL, 5);
    line([-140, 70, -100, 70], '#fff', 10);
    phone(120, 70, 22, 38, { s1: '#fff', s2: '#fff', lw: 3, body: '#fff' });
  });
}
// big "PROBLEM #n" plate: pops in the middle, then parks at the top of the scene
function problemBanner(t, a, n, title) {
  if (t < a) return;
  const mv = eio(P(t, a + 2.4, a + 2.9));
  const y = lerp(620, 392, mv), s = pop(t, a, .4) * lerp(1, .55, mv);
  const [dx, dy] = shk(t, a + .3, .3, 14);
  at(540 + dx, y + dy, s, -.03, () => {
    const w = Math.max(tw(title, 64, 900), 420) + 120;
    rr(-w / 2, -120, w, 240, 34, '#e5484d', OL, 9);
    txt('ПРОБЛЕМА №' + n, 0, -52, 52, '#ffe4e6', { w: 900 });
    txt(title, 0, 36, 64, '#fff', { w: 900 });
  });
}
function rulePill(t, a, b, s, y = 1180, col = '#16a34a') {
  const k = pop(t, a, .35) * (1 - P(t, b - .25, b));
  if (k <= 0) return;
  at(540, y, k, -.03, () => {
    const w = tw(s, 50, 900) + 90;
    rr(-w / 2, -50, w, 100, 50, col, OL, 7);
    txt(s, 0, 3, 50, '#fff', { w: 900 });
  });
}
function countTable(t, a, title, rows, totalT, totalText, totalCol) {
  const tk = P(t, a, a + .5);
  if (tk <= 0) return;
  ctx.save(); ctx.globalAlpha = tk * .6; ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H); ctx.restore();
  at(540, 780, lerp(.9, 1, eout(tk)), 0, () => {
    rr(-430, -400, 860, 780, 34, '#fffdf5', OL, 9);
    txt(title, 0, -320, 60, OL, { w: 900 });
    line([-370, -260, 370, -260], '#e2e8f0', 6);
    rows.forEach(([rt, l, v, c], i) => {
      const k = P(t, rt, rt + .3); if (k <= 0) return;
      const y = -200 + i * 84;
      txt(l, -370, y, 42, '#334155', { w: 600, al: 'left', a: k });
      txt(v, 370, y, 50, c, { w: 900, al: 'right', a: k });
    });
    if (t > totalT - .3) line([-370, 222, 370, 222], OL, 7);
    const fk = P(t, totalT, totalT + .3);
    if (fk > 0) {
      txt('ИТОГ', -370, 296, 56, OL, { w: 900, al: 'left', a: fk });
      const [ex2, ey2] = shk(t, totalT + .3, .3, 12);
      at(180 + ex2, 296 + ey2, lerp(2, 1, eout(fk)), -.04, () => txt(totalText, 0, 0, 80, totalCol, { w: 900 }), fk);
    }
  });
}
function voteCard(t, a, opts, nextT, nextText) {
  const vk = P(t, a, a + .4);
  if (vk <= 0) return;
  ctx.save(); ctx.globalAlpha = vk * .72; ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H); ctx.restore();
  at(540, 400, pop(t, a + .1), -.03, () => txt('РЕШАТЬ ВАМ!', 0, 0, 96, '#ffd23f', { w: 900, st: 16 }));
  opts.forEach((o, i) => {
    const x = i ? 790 : 290, col = i ? '#3b82f6' : '#22c55e';
    const k = pop(t, a + .6 + i * .5, .4), pul = 1 + .03 * Math.sin(t * 6 + x);
    at(x, 760, k * pul, 0, () => {
      rr(-225, -250, 450, 500, 36, '#fff', col, 12);
      circ(0, -150, 70, col, OL, 7);
      txt(String(i + 1), 0, -146, 96, '#fff', { w: 900 });
      txt(o[0], 0, -10, 58, OL, { w: 900 });
      txt(o[1], 0, 58, 58, OL, { w: 900 });
      txt(o[2], 0, 160, 32, '#64748b', { w: 700 });
    });
  });
  at(540, 1140, pop(t, a + 2.2), 0, () => {
    rr(-430, -60, 860, 120, 60, '#ffd23f', OL, 8);
    ctx.save(); ctx.translate(-350, 0);
    rr(-36, -28, 72, 50, 14, '#fff', OL, 5);
    ctx.beginPath(); ctx.moveTo(-12, 22); ctx.lineTo(-22, 40); ctx.lineTo(6, 22); ctx.fillStyle = '#fff'; ctx.fill();
    txt('…', 0, -8, 30, OL, { w: 900 }); ctx.restore();
    txt('ПИШИ 1 ИЛИ 2 В КОММЕНТЫ', 40, 3, 46, OL, { w: 900 });
  });
  if (t > nextT) at(540, 1280, pop(t, nextT), 0, () => txt(nextText, 0, 0, 44, '#fff', { w: 800, st: 10 }));
}

function personCard(t, x, y, w, h, cfg, label, col, k, shakeAt = null) {
  if (k <= 0) return;
  const [dx, dy] = shakeAt == null ? [0, 0] : shk(t, shakeAt, .5, 10);
  at(x + dx, y + dy, k, .02, () => {
    rr(-w / 2, -h / 2, w, h, 30, '#dbeafe', col, 9);
    ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 24); ctx.clip();
    person(Object.assign({}, cfg, { x: 0, y: 290, s: 1 }), t);
    ctx.restore();
    const lw = tw(label, 34, 800) + 40;
    rr(-lw / 2, h / 2 - 28, lw, 56, 28, col, OL, 5);
    txt(label, 0, h / 2, 34, '#fff', { w: 800 });
  });
}
/* ---------- 2.5D character renderer (opt-in: const STYLE = '25d' in an episode) ---------- */
function shade(hex, k) {
  // k > 0 lightens towards white, k < 0 darkens towards black
  let r, g, b;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(hex);
  if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  else { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
const OL25 = 'rgba(22,24,36,.9)';
function vgrad(y0, y1, c, light = .18, dark = -.22) {
  const g = ctx.createLinearGradient(-60, y0, 60, y1);
  g.addColorStop(0, shade(c, light)); g.addColorStop(.55, c); g.addColorStop(1, shade(c, dark));
  return g;
}
function limb25(pts, col, w) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = OL25; ctx.lineWidth = w + 9; ctx.stroke();
  ctx.strokeStyle = shade(col, -.18); ctx.lineWidth = w; ctx.stroke();
  ctx.save(); ctx.translate(-w * .16, -w * .05);
  ctx.strokeStyle = col; ctx.lineWidth = w * .62; ctx.stroke();
  ctx.translate(-w * .08, 0); ctx.strokeStyle = shade(col, .22); ctx.lineWidth = w * .18; ctx.stroke();
  ctx.restore();
}
function ball(x, y, r, col, ol = 4) {
  const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r * 1.05);
  g.addColorStop(0, shade(col, .32)); g.addColorStop(.6, col); g.addColorStop(1, shade(col, -.28));
  circ(x, y, r, g, OL25, ol);
}
function person25(o, t) {
  const s = o.s || 1, ph = o.ph || 0, ex = o.expr || 'n', tk = o.talk || 0;
  const walk = o.walk || 0, wp = t * (o.wspd || 9);
  // contact shadow
  ctx.save(); ctx.translate(o.x, o.y);
  const sg = ctx.createRadialGradient(0, 0, 4, 0, 0, 110 * s);
  sg.addColorStop(0, 'rgba(0,0,0,.32)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.scale(1, .22); ctx.beginPath(); ctx.arc(0, 0, 110 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(s, s);
  if (o.rot) ctx.rotate(o.rot);
  const breath = Math.sin(t * 2.1 + ph);
  const bob = (o.bob != null ? o.bob : breath * 2) - Math.abs(Math.sin(wp)) * 14 * walk;
  // legs with knee lift
  for (const sd of [-1, 1]) {
    const phs = wp + (sd > 0 ? 0 : Math.PI);
    const lift = Math.max(0, Math.cos(phs)) * 30 * walk;
    const sw = Math.sin(phs) * 26 * walk;
    const hx = sd * 24, hy = -88, fx = sd * 25 + sw, fy = -lift;
    const kx = (hx + fx) / 2 + sd * (6 + lift * .25), ky = (hy + fy) / 2 - lift * .35;
    limb25([hx, hy, kx, ky, fx, fy - 12], o.pants, 27);
    ctx.save(); ctx.translate(fx + sd * 8, fy - 7);
    const shg = ctx.createLinearGradient(0, -14, 0, 14); shg.addColorStop(0, shade(o.shoe || '#2a2f42', .3)); shg.addColorStop(1, shade(o.shoe || '#2a2f42', -.3));
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 15, 0, 0, Math.PI * 2); ctx.fillStyle = shg; ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-6, -6, 12, 4, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
    ctx.restore();
  }
  ctx.translate(0, bob);
  const sway = (o.sway != null ? o.sway : Math.sin(t * 1.3 + ph) * .012) + Math.sin(wp) * .045 * walk;
  ctx.translate(0, -88); ctx.rotate(sway); ctx.translate(0, 88);
  // back layers
  const turn = clamp(o.turn != null ? o.turn : (o.lx || 0) * .45, -1, 1);
  if (o.hair === 'long') { ctx.beginPath(); ctx.ellipse(turn * -8, -280, 98, 124, 0, 0, Math.PI * 2); ctx.fillStyle = vgrad(-400, -160, o.hairCol, .15, -.35); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 5; ctx.stroke(); }
  if (o.hair === 'hood') ball(0, -310, 96, o.hood, 5);
  if (o.hair === 'cap') { ctx.beginPath(); ctx.ellipse(-82 - turn * 20, -362, 42, 13, -.5, 0, Math.PI * 2); ctx.fillStyle = shade(o.capCol, -.15); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4; ctx.stroke(); }
  // torso (slight taper, breathing)
  const by = 1 + breath * .012;
  ctx.save(); ctx.translate(0, -70); ctx.scale(1, by); ctx.translate(0, 70);
  ctx.beginPath();
  ctx.moveTo(-58, -250); ctx.quadraticCurveTo(-76, -246, -72, -200); ctx.lineTo(-66, -92); ctx.quadraticCurveTo(-64, -70, -40, -70);
  ctx.lineTo(40, -70); ctx.quadraticCurveTo(64, -70, 66, -92); ctx.lineTo(72, -200); ctx.quadraticCurveTo(76, -246, 58, -250); ctx.closePath();
  ctx.fillStyle = vgrad(-260, -60, o.shirt, .2, -.3); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4.5; ctx.stroke();
  // fabric folds + side shadow
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(36, -260, 50, 200);
  line([-30, -120, -10, -100], 'rgba(0,0,0,.12)', 4); line([24, -140, 34, -112], 'rgba(0,0,0,.12)', 4);
  const ns = ctx.createRadialGradient(0, -250, 4, 0, -250, 70); ns.addColorStop(0, 'rgba(0,0,0,.32)'); ns.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ns; ctx.fillRect(-80, -260, 160, 80);
  ctx.restore();
  if (o.apron) { rr(-46, -205, 92, 135, [12, 12, 18, 18], vgrad(-205, -70, o.apron), OL25, 4); }
  else if (o.pocket !== false) { rr(-40, -150, 80, 46, 16, 'rgba(0,0,0,.08)', 'rgba(0,0,0,.2)', 3); }
  if (o.collar) { ctx.beginPath(); ctx.moveTo(-44, -248); ctx.lineTo(-8, -196); ctx.lineTo(-28, -252); ctx.moveTo(44, -248); ctx.lineTo(8, -196); ctx.lineTo(28, -252); ctx.fillStyle = o.collar; ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 3; ctx.stroke(); }
  if (o.chain) { ctx.beginPath(); ctx.arc(0, -262, 34, Math.PI * .2, Math.PI * .8); ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 6; ctx.stroke(); }
  if (o.strings) { line([-14, -236, -17, -194], '#f5f5f5', 5); line([14, -236, 17, -194], '#f5f5f5', 5); circ(-17, -192, 5, '#f5f5f5'); circ(17, -192, 5, '#f5f5f5'); }
  if (o.zip) line([0, -240, 0, -74], 'rgba(0,0,0,.35)', 3);
  ctx.restore();
  // arms (swing while walking)
  const armPts = (ab, sd) => {
    let [a, b] = ab;
    if (walk && ab === POSE.idle) { a += Math.sin(wp + (sd > 0 ? Math.PI : 0)) * .35 * walk; b += .25 * walk; }
    const L = 60, sx = sd * 60, sy = -224;
    const ex2 = sx + sd * Math.sin(a) * L, ey2 = sy + Math.cos(a) * L;
    const hx = ex2 + sd * Math.sin(a + b) * L, hy = ey2 + Math.cos(a + b) * L;
    limb25([sx, sy, ex2, ey2, hx, hy], o.sleeve || o.shirt, 25);
    return [hx, hy];
  };
  const hL = armPts(o.aL || POSE.idle, -1), hR = armPts(o.aR || POSE.idle, 1);

  // ----- head group (pivot at neck) -----
  const nod = (o.tilt || 0) + (tk > .05 ? Math.sin(t * 5.3) * .035 * tk : 0) + Math.sin(t * .9 + ph) * .01;
  ctx.save(); ctx.translate(0, -250); ctx.rotate(nod); ctx.translate(0, 250);
  const fx = turn * 18;
  // neck
  rr(-20, -268, 40, 30, 10, shade(o.skin, -.2));
  // ears (far ear shrinks)
  ball(-73 + turn * 6, -306, 15 * (1 + turn * .35), o.skin, 4);
  ball(73 + turn * 6, -306, 15 * (1 - turn * .35), o.skin, 4);
  // head
  const hg = ctx.createRadialGradient(-28 + fx, -350, 10, 0, -312, 92);
  hg.addColorStop(0, shade(o.skin, .3)); hg.addColorStop(.55, o.skin); hg.addColorStop(1, shade(o.skin, -.25));
  circ(0, -312, 76, hg, OL25, 4.5);
  ctx.beginPath(); ctx.arc(0, -312, 70, -0.9, 0.5); ctx.strokeStyle = 'rgba(255,235,210,.55)'; ctx.lineWidth = 5; ctx.stroke(); // rim light
  // cheeks
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sd * 40 + fx * 1.1, -280, 16, 9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(235,110,110,.22)'; ctx.fill(); }
  // hair front
  if (o.hair === 'cap') {
    ctx.beginPath(); ctx.arc(0, -320, 80, Math.PI * 1.03, Math.PI * 1.97); ctx.closePath();
    ctx.fillStyle = vgrad(-400, -320, o.capCol, .28, -.25); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4.5; ctx.stroke();
    line([-75, -337, 75, -337], shade(o.capCol, -.3), 7);
    line([fx, -398, fx * .6, -340], shade(o.capCol, -.22), 3);
    ball(fx * .4, -400, 7, shade(o.capCol, -.1), 3);
    ctx.beginPath(); ctx.ellipse(-30 + fx, -378, 22, 8, -.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.fillStyle = o.hairCol;
    ctx.beginPath(); ctx.moveTo(-62, -334); ctx.quadraticCurveTo(-58, -300, -70, -290); ctx.lineTo(-74, -334); ctx.fill();
    ctx.beginPath(); ctx.moveTo(62, -334); ctx.quadraticCurveTo(58, -300, 70, -290); ctx.lineTo(74, -334); ctx.fill();
  } else if (o.hair === 'short') {
    ctx.beginPath(); ctx.arc(0, -318, 80, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(50 + fx, -350, 10 + fx, -352); ctx.quadraticCurveTo(-30 + fx, -358, -62, -330); ctx.closePath();
    ctx.fillStyle = vgrad(-400, -320, o.hairCol, .25, -.3); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4; ctx.stroke();
  } else if (o.hair === 'long') {
    ctx.beginPath(); ctx.arc(0, -318, 81, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(24 + fx, -362, -28 + fx, -342); ctx.quadraticCurveTo(-60, -322, -81, -312);
    ctx.fillStyle = vgrad(-400, -310, o.hairCol, .25, -.3); ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-26, -378, 26, 7, -.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fill();
  } else if (o.hair === 'bald') {
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(sd * 66, -306, 18, 0, Math.PI * 2); ctx.fillStyle = o.hairCol || '#9a948e'; ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(-22 + fx, -366, 22, 9, -.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fill();
  } else if (o.hair === 'hood') {
    ctx.beginPath(); ctx.arc(0, -312, 82, Math.PI * 1.1, Math.PI * 1.9); ctx.strokeStyle = o.hood; ctx.lineWidth = 26; ctx.stroke();
  }
  // eyes
  const lx = (o.lx || 0) * 6, ly = (o.ly || 0) * 5;
  const blink = ((t + ph * 1.7) % 3.9) < .14 && ex !== 's';
  for (const sd of [-1, 1]) {
    const far = sd * turn < 0 ? 1 - Math.abs(turn) * .25 : 1;
    const cx = sd * 27 * (1 - Math.abs(turn) * .12) + fx, cy = -318;
    if (o.glasses === 'sun') continue;
    const ew = 16 * far, eh = ex === 's' ? 21 : 19;
    if (blink) { ctx.beginPath(); ctx.arc(cx, cy - 2, ew, .15, Math.PI - .15); ctx.strokeStyle = OL25; ctx.lineWidth = 5; ctx.stroke(); continue; }
    ctx.beginPath(); ctx.ellipse(cx, cy, ew, eh, 0, 0, Math.PI * 2); ctx.fillStyle = '#fdfdfb'; ctx.fill();
    ctx.save(); ctx.clip();
    const ix = cx + lx, iy = cy + ly + 2, ir = (ex === 's' ? 8 : 10.5) * far;
    const ig = ctx.createRadialGradient(ix, iy + 3, 1, ix, iy, ir); ig.addColorStop(0, o.iris ? shade(o.iris, .35) : '#9a6a3c'); ig.addColorStop(1, o.iris || '#4a2f1d');
    circ(ix, iy, ir, ig); circ(ix, iy, ir * .5, '#0d0b0a');
    circ(ix - 3, iy - 4, 3.4, '#fff'); circ(ix + 3, iy + 3, 1.6, 'rgba(255,255,255,.8)');
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(cx - ew, cy - eh, ew * 2, 7);
    if (o.tired) { ctx.fillStyle = shade(o.skin, -.05); ctx.fillRect(cx - ew, cy - eh, ew * 2, eh * .7); }
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(cx, cy, ew, eh, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.strokeStyle = OL25; ctx.lineWidth = 5; ctx.stroke();
    if (o.tired) { ctx.beginPath(); ctx.arc(cx, cy + eh + 2, ew * .8, .3, Math.PI - .3); ctx.strokeStyle = 'rgba(80,40,60,.35)'; ctx.lineWidth = 4; ctx.stroke(); }
  }
  if (o.glasses === 'sun') {
    rr(-54 + fx, -336, 48, 32, 10, '#0f1117', OL25, 3); rr(6 + fx, -336, 48, 32, 10, '#0f1117', OL25, 3);
    line([-6 + fx, -322, 6 + fx, -322], OL25, 4);
    line([-46 + fx, -328, -32 + fx, -328], 'rgba(255,255,255,.55)', 4); line([14 + fx, -328, 28 + fx, -328], 'rgba(255,255,255,.55)', 4);
  }
  if (o.glasses === 'round') { circ(-27 + fx, -318, 24, null, '#2b2f3a', 4); circ(27 + fx, -318, 24, null, '#2b2f3a', 4); line([-4 + fx, -320, 4 + fx, -320], '#2b2f3a', 4); }
  // brows (lift with speech)
  const lift = tk * 4;
  for (const sd of [-1, 1]) {
    const cx = sd * 27 + fx, by = -348 - lift, bw = 16;
    let p;
    switch (ex) {
      case 's': p = [cx - bw, by - 8, cx, by - 16, cx + bw, by - 8]; break;
      case 'h': p = [cx - bw, by + 2, cx, by - 6, cx + bw, by + 2]; break;
      case 'sad': case 'worry': p = [cx + sd * bw, by + 4, cx, by - 2, cx - sd * bw, by - 9]; break;
      case 'angry': p = [cx + sd * bw, by - 8, cx, by - 2, cx - sd * bw, by + 7]; break;
      case 'smirk': p = sd > 0 ? [cx - bw, by - 6, cx, by - 13, cx + bw, by - 8] : [cx - bw, by + 2, cx, by, cx + bw, by + 2]; break;
      default: p = [cx - bw, by, cx, by - 3, cx + bw, by];
    }
    if (o.glasses === 'sun') p = p.map((v, i) => i % 2 ? v - 6 : v);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[2], p[3], p[4], p[5]);
    ctx.strokeStyle = o.browCol || (o.hair === 'bald' ? '#6b625b' : '#2a2018'); ctx.lineWidth = 8; ctx.stroke();
  }
  // nose
  const nx = fx * 1.25;
  ctx.beginPath(); ctx.ellipse(nx, -290, 10, 8, 0, 0, Math.PI * 2); ctx.fillStyle = shade(o.skin, -.08); ctx.fill();
  ctx.beginPath(); ctx.ellipse(nx - 3, -293, 4, 3, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fill();
  if (o.stubble) for (let i = 0; i < 26; i++) circ(-38 + hash(i) * 76 + fx, -270 + hash(i + 7) * 36, 1.8, 'rgba(40,30,30,.28)');
  // mouth
  const mx = fx * 1.1;
  if (tk > .04) {
    const mh = 5 + 22 * tk, mw = 22 - 4 * tk + 3 * Math.sin(t * 7.3);
    ctx.beginPath(); ctx.ellipse(mx, -258, mw, mh, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5e1a24'; ctx.fill();
    ctx.save(); ctx.clip();
    if (tk > .3) { ctx.fillStyle = '#fbf7f2'; ctx.fillRect(mx - mw, -258 - mh, mw * 2, mh * .38); }
    ctx.beginPath(); ctx.ellipse(mx, -258 + mh * .75, mw * .6, mh * .45, 0, 0, Math.PI * 2); ctx.fillStyle = '#e36f7a'; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(mx, -258, mw, mh, 0, 0, Math.PI * 2); ctx.strokeStyle = OL25; ctx.lineWidth = 4; ctx.stroke();
  } else {
    ctx.beginPath();
    switch (ex) {
      case 'h': ctx.moveTo(mx - 24, -268); ctx.quadraticCurveTo(mx, -238, mx + 24, -268); ctx.closePath(); ctx.fillStyle = '#5e1a24'; ctx.fill(); break;
      case 'smirk': ctx.moveTo(mx - 20, -262); ctx.quadraticCurveTo(mx + 6, -252, mx + 26, -274); break;
      case 's': ctx.ellipse(mx, -256, 11, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#5e1a24'; ctx.fill(); break;
      case 'sad': case 'worry': ctx.moveTo(mx - 18, -250); ctx.quadraticCurveTo(mx, -266, mx + 18, -250); break;
      case 'angry': ctx.moveTo(mx - 18, -256); ctx.lineTo(mx + 18, -261); break;
      default: ctx.moveTo(mx - 14, -262); ctx.quadraticCurveTo(mx, -256, mx + 14, -262);
    }
    ctx.strokeStyle = OL25; ctx.lineWidth = 5.5; ctx.stroke();
  }
  if (o.mustache) {
    ctx.beginPath(); ctx.moveTo(mx, -276);
    ctx.quadraticCurveTo(mx - 30, -286, mx - 40, -262); ctx.quadraticCurveTo(mx - 20, -270, mx, -268);
    ctx.quadraticCurveTo(mx + 20, -270, mx + 40, -262); ctx.quadraticCurveTo(mx + 30, -286, mx, -276);
    ctx.fillStyle = o.mustache; ctx.fill();
  }
  if (o.tear) {
    const ty = -300 + ((t * 30) % 40);
    ctx.beginPath(); ctx.moveTo(-27 + fx, ty - 14); ctx.quadraticCurveTo(-18 + fx, ty, -27 + fx, ty + 6); ctx.quadraticCurveTo(-36 + fx, ty, -27 + fx, ty - 14);
    ctx.fillStyle = 'rgba(150,210,255,.9)'; ctx.fill();
  }
  if (o.sweat) {
    const sy = -360 + ((t * 40) % 30);
    ctx.beginPath(); ctx.moveTo(86, sy - 22); ctx.quadraticCurveTo(100, sy, 86, sy + 6); ctx.quadraticCurveTo(72, sy, 86, sy - 22);
    ctx.fillStyle = '#9ad6ff'; ctx.fill(); ctx.strokeStyle = OL25; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore(); // head group
  if (o.propL) o.propL(hL[0], hL[1]);
  if (o.propR) o.propR(hR[0], hR[1]);
  ball(hL[0], hL[1], 16, o.skin, 4);
  ball(hR[0], hR[1], 16, o.skin, 4);
  ctx.restore();
}

/* ---------- player ---------- */
function startPlayer() {
const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
if (RENDER) document.body.classList.add('render');
window.renderAt = t => frame(t);
window.DURATION = DUR;
window.COVER_T = typeof COVER_T === 'undefined' ? 7.6 : COVER_T;
document.getElementById('seek').max = DUR;
window.SUBS = SUBS;

let cur = parseFloat(params.get('t') || '0') || 0, playing = false, last = 0;
const btn = document.getElementById('play'), seek = document.getElementById('seek'), tm = document.getElementById('time');
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function show() { frame(cur); seek.value = cur; tm.textContent = `${mmss(cur)} / ${mmss(DUR)}`; }
function loop(ts) {
  if (!playing) return;
  if (last) cur += (ts - last) / 1000;
  last = ts;
  if (cur >= DUR) { cur = DUR - .01; playing = false; btn.textContent = '▶ Play'; }
  show();
  if (playing) requestAnimationFrame(loop);
}
function toggle() {
  playing = !playing; btn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  if (playing) { if (cur >= DUR - .05) cur = 0; last = 0; requestAnimationFrame(loop); }
}
btn.onclick = toggle; cv.onclick = toggle;
seek.oninput = () => { cur = +seek.value; show(); };
document.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
document.fonts.load(`800 40px Rubik`).finally(() => { window.READY = true; if (!RENDER) show(); });
}