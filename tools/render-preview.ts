/**
 * Offline preview of the baked terrain (no GPU, no browser):
 *   node tools/render-preview.ts [seed] [outDir]
 * Writes the whole continent (LOD 0) and one close-up chunk as PNG.
 */
import { mkdirSync } from 'node:fs';
import { CHUNK_NODES, LODS, WORLD_SIZE } from '../src/core/config.ts';
import { generateWorld } from '../src/world/generation/generateWorld.ts';
import { DEFAULT_WORLD_PARAMS } from '../src/world/generation/WorldParams.ts';
import { bakeChunk } from '../src/world/terrain/chunkBaker.ts';
import { writePng } from './png.ts';

const seed = process.argv[2] ? Number(process.argv[2]) >>> 0 : DEFAULT_WORLD_PARAMS.seed;
const outDir = process.argv[3] ?? 'preview';
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const world = generateWorld({ ...DEFAULT_WORLD_PARAMS, seed });
const t1 = performance.now();
console.log(`seed ${seed}: generated in ${(t1 - t0).toFixed(0)} ms`);
console.log(JSON.stringify(world.meta, null, 1));

function stitch(level: number, cx0: number, cy0: number, count: number, file: string, markShore: boolean): void {
  const n = CHUNK_NODES - 1;
  const size = n * count;
  const img = new Uint8Array(size * size * 4);
  let ms = 0;
  for (let cy = 0; cy < count; cy++) {
    for (let cx = 0; cx < count; cx++) {
      const s = performance.now();
      const px = bakeChunk(world, level, cx0 + cx, cy0 + cy);
      ms += performance.now() - s;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const src = (j * CHUNK_NODES + i) * 4;
          const dst = ((cy * n + j) * size + cx * n + i) * 4;
          let r = px[src];
          let g = px[src + 1];
          let b = px[src + 2];
          if (markShore) {
            const a = px[src + 3];
            // emulate the shader's foam rim so the preview resembles the app
            if (a < 128 && a > 118) {
              const t = (a - 118) / 10;
              r += (250 - r) * t * 0.7;
              g += (252 - g) * t * 0.7;
              b += (255 - b) * t * 0.7;
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
  writePng(`${outDir}/${file}`, size, size, img);
  console.log(`${file}: ${count * count} chunks, ${(ms / (count * count)).toFixed(1)} ms/chunk`);
}

stitch(0, 0, 0, WORLD_SIZE / LODS[0].chunkSize, `continent-${seed}.png`, false);
// close-up around a stretch of coast: find a coastal point scanning from the west
let fx = 0;
const fy = WORLD_SIZE / 2 + 300;
for (let x = 0; x < WORLD_SIZE; x += 16) {
  if (world.e.sample(x, fy) > 0) {
    fx = x;
    break;
  }
}
const l3 = LODS[3];
stitch(3, Math.floor(fx / l3.chunkSize) , Math.floor(fy / l3.chunkSize), 2, `closeup-${seed}.png`, true);
const l2 = LODS[2];
stitch(2, Math.floor(fx / l2.chunkSize), Math.floor(fy / l2.chunkSize) - 1, 3, `mid-${seed}.png`, true);
