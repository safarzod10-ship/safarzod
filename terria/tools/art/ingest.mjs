/**
 * Take a folder of separate transparent building PNGs (one isometric tile per
 * file, plus manifest.json) and prepare them like tools/art/cut.mjs does for
 * sheets: trim, measure the ground diamond, cut the soil block off, normalise
 * to the map's 2:1 projection.
 *
 *   node tools/art/ingest.mjs <srcDir> <outDir> [--skip name,name]
 *
 * Names follow the game: market -> shop, monument -> statue,
 * construction_NxN -> site:N, trees -> tree:0..3.
 */
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [, , src, outDir, ...rest] = process.argv;
const skip = rest.includes('--skip') ? rest[rest.indexOf('--skip') + 1].split(',') : [];
// a set made in one go shares one projection: --aspect 0.5 forces it
const forceAspect = rest.includes('--aspect') ? Number(rest[rest.indexOf('--aspect') + 1]) : 0;
mkdirSync(outDir, { recursive: true });
const TARGET_ASPECT = 0.5;
const STRONG = 100; // alpha that counts as solid when telling pictures apart

const jobs = [];
const RENAME = { market: 'shop' };
for (const dir of readdirSync(src, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === 'extras') continue;
  const t = RENAME[dir.name] ?? dir.name;
  if (skip.includes(t)) continue;
  for (const f of readdirSync(join(src, dir.name))) {
    const m = /_(\d)\.png$/.exec(f);
    if (m) jobs.push({ name: `${t}:${m[1]}`, path: join(src, dir.name, f) });
  }
}
const extras = join(src, 'extras');
if (existsSync(extras)) {
  const map = {
    'park.png': 'park:1',
    'fountain.png': 'fountain:1',
    'monument.png': 'statue:1',
    'construction_2x2.png': 'site:2',
    'construction_3x3.png': 'site:3',
    'construction_4x4.png': 'site:4',
    // tree_deciduous.png in the set is cut in half, so it is not used
    'tree_flowering.png': 'tree:0',
    'tree_pine.png': 'tree:1',
    'tree_poplar.png': 'tree:2',
  };
  for (const [f, name] of Object.entries(map)) if (existsSync(join(extras, f)) && !skip.includes(name.split(':')[0])) jobs.push({ name, path: join(extras, f) });
}

async function load(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // drop leftovers of neighbouring pictures (the set was cut from one
  // catalogue): components that sit entirely in the outer 12 % of the canvas
  const seen = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (seen[p0] >= 0 || data[p0 * 4 + 3] <= STRONG) continue;
    const c = { n: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0, px: [] };
    const st = [p0];
    seen[p0] = comps.length;
    while (st.length) {
      const p = st.pop();
      const x = p % W;
      const y = (p - x) / W;
      c.n++;
      c.sx += x;
      c.sy += y;
      c.px.push(p);
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
        if (q >= 0 && seen[q] < 0 && data[q * 4 + 3] > STRONG) {
          seen[q] = comps.length;
          st.push(q);
        }
    }
    comps.push(c);
  }
  const big = comps.reduce((a, b) => (b.n > a.n ? b : a), comps[0]);
  const m = 0.12;
  const keepMask = new Uint8Array(W * H);
  for (const c of comps) {
    const cx = c.sx / c.n;
    const cy = c.sy / c.n;
    const disjoint = c.x1 < big.x0 + 2 || c.x0 > big.x1 - 2 || c.y1 < big.y0 + 2;
    const rim = cx < W * m || cx > W * (1 - m) || cy < H * m;
    const tiny = c.n < big.n * 0.002;
    // caption letters: small and near-white
    let bright = 0;
    for (const p of c.px) if (data[p * 4] > 215 && data[p * 4 + 1] > 215 && data[p * 4 + 2] > 215) bright++;
    const caption = c.n < big.n * 0.02 && bright > c.n * 0.5;
    if (c === big || !(disjoint || rim || tiny || caption)) for (const p of c.px) keepMask[p] = 1;
  }
  // soft edge pixels stay only next to kept solid pixels
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (keepMask[p] || data[p * 4 + 3] === 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && keepMask[yy * W + xx] === 1 && data[(yy * W + xx) * 4 + 3] > STRONG) near = true;
        }
      if (!near) data[p * 4 + 3] = 0;
    }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) data.copy(out, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1 + 1) * 4);
  return { out, w, h };
}

function spans(out, w, h) {
  const span = [];
  for (let y = 0; y < h; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++)
      if (out[(y * w + x) * 4 + 3] > 128) {
        if (l < 0) l = x;
        r = x;
      }
    span[y] = l < 0 ? null : [l, r];
  }
  return span;
}

/** First pass: geometry of the ground diamond. */
function measure(out, w, h) {
  const span = spans(out, w, h);
  let best = 0;
  for (let y = Math.floor(h * 0.35); y < h; y++) if (span[y] && span[y][1] - span[y][0] > best) best = span[y][1] - span[y][0];
  let yc = -1;
  for (let y = Math.floor(h * 0.35); y < h; y++)
    if (span[y] && span[y][1] - span[y][0] >= best * 0.985) {
      yc = y;
      break;
    }
  const [l, r] = span[yc];
  let yb = h - 1;
  while (yb > 0 && (!span[yb] || span[yb][1] - span[yb][0] < 3)) yb--;
  const xb = (span[yb][0] + span[yb][1]) / 2;
  const n = Math.max(8, Math.round((r - l) * 0.15));
  const ys = [];
  const xs = [];
  for (let y = yb - n; y < yb - 2; y++) if (span[y]) ys.push(y), xs.push(span[y][0]);
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < ys.length; i++) {
    num += (ys[i] - my) * (xs[i] - mx);
    den += (ys[i] - my) ** 2;
  }
  const measured = den / num;
  const aspect = forceAspect || (Math.abs(measured - 0.5) < Math.abs(measured - 0.5774) ? 0.5 : 0.5774);
  const half = (r - l) / 2;
  return { half, cx: xb, yb, yc, aspect, measured, soilRel: (yb - yc - half * aspect) / (2 * half) };
}

const items = [];
for (const j of jobs) {
  const img = await load(j.path);
  // the crane picture of this set carries part of a caption ("ки") in its corner
  if (j.name === 'site:4')
    for (let y = 0; y < img.h * 0.09; y++) for (let x = 0; x < img.w * 0.16; x++) img.out[(y * img.w + x) * 4 + 3] = 0;
  if (j.name.startsWith('tree:')) {
    items.push({ ...j, ...img, tree: true });
    continue;
  }
  items.push({ ...j, ...img, g: measure(img.out, img.w, img.h) });
}
// soil thickness relative to the tile width: use the median when a picture's
// own value is off (something sticks out at the bottom corner)
const rel = items.filter((i) => i.g).map((i) => i.g.soilRel).filter((v) => v > 0.005 && v < 0.15).sort((a, b) => a - b);
const med = rel.length ? rel[rel.length >> 1] : 0.04;

const report = [];
for (const it of items) {
  const file = it.name.replace(':', '_') + '.png';
  if (it.tree) {
    // trees: anchor at the bottom of the trunk, "dw" = crown width
    const span = spans(it.out, it.w, it.h);
    let best = 0;
    for (const s of span) if (s && s[1] - s[0] > best) best = s[1] - s[0];
    let yb = it.h - 1;
    while (yb > 0 && !span[yb]) yb--;
    await sharp(it.out, { raw: { width: it.w, height: it.h, channels: 4 } }).png().toFile(join(outDir, file));
    const ax = (span[yb][0] + span[yb][1]) / 2;
    report.push({ name: it.name, file, w: it.w, h: it.h, dw: best, ax, ay: yb - it.h * 0.03 });
    if (it.name === 'tree:1') {
      // a mirrored pine as the fourth variant
      await sharp(it.out, { raw: { width: it.w, height: it.h, channels: 4 } }).flop().png().toFile(join(outDir, 'tree_3.png'));
      report.push({ name: 'tree:3', file: 'tree_3.png', w: it.w, h: it.h, dw: best, ax: it.w - 1 - ax, ay: yb - it.h * 0.03 });
    }
    continue;
  }
  const g = it.g;
  const soilRel = g.soilRel > 0.005 && g.soilRel < 0.15 && Math.abs(g.soilRel - med) < 0.03 ? g.soilRel : med;
  const soil = soilRel * 2 * g.half;
  const yc = g.yb - soil - g.half * g.aspect;
  const out = it.out;
  for (let y = 0; y < it.h; y++)
    for (let x = 0; x < it.w; x++) {
      const limit = yc + (g.half - Math.abs(x - g.cx)) * g.aspect + 1;
      const o = (y * it.w + x) * 4 + 3;
      if (y > limit) out[o] = 0;
      else if (y > limit - 1) out[o] = Math.round(out[o] * (limit - y));
    }
  const hKeep = Math.min(it.h, Math.ceil(yc + g.half * g.aspect + 2));
  const sy = TARGET_ASPECT / g.aspect;
  const outH = Math.max(1, Math.round(hKeep * sy));
  await sharp(out, { raw: { width: it.w, height: it.h, channels: 4 } })
    .extract({ left: 0, top: 0, width: it.w, height: hKeep })
    .resize(it.w, outH, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toFile(join(outDir, file));
  report.push({ name: it.name, file, w: it.w, h: outH, dw: g.half * 2, ax: g.cx, ay: yc * sy, aspect: g.aspect, measured: +g.measured.toFixed(3), soil: +soil.toFixed(1) });
}
writeFileSync(join(outDir, 'cut.json'), JSON.stringify({ sprites: report }, null, 1));
for (const r of report) console.log(r.name.padEnd(12), `${r.w}x${r.h}`.padEnd(9), 'diamond', r.dw, 'aspect', r.aspect ?? '-', r.measured ?? '', 'soil', r.soil ?? '-');
