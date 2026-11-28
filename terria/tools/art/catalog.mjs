/**
 * Cut every building out of the TERRIA art catalogue (art/catalog/terria_catalog.png):
 * panels on a flat dark background, 5 levels per building in a row, plus
 * decor, construction sites and trees.
 *
 *   node tools/art/catalog.mjs [catalog.png] [outDir=art/catalog/out]
 *
 * - background = large connected regions of the panel colour; anything
 *   enclosed by a building (dark doorways, pits, shadows) stays part of it
 * - panel frames are removed so buildings touching them come apart
 * - each building keeps every piece that belongs to it (smoke, flags, tree
 *   tops), level numerals and captions below it are left out
 * - anti-aliased edges are un-blended from the background colour (no dark rim)
 * - the picture itself is never cropped or reshaped
 * Writes <name>.png + cut.json { sprites: [{ name, file, w, h, dw, ax, ay }] }:
 * (ax, ay) = centre of the lot (top face of the ground tile), dw = its width.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const src = process.argv[2] ?? 'art/catalog/terria_catalog.png';
const outDir = process.argv[3] ?? 'art/catalog/out';
mkdirSync(outDir, { recursive: true });

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const N = W * H;

// ---------------------------------------------------------------- background
const BG = [15, 19, 19];
const dist = (p) => Math.abs(data[p * 3] - BG[0]) + Math.abs(data[p * 3 + 1] - BG[1]) + Math.abs(data[p * 3 + 2] - BG[2]);
const NEAR = 22;
function regions(test) {
  const lab = new Int32Array(N).fill(-1);
  const list = [];
  const st = [];
  for (let p0 = 0; p0 < N; p0++) {
    if (lab[p0] >= 0 || !test(p0)) continue;
    const c = { id: list.length, n: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0 };
    list.push(c);
    lab[p0] = c.id;
    st.push(p0);
    while (st.length) {
      const p = st.pop();
      const x = p % W;
      const y = (p - x) / W;
      c.n++;
      c.sx += x;
      c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && lab[p - 1] < 0 && test(p - 1)) (lab[p - 1] = c.id), st.push(p - 1);
      if (x < W - 1 && lab[p + 1] < 0 && test(p + 1)) (lab[p + 1] = c.id), st.push(p + 1);
      if (y > 0 && lab[p - W] < 0 && test(p - W)) (lab[p - W] = c.id), st.push(p - W);
      if (y < H - 1 && lab[p + W] < 0 && test(p + W)) (lab[p + W] = c.id), st.push(p + W);
    }
  }
  return { lab, list };
}
// the panel colour, or darker than it (the soft shadow under every tile)
const isBgColour = (p) => dist(p) < NEAR || (data[p * 3] <= BG[0] + 9 && data[p * 3 + 1] <= BG[1] + 9 && data[p * 3 + 2] <= BG[2] + 10);
const near = regions(isBgColour);
const bg = new Uint8Array(N);
for (let p = 0; p < N; p++) if (near.lab[p] >= 0 && near.list[near.lab[p]].n > 3000) bg[p] = 1;

// panel frames: thin grey lines, i.e. long straight runs of grey pixels
const grey = (p) => {
  const r = data[p * 3];
  const g = data[p * 3 + 1];
  const b = data[p * 3 + 2];
  const lum = (r + g + b) / 3;
  return lum > 20 && lum < 110 && Math.abs(r - g) < 12 && Math.abs(g - b) < 8;
};
const frame = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  let run = 0;
  for (let x = 0; x <= W; x++) {
    if (x < W && grey(y * W + x)) run++;
    else {
      if (run >= 100) for (let k = x - run; k < x; k++) frame[y * W + k] = 1;
      run = 0;
    }
  }
}
for (let x = 0; x < W; x++) {
  let run = 0;
  for (let y = 0; y <= H; y++) {
    if (y < H && grey(y * W + x)) run++;
    else {
      if (run >= 60) for (let k = y - run; k < y; k++) frame[k * W + x] = 1;
      run = 0;
    }
  }
}
// the same horizontal lines where a tall building almost touches them (the
// run is cut short there): grey pixels exactly on a frame row
const frameRows = [];
for (let y = 0; y < H; y++) {
  let n = 0;
  for (let x = 0; x < W; x++) n += frame[y * W + x];
  if (n >= 300) frameRows.push(y);
}
for (const y of frameRows) for (let x = 0; x < W; x++) if (grey(y * W + x)) frame[y * W + x] = 1;

for (let p = 0; p < N; p++) if (frame[p]) {
  bg[p] = 1;
  const x = p % W;
  if (x > 0) bg[p - 1] = 1;
  if (x < W - 1) bg[p + 1] = 1;
  if (p >= W) bg[p - W] = 1;
  if (p + W < N) bg[p + W] = 1;
}

// see-through gaps inside open structures (crane, scaffolding, towers) are
// enclosed patches of exactly the panel colour: background too. Dark parts
// of buildings (doorways, pits, shadows) have other colours and stay.
const holeColour = (p) => !bg[p] && dist(p) < 14;
const holes = regions(holeColour);
for (let p = 0; p < N; p++) if (holes.lab[p] >= 0 && holes.list[holes.lab[p]].n >= 12) bg[p] = 1;

let fg = regions((p) => !bg[p]);

// ---------------------------------------------------------------- buildings
const blobs = fg.list.filter((c) => c.n > 1200 && c.y1 - c.y0 > 45 && c.y0 > 80);
// drop the round category icons at the left of every panel
const isIcon = (c) => c.x1 - c.x0 < 60 && c.y1 - c.y0 < 60 && Math.abs(c.x1 - c.x0 - (c.y1 - c.y0)) < 6;
const buildings = blobs.filter((c) => !isIcon(c)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

// rows of the catalogue (top to bottom) and their names
const ROWS = [
  { y: [86, 235], left: 'townhall', right: 'house' },
  { y: [236, 386], left: 'farm', right: 'sawmill' },
  { y: [387, 532], left: 'quarry', right: 'mine' },
  { y: [533, 668], left: 'shop', right: 'warehouse' },
  { y: [669, 805], left: 'hospital', right: 'factory' },
];
/** Split a blob that holds two neighbouring tiles at its thinnest column. */
function split(b) {
  const w = b.x1 - b.x0 + 1;
  let cut = -1;
  let best = Infinity;
  for (let x = b.x0 + Math.round(w * 0.3); x <= b.x0 + Math.round(w * 0.7); x++) {
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) if (fg.lab[y * W + x] === b.id) n++;
    if (n < best) (best = n), (cut = x);
  }
  const right = { id: fg.list.length, n: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0 };
  fg.list.push(right);
  const left = b;
  left.n = 0; left.sx = 0; left.sy = 0; left.x0 = W; left.y0 = H; left.x1 = 0; left.y1 = 0;
  const bx0 = b.x0 === W ? 0 : b.x0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (fg.lab[p] !== b.id) continue;
      const c = x >= cut ? right : left;
      if (c === right) fg.lab[p] = right.id;
      c.n++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
    }
  void bx0;
  console.log(`split a merged pair at x=${cut} (${best} px joint)`);
  return right;
}
function fillRow(list) {
  while (list.length && list.length < 5) {
    const widths = list.map((b) => b.x1 - b.x0).sort((a, c) => a - c);
    const med = widths[widths.length >> 1];
    const widest = list.reduce((a, c) => (c.x1 - c.x0 > a.x1 - a.x0 ? c : a));
    if (widest.x1 - widest.x0 < med * 1.6 || list.length === 1) break;
    list.push(split(widest));
    list.sort((a, c) => a.x0 - c.x0);
  }
  return list;
}

const names = new Map();
for (const r of ROWS) {
  const inRow = buildings.filter((b) => (b.y0 + b.y1) / 2 > r.y[0] && (b.y0 + b.y1) / 2 < r.y[1]);
  const left = fillRow(inRow.filter((b) => b.x1 < 775).sort((a, b) => a.x0 - b.x0));
  const right = fillRow(inRow.filter((b) => b.x0 > 775).sort((a, b) => a.x0 - b.x0));
  left.forEach((b, i) => names.set(b, `${r.left}:${i + 1}`));
  right.forEach((b, i) => names.set(b, `${r.right}:${i + 1}`));
  if (left.length !== 5 || right.length !== 5) console.warn(`row ${r.left}/${r.right}: found ${left.length} + ${right.length}`);
}
const bottom = buildings.filter((b) => (b.y0 + b.y1) / 2 > 806).sort((a, b) => a.x0 - b.x0);
const school = bottom.filter((b) => b.x1 < 708);
const decor = bottom.filter((b) => b.x0 > 708 && b.x1 < 958);
const sites = bottom.filter((b) => b.x0 > 958 && b.x1 < 1262);
const trees = bottom.filter((b) => b.x0 > 1262);
school.forEach((b, i) => names.set(b, `school:${i + 1}`));
['park:1', 'fountain:1', 'statue:1'].forEach((n, i) => decor[i] && names.set(decor[i], n));
['site:2', 'site:3', 'site:4'].forEach((n, i) => sites[i] && names.set(sites[i], n));
// the catalogue's trees are not used: the map paints its own trees
void trees;
console.log(`buildings found: ${names.size} (school ${school.length}, decor ${decor.length}, sites ${sites.length}, trees ${trees.length})`);

// small pieces (smoke, flags, separate tree tops) join the building above
// which they float; numerals and captions below a building do not
const pieces = fg.list.filter((c) => !names.has(c) && c.n >= 2 && c.y0 > 80);
const owner = new Map();
for (const pc of pieces) {
  const cx = pc.sx / pc.n;
  const cy = pc.sy / pc.n;
  const pw = pc.x1 - pc.x0 + 1;
  const ph = pc.y1 - pc.y0 + 1;
  if ((pw / ph > 6 || ph / pw > 6) && pc.n < 400) continue; // a leftover line
  if (pc.n < 10) continue; // specks
  // a piece of a rounded panel corner: dim grey
  let dimGrey = 0;
  for (let y = pc.y0; y <= pc.y1; y++)
    for (let x = pc.x0; x <= pc.x1; x++) if (fg.lab[y * W + x] === pc.id && grey(y * W + x) && (data[(y * W + x) * 3] + data[(y * W + x) * 3 + 1] + data[(y * W + x) * 3 + 2]) / 3 < 110) dimGrey++;
  if (dimGrey > pc.n * 0.6 && pc.n < 300) continue;
  // the headings of the bottom panels ("Стройплощадки", "Деревья", ...)
  if (cy > 812 && cy < 862 && cx > 708) continue;
  let best = null;
  let bestD = Infinity;
  for (const b of names.keys()) {
    // within 3 px of the building's box and not below its upper three quarters
    const touch = pc.x1 >= b.x0 - 3 && pc.x0 <= b.x1 + 3 && pc.y1 >= b.y0 - 3 && pc.y0 <= b.y1 + 3;
    const inside = touch && cy <= b.y1 - (b.y1 - b.y0) * 0.25 && cx >= b.x0 - 3 && cx <= b.x1 + 3;
    if (!inside) continue;
    const d = Math.hypot(cx - (b.x0 + b.x1) / 2, cy - (b.y0 + b.y1) / 2);
    if (d < bestD) (bestD = d), (best = b);
  }
  if (best) owner.set(pc, best);
}

// ---------------------------------------------------------------- output
const report = [];
for (const [b, name] of names) {
  const parts = [b, ...[...owner].filter(([, o]) => o === b).map(([pc]) => pc)];
  const ids = new Set(parts.map((c) => c.id));
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of parts) (x0 = Math.min(x0, c.x0)), (y0 = Math.min(y0, c.y0)), (x1 = Math.max(x1, c.x1)), (y1 = Math.max(y1, c.y1));
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(W - 1, x1 + 1);
  y1 = Math.min(H - 1, y1 + 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y0 + y) * W + (x0 + x);
      if (!ids.has(fg.lab[p])) continue;
      // scaffolding and the crane are see-through: panel colour (or its
      // shadow) seen between the beams is background
      if (name.startsWith('site:') && isBgColour(p)) continue;
      const o = (y * w + x) * 4;
      // edge pixels are a mix of the building and the background
      let edge = false;
      const px = p % W;
      for (const q of [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, p - W, p + W]) if (q >= 0 && q < N && bg[q]) edge = true;
      const a = edge ? Math.min(1, Math.max(0.2, dist(p) / 70)) : 1;
      for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, Math.round((data[p * 3 + k] - BG[k] * (1 - a)) / a)));
      out[o + 3] = Math.round(a * 255);
    }
  const file = name.replace(':', '_') + '.png';
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(outDir, file));
  report.push({ name, file, w, h, ...measure(out, w, h, name) });
}

/**
 * The lot on a tile: from the bottom tip upwards the silhouette widens by
 * ~4 px per row (two 2:1 edges) until the side corners of the soil block,
 * then stays as wide for the soil thickness. The lot centre is the row of
 * the side corners of the top face (soil top), horizontally the tip.
 */
function measure(out, w, h, name) {
  const span = [];
  for (let y = 0; y < h; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) if (out[(y * w + x) * 4 + 3] > 128) (l < 0 && (l = x)), (r = x);
    span[y] = l < 0 ? null : [l, r];
  }
  let yb = h - 1;
  while (yb > 0 && (!span[yb] || span[yb][1] - span[yb][0] < 2)) yb--;
  if (name.startsWith('tree:')) {
    let best = 0;
    for (const s of span) if (s && s[1] - s[0] > best) best = s[1] - s[0];
    return { dw: best, ax: (span[yb][0] + span[yb][1]) / 2, ay: yb - 1 };
  }
  const width = (d) => (span[yb - d] ? span[yb - d][1] - span[yb - d][0] : 0);
  // first row where the widening stops (the side corners of the soil block)
  let d1 = 4;
  while (d1 < h / 2 && width(d1 + 3) - width(d1) >= 5) d1++;
  const dw = width(d1);
  // soil thickness: rows the width stays (nearly) constant above that
  let d2 = d1;
  while (d2 < d1 + 40 && Math.abs(width(d2 + 1) - dw) <= 3) d2++;
  const t = d2 - d1;
  const ax = (span[yb - d1][0] + span[yb - d1][1]) / 2;
  return { dw, ax, ay: yb - d2, t, d1, yb, check: +(dw / 4 / d1).toFixed(2), span };
}

/** Second pass: fix tiles whose measurement is off, using the whole set. */
function settle(list) {
  const ts = list.filter((r) => r.t >= 4 && r.t <= 11).map((r) => r.t).sort((a, b) => a - b);
  const tMed = ts.length ? ts[ts.length >> 1] : 7;
  for (const r of list) {
    if (r.name.startsWith('tree:')) continue;
    if (Math.abs(r.check - 1) > 0.15) {
      // something (a crane mast) broke the silhouette: the ground is the
      // widest row of the lower part
      let best = 0;
      let row = r.yb;
      for (let y = Math.round(r.h * 0.5); y <= r.yb; y++) {
        const s = r.span[y];
        if (s && s[1] - s[0] > best) (best = s[1] - s[0]), (row = y);
      }
      r.dw = best;
      r.ax = (r.span[row][0] + r.span[row][1]) / 2;
      r.ay = r.yb - best / 4 - tMed;
      r.fixed = 'width';
    } else if (r.t < 3 || r.t > 11) {
      r.ay = r.yb - r.d1 - tMed;
      r.fixed = 'soil';
    }
  }
  for (const r of list) {
    delete r.span;
    delete r.d1;
    delete r.yb;
  }
}

settle(report);
writeFileSync(join(outDir, 'cut.json'), JSON.stringify({ source: src, sprites: report.sort((a, b) => a.name.localeCompare(b.name)) }, null, 1));
for (const r of report) if (r.fixed) console.log(r.name.padEnd(12), 'lot', r.dw, 'fixed', r.fixed);
