/**
 * Everything small the splash draws besides the illustration and the logo is
 * painted here once, on one 512 x 512 canvas: clouds, the first houses of the
 * new world, a field, dust, sparks. One texture source means the sprites batch
 * into a single draw call, and the splash downloads nothing for them.
 *
 * Buildings use a front oblique view (straight on, seen from above) with the
 * light from the left, like the trees of the illustration.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';

const ATLAS = 512;

export interface SpriteSet {
  source: CanvasSource;
  clouds: Texture[];
  houses: Texture[];
  hall: Texture;
  fields: Texture[];
  glow: Texture;
  dust: Texture;
  dot: Texture;
  sparkle: Texture;
  /** Point of a building cell that stands on the ground, as a share of the cell. */
  houseAnchor: { x: number; y: number };
  hallAnchor: { x: number; y: number };
  destroy(): void;
}

type Ctx = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------
function paintCloud(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const rand = rng(seed);
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const c = layer.getContext('2d')!;
  const cx = w / 2;
  const cy = h * 0.52;
  // body: many overlapping soft puffs; small ones towards the rim give a lobed, wispy outline
  const puffs = 46;
  for (let i = 0; i < puffs; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.pow(rand(), 0.7);
    const px = cx + Math.cos(a) * d * w * 0.33;
    const py = cy + Math.sin(a) * d * h * 0.21;
    const r = h * (0.09 + 0.2 * (1 - d) * (0.6 + 0.4 * rand()) + 0.04 * rand());
    const g = c.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, r, 0, Math.PI * 2);
    c.fill();
  }
  // volume: cool shade towards the lower right, kept inside the cloud
  c.globalCompositeOperation = 'source-atop';
  const shade = c.createLinearGradient(w * 0.25, h * 0.2, w * 0.75, h * 0.95);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(126,160,196,0.5)');
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
  // sunlit crowns
  for (let i = 0; i < 7; i++) {
    const px = cx + (rand() - 0.62) * w * 0.42;
    const py = cy + (rand() - 0.75) * h * 0.3;
    const r = h * (0.1 + 0.08 * rand());
    const g = c.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(px, py, r, 0, Math.PI * 2);
    c.fill();
  }
  ctx.drawImage(layer, x, y);
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
/** Front oblique projection: depth (y, towards the viewer) is squashed, height lifts straight up. */
const DEPTH = 0.56;
const LIFT = 0.86;

interface RoofColors {
  lit: string;
  front: string;
  shade: string;
  line: string;
}

const ROOFS: readonly RoofColors[] = [
  { lit: '#f6a56c', front: '#de6d40', shade: '#ad472b', line: '#74301d' }, // terracotta
  { lit: '#8eb4e0', front: '#5f88be', shade: '#3f6093', line: '#294066' }, // slate blue
  { lit: '#f7da86', front: '#dfb651', shade: '#b48a37', line: '#775721' }, // straw
  { lit: '#f08f7c', front: '#cf5a55', shade: '#9c3c41', line: '#682530' }, // red tile
];
const WALL = { lit: '#fdf3db', front: '#efdcb4', low: '#cdb388', line: '#8c6f48' };

function poly(c: Ctx, pts: number[], fill: string, stroke?: string): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.stroke();
  }
}

function groundShadow(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  c.save();
  c.translate(cx, cy);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
  g.addColorStop(0, 'rgba(16,52,30,0.5)');
  g.addColorStop(0.7, 'rgba(16,52,30,0.22)');
  g.addColorStop(1, 'rgba(16,52,30,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

interface HouseSpec {
  width: number;
  depth: number;
  wall: number;
  roof: number;
  colors: RoofColors;
  chimney: boolean;
  door: number;
}

/** A hip-roofed house standing on (gx, gy). */
function paintHouse(c: Ctx, gx: number, gy: number, s: HouseSpec): void {
  const hw = s.width / 2;
  const hd = s.depth / 2;
  const o = 3; // eaves overhang
  const inset = Math.min(hw - 4, hd + 2);
  const P = (x: number, y: number, z: number): [number, number] => [gx + x, gy + y * DEPTH - z * LIFT];

  groundShadow(c, gx + hw * 0.55, gy + hd * DEPTH * 0.55, hw * 1.35, hd * 0.95);

  c.lineJoin = 'round';
  c.lineWidth = 1;
  // front wall
  const [wx0, wyTop] = P(-hw, hd, s.wall);
  const [wx1, wyBase] = P(hw, hd, 0);
  const wall = c.createLinearGradient(wx0, wyTop, wx1, wyBase);
  wall.addColorStop(0, WALL.lit);
  wall.addColorStop(0.55, WALL.front);
  wall.addColorStop(1, WALL.low);
  c.fillStyle = wall;
  c.fillRect(wx0, wyTop, wx1 - wx0, wyBase - wyTop);
  c.strokeStyle = WALL.line;
  c.strokeRect(wx0 + 0.5, wyTop + 0.5, wx1 - wx0 - 1, wyBase - wyTop - 1);
  // shade under the eaves
  const eave = c.createLinearGradient(0, wyTop, 0, wyTop + 7);
  eave.addColorStop(0, 'rgba(70,45,20,0.45)');
  eave.addColorStop(1, 'rgba(70,45,20,0)');
  c.fillStyle = eave;
  c.fillRect(wx0, wyTop, wx1 - wx0, 7);
  // door and windows
  const baseY = wyBase - 1;
  const dx = gx + s.door * hw;
  c.fillStyle = '#6d4426';
  c.fillRect(dx - 3.5, baseY - 10, 7, 10);
  c.fillStyle = '#93623a';
  c.fillRect(dx - 2.5, baseY - 9, 2, 8);
  for (const wxp of [-0.62, 0.62]) {
    if (Math.abs(wxp - s.door) < 0.4) continue;
    const x = gx + wxp * hw;
    c.fillStyle = '#5a3b20';
    c.fillRect(x - 4, baseY - 12, 8, 7.5);
    c.fillStyle = '#ffe68f';
    c.fillRect(x - 3, baseY - 11, 6, 5.5);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(x - 3, baseY - 11, 2.5, 2.5);
  }

  // roof: left hip (lit), right hip (shade), front slope
  const z0 = s.wall;
  const z1 = s.wall + s.roof;
  const FL = P(-hw - o, hd + o, z0);
  const FR = P(hw + o, hd + o, z0);
  const BL = P(-hw - o, -hd - o, z0);
  const BR = P(hw + o, -hd - o, z0);
  const RL = P(-hw + inset, 0, z1);
  const RR = P(hw - inset, 0, z1);
  poly(c, [...BL, ...BR, ...RR, ...RL], s.colors.shade, s.colors.line);
  poly(c, [...BL, ...FL, ...RL], s.colors.lit, s.colors.line);
  poly(c, [...BR, ...FR, ...RR], s.colors.shade, s.colors.line);
  const front = c.createLinearGradient(0, RL[1], 0, FL[1]);
  front.addColorStop(0, s.colors.lit);
  front.addColorStop(0.35, s.colors.front);
  front.addColorStop(1, s.colors.front);
  poly(c, [...FL, ...FR, ...RR, ...RL], front as unknown as string, s.colors.line);
  // tile courses on the front slope
  c.strokeStyle = 'rgba(60,25,12,0.22)';
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    c.beginPath();
    c.moveTo(RL[0] + (FL[0] - RL[0]) * t, RL[1] + (FL[1] - RL[1]) * t);
    c.lineTo(RR[0] + (FR[0] - RR[0]) * t, RR[1] + (FR[1] - RR[1]) * t);
    c.stroke();
  }
  // ridge catches the light
  c.strokeStyle = 'rgba(255,248,225,0.85)';
  c.beginPath();
  c.moveTo(RL[0], RL[1] + 0.5);
  c.lineTo(RR[0], RR[1] + 0.5);
  c.stroke();

  if (s.chimney) {
    const [kx, ky] = P(hw * 0.38, hd * 0.35, z0 + s.roof * 0.62);
    c.fillStyle = '#b9a38a';
    c.fillRect(kx - 3, ky - 9, 6, 9);
    c.fillStyle = '#8d775f';
    c.fillRect(kx, ky - 9, 3, 9);
    c.fillStyle = '#5f4a36';
    c.fillRect(kx - 3.5, ky - 10.5, 7, 2.5);
  }
}

/** The first public building: a long hall with a small tower and a pennant. */
function paintHall(c: Ctx, gx: number, gy: number): void {
  paintHouse(c, gx, gy, { width: 70, depth: 40, wall: 22, roof: 19, colors: ROOFS[1], chimney: false, door: 0 });
  const P = (x: number, y: number, z: number): [number, number] => [gx + x, gy + y * DEPTH - z * LIFT];
  const t = 9; // half width of the tower
  const top = 58;
  // tower body in front of the ridge
  const [ax, ay] = P(-t, 6, top);
  const [bx, by] = P(t, 6, 30);
  const body = c.createLinearGradient(ax, 0, bx, 0);
  body.addColorStop(0, WALL.lit);
  body.addColorStop(1, WALL.low);
  c.fillStyle = body;
  c.fillRect(ax, ay, bx - ax, by - ay);
  c.strokeStyle = WALL.line;
  c.lineWidth = 1;
  c.strokeRect(ax + 0.5, ay + 0.5, bx - ax - 1, by - ay - 1);
  c.fillStyle = '#5a3b20';
  c.fillRect(gx - 3, ay + 8, 6, 8);
  c.fillStyle = '#ffe68f';
  c.fillRect(gx - 2, ay + 9, 4, 6);
  // pointed roof
  const apex = P(0, 6, top + 22);
  const L = P(-t - 3, 6, top);
  const R = P(t + 3, 6, top);
  poly(c, [...L, ...apex, gx, L[1]], ROOFS[0].lit, ROOFS[0].line);
  poly(c, [gx, R[1], ...apex, ...R], ROOFS[0].shade, ROOFS[0].line);
  // pennant
  c.strokeStyle = '#6b4a2a';
  c.beginPath();
  c.moveTo(apex[0], apex[1]);
  c.lineTo(apex[0], apex[1] - 13);
  c.stroke();
  poly(c, [apex[0], apex[1] - 13, apex[0] + 11, apex[1] - 9.5, apex[0], apex[1] - 6], '#f2c14e', '#a9781f');
}

function paintField(c: Ctx, x: number, y: number, w: number, h: number, wheat: boolean): void {
  const pad = 6;
  const fx = x + pad;
  const fy = y + pad;
  const fw = w - pad * 2;
  const fh = h - pad * 2;
  c.save();
  c.beginPath();
  c.roundRect(fx, fy, fw, fh, 7);
  c.clip();
  c.fillStyle = wheat ? '#d9bb52' : '#7cb53a';
  c.fillRect(fx, fy, fw, fh);
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    c.fillStyle = wheat ? (i % 2 ? '#f0d877' : '#c9a63f') : i % 2 ? '#a5d552' : '#5f9c2e';
    c.fillRect(fx, fy + (i * fh) / rows, fw, fh / rows / 2);
  }
  // light from the left
  const g = c.createLinearGradient(fx, 0, fx + fw, 0);
  g.addColorStop(0, 'rgba(255,255,220,0.25)');
  g.addColorStop(1, 'rgba(20,60,20,0.18)');
  c.fillStyle = g;
  c.fillRect(fx, fy, fw, fh);
  c.restore();
  c.strokeStyle = 'rgba(92,70,34,0.7)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.roundRect(fx, fy, fw, fh, 7);
  c.stroke();
}

// ---------------------------------------------------------------------------
// Light and dust
// ---------------------------------------------------------------------------
function radial(c: Ctx, cx: number, cy: number, r: number, stops: [number, string][]): void {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
}

function paintDust(c: Ctx, x: number, y: number, size: number): void {
  const rand = rng(77);
  for (let i = 0; i < 7; i++) {
    const px = x + size * (0.25 + 0.5 * rand());
    const py = y + size * (0.4 + 0.3 * rand());
    radial(c, px, py, size * (0.16 + 0.12 * rand()), [
      [0, 'rgba(255,244,214,0.75)'],
      [1, 'rgba(255,244,214,0)'],
    ]);
  }
}

function paintSparkle(c: Ctx, x: number, y: number, size: number): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  radial(c, cx, cy, size * 0.3, [
    [0, 'rgba(255,255,255,0.95)'],
    [0.4, 'rgba(255,255,255,0.35)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  c.save();
  c.translate(cx, cy);
  for (let i = 0; i < 2; i++) {
    c.rotate(Math.PI / 2);
    const g = c.createLinearGradient(-size * 0.46, 0, size * 0.46, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, size * 0.46, size * 0.045, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------------------
// Atlas
// ---------------------------------------------------------------------------
const CELL = {
  cloud: [
    [0, 0, 256, 160],
    [256, 0, 256, 160],
  ],
  house: [
    [0, 160, 96, 96],
    [96, 160, 96, 96],
    [192, 160, 96, 96],
    [288, 160, 96, 96],
  ],
  hall: [384, 160, 128, 128],
  field: [
    [0, 256, 112, 64],
    [112, 256, 112, 64],
  ],
  glow: [224, 256, 128, 128],
  dust: [0, 320, 64, 64],
  dot: [64, 320, 32, 32],
  sparkle: [96, 320, 48, 48],
} as const;

export function createSpriteSet(): SpriteSet {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const c = canvas.getContext('2d')!;

  paintCloud(c, CELL.cloud[0][0], CELL.cloud[0][1], 256, 160, 11);
  paintCloud(c, CELL.cloud[1][0], CELL.cloud[1][1], 256, 160, 29);

  const houseAnchor = { x: 0.5, y: 0.74 };
  const specs: HouseSpec[] = [
    { width: 46, depth: 30, wall: 17, roof: 15, colors: ROOFS[0], chimney: true, door: -0.1 },
    { width: 40, depth: 28, wall: 16, roof: 14, colors: ROOFS[2], chimney: false, door: 0.2 },
    { width: 50, depth: 30, wall: 17, roof: 15, colors: ROOFS[3], chimney: true, door: 0 },
    { width: 42, depth: 28, wall: 16, roof: 15, colors: ROOFS[1], chimney: false, door: -0.25 },
  ];
  specs.forEach((spec, i) => {
    const [x, y, w, h] = CELL.house[i];
    paintHouse(c, x + w * houseAnchor.x, y + h * houseAnchor.y, spec);
  });
  const hallAnchor = { x: 0.5, y: 0.8 };
  paintHall(c, CELL.hall[0] + CELL.hall[2] * hallAnchor.x, CELL.hall[1] + CELL.hall[3] * hallAnchor.y);

  paintField(c, CELL.field[0][0], CELL.field[0][1], 112, 64, false);
  paintField(c, CELL.field[1][0], CELL.field[1][1], 112, 64, true);

  const [gx, gy, gs] = CELL.glow;
  radial(c, gx + gs / 2, gy + gs / 2, gs / 2 - 2, [
    [0, 'rgba(255,255,255,0.9)'],
    [0.35, 'rgba(255,255,255,0.38)'],
    [0.7, 'rgba(255,255,255,0.1)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  paintDust(c, CELL.dust[0], CELL.dust[1], 64);
  const [dx, dy, ds] = CELL.dot;
  radial(c, dx + ds / 2, dy + ds / 2, ds / 2 - 1, [
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,255,255,0.6)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  paintSparkle(c, CELL.sparkle[0], CELL.sparkle[1], 48);

  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    label: 'splash-sprites',
  });
  source.autoGarbageCollect = false;
  const tex = (r: readonly number[]): Texture => new Texture({ source, frame: new Rectangle(r[0], r[1], r[2], r[3]) });
  const set: SpriteSet = {
    source,
    clouds: CELL.cloud.map(tex),
    houses: CELL.house.map(tex),
    hall: tex(CELL.hall),
    fields: CELL.field.map(tex),
    glow: tex(CELL.glow),
    dust: tex(CELL.dust),
    dot: tex(CELL.dot),
    sparkle: tex(CELL.sparkle),
    houseAnchor,
    hallAnchor,
    destroy() {
      for (const t of [...set.clouds, ...set.houses, set.hall, ...set.fields, set.glow, set.dust, set.dot, set.sparkle]) {
        t.destroy(false);
      }
      source.destroy();
      canvas.width = canvas.height = 0;
    },
  };
  return set;
}
