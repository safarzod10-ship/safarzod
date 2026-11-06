// Basketball Rush — физика броска. Один и тот же код работает в браузере (анимация, предпросмотр)
// и на сервере (проверка каждого броска). Симуляция детерминирована: фиксированный шаг и только
// операции + − × ÷ и √ (они дают одинаковый результат на любом устройстве), без sin/cos/pow.
//
// Мир — вид сбоку, единицы ≈ метры, ось Y вверх, пол на y = 0.

export const WORLD = Object.freeze({
  W: 10, // ширина поля
  MIN_H: 10.5, // минимальная видимая высота
  G: 15, // гравитация
  DT: 1 / 120, // шаг симуляции
  MAX_T: 4, // предел полёта
  BALL_R: 0.24,
  RIM_HALF: 0.5, // половина ширины кольца (от центра до дужки)
  RIM_R: 0.05, // толщина дужки
  BOARD_X: 0.66, // щит правее центра кольца
  BOARD_BOTTOM: -0.3, // щит относительно высоты кольца
  BOARD_TOP: 1.5,
  START: Object.freeze({ x: 1.55, y: 2.6 }), // мяч в руках игрока
  VMIN: 5, // скорость броска
  VMAX: 15.5,
  E_RIM: 0.55, // упругость дужки
  E_BOARD: 0.7,
  E_FLOOR: 0.55,
});

/** Допустимая область центра кольца — всегда в кадре и всегда достижима. */
export const HOOP_BOUNDS = Object.freeze({ xMin: 5.2, xMax: 8.6, yMin: 3.2, yMax: 7.2 });

/** Скорость броска приходит целыми тысячными — одинаковые числа на клиенте и сервере. */
export const QUANT = 1000;

/** Допустим ли бросок: скорость в пределах, направление вправо-вверх (≈ 8°…84°). */
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
  b.x = px + nx * minDist; // выталкиваем из препятствия
  b.y = py + ny * minDist;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    b.vx *= 0.94; // небольшое трение при касании
    b.vy *= 0.94;
  }
  return true;
}

/**
 * Полёт мяча. hoop — центр кольца {x, y}; vx, vy — скорость броска.
 * Возвращает: made (попал ли), madeT (когда), settleT (когда мяч «отыграл» — можно брать новый),
 * quality (0…1, насколько близко к центру кольца — для правила ничьих), contacts, frames (по запросу).
 */
export function simulateShot(hoop, vx, vy, { frames = false } = {}) {
  const W = WORLD;
  const b = { x: W.START.x, y: W.START.y, vx, vy };
  const front = hoop.x - W.RIM_HALF;
  const back = hoop.x + W.RIM_HALF;
  const boardX = hoop.x + W.BOARD_X;
  const boardY0 = hoop.y + W.BOARD_BOTTOM;
  const boardY1 = hoop.y + W.BOARD_TOP;
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
    const cy = b.y < boardY0 ? boardY0 : b.y > boardY1 ? boardY1 : b.y;
    if (collidePoint(b, boardX, cy, W.BALL_R, W.E_BOARD)) contacts.push(['board', t]);

    // Попадание: центр мяча сверху вниз пересёк линию кольца между дужками
    if (!made && prevY > hoop.y && b.y <= hoop.y && b.vy < 0) {
      const off = b.x - hoop.x;
      const abs = off < 0 ? -off : off;
      if (abs < W.RIM_HALF - W.RIM_R) {
        made = true;
        madeT = t;
        quality = 1 - abs / (W.RIM_HALF - W.RIM_R);
        b.vx *= 0.35; // сетка гасит скорость
        b.vy *= 0.6;
        settleT = Math.min(W.MAX_T, t + 0.55);
      }
    }

    let floor = false;
    if (b.y - W.BALL_R < 0) {
      b.y = W.BALL_R;
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

/** Точки пунктира: полёт без столкновений (только гравитация), на время previewT. */
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

/** Есть ли хоть один допустимый бросок, который попадает в кольцо. */
export function isReachable(hoop) {
  for (let speed = WORLD.VMIN; speed <= WORLD.VMAX; speed += 0.25) {
    for (let k = 0; k <= 30; k++) {
      // направление без тригонометрии: вектор (1, s), нормированный корнем
      const s = 0.2 + k * 0.17;
      const n = Math.sqrt(1 + s * s);
      const vx = speed / n;
      const vy = (speed * s) / n;
      if (validLaunch(vx, vy) && simulateShot(hoop, vx, vy).made) return true;
    }
  }
  return false;
}

/**
 * Следующее положение кольца: случайно (ближе/дальше/выше/ниже), в границах, достижимо,
 * заметно отличается от предыдущего. rnd — генератор [0, 1) (на сервере — криптографический).
 */
export function nextHoop(prev, rnd) {
  const B = HOOP_BOUNDS;
  for (let tries = 0; tries < 60; tries++) {
    const h = {
      x: Math.round((B.xMin + rnd() * (B.xMax - B.xMin)) * 100) / 100,
      y: Math.round((B.yMin + rnd() * (B.yMax - B.yMin)) * 100) / 100,
    };
    if (prev) {
      const dx = h.x - prev.x;
      const dy = h.y - prev.y;
      if (dx * dx + dy * dy < 1.1 * 1.1) continue;
    }
    if (isReachable(h)) return h;
  }
  return { x: 6.8, y: 4.6 }; // запасная позиция (достижима всегда)
}
