/**
 * Bakes one terrain chunk into an RGBA8 texture. Pure function of the world:
 * runs identically in the worker, on the main thread and in tests.
 *
 *   RGB  final albedo: land (grass, meadows, forest, sand, hill shading) or
 *        water (depth-dependent sea / lake colour, rivers).
 *   A    signed distance to the nearest waterline, in units of the LOD's
 *        `band`: 0.5 = shore, 1 = `band` wu inland, 0 = `band` wu out on the
 *        water. The shader thresholds it, so shores stay crisp at any zoom.
 *
 * Texels sit on chunk-shared edges (node i at origin + i * texel), which makes
 * neighbouring chunks agree exactly along their border.
 */
import { CANOPY_MAX_LEVEL, CHUNK_NODES, FINEST_LEVEL, LODS } from '../../core/config.ts';
import { smoothstep } from '../../core/math.ts';
import { hash2 } from '../../core/rng.ts';
import { RIVER_GRADIENT } from '../generation/rivers.ts';
import type { WorldFields } from '../generation/WorldFields.ts';
import { OCEAN, oceanColor } from '../ocean/oceanPalette.ts';
import { LAND, RELIEF } from './palette.ts';

const N = CHUNK_NODES;
const P = N + 2; // one texel of padding for central differences

const eBuf = new Float32Array(P * P);
const zBuf = new Float32Array(P * P);
const reliefBuf = new Float32Array(P * P);
const forestBuf = new Float32Array(P * P);
const moistBuf = new Float32Array(P * P);
const meadowBuf = new Float32Array(P * P);
const riverBuf = new Float32Array(P * P);

/** Depth (wu) and reach (wu) of the small bank cut by a river. */
const RIVER_BANK_DROP = 3;
const RIVER_BANK_REACH = 14;

/** Texels per side of the tiles used to cull river segments. */
const TILE = 16;
const TILES = Math.ceil(P / TILE);

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

  let hasRivers = false;
  if (anyNearLand) {
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

    hasRivers = applyRivers(world, ox, oy, step);
    yield;

    // Elevation for hill shading: rolling relief that sinks to the waterline.
    for (let j = 0; j < P; j++) {
      const y = oy + j * step;
      for (let i = 0; i < P; i++) {
        const k = j * P + i;
        const e = eBuf[k];
        if (e > 0) {
          const r = world.reliefAt(ox + i * step, y, step);
          reliefBuf[k] = r;
          let z = RELIEF.height * r * smoothstep(0, RELIEF.riseE, e) + RELIEF.bank * smoothstep(0, RELIEF.bankE, e);
          // a river only cuts a small bank into the hills it crosses
          if (hasRivers && riverBuf[k] < RIVER_BANK_REACH) z -= RIVER_BANK_DROP * (1 - smoothstep(0, RIVER_BANK_REACH, riverBuf[k]));
          zBuf[k] = z;
        } else {
          reliefBuf[k] = 0;
          zBuf[k] = 0;
        }
      }
      if ((j & 63) === 63) yield;
    }
  }

  const band = lod.band;
  const inv2 = 1 / (2 * step);
  const shoreLen = Math.max(10, 2.2 * step);
  const riverShore = 1.2 + step * 0.05;
  const [lx, ly, lz] = RELIEF.light;
  const colorNoise = world.colorNoise;
  const beachNoise = world.beachNoise;
  const groveNoise = world.groveNoise;
  const canopyMode = level <= CANOPY_MAX_LEVEL;
  const flowers = level >= FINEST_LEVEL;
  const seed = world.decoSeed;
  const texelsPerWorld = 1 / step;

  for (let j = 0; j < N; j++) {
    if ((j & 31) === 31) yield;
    const wy = oy + (j + 1) * step;
    for (let i = 0; i < N; i++) {
      const k = (j + 1) * P + (i + 1);
      const o = (j * N + i) * 4;
      const eCoast = eBuf[k];

      // Distance to the nearest waterline (wu), + on land: the nearer of the
      // coast / lake shore (first-order estimate from the coast function) and
      // the river bank (exact).
      const ex = (eBuf[k + 1] - eBuf[k - 1]) * inv2;
      const ey = (eBuf[k + P] - eBuf[k - P]) * inv2;
      let grad = Math.sqrt(ex * ex + ey * ey);
      if (grad < 2e-6) grad = 2e-6;
      let dist = eCoast / grad;
      let e = eCoast;
      let byRiver = false;
      if (hasRivers && riverBuf[k] < dist) {
        dist = riverBuf[k];
        byRiver = true;
        const re = dist * RIVER_GRADIENT;
        if (re < e) e = re;
      }

      let sdf = dist / band;
      if (sdf > 1) sdf = 1;
      else if (sdf < -1) sdf = -1;
      pixels[o + 3] = Math.round(127.5 + 127.5 * sdf);

      if (e <= 0) {
        if (byRiver) {
          const t = smoothstep(0, riverShore, -dist);
          pixels[o] = OCEAN.wetSand[0] + (OCEAN.river[0] - OCEAN.wetSand[0]) * t;
          pixels[o + 1] = OCEAN.wetSand[1] + (OCEAN.river[1] - OCEAN.wetSand[1]) * t;
          pixels[o + 2] = OCEAN.wetSand[2] + (OCEAN.river[2] - OCEAN.wetSand[2]) * t;
        } else {
          const c = oceanColor(-e, -dist, shoreLen);
          pixels[o] = c[0];
          pixels[o + 1] = c[1];
          pixels[o + 2] = c[2];
        }
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

      // ---- soft, non-repeating colour mottling (octaves the LOD can show) -
      let cloud = 0.5 * colorNoise(wx / 2400, wy / 2400) + 0.5 * colorNoise(wx / 640 + 7.7, wy / 640 - 3.1);
      if (step <= 32) cloud = cloud * 0.6 + 0.4 * colorNoise(wx / 190, wy / 190);
      if (step <= 8) cloud = cloud * 0.72 + 0.28 * colorNoise(wx / 61 + 31.7, wy / 61 - 12.3);
      const relief = reliefBuf[k];
      const tone = (1 + 0.06 * relief) * (1 + 0.055 * cloud);
      r = r * tone + 5 * cloud;
      g = g * tone;
      b = b * tone - 3 * cloud;

      // ---- forests and groves -------------------------------------------
      const regional = forestBuf[k];
      let f = 0;
      if (regional > -0.4) {
        // tree cover: regional forests + local groves (see procedural.ts)
        let v = regional + 0.42 * (0.62 * groveNoise(wx / 2600, wy / 2600) + 0.38 * groveNoise(wx / 1100 + 40.3, wy / 1100 - 17.9));
        if (step <= 64) v += 0.16 * groveNoise(wx / 420 - 9.1, wy / 420 + 3.3);
        f = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      if (f > 0.3) {
        if (canopyMode) {
          // Far view: tree sprites are not drawn, the woods are painted in.
          // p mirrors the placement probability of real trees, so painted and
          // sprite forests thin out in the same places.
          const hh = hash2(Math.round(wx * texelsPerWorld), Math.round(wy * texelsPerWorld), seed);
          const h = (hh & 0xffff) / 65535;
          const p = smoothstep(0.44, 0.74, f) * 0.9;
          let t: number;
          if (step <= 16) {
            // about one tree per texel: each texel is a crown or a gap
            t = h < p ? 0.72 + 0.26 * ((hh >>> 16) / 65535) : 0.22 * p;
          } else {
            t = p * (0.74 + 0.22 * h);
          }
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

      // ---- beach / river bank -------------------------------------------
      const beachW = byRiver ? 3.5 : 8 + 62 * smoothstep(0.05, 0.6, beachNoise(wx / 5200, wy / 5200));
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

/**
 * Find the rivers near the chunk being baked: fills riverBuf with the signed
 * distance (wu) to the nearest river bank, Infinity where none is close.
 *
 * Coarse LODs draw rivers wider than they are, and leave out the smallest
 * streams, so the river system stays readable from far away.
 */
function applyRivers(world: WorldFields, ox: number, oy: number, step: number): boolean {
  const rivers = world.rivers;
  if (rivers.count === 0) return false;
  const minHalf = step >= 8 ? step : 0;
  const include = step >= 128 ? 11 : step >= 64 ? 8 : 0;
  const radius = Math.max(64, 4 * step);
  const span = (P - 1) * step;
  const candidates = rivers.collect(ox, oy, ox + span, oy + span, radius + minHalf);
  if (candidates.length === 0) return false;

  const tiles: number[][] = [];
  for (let t = 0; t < TILES * TILES; t++) tiles.push([]);
  const s = rivers.segments;
  let any = false;
  for (const i of candidates) {
    const w = rivers.segmentWidth(i);
    if (w < include) continue;
    const pad = radius + (w > minHalf ? w : minHalf);
    const o = i * 6;
    const x0 = Math.min(s[o], s[o + 3]) - pad;
    const x1 = Math.max(s[o], s[o + 3]) + pad;
    const y0 = Math.min(s[o + 1], s[o + 4]) - pad;
    const y1 = Math.max(s[o + 1], s[o + 4]) + pad;
    const tx0 = Math.max(0, Math.floor((x0 - ox) / step / TILE));
    const tx1 = Math.min(TILES - 1, Math.floor((x1 - ox) / step / TILE));
    const ty0 = Math.max(0, Math.floor((y0 - oy) / step / TILE));
    const ty1 = Math.min(TILES - 1, Math.floor((y1 - oy) / step / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        tiles[ty * TILES + tx].push(i);
        any = true;
      }
    }
  }
  if (!any) return false;

  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      const list = tiles[ty * TILES + tx];
      const j1 = Math.min(P, (ty + 1) * TILE);
      const i1 = Math.min(P, (tx + 1) * TILE);
      for (let j = ty * TILE; j < j1; j++) {
        const y = oy + j * step;
        for (let i = tx * TILE; i < i1; i++) {
          const k = j * P + i;
          if (list.length === 0) {
            riverBuf[k] = Infinity;
            continue;
          }
          const x = ox + i * step;
          let best = Infinity;
          for (let q = 0; q < list.length; q++) {
            const sd = rivers.segmentSd(list[q], x, y, minHalf);
            if (sd < best) best = sd;
          }
          riverBuf[k] = best < radius ? best : Infinity;
        }
      }
    }
  }
  return true;
}
