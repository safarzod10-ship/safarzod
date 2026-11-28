import { BASE_SPACING, CAMERA, FOG, GRID_NODES, REGION_COUNT, WORLD_CENTER } from '../../core/config.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { mulberry32, subSeed } from '../../core/rng.ts';
import { buildRegions, type RegionsRaw } from '../regions/regions.ts';
import { buildHydrology } from './hydrology.ts';
import { fbm, makeNoise } from './noise.ts';
import { forestValue, reliefValue } from './procedural.ts';
import { RiverNetwork } from './rivers.ts';
import { ScalarGrid } from './ScalarGrid.ts';
import {
  BUILDABLE_E,
  COARSE_NODES,
  COARSE_SPACING,
  COAST_BASE_OCTAVES,
  COAST_FREQUENCY,
  COAST_GAIN,
  NOISE_SCALE,
  WOODED_DENSITY,
  WorldFields,
  type WorldMeta,
} from './WorldFields.ts';
import type { WorldParams } from './WorldParams.ts';

/**
 * Deterministic continent generator.
 *
 * Shape = mathematical mask (a handful of smooth lobes inside an ellipse,
 * twisted by a domain warp) + fractal simplex noise for bays and peninsulas.
 * On top of that: lakes and rivers (hydrology.ts) and the division of the land
 * into player regions (regions.ts).
 * Only IEEE-exact operations (+ - * / sqrt) and integer hashing are used, so a
 * seed yields the same map on every device.
 *
 * Implemented as a generator so the caller can spread the work over frames
 * (main-thread fallback) or run it straight through (worker). Yields progress
 * in [0, 1] and returns the finished world.
 */

interface Lobe {
  x: number;
  y: number;
  /** 1 / r^2 */
  invR2: number;
  w: number;
}

const LAND_THRESHOLD = 0.3;
/** Land cannot exist beyond this normalised radius of the ellipse. */
export const LAND_LIMIT = 1.08;
/** Islands are pushed to this e (a shoal); puddles too small to draw are filled. */
const ISLAND_SINK = -0.03;
const POND_FILL = 0.035;
const MIN_POND_NODES = 6;

function buildLobes(params: WorldParams): Lobe[] {
  const rng = mulberry32(subSeed(params.seed, 'lobes'));
  const lobes: Lobe[] = [];
  const add = (x: number, y: number, r: number, w: number): void => {
    lobes.push({ x, y, invR2: 1 / (r * r), w });
  };
  // Rejection-sample a point in the ring [dMin, dMax] that keeps `gap` away
  // from the previously placed lobes of the same kind (indices >= from).
  const place = (dMin: number, dMax: number, gap: number, from: number): { x: number; y: number } | null => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = rng() * 2 - 1;
      const y = rng() * 2 - 1;
      const d2 = x * x + y * y;
      if (d2 < dMin * dMin || d2 > dMax * dMax) continue;
      let ok = true;
      for (let i = from; i < lobes.length; i++) {
        const dx = lobes[i].x - x;
        const dy = lobes[i].y - y;
        if (dx * dx + dy * dy < gap * gap) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
    return null;
  };

  // Core landmass, slightly off-centre.
  add((rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2, 0.94, 1);

  // Large secondary masses that make the outline lopsided.
  const bodies = Math.max(2, params.lobes - 3);
  let from = lobes.length;
  for (let i = 0; i < bodies; i++) {
    const p = place(0.32, 0.64, 0.42, from);
    if (!p) break;
    add(p.x, p.y, 0.38 + rng() * 0.28, 0.6 + rng() * 0.4);
  }
  // Peninsulas: small masses near the rim.
  from = lobes.length;
  for (let i = 0; i < 3; i++) {
    const p = place(0.7, 0.9, 0.5, from);
    if (!p) break;
    add(p.x, p.y, 0.2 + rng() * 0.12, 0.75 + rng() * 0.25);
  }
  // Bays: negative masses biting into the rim.
  from = lobes.length;
  for (let i = 0; i < 4; i++) {
    const p = place(0.62, 0.92, 0.55, from);
    if (!p) break;
    add(p.x, p.y, 0.22 + rng() * 0.2, -(0.5 + rng() * 0.4));
  }
  return lobes;
}

export function* generateWorldSteps(params: WorldParams): Generator<number, WorldFields, void> {
  const t0 = now();
  const seed = params.seed;
  const lobes = buildLobes(params);
  const warpA = makeNoise(seed, 'warp-a');
  const warpB = makeNoise(seed, 'warp-b');
  const coast = makeNoise(seed, 'coast');
  const reliefNoise = makeNoise(seed, 'relief');
  const groveNoise = makeNoise(seed, 'forest-groves');
  const regionNoise = makeNoise(seed, 'forest-region');
  const moistNoise = makeNoise(seed, 'moisture');
  const meadowNoise = makeNoise(seed, 'meadow');
  const lakeNoise = makeNoise(seed, 'lakes');

  const n = GRID_NODES;
  const S = BASE_SPACING;
  const e = new Float32Array(n * n);
  const sx = NOISE_SCALE / params.radiusX;
  const sy = NOISE_SCALE / params.radiusY;

  // ---- 1. coast function on the base grid -------------------------------
  for (let j = 0; j < n; j++) {
    const ny = (j * S - WORLD_CENTER) / NOISE_SCALE;
    for (let i = 0; i < n; i++) {
      const nx = (i * S - WORLD_CENTER) / NOISE_SCALE;
      const px = nx + params.warp * fbm(warpA, nx * 1.25, ny * 1.25, 2);
      const py = ny + params.warp * fbm(warpB, nx * 1.25, ny * 1.25, 2);
      const qx = px * sx;
      const qy = py * sy;
      let shape = 0;
      for (let k = 0; k < lobes.length; k++) {
        const l = lobes[k];
        const dx = qx - l.x;
        const dy = qy - l.y;
        const t = (dx * dx + dy * dy) * l.invR2;
        if (t < 1) {
          const u = 1 - t;
          shape += l.w * u * u * u;
        }
      }
      const rough = fbm(coast, px * COAST_FREQUENCY, py * COAST_FREQUENCY, COAST_BASE_OCTAVES, 2, COAST_GAIN);
      let v = shape - LAND_THRESHOLD + params.coastRoughness * rough;
      // Keep land away from the edge of the world: a soft push-down towards
      // the rim of the ellipse plus a hard cap that crosses zero at r = 1.08.
      const rx = nx * sx;
      const ry = ny * sy;
      const r = Math.sqrt(rx * rx + ry * ry);
      v -= 0.9 * smoothstep(0.82, 1.4, r);
      const cap = 0.8 * (LAND_LIMIT - r);
      if (v > cap) v = cap;
      e[j * n + i] = v;
    }
    if ((j & 31) === 31) yield 0.5 * (j / n);
  }

  // ---- 2. one continent: sink islands, fill puddles ----------------------
  const ocean = enforceSingleContinent(e, n);
  yield 0.54;

  // ---- 3. things that describe the continent as seen from the sea --------
  // (taken before lakes are carved: a lake is not "the sea")
  const coastDist = distanceFromLand(ocean, n);
  const inland = new Float32Array(COARSE_NODES * COARSE_NODES);
  {
    const ratio = (n - 1) / (COARSE_NODES - 1);
    for (let j = 0; j < COARSE_NODES; j++) {
      for (let i = 0; i < COARSE_NODES; i++) {
        const k = j * ratio * n + i * ratio;
        // natural lakes are fresh water too
        inland[j * COARSE_NODES + i] = ocean[k] ? e[k] : Math.max(e[k], 0.12);
      }
    }
  }

  // ---- 4. rivers and lakes ----------------------------------------------
  const hill = (x: number, y: number): number => clamp01(0.5 + 1.5 * reliefValue(reliefNoise, x, y, 2000));
  const hydro = buildHydrology(params, e, n, ocean, hill, lakeNoise);
  const rivers = new RiverNetwork(hydro.rivers);
  // a wobbly lake shore can pinch off a scrap of land: it becomes lake bed
  sinkStrayLand(e, n);
  yield 0.66;

  // ---- 5. slow fields on the coarse grid ---------------------------------
  const forest = new Float32Array(COARSE_NODES * COARSE_NODES);
  const moist = new Float32Array(COARSE_NODES * COARSE_NODES);
  const meadow = new Float32Array(COARSE_NODES * COARSE_NODES);
  const forestBias = (params.forest - 0.5) * 0.8;
  for (let j = 0; j < COARSE_NODES; j++) {
    const y = j * COARSE_SPACING;
    for (let i = 0; i < COARSE_NODES; i++) {
      const x = i * COARSE_SPACING;
      const k = j * COARSE_NODES + i;
      // where the big forests are, and where the open plains
      forest[k] = 0.5 + 1.9 * (fbm(regionNoise, x / 26000, y / 26000, 3) - 0.2) + forestBias;
      moist[k] = clamp01(0.5 + 0.85 * fbm(moistNoise, x / 34000, y / 34000, 3));
      meadow[k] = clamp01(0.5 + 0.9 * fbm(meadowNoise, x / 10400, y / 10400, 2));
    }
  }
  yield 0.72;

  // ---- 6. player regions -------------------------------------------------
  const land = landBounds(e, n);
  const waterDist = distanceToWater(e, n);
  const eGrid = new ScalarGrid(n, S, e);
  const sampleE = (x: number, y: number): number => eGrid.sample(x, y);
  const regionBounds = { x: land.x - 2000, y: land.y - 2000, width: land.width + 4000, height: land.height + 4000 };
  const regions = buildRegions(
    seed,
    REGION_COUNT,
    e,
    n,
    regionBounds,
    (x, y) => waterDist[Math.round(y / S) * n + Math.round(x / S)] >= 4 && rivers.sdAt(x, y, 220) === Infinity,
    (x, y) => {
      const v = sampleE(x, y);
      if (v <= 0) return v;
      const sd = rivers.sdAt(x, y, 8);
      return sd < 0 ? -1 : v;
    },
  );
  yield 0.95;

  // ---- 7. summary --------------------------------------------------------
  const meta = summarize(params, e, n, forest, groveNoise, rivers, hydro.lakes, regions, land, now() - t0);
  yield 1;

  return new WorldFields({
    params,
    meta,
    e,
    forest,
    moist,
    meadow,
    coastDist,
    inland,
    rivers: hydro.rivers,
    lakes: hydro.lakes,
    regions,
  });
}

/** Run the generator to completion (worker / tests / tools). */
export function generateWorld(params: WorldParams, onProgress?: (p: number) => void): WorldFields {
  const it = generateWorldSteps(params);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Flood fill on the base grid (4-connectivity):
 *  - every land component except the largest is an island -> sunk to a shoal;
 *  - enclosed water too small to draw is filled; larger natural lakes stay.
 * @returns mask of the nodes that belong to the ocean
 */
function enforceSingleContinent(e: Float32Array, n: number): Uint8Array {
  const total = n * n;
  const label = new Int32Array(total);
  const queue = new Int32Array(total);

  const flood = (start: number, id: number, land: boolean): number => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % n;
      const cy = (c - cx) / n;
      if (cx > 0) {
        const k = c - 1;
        if (label[k] === 0 && e[k] > 0 === land) {
          label[k] = id;
          queue[tail++] = k;
        }
      }
      if (cx < n - 1) {
        const k = c + 1;
        if (label[k] === 0 && e[k] > 0 === land) {
          label[k] = id;
          queue[tail++] = k;
        }
      }
      if (cy > 0) {
        const k = c - n;
        if (label[k] === 0 && e[k] > 0 === land) {
          label[k] = id;
          queue[tail++] = k;
        }
      }
      if (cy < n - 1) {
        const k = c + n;
        if (label[k] === 0 && e[k] > 0 === land) {
          label[k] = id;
          queue[tail++] = k;
        }
      }
    }
    return tail;
  };

  // Ocean: the world border is always water (guaranteed by the edge falloff).
  const OCEAN = 1;
  flood(0, OCEAN, false);
  let nextId = 2;
  // Enclosed water: keep real lakes, fill puddles.
  for (let k = 0; k < total; k++) {
    if (label[k] === 0 && !(e[k] > 0)) {
      const size = flood(k, nextId, false);
      if (size < MIN_POND_NODES) {
        for (let q = 0; q < size; q++) {
          e[queue[q]] = POND_FILL;
          label[queue[q]] = 0;
        }
      }
      nextId++;
    }
  }
  // Land components.
  const firstLand = nextId;
  let bestId = -1;
  let bestSize = 0;
  for (let k = 0; k < total; k++) {
    if (label[k] === 0) {
      const size = flood(k, nextId, true);
      if (size > bestSize) {
        bestSize = size;
        bestId = nextId;
      }
      nextId++;
    }
  }
  const ocean = new Uint8Array(total);
  for (let k = 0; k < total; k++) {
    if (label[k] >= firstLand && label[k] !== bestId) {
      e[k] = ISLAND_SINK;
      label[k] = OCEAN; // a sunk island is part of the sea
    }
  }
  // Water bodies that only touched a sunk island are sea as well.
  for (let k = 0; k < total; k++) ocean[k] = e[k] > 0 ? 0 : label[k] === OCEAN ? 1 : 0;
  // Re-flood so anything now connected to the ocean is labelled ocean.
  {
    let head = 0;
    let tail = 0;
    for (let k = 0; k < total; k++) if (ocean[k]) queue[tail++] = k;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % n;
      const cy = (c - cx) / n;
      const visit = (k: number): void => {
        if (!ocean[k] && !(e[k] > 0)) {
          ocean[k] = 1;
          queue[tail++] = k;
        }
      };
      if (cx > 0) visit(c - 1);
      if (cx < n - 1) visit(c + 1);
      if (cy > 0) visit(c - n);
      if (cy < n - 1) visit(c + n);
    }
  }
  return ocean;
}

/** Turn every land component except the largest into shallow water. */
function sinkStrayLand(e: Float32Array, n: number): void {
  const total = n * n;
  const label = new Int32Array(total);
  const queue = new Int32Array(total);
  let next = 1;
  let bestId = 0;
  let bestSize = 0;
  for (let start = 0; start < total; start++) {
    if (label[start] !== 0 || !(e[start] > 0)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = next;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % n;
      const cy = (c - cx) / n;
      if (cx > 0 && label[c - 1] === 0 && e[c - 1] > 0) (label[c - 1] = next), (queue[tail++] = c - 1);
      if (cx < n - 1 && label[c + 1] === 0 && e[c + 1] > 0) (label[c + 1] = next), (queue[tail++] = c + 1);
      if (cy > 0 && label[c - n] === 0 && e[c - n] > 0) (label[c - n] = next), (queue[tail++] = c - n);
      if (cy < n - 1 && label[c + n] === 0 && e[c + n] > 0) (label[c + n] = next), (queue[tail++] = c + n);
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestId = next;
    }
    next++;
  }
  if (next <= 2) return;
  for (let k = 0; k < total; k++) {
    if (label[k] !== 0 && label[k] !== bestId) e[k] = -0.012;
  }
}

/** Distance (in grid steps, capped) from each land node to the nearest water. */
function distanceToWater(e: Float32Array, n: number): Uint8Array {
  const total = n * n;
  const dist = new Uint8Array(total).fill(255);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < total; k++) {
    if (!(e[k] > 0)) {
      dist[k] = 0;
      queue[tail++] = k;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    const d = dist[c] + 1;
    if (d > 32) continue;
    const cx = c % n;
    const cy = (c - cx) / n;
    if (cx > 0 && dist[c - 1] === 255) (dist[c - 1] = d), (queue[tail++] = c - 1);
    if (cx < n - 1 && dist[c + 1] === 255) (dist[c + 1] = d), (queue[tail++] = c + 1);
    if (cy > 0 && dist[c - n] === 255) (dist[c - n] = d), (queue[tail++] = c - n);
    if (cy < n - 1 && dist[c + n] === 255) (dist[c + n] = d), (queue[tail++] = c + n);
  }
  return dist;
}

function landBounds(e: Float32Array, n: number): { x: number; y: number; width: number; height: number } {
  let minX = n;
  let minY = n;
  let maxX = -1;
  let maxY = -1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (e[j * n + i] > 0) {
        if (i < minX) minX = i;
        if (i > maxX) maxX = i;
        if (j < minY) minY = j;
        if (j > maxY) maxY = j;
      }
    }
  }
  return {
    x: minX * BASE_SPACING,
    y: minY * BASE_SPACING,
    width: (maxX - minX) * BASE_SPACING,
    height: (maxY - minY) * BASE_SPACING,
  };
}

/**
 * Distance (wu) from the continent - anything that is not ocean - on a coarse
 * grid, by a two-pass chamfer transform.
 */
function distanceFromLand(ocean: Uint8Array, n: number): Float32Array {
  const m = COARSE_NODES;
  const ratio = (n - 1) / (m - 1);
  const dist = new Float32Array(m * m);
  const FAR = 1e9;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      // A coarse node is land if any base node in its neighbourhood is land.
      let land = false;
      const bi = i * ratio;
      const bj = j * ratio;
      for (let dj = -2; dj <= 2 && !land; dj++) {
        const jj = bj + dj;
        if (jj < 0 || jj >= n) continue;
        for (let di = -2; di <= 2; di++) {
          const ii = bi + di;
          if (ii < 0 || ii >= n) continue;
          if (!ocean[jj * n + ii]) {
            land = true;
            break;
          }
        }
      }
      dist[j * m + i] = land ? 0 : FAR;
    }
  }
  const o = COARSE_SPACING;
  const d = COARSE_SPACING * 1.41421356;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const k = j * m + i;
      let v = dist[k];
      if (i > 0 && dist[k - 1] + o < v) v = dist[k - 1] + o;
      if (j > 0) {
        if (dist[k - m] + o < v) v = dist[k - m] + o;
        if (i > 0 && dist[k - m - 1] + d < v) v = dist[k - m - 1] + d;
        if (i < m - 1 && dist[k - m + 1] + d < v) v = dist[k - m + 1] + d;
      }
      dist[k] = v;
    }
  }
  for (let j = m - 1; j >= 0; j--) {
    for (let i = m - 1; i >= 0; i--) {
      const k = j * m + i;
      let v = dist[k];
      if (i < m - 1 && dist[k + 1] + o < v) v = dist[k + 1] + o;
      if (j < m - 1) {
        if (dist[k + m] + o < v) v = dist[k + m] + o;
        if (i < m - 1 && dist[k + m + 1] + d < v) v = dist[k + m + 1] + d;
        if (i > 0 && dist[k + m - 1] + d < v) v = dist[k + m - 1] + d;
      }
      dist[k] = v;
    }
  }
  // Whatever the land looks like, the rim of the world is always deep in fog.
  const rim = 6400;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const border = Math.min(i, j, m - 1 - i, m - 1 - j) * COARSE_SPACING;
      if (border < rim) {
        const forced = FOG.range * (1 - border / rim);
        if (forced > dist[j * m + i]) dist[j * m + i] = forced;
      }
    }
  }
  return dist;
}

function summarize(
  params: WorldParams,
  e: Float32Array,
  n: number,
  forest: Float32Array,
  groveNoise: ReturnType<typeof makeNoise>,
  rivers: RiverNetwork,
  lakes: Float32Array,
  regions: RegionsRaw,
  land: { x: number; y: number; width: number; height: number },
  generationMs: number,
): WorldMeta {
  let landNodes = 0;
  let buildable = 0;
  let sampled = 0;
  let wooded = 0;
  const S = BASE_SPACING;
  const ratio = (COARSE_NODES - 1) / (n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = e[j * n + i];
      if (!(v > 0)) continue;
      landNodes++;
      if (v > BUILDABLE_E) buildable++;
      if ((i & 3) === 0 && (j & 3) === 0) {
        // regional value at the matching coarse node, plus local detail
        const regional = forest[Math.round(j * ratio) * COARSE_NODES + Math.round(i * ratio)];
        sampled++;
        if (forestValue(regional, groveNoise, i * S, j * S, 2) > WOODED_DENSITY) wooded++;
      }
    }
  }
  const m = CAMERA.fitMargin;
  let aMin = Infinity;
  let aMax = 0;
  let aSum = 0;
  for (const a of regions.areas) {
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    aSum += a;
  }
  const count = regions.areas.length;
  return {
    params,
    landBounds: land,
    cameraBounds: { x: land.x - m, y: land.y - m, width: land.width + 2 * m, height: land.height + 2 * m },
    landArea: landNodes * S * S,
    landFraction: landNodes / (n * n),
    buildableFraction: landNodes > 0 ? buildable / landNodes : 0,
    forestFraction: sampled > 0 ? wooded / sampled : 0,
    lakeCount: lakes.length / 3,
    riverLength: rivers.totalLength(),
    regionCount: count,
    regionAreaMin: count ? aMin : 0,
    regionAreaAvg: count ? aSum / count : 0,
    regionAreaMax: aMax,
    generationMs,
  };
}
