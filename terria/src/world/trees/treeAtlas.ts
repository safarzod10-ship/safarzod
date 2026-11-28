/**
 * Procedural tree sprites: a few canopy variants seen from almost straight
 * above with a hint of side view, plus one soft ground shadow. Painted once
 * into a single atlas so every tree in the world shares one texture.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { mulberry32 } from '../../core/rng.ts';
import { TREE_VARIANTS } from './treePlacement.ts';

export interface TreeAtlas {
  /** One sprite per variant: canopy with its soft ground shadow. */
  readonly canopies: Texture[];
  /** Canopy diameter in atlas pixels (to convert world size -> sprite scale). */
  readonly canopyPx: number;
  /** Anchor of the trunk base inside a canopy cell (0..1). */
  readonly anchorX: number;
  readonly anchorY: number;
  destroy(): void;
}

const CELL = 128;
const CANOPY_PX = 84;
/** Canopy centre inside a cell (the shadow needs room to the lower right). */
const CENTER_X = 0.42;
const CENTER_Y = 0.4;

interface Hue {
  dark: [number, number, number];
  mid: [number, number, number];
  light: [number, number, number];
}

const HUES: Hue[] = [
  { dark: [46, 104, 46], mid: [78, 148, 56], light: [158, 208, 96] },
  { dark: [48, 104, 46], mid: [86, 152, 58], light: [172, 214, 98] },
  { dark: [44, 102, 50], mid: [74, 146, 62], light: [150, 206, 104] },
  { dark: [58, 106, 42], mid: [104, 156, 56], light: [190, 216, 100] },
];

export function createTreeAtlas(seed: number): TreeAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * TREE_VARIANTS;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed ^ 0x3c6ef372);

  for (let v = 0; v < TREE_VARIANTS; v++) {
    paintShadow(ctx, v * CELL, 0);
    paintCanopy(ctx, v * CELL, 0, HUES[v % HUES.length], rnd, v);
  }

  const source = new CanvasSource({
    resource: canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
  });
  const canopies: Texture[] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    canopies.push(new Texture({ source, frame: new Rectangle(v * CELL + 1, 1, CELL - 2, CELL - 2) }));
  }
  return {
    canopies,
    canopyPx: CANOPY_PX,
    anchorX: CENTER_X + 0.02,
    anchorY: CENTER_Y + 0.2,
    destroy() {
      for (const t of canopies) t.destroy();
      source.destroy();
    },
  };
}

function rgb(c: [number, number, number], a = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function paintCanopy(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  hue: Hue,
  rnd: () => number,
  variant: number,
): void {
  const cx = ox + CELL * CENTER_X;
  const cy = oy + CELL * CENTER_Y;
  const R = CANOPY_PX / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();

  // Leaf clumps: a ring of blobs around the crown plus a few on top. Lower /
  // right blobs are drawn first and darker (light comes from the top-left).
  const blobs: { x: number; y: number; r: number; lift: number }[] = [];
  const ring = 8 + variant;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.5;
    const d = R * (0.5 + rnd() * 0.16);
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.94, r: R * (0.36 + rnd() * 0.14), lift: 0 });
  }
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * rnd() * 0.3;
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: R * (0.34 + rnd() * 0.14), lift: 1 });
  }
  // order: far from the light first
  blobs.sort((p, q) => q.lift * -1000 + (q.x + q.y) - (p.lift * -1000 + (p.x + p.y)));

  // dark silhouette underneath gives a soft outline
  ctx.fillStyle = rgb([Math.round(hue.dark[0] * 0.8), Math.round(hue.dark[1] * 0.82), Math.round(hue.dark[2] * 0.85)], 0.96);
  for (const b of blobs) {
    ctx.beginPath();
    ctx.arc(b.x + 1, b.y + 2, b.r + 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of blobs) {
    const lit = 1 - (b.x - cx + (b.y - cy)) / (R * 2.2); // ~0.3..1.7
    const k = Math.max(0, Math.min(1, lit * 0.5 + (b.lift ? 0.18 : 0)));
    const base: [number, number, number] = [
      hue.dark[0] + (hue.mid[0] - hue.dark[0]) * k,
      hue.dark[1] + (hue.mid[1] - hue.dark[1]) * k,
      hue.dark[2] + (hue.mid[2] - hue.dark[2]) * k,
    ];
    const g = ctx.createRadialGradient(b.x - b.r * 0.38, b.y - b.r * 0.42, b.r * 0.08, b.x, b.y, b.r);
    g.addColorStop(0, rgb(hue.light, 0.62 + 0.38 * k));
    g.addColorStop(0.5, rgb([Math.round(base[0]), Math.round(base[1]), Math.round(base[2])]));
    g.addColorStop(1, rgb(hue.dark, 0.9));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // leaf dabs
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = R * 0.82 * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const lightSide = x - cx + (y - cy) < 0;
    ctx.fillStyle = lightSide ? rgb(hue.light, 0.2 + rnd() * 0.25) : rgb(hue.dark, 0.14 + rnd() * 0.2);
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rnd() * 3.5, 1.4 + rnd() * 2.4, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintShadow(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  // soft ellipse on the ground, cast to the lower right of the crown
  const cx = ox + CELL * (CENTER_X + 0.17);
  const cy = oy + CELL * (CENTER_Y + 0.2);
  const rx = CANOPY_PX * 0.56;
  const ry = CANOPY_PX * 0.38;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
  g.addColorStop(0, 'rgba(22,48,34,0.46)');
  g.addColorStop(0.55, 'rgba(22,48,34,0.28)');
  g.addColorStop(1, 'rgba(22,48,34,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
