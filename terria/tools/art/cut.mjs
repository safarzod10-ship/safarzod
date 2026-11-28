/**
 * Cut buildings out of an art sheet (several isometric tiles on a plain dark
 * background, with caption badges) into separate transparent PNGs.
 *
 *   node tools/art/cut.mjs <sheet.png> <outDir> <rows> <cols> <names...>
 *   e.g. node tools/art/cut.mjs art/source/sheet-01.png art/cut 2 5 house:1 ... farm:5
 *
 * Steps: flood-fill the background from the borders, drop caption badges
 * (wide, short components), split the rest into the row x col grid by
 * centroid, de-fringe the anti-aliased edge against the background colour,
 * trim, and measure the ground diamond (its side corners give the lot width
 * and the lot centre).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [, , sheet, outDir, rowsArg, colsArg, ...names] = process.argv;
const ROWS = Number(rowsArg);
const COLS = Number(colsArg);
mkdirSync(outDir, { recursive: true });

const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const at = (x, y) => (y * W + x) * 4;
// background colour = median of the border
const border = [];
for (let x = 0; x < W; x += 7) border.push(at(x, 0), at(x, H - 1));
for (let y = 0; y < H; y += 7) border.push(at(0, y), at(W - 1, y));
const med = (k) => border.map((i) => data[i + k]).sort((a, b) => a - b)[border.length >> 1];
const BG = [med(0), med(1), med(2)];
const dist = (i) => Math.abs(data[i] - BG[0]) + Math.abs(data[i + 1] - BG[1]) + Math.abs(data[i + 2] - BG[2]);
const TH = 26;
const TARGET_ASPECT = 0.5; // 2:1 dimetric, the map's projection

// 1. background = pixels close to BG connected to the border
const bg = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => {
  const p = y * W + x;
  if (bg[p] || dist(p * 4) > TH) return;
  bg[p] = 1;
  stack.push(p);
};
for (let x = 0; x < W; x++) push(x, 0), push(x, H - 1);
for (let y = 0; y < H; y++) push(0, y), push(W - 1, y);
while (stack.length) {
  const p = stack.pop();
  const x = p % W;
  const y = (p - x) / W;
  if (x > 0) push(x - 1, y);
  if (x < W - 1) push(x + 1, y);
  if (y > 0) push(x, y - 1);
  if (y < H - 1) push(x, y + 1);
}

// 2. connected components of the foreground
const comp = new Int32Array(W * H).fill(-1);
const comps = [];
for (let p0 = 0; p0 < W * H; p0++) {
  if (bg[p0] || comp[p0] >= 0) continue;
  const id = comps.length;
  const c = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0 };
  comps.push(c);
  comp[p0] = id;
  stack.push(p0);
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p - x) / W;
    c.n++;
    c.sx += x;
    c.sy += y;
    if (x < c.x0) c.x0 = x;
    if (x > c.x1) c.x1 = x;
    if (y < c.y0) c.y0 = y;
    if (y > c.y1) c.y1 = y;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
      if (q >= 0 && !bg[q] && comp[q] < 0) {
        comp[q] = id;
        stack.push(q);
      }
  }
}
// caption badges: wide and short (aspect > 3) and not huge
const isBadge = (c) => {
  const w = c.x1 - c.x0 + 1;
  const h = c.y1 - c.y0 + 1;
  return w / h > 3 && h < H / ROWS / 3;
};
// tiny specks far from anything are noise
const keep = comps.filter((c) => c.n > 30 && !isBadge(c));

// 3. cells: split rows and columns at the emptiest lines near the nominal grid
const fg = (p) => !bg[p] && comp[p] >= 0 && keepIds.has(comp[p]);
function valley(isCol, nominal, lo, hi, a0, a1) {
  let bestPos = nominal;
  let bestN = Infinity;
  for (let v = Math.max(lo, nominal - 60); v <= Math.min(hi, nominal + 60); v++) {
    let n = 0;
    for (let u = a0; u < a1; u++) if (fg(isCol ? u * W + v : v * W + u)) n++;
    if (n < bestN) {
      bestN = n;
      bestPos = v;
    }
  }
  return bestPos;
}
const keepIds = new Set(keep.map((c) => c.id));
const rowB = [0];
for (let r = 1; r < ROWS; r++) rowB.push(valley(false, Math.round((r * H) / ROWS), 1, H - 2, 0, W));
rowB.push(H);
const cellsRect = [];
for (let r = 0; r < ROWS; r++) {
  const colB = [0];
  for (let c = 1; c < COLS; c++) colB.push(valley(true, Math.round((c * W) / COLS), 1, W - 2, rowB[r], rowB[r + 1]));
  colB.push(W);
  for (let c = 0; c < COLS; c++) cellsRect.push([colB[c], rowB[r], colB[c + 1], rowB[r + 1]]);
}

const report = [];
const pending = [];
for (let k = 0; k < cellsRect.length; k++) {
  const [cx0, cy0, cx1, cy1] = cellsRect[k];
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = cy0; y < cy1; y++)
    for (let x = cx0; x < cx1; x++)
      if (fg(y * W + x)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) continue;
  const inCell = (p) => {
    const x = p % W;
    const y = (p - x) / W;
    return x >= cx0 && x < cx1 && y >= cy0 && y < cy1 && fg(p);
  };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y0 + y) * W + (x0 + x);
      const i = p * 4;
      const o = (y * w + x) * 4;
      if (!inCell(p)) continue;
      // de-fringe: pixels next to the background are partly background
      let edge = false;
      for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && bg[q]) edge = true;
      let a = 1;
      if (edge) a = Math.min(1, Math.max(0.15, dist(i) / 90));
      for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.max(0, Math.min(255, Math.round((data[i + ch] - BG[ch] * (1 - a)) / a)));
      out[o + 3] = Math.round(a * 255);
    }
  // 4. ground diamond: the widest rows of the lower half are the side corners
  const opaque = (x, y) => out[(y * w + x) * 4 + 3] > 128;
  let best = 0;
  const span = [];
  for (let y = Math.floor(h * 0.35); y < h; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) if (opaque(x, y)) {
      if (l < 0) l = x;
      r = x;
    }
    span[y] = l < 0 ? null : [l, r];
    if (l >= 0 && r - l > best) best = r - l;
  }
  let yc = -1;
  for (let y = Math.floor(h * 0.35); y < h; y++) if (span[y] && span[y][1] - span[y][0] >= best * 0.985) {
    yc = y;
    break;
  }
  const [l, r] = span[yc];
  // bottom tip of the soil block
  let yb = h - 1;
  while (yb > 0 && !span[yb]) yb--;
  // slope of the lower-left edge below the soil band: x per y
  const pts = [];
  for (let y = yc; y <= yb; y++) if (span[y]) pts.push([y, span[y][0]]);
  // Ground diamond, measured from the bottom up (trees may stick out sideways):
  // the lower-left edge is a straight line from the bottom tip to the left
  // corner of the soil block, then the soil block's side goes straight up.
  let yb2 = yb;
  while (yb2 > 0 && (!span[yb2] || span[yb2][1] - span[yb2][0] < 3)) yb2--;
  const xb = (span[yb2][0] + span[yb2][1]) / 2;
  const ys = [];
  const xs = [];
  for (let y = yb2 - 60; y < yb2 - 4; y++) if (span[y]) ys.push(y), xs.push(span[y][0]);
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < ys.length; i++) {
    num += (ys[i] - my) * (xs[i] - mx);
    den += (ys[i] - my) ** 2;
  }
  const measured = den / num; // dy/dx of the edge
  const aspect = Math.abs(measured - 0.5) < Math.abs(measured - 0.5774) ? 0.5 : 0.5774;
  // width: the widest row (the side corners); centre: the bottom tip; the
  // soil thickness follows, and is replaced by the sheet median if odd
  const half = (r - l) / 2;
  const cxp = xb;
  const soilRaw = yb2 - yc - half * aspect;
  pending.push({ k, soilRaw });
  const soilFor = () => {
    const ok = pending.map((p) => p.soilRaw).filter((v) => v >= 4 && v <= 40).sort((x, y) => x - y);
    const med = ok.length ? ok[ok.length >> 1] : 12;
    return soilRaw >= 4 && soilRaw <= 40 && Math.abs(soilRaw - med) < 8 ? soilRaw : med;
  };
  const soil = soilFor();
  const ycTrue = yb2 - soil - half * aspect;
  // cut the soil block away: keep only what is above the lower edges of the ground diamond
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const limit = ycTrue + (half - Math.abs(x - cxp)) * aspect + 1.5;
      if (y > limit) out[(y * w + x) * 4 + 3] = 0;
      else if (y > limit - 1) out[(y * w + x) * 4 + 3] = Math.round(out[(y * w + x) * 4 + 3] * (limit - y));
    }
  // chimney smoke drawn over the dark background came out as dark grey
  // blobs: make grey pixels high above the ground light and see-through
  // (only for pictures listed in SMOKE=..., grey roofs would suffer otherwise)
  const smoky = (process.env.SMOKE ?? '').split(',').includes(names[k]);
  for (let y = 0; smoky && y < Math.min(h, ycTrue - half * aspect * 1.2); y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!out[o + 3]) continue;
      const mx = Math.max(out[o], out[o + 1], out[o + 2]);
      const mn = Math.min(out[o], out[o + 1], out[o + 2]);
      if (mx - mn < 16 && mx < 140) {
        const t = mx / 140;
        out[o] = out[o + 1] = out[o + 2] = Math.round(205 + 30 * t);
        out[o + 3] = Math.round(out[o + 3] * (0.25 + 0.35 * t));
      }
    }
  const hKeep = Math.min(h, Math.ceil(ycTrue + half * aspect + 2));
  // normalise every picture to the map's 2:1 projection
  const sy = TARGET_ASPECT / aspect;
  const outH = Math.max(1, Math.round(hKeep * sy));
  const name = names[k] ?? `cell-${k}`;
  const file = name.replace(':', '_') + '.png';
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: 0, top: 0, width: w, height: hKeep })
    .resize(w, outH, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toFile(join(outDir, file));
  report.push({ name, file, w, h: outH, dw: half * 2, ax: cxp, ay: ycTrue * sy, aspect, measured: +measured.toFixed(3), soil });
}
writeFileSync(join(outDir, 'cut.json'), JSON.stringify({ background: BG, sprites: report }, null, 1));
for (const r of report) console.log(r.name.padEnd(10), `${r.w}x${r.h}`, 'diamond', r.dw, 'anchor', r.ax.toFixed(1), r.ay.toFixed(1), 'aspect', r.aspect, r.measured, 'soil', r.soil);
