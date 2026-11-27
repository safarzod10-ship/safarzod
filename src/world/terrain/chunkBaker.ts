/**
 * Bakes one terrain chunk into an RGBA8 texture. Pure function of the world
 * fields: runs identically in the worker, on the main thread and in tests.
 *
 *   RGB  final albedo: land (grass, meadows, sand, hill shading) or the
 *        depth-dependent ocean colour. Continuous across the waterline.
 *   A    signed distance to the waterline, in units of the LOD's `band`:
 *        0.5 = shoreline, 1 = `band` wu inland, 0 = `band` wu offshore.
 *        The shader thresholds it, so coasts stay crisp at any zoom.
 *
 * Texels sit on chunk-shared edges (node i at origin + i * texel), which makes
 * neighbouring chunks agree exactly along their border.
 */
import { CHUNK_NODES, LODS } from '../../core/config.ts';
import { smoothstep } from '../../core/math.ts';
import { hash2 } from '../../core/rng.ts';
import type { WorldFields } from '../generation/WorldFields.ts';
import { oceanColor } from '../ocean/oceanPalette.ts';
import { LAND, RELIEF } from './palette.ts';

const N = CHUNK_NODES;
const P = N + 2; // one texel of padding for central differences

const eBuf = new Float32Array(P * P);
const zBuf = new Float32Array(P * P);
const reliefBuf = new Float32Array(P * P);
const forestBuf = new Float32Array(P * P);
const moistBuf = new Float32Array(P * P);
const meadowBuf = new Float32Array(P * P);

export const CHUNK_BYTES = N * N * 4;

/** Bake a chunk in one go (worker, tests, tools). */
export function bakeChunk(world: WorldFields, level: number, cx: number, cy: number, out?: Uint8Array): Uint8Array {
  const it = bakeChunkSteps(world, level, cx, cy, out);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * Same work as bakeChunk, split into small steps so the main-thread fallback
 * can spread a bake over several frames. Uses shared scratch buffers: only one
 * bake may be in progress at a time.
 */
export function* bakeChunkSteps(
  world: WorldFields,
  level: number,
  cx: number,
  cy: number,
  out?: Uint8Array,
): Generator<void, Uint8Array, void> {
  const pixels = out ?? new Uint8Array(CHUNK_BYTES);
  const lod = LODS[level];
  const step = lod.texel;
  const ox = cx * lod.chunkSize - step;
  const oy = cy * lod.chunkSize - step;

  world.e.upsample(ox, oy, step, P, eBuf);
  yield;

  // Fast path: a chunk that is entirely deep ocean needs no land fields.
  let anyNearLand = false;
  for (let k = 0; k < P * P; k++) {
    if (eBuf[k] > -0.08) {
      anyNearLand = true;
      break;
    }
  }

  if (anyNearLand) {
    world.relief.upsample(ox, oy, step, P, reliefBuf);
    yield;
    world.forest.upsample(ox, oy, step, P, forestBuf);
    yield;
    world.moist.upsample(ox, oy, step, P, moistBuf);
    yield;
    world.meadow.upsample(ox, oy, step, P, meadowBuf);
    yield;

    // Fine coastline octaves only matter (and are only paid for) near sea level.
    if (level >= 1) {
      for (let j = 0; j < P; j++) {
        const y = oy + j * step;
        for (let i = 0; i < P; i++) {
          const k = j * P + i;
          const e = eBuf[k];
          const ae = e < 0 ? -e : e;
          if (ae < 0.06) {
            const fade = 1 - smoothstep(0.03, 0.06, ae);
            eBuf[k] = e + fade * world.coastDetail(ox + i * step, y, level);
          }
        }
        if ((j & 63) === 63) yield;
      }
    }

    for (let k = 0; k < P * P; k++) {
      const e = eBuf[k];
      zBuf[k] = e > 0 ? RELIEF.height * reliefBuf[k] * smoothstep(0, 0.12, e) + RELIEF.bank * smoothstep(0, 0.035, e) : 0;
    }
  }

  const band = lod.band;
  const inv2 = 1 / (2 * step);
  const shoreLen = Math.max(10, 2.2 * step);
  const [lx, ly, lz] = RELIEF.light;
  const colorNoise = world.colorNoise;
  const beachNoise = world.beachNoise;
  const canopyMode = level <= 1;
  const flowers = level >= 3;
  const seed = world.decoSeed;
  const texelsPerWorld = 1 / step;

  for (let j = 0; j < N; j++) {
    if ((j & 31) === 31) yield;
    const wy = oy + (j + 1) * step;
    for (let i = 0; i < N; i++) {
      const k = (j + 1) * P + (i + 1);
      const o = (j * N + i) * 4;
      const e = eBuf[k];

      const ex = (eBuf[k + 1] - eBuf[k - 1]) * inv2;
      const ey = (eBuf[k + P] - eBuf[k - P]) * inv2;
      let grad = Math.sqrt(ex * ex + ey * ey);
      if (grad < 2e-5) grad = 2e-5;
      const dist = e / grad; // first-order distance to the waterline (wu)

      let sdf = dist / band;
      if (sdf > 1) sdf = 1;
      else if (sdf < -1) sdf = -1;
      pixels[o + 3] = Math.round(127.5 + 127.5 * sdf);

      if (e <= 0) {
        const c = oceanColor(-e, -dist, shoreLen);
        pixels[o] = c[0];
        pixels[o + 1] = c[1];
        pixels[o + 2] = c[2];
        continue;
      }

      const wx = ox + (i + 1) * step;

      // ---- grass base ---------------------------------------------------
      const m = moistBuf[k];
      let r: number;
      let g: number;
      let b: number;
      if (m < 0.5) {
        const t = m * 2;
        r = LAND.grassDry[0] + (LAND.grassMid[0] - LAND.grassDry[0]) * t;
        g = LAND.grassDry[1] + (LAND.grassMid[1] - LAND.grassDry[1]) * t;
        b = LAND.grassDry[2] + (LAND.grassMid[2] - LAND.grassDry[2]) * t;
      } else {
        const t = (m - 0.5) * 2;
        r = LAND.grassMid[0] + (LAND.grassLush[0] - LAND.grassMid[0]) * t;
        g = LAND.grassMid[1] + (LAND.grassLush[1] - LAND.grassMid[1]) * t;
        b = LAND.grassMid[2] + (LAND.grassLush[2] - LAND.grassMid[2]) * t;
      }

      // ---- meadows ------------------------------------------------------
      const meadowAmt = smoothstep(0.56, 0.8, meadowBuf[k]);
      if (meadowAmt > 0) {
        const t = meadowAmt * 0.6;
        r += (LAND.meadow[0] - r) * t;
        g += (LAND.meadow[1] - g) * t;
        b += (LAND.meadow[2] - b) * t;
      }

      // ---- soft, non-repeating colour mottling --------------------------
      let cloud = colorNoise(wx / 190, wy / 190);
      if (level >= 1) cloud = cloud * 0.65 + 0.35 * colorNoise(wx / 61 + 31.7, wy / 61 - 12.3);
      const tone = (1 + 0.05 * reliefBuf[k]) * (1 + 0.05 * cloud);
      r = r * tone + 5 * cloud;
      g = g * tone;
      b = b * tone - 3 * cloud;

      // ---- groves -------------------------------------------------------
      const f = forestBuf[k];
      if (f > 0.3) {
        if (canopyMode) {
          // Far view: tree sprites are not drawn, groves are painted in.
          const h = (hash2(Math.round(wx * texelsPerWorld), Math.round(wy * texelsPerWorld), seed) & 0xffff) / 65535;
          const t = smoothstep(0.44, 0.62, f + (h - 0.5) * 0.3) * (0.7 + 0.2 * h);
          r += (LAND.canopy[0] - r) * t;
          g += (LAND.canopy[1] - g) * t;
          b += (LAND.canopy[2] - b) * t;
        } else {
          const t = smoothstep(0.3, 0.75, f) * 0.34;
          r += (LAND.forestFloor[0] - r) * t;
          g += (LAND.forestFloor[1] - g) * t;
          b += (LAND.forestFloor[2] - b) * t;
        }
      }

      // ---- flowers (close-up only) -------------------------------------
      if (flowers && meadowAmt > 0.05 && f < 0.4) {
        // flowers gather in drifts; one colour dominates each drift
        const drift = colorNoise(wx / 46 - 71.3, wy / 46 + 18.9);
        if (drift > 0.3) {
          const h = hash2(Math.round(wx * texelsPerWorld), Math.round(wy * texelsPerWorld), seed ^ 0x1234567);
          if ((h & 0xffff) / 65535 < 0.16 * meadowAmt * smoothstep(0.3, 0.6, drift)) {
            const kind = colorNoise(wx / 210 + 5.1, wy / 210 - 44.4);
            const pick = ((h >>> 16) & 0xff) / 255 < 0.75 ? (kind > 0.15 ? 1 : kind < -0.2 ? 2 : 0) : (h >>> 24) % 3;
            const fc = LAND.flowers[pick];
            r += (fc[0] - r) * 0.5;
            g += (fc[1] - g) * 0.5;
            b += (fc[2] - b) * 0.5;
          }
        }
      }

      // ---- hill shading -------------------------------------------------
      const zx = (zBuf[k + 1] - zBuf[k - 1]) * inv2;
      const zy = (zBuf[k + P] - zBuf[k - P]) * inv2;
      let shade = (-zx * lx - zy * ly + lz) / (Math.sqrt(zx * zx + zy * zy + 1) * lz);
      shade = 1 + (shade - 1) * RELIEF.strength;
      if (shade < RELIEF.min) shade = RELIEF.min;
      else if (shade > RELIEF.max) shade = RELIEF.max;
      r *= shade;
      g *= shade;
      b *= shade;

      // ---- beach --------------------------------------------------------
      const beachW = 6 + 30 * smoothstep(0.05, 0.6, beachNoise(wx / 900, wy / 900));
      if (dist < beachW) {
        const sand = 1 - smoothstep(beachW * 0.5, beachW, dist);
        const dry = smoothstep(0, 7, dist);
        const sr = LAND.sandWet[0] + (LAND.sandDry[0] - LAND.sandWet[0]) * dry;
        const sg = LAND.sandWet[1] + (LAND.sandDry[1] - LAND.sandWet[1]) * dry;
        const sb = LAND.sandWet[2] + (LAND.sandDry[2] - LAND.sandWet[2]) * dry;
        r += (sr - r) * sand;
        g += (sg - g) * sand;
        b += (sb - b) * sand;
      }

      pixels[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      pixels[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      pixels[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
  return pixels;
}
