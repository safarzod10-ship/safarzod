/**
 * Offline preview of the baked terrain (no GPU, no browser):
 *   node tools/render-preview.ts [seed] [outDir]
 * Writes the whole continent (LOD 0, with region borders) and close-ups as PNG.
 */
import { mkdirSync } from 'node:fs';
import { CHUNK_NODES, LODS, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld } from '../src/world/generation/generateWorld.ts';
import { DEFAULT_WORLD_PARAMS } from '../src/world/generation/WorldParams.ts';
import { BORDER_STRIDE } from '../src/world/regions/regions.ts';
import { bakeChunk } from '../src/world/terrain/chunkBaker.ts';
import { placeTrees, TREE_STRIDE } from '../src/world/trees/treePlacement.ts';
import { writePng } from './png.ts';

const seed = process.argv[2] ? Number(process.argv[2]) >>> 0 : DEFAULT_WORLD_PARAMS.seed;
const outDir = process.argv[3] ?? 'preview';
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const world = generateWorld({ ...DEFAULT_WORLD_PARAMS, seed });
console.log(`seed ${seed}: generated in ${(performance.now() - t0).toFixed(0)} ms`);
const m = world.meta;
console.log(
  JSON.stringify(
    {
      landKm: [m.landBounds.width / 1000, m.landBounds.height / 1000],
      landAreaKm2: m.landArea / 1e6,
      buildable: m.buildableFraction,
      forest: m.forestFraction,
      lakes: m.lakeCount,
      riverKm: m.riverLength / 1000,
      riverSegments: world.rivers.count,
      regions: m.regionCount,
      regionKm2: [m.regionAreaMin / 1e6, m.regionAreaAvg / 1e6, m.regionAreaMax / 1e6],
    },
    null,
    1,
  ),
);

function stitch(
  level: number,
  cx0: number,
  cy0: number,
  count: number,
  file: string,
  opts: { shore?: boolean; borders?: boolean; trees?: boolean } = {},
): void {
  const n = CHUNK_NODES - 1;
  const size = n * count;
  const lod = LODS[level];
  const img = new Uint8Array(size * size * 4);
  let ms = 0;
  let worst = 0;
  for (let cy = 0; cy < count; cy++) {
    for (let cx = 0; cx < count; cx++) {
      const s = performance.now();
      const px = bakeChunk(world, level, cx0 + cx, cy0 + cy);
      const dt = performance.now() - s;
      ms += dt;
      if (dt > worst) worst = dt;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const src = (j * CHUNK_NODES + i) * 4;
          const dst = ((cy * n + j) * size + cx * n + i) * 4;
          let r = px[src];
          let g = px[src + 1];
          let b = px[src + 2];
          if (opts.shore) {
            const a = px[src + 3];
            if (a < 128 && a > 118) {
              const t = ((a - 118) / 10) * 0.7;
              r += (250 - r) * t;
              g += (252 - g) * t;
              b += (255 - b) * t;
            }
          }
          img[dst] = r;
          img[dst + 1] = g;
          img[dst + 2] = b;
          img[dst + 3] = 255;
        }
      }
    }
  }
  const x0 = cx0 * lod.chunkSize;
  const y0 = cy0 * lod.chunkSize;
  const plot = (wx: number, wy: number, r: number, g: number, b: number, a: number): void => {
    const i = Math.round((wx - x0) / lod.texel);
    const j = Math.round((wy - y0) / lod.texel);
    if (i < 0 || j < 0 || i >= size || j >= size) return;
    const o = (j * size + i) * 4;
    img[o] += (r - img[o]) * a;
    img[o + 1] += (g - img[o + 1]) * a;
    img[o + 2] += (b - img[o + 2]) * a;
  };
  if (opts.borders) {
    const bs = world.regions.borders;
    for (let o = 0; o < bs.length; o += BORDER_STRIDE) {
      const len = Math.hypot(bs[o + 2] - bs[o], bs[o + 3] - bs[o + 1]);
      const steps = Math.max(1, Math.ceil(len / lod.texel));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        plot(bs[o] + (bs[o + 2] - bs[o]) * t, bs[o + 1] + (bs[o + 3] - bs[o + 1]) * t, 255, 255, 255, 0.55);
      }
    }
  }
  if (opts.trees) {
    const per = 1024;
    for (let ty = Math.floor(y0 / per); ty <= Math.floor((y0 + size * lod.texel) / per); ty++) {
      for (let tx = Math.floor(x0 / per); tx <= Math.floor((x0 + size * lod.texel) / per); tx++) {
        const t = placeTrees(world, tx, ty);
        for (let k = 0; k < t.length; k += TREE_STRIDE) {
          const rad = t[k + 2] / 2 / lod.texel;
          for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
            for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
              if (dx * dx + dy * dy <= rad * rad) plot(t[k] + dx * lod.texel, t[k + 1] + dy * lod.texel - rad, 52, 118, 56, 0.9);
            }
          }
        }
      }
    }
  }
  writePng(`${outDir}/${file}`, size, size, img);
  console.log(`${file}: ${count * count} chunks, avg ${(ms / (count * count)).toFixed(1)} ms, worst ${worst.toFixed(0)} ms`);
}

stitch(0, 0, 0, WORLD_SIZE / LODS[0].chunkSize, `continent-${seed}.png`);
stitch(0, 0, 0, WORLD_SIZE / LODS[0].chunkSize, `regions-${seed}.png`, { borders: true });

// a stretch of river: take a segment from the middle of the list
const seg = world.rivers.segments;
const mid = Math.floor(world.rivers.count * 0.45) * 6;
const rx = seg[mid];
const ry = seg[mid + 1];
for (const level of [2, 4, 6]) {
  const lod = LODS[level];
  stitch(level, Math.floor(rx / lod.chunkSize), Math.floor(ry / lod.chunkSize), 2, `river-L${level}-${seed}.png`, {
    shore: true,
    borders: level < 6,
    trees: level >= 5,
  });
}
if (world.lakes.length) {
  const lod = LODS[3];
  stitch(3, Math.floor(world.lakes[0] / lod.chunkSize), Math.floor(world.lakes[1] / lod.chunkSize), 2, `lake-L3-${seed}.png`, {
    shore: true,
  });
}
