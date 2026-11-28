/**
 * Pack prepared building art into the game's sprite atlas.
 *
 *   node tools/art/pack.mjs <outDir=public/models> <artDir> [artDir...]
 *
 * Each artDir has cut.json from tools/art/cut.mjs or tools/art/ingest.mjs:
 *   { sprites: [{ name: "house:1", file, w, h, dw, ax, ay }] }
 * Later dirs win when two have the same name. Pictures are scaled down so a
 * lot cell is ART_PX_PER_CELL pixels wide (max zoom 3.2 css px/m on a 2x phone needs ~145).
 *
 * Output: atlas-<n>.webp + atlas.json { pages, sprites: { name: { p, x, y, w, h, ax, ay, dw, pt? } } }
 * (ax, ay) = lot centre in the sprite, dw = lot diamond width (trees: crown width),
 * pt = named points for effects (chimney tops, flag), in sprite pixels.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { BUILDINGS } from '../../src/game/config.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const [, , outArg, ...dirs] = process.argv;
const outDir = resolve(ROOT, outArg ?? 'public/models');
const ART_PX_PER_CELL = 150;
const TREE_CROWN_PX = 90;
const PAGE = 2048;
/** Small pictures are enlarged up to 2x with lanczos (sharper than the GPU's bilinear zoom). */
const MAX_UPSCALE = 2;

const byName = new Map();
for (const d of dirs) {
  const dir = resolve(ROOT, d);
  const cut = JSON.parse(readFileSync(join(dir, 'cut.json'), 'utf8'));
  for (const s of cut.sprites) byName.set(s.name, { ...s, path: join(dir, s.file) });
}

const sprites = [];
for (const [name, a] of byName) {
  const [t, arg] = name.split(':');
  const isTree = t === 'tree';
  const cells = t === 'site' ? Number(arg) : (BUILDINGS[t]?.size ?? 1);
  const k = Math.min(MAX_UPSCALE, isTree ? TREE_CROWN_PX / a.dw : (cells * ART_PX_PER_CELL) / a.dw);
  const w = Math.max(1, Math.round(a.w * k));
  const h = Math.max(1, Math.round(a.h * k));
  const png = await sharp(a.path).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const pt = a.points ? Object.fromEntries(Object.entries(a.points).map(([n, [x, y]]) => [n, [+(x * k).toFixed(1), +(y * k).toFixed(1)]])) : undefined;
  sprites.push({ name, png, w, h, ax: a.ax * k, ay: a.ay * k, dw: a.dw * k, tree: isTree, pt });
}

// trees share one frame size and anchor (the map draws them as particles)
const trees = sprites.filter((s) => s.tree);
if (trees.length) {
  const L = Math.ceil(Math.max(...trees.map((t) => t.ax)));
  const R = Math.ceil(Math.max(...trees.map((t) => t.w - t.ax)));
  const U = Math.ceil(Math.max(...trees.map((t) => t.ay)));
  const D = Math.ceil(Math.max(...trees.map((t) => t.h - t.ay)));
  for (const t of trees) {
    const left = Math.round(L - t.ax);
    const top = Math.round(U - t.ay);
    t.png = await sharp(t.png)
      .extend({ left, top, right: Math.max(0, L + R - t.w - left), bottom: Math.max(0, U + D - t.h - top), background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    t.w = L + R;
    t.h = U + D;
    t.ax = L;
    t.ay = U;
  }
}

// shelf packing; trees first so they all land on page 0 (one particle texture)
const order = [...trees, ...sprites.filter((s) => !s.tree).sort((a, b) => b.h - a.h)];
const pages = [[]];
let x = 0;
let y = 0;
let rowH = 0;
const placed = {};
for (const s of order) {
  if (x + s.w > PAGE) {
    x = 0;
    y += rowH + 2;
    rowH = 0;
  }
  if (y + s.h > PAGE) {
    pages.push([]);
    x = 0;
    y = 0;
    rowH = 0;
  }
  pages[pages.length - 1].push({ input: s.png, left: x, top: y });
  placed[s.name] = { p: pages.length - 1, x, y, w: s.w, h: s.h, ax: +s.ax.toFixed(1), ay: +s.ay.toFixed(1), dw: +s.dw.toFixed(1), ...(s.pt ? { pt: s.pt } : {}) };
  x += s.w + 2;
  rowH = Math.max(rowH, s.h);
}
mkdirSync(outDir, { recursive: true });
const files = [];
for (let i = 0; i < pages.length; i++) {
  const last = i === pages.length - 1;
  const height = last ? Math.min(PAGE, 2 ** Math.ceil(Math.log2(y + rowH + 2))) : PAGE;
  const file = `atlas-${i}.webp`;
  await sharp({ create: { width: PAGE, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(pages[i])
    .webp({ quality: 90, alphaQuality: 95, effort: 6 })
    .toFile(join(outDir, file));
  files.push(file);
}
writeFileSync(join(outDir, 'atlas.json'), JSON.stringify({ pages: files, sprites: placed }));
console.log(`atlas: ${sprites.length} sprites on ${files.length} page(s) -> ${outDir}`);
