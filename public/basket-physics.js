export const WORLD = Object.freeze({
  W: 10,
  MIN_H: 10.5,
  G: 15,
  DT: 1 / 120,
  MAX_T: 4,
  BALL_R: 0.24,
  RIM_HALF: 0.5,
  RIM_R: 0.05,
  BOARD_HALF: 0.8,
  BOARD_TOP: 1.3,
  START: Object.freeze({ x: 1.55, y: 2.6 }),
  VMIN: 5,
  VMAX: 15.5,
  E_RIM: 0.55,
  E_FLOOR: 0.55,
});

export const HOOP_BOUNDS = Object.freeze({ xMin: 4.5, xMax: 8.6, yMin: 3.4, yMax: 7.2 });

export function hoopRange(level) {
  const k = Math.min(1, Math.max(0, level) / 12);
  return {
    xMin: 4.5 + k * 2.6,
    xMax: 5.9 + k * 2.7,
    yMin: 3.8 - k * 0.4,
    yMax: 5.2 + k * 2.0,
  };
}

export const QUANT = 1000;

export function validLaunch(vx, vy) {
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || vx <= 0 || vy <= 0) return false;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < WORLD.VMIN - 1e-9 || speed > WORLD.VMAX + 1e-9) return false;
  return vy >= 0.14 * vx && vy <= 9.5 * vx;
}

function collidePoint(b, px, py, minDist, e) {
  const dx = b.x - px;
  const dy = b.y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minDist * minDist || d2 === 0) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  b.x = px + nx * minDist;
  b.y = py + ny * minDist;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    b.vx *= 0.94;
    b.vy *= 0.94;
  }
  return true;
}

export function simulateShot(hoop, vx, vy, { frames = false } = {}) {
  const W = WORLD;
  const b = { x: W.START.x, y: W.START.y, vx, vy };
  const front = hoop.x - W.RIM_HALF;
  const back = hoop.x + W.RIM_HALF;
  const hitDist = W.BALL_R + W.RIM_R;
  const out = frames ? [b.x, b.y] : null;
  const contacts = [];
  let made = false;
  let madeT = 0;
  let quality = 0;
  let settleT = W.MAX_T;
  const steps = Math.round(W.MAX_T / W.DT);

  for (let i = 1; i <= steps; i++) {
    const t = i * W.DT;
    const prevY = b.y;
    b.vy -= W.G * W.DT;
    b.x += b.vx * W.DT;
    b.y += b.vy * W.DT;

    if (collidePoint(b, front, hoop.y, hitDist, W.E_RIM)) contacts.push(['rim', t]);
    if (collidePoint(b, back, hoop.y, hitDist, W.E_RIM)) contacts.push(['rim', t]);

    if (!made && prevY > hoop.y && b.y <= hoop.y && b.vy < 0) {
      const off = b.x - hoop.x;
      const abs = off < 0 ? -off : off;
      if (abs < W.RIM_HALF - W.RIM_R) {
        made = true;
        madeT = t;
        quality = 1 - abs / (W.RIM_HALF - W.RIM_R);
        b.vx *= 0.35;
        b.vy *= 0.6;
        settleT = Math.min(W.MAX_T, t + 0.55);
      }
    }

    let floor = false;
    if (b.y - W.BALL_R < 0) {
      b.y = W.BALL_R;
      if (b.vy < -0.8) contacts.push(['floor', t]);
      if (b.vy < 0) b.vy = -b.vy * W.E_FLOOR;
      b.vx *= 0.8;
      floor = true;
    }
    if (out) out.push(b.x, b.y);
    if (!made && settleT === W.MAX_T && (floor || b.x > W.W + 1.5 || b.x < -1.5)) settleT = Math.min(W.MAX_T, t + 0.3);
    if (t >= settleT) break;
  }
  return { made, madeT, settleT, quality, contacts, frames: out };
}

export function previewPath(vx, vy, previewT = 0.75, step = 0.05) {
  const pts = [];
  for (let t = step; t <= previewT + 1e-9; t += step) {
    const x = WORLD.START.x + vx * t;
    const y = WORLD.START.y + vy * t - 0.5 * WORLD.G * t * t;
    if (y < 0) break;
    pts.push([x, y]);
  }
  return pts;
}

export function isReachable(hoop) {
  for (let speed = WORLD.VMIN; speed <= WORLD.VMAX; speed += 0.25) {
    for (let k = 0; k <= 30; k++) {
      const s = 0.2 + k * 0.17;
      const n = Math.sqrt(1 + s * s);
      const vx = speed / n;
      const vy = (speed * s) / n;
      if (validLaunch(vx, vy) && simulateShot(hoop, vx, vy).made) return true;
    }
  }
  return false;
}

export function nextHoop(prev, rnd, level = 0) {
  const R = prev ? hoopRange(level) : { xMin: 4.6, xMax: 5.4, yMin: 4.2, yMax: 4.9 };
  for (let tries = 0; tries < 60; tries++) {
    const h = {
      x: Math.round((R.xMin + rnd() * (R.xMax - R.xMin)) * 100) / 100,
      y: Math.round((R.yMin + rnd() * (R.yMax - R.yMin)) * 100) / 100,
    };
    if (prev) {
      const dx = h.x - prev.x;
      const dy = h.y - prev.y;
      if (dx * dx + dy * dy < 1.1 * 1.1) continue;
    }
    if (isReachable(h)) return h;
  }
  return { x: (R.xMin + R.xMax) / 2, y: (R.yMin + R.yMax) / 2 };
}
