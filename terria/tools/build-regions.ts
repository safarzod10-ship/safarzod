/**
 * Precompute the 1000 region masks the game server and client share:
 *   node tools/build-regions.ts [outDir=public/regions]
 *
 * For every region: bounding box in world cells (16 m), buildable cells,
 * wooded cells, the clipped starter plot (1 % of the region) and a town hall
 * spot. Written as static JSON so the Worker reads them for free from its
 * assets and never has to generate the world (that takes ~1 s of CPU, the
 * free plan allows 10 ms per request).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GRID_CELL } from '../src/core/config.ts';
import { getBit, newBits, setBit, toB64 } from '../src/game/bits.ts';
import type { RegionMaskDTO } from '../src/game/types.ts';
import { generateWorld } from '../src/world/generation/generateWorld.ts';
import { DEFAULT_WORLD_PARAMS, GENERATOR_VERSION } from '../src/world/generation/WorldParams.ts';
import { createWorldQuery } from '../src/world/WorldQuery.ts';

const outDir = process.argv[2] ?? 'public/regions';
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const world = generateWorld(DEFAULT_WORLD_PARAMS);
const q = createWorldQuery(world);
const count = q.regions.count;
const lb = q.meta.landBounds;
const cx0 = Math.floor(lb.x / GRID_CELL);
const cy0 = Math.floor(lb.y / GRID_CELL);
const cw = Math.ceil((lb.x + lb.width) / GRID_CELL) - cx0;
const ch = Math.ceil((lb.y + lb.height) / GRID_CELL) - cy0;

// region id per buildable cell (sampled at the cell centre), -1 elsewhere
const owner = new Int16Array(cw * ch).fill(-1);
const wooded = new Uint8Array(cw * ch);
const box = new Int32Array(count * 4);
for (let r = 0; r < count; r++) box.set([1e9, 1e9, -1e9, -1e9], r * 4);
for (let y = 0; y < ch; y++)
  for (let x = 0; x < cw; x++) {
    const wx = (cx0 + x) * GRID_CELL + GRID_CELL / 2;
    const wy = (cy0 + y) * GRID_CELL + GRID_CELL / 2;
    if (!q.isBuildable(wx, wy)) continue;
    const reg = q.regionAt(wx, wy);
    if (!reg) continue;
    const i = y * cw + x;
    owner[i] = reg.id;
    if (q.isWooded(wx, wy)) wooded[i] = 1;
    const b = reg.id * 4;
    box[b] = Math.min(box[b], x);
    box[b + 1] = Math.min(box[b + 1], y);
    box[b + 2] = Math.max(box[b + 2], x);
    box[b + 3] = Math.max(box[b + 3], y);
  }
console.log(`scan ${(performance.now() - t0).toFixed(0)} ms`);

const index: { id: number; cells: number; hx: number; hy: number }[] = [];
let moved = 0;
for (let r = 0; r < count; r++) {
  const bx = box[r * 4];
  const by = box[r * 4 + 1];
  const w = box[r * 4 + 2] - bx + 1;
  const h = box[r * 4 + 3] - by + 1;
  const build = newBits(w * h);
  const wood = newBits(w * h);
  let cells = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gi = (by + y) * cw + (bx + x);
      if (owner[gi] !== r) continue;
      setBit(build, y * w + x);
      if (wooded[gi]) setBit(wood, y * w + x);
      cells++;
    }
  const info = q.regions.info(r);
  const sp = info.starterPlot;
  const start = {
    x: Math.round(sp.x / GRID_CELL),
    y: Math.round(sp.y / GRID_CELL),
    w: Math.round(sp.width / GRID_CELL),
    h: Math.round(sp.height / GRID_CELL),
  };
  const local = (x: number, y: number): number => (x - cx0 - bx) + (y - cy0 - by) * w;
  const ok4 = (hx: number, hy: number): boolean => {
    for (let y = hy; y < hy + 4; y++)
      for (let x = hx; x < hx + 4; x++) {
        const lx = x - cx0 - bx;
        const ly = y - cy0 - by;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h || !getBit(build, local(x, y))) return false;
      }
    return true;
  };
  // town hall: a fully buildable 4x4 spot nearest to the plot's north-west
  // corner, so the rest of the plot stays one usable L-shaped block
  const ccx = start.x;
  const ccy = start.y;
  let hall = { x: ccx, y: ccy };
  search: for (let rad = 0; rad < 40; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (ok4(ccx + dx, ccy + dy)) {
          hall = { x: ccx + dx, y: ccy + dy };
          if (rad > 0) moved++;
          break search;
        }
      }
  // keep the starter plot around the hall
  start.x = Math.min(start.x, hall.x);
  start.y = Math.min(start.y, hall.y);
  if (hall.x + 4 > start.x + start.w) start.x = hall.x + 4 - start.w;
  if (hall.y + 4 > start.y + start.h) start.y = hall.y + 4 - start.h;
  const dto: RegionMaskDTO = {
    id: r,
    x0: cx0 + bx,
    y0: cy0 + by,
    w,
    h,
    build: toB64(build),
    wood: toB64(wood),
    cells,
    start,
    hall,
  };
  writeFileSync(`${outDir}/${r}.json`, JSON.stringify(dto));
  index.push({ id: r, cells, hx: hall.x, hy: hall.y });
}
writeFileSync(
  `${outDir}/index.json`,
  JSON.stringify({ seed: DEFAULT_WORLD_PARAMS.seed, generator: GENERATOR_VERSION, count, regions: index }),
);
const cells = index.map((r) => r.cells).sort((a, b) => a - b);
console.log(
  `wrote ${count} regions in ${(performance.now() - t0).toFixed(0)} ms; cells min ${cells[0]} median ${cells[count >> 1]} max ${cells[count - 1]}; hall nudged in ${moved}`,
);
