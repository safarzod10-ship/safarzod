/**
 * Blender renders -> sprites for the atlas packer.
 *
 *   node tools/blender/cut.mjs <renderDir=art/blender/render> <outDir=art/blender/out>
 *
 * For every `<type>_<level>.png` with its `<type>_<level>.json` (written by
 * the Blender scripts: lot anchor, lot diamond width, named points) the
 * picture is cropped to its visible pixels and listed in cut.json in the
 * format tools/art/pack.mjs reads: { sprites: [{ name: "townhall:1", file,
 * w, h, dw, ax, ay, points }] }. Nothing is cut out or repainted: the render
 * already has a transparent background.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const src = resolve(ROOT, process.argv[2] ?? 'art/blender/render');
const out = resolve(ROOT, process.argv[3] ?? 'art/blender/out');
const PAD = 2;
/** Faint alpha below this (sky occlusion caught far from the building) is dropped. */
const MIN_ALPHA = 10;
mkdirSync(out, { recursive: true });

const sprites = [];
for (const f of readdirSync(src).filter((n) => /^[a-z]+_\d+\.png$/.test(n)).sort()) {
  const base = f.slice(0, -4);
  const meta = JSON.parse(readFileSync(join(src, base + '.json'), 'utf8'));
  const { data, info } = await sharp(join(src, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // drop the faint veil of caught sky shadow, keep the real shadow soft
  for (let k = 3; k < data.length; k += 4) {
    const a = data[k];
    data[k] = a <= MIN_ALPHA ? 0 : Math.round(((a - MIN_ALPHA) * 255) / (255 - MIN_ALPHA));
  }
  const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  let x0 = info.width;
  let y0 = info.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  x0 = Math.max(0, x0 - PAD);
  y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(info.width - 1, x1 + PAD);
  y1 = Math.min(info.height - 1, y1 + PAD);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const file = base + '.png';
  await img.extract({ left: x0, top: y0, width: w, height: h }).png().toFile(join(out, file));
  const [type, level] = base.split('_');
  const points = {};
  for (const [k, [px, py]] of Object.entries(meta.points ?? {})) points[k] = [+(px - x0).toFixed(1), +(py - y0).toFixed(1)];
  sprites.push({ name: `${type}:${Number(level)}`, file, w, h, dw: +meta.dw.toFixed(1), ax: +(meta.ax - x0).toFixed(1), ay: +(meta.ay - y0).toFixed(1), points });
  console.log(`${type}:${Number(level)}  ${w}x${h}  lot ${meta.dw.toFixed(0)} px wide`);
}
writeFileSync(join(out, 'cut.json'), JSON.stringify({ sprites }, null, 1));
