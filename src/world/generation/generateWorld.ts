import { CAMERA, FOG, GRID_CELL, GRID_NODES, WORLD_CENTER } from '../../core/config.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { mulberry32, subSeed } from '../../core/rng.ts';
import { fbm, makeNoise } from './noise.ts';
import {
  BUILDABLE_E,
  COARSE_NODES,
  COARSE_SPACING,
  RELIEF_NODES,
  RELIEF_SPACING,
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
 * Only IEEE-exact operations (+ - * / sqrt) and integer hashing are used, so a
 * seed yields the same map on every device.
 *
 * Implemented as a generator so the caller can spread the work over frames
 * (main-thread fallback) or run it straight through (worker). Yields progress
 * in [0, 1] and returns the finished fields.
 */

interface Lobe {
  x: number;
  y: number;
  /** 1 / r^2 */
  invR2: number;
  w: number;
}

/** Noise coordinates are world units divided by this (keeps features round). */
const NOISE_SCALE = 5000;
const LAND_THRESHOLD = 0.3;
/** Land cannot exist beyond this normalised radius of the ellipse. */
export const LAND_LIMIT = 1.08;
/** Islands are pushed to this e (a shoal), enclosed water is raised to land. */
const ISLAND_SINK = -0.07;
const LAKE_FILL = 0.035;

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
  const forestNoise = makeNoise(seed, 'forest');
  const regionNoise = makeNoise(seed, 'forest-region');
  const moistNoise = makeNoise(seed, 'moisture');
  const meadowNoise = makeNoise(seed, 'meadow');

  const n = GRID_NODES;
  const e = new Float32Array(n * n);
  const sx = NOISE_SCALE / params.radiusX;
  const sy = NOISE_SCALE / params.radiusY;

  // ---- 1. coast function on the base grid -------------------------------
  for (let j = 0; j < n; j++) {
    const ny = (j * GRID_CELL - WORLD_CENTER) / NOISE_SCALE;
    for (let i = 0; i < n; i++) {
      const nx = (i * GRID_CELL - WORLD_CENTER) / NOISE_SCALE;
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
      const rough = fbm(coast, px * 1.35, py * 1.35, 6, 2, 0.54);
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
    if ((j & 31) === 31) yield 0.62 * (j / n);
  }

  // ---- 2. one continent: sink islands, fill enclosed water ---------------
  enforceSingleContinent(e, n);
  yield 0.68;

  // ---- 3. secondary fields ----------------------------------------------
  const relief = new Float32Array(RELIEF_NODES * RELIEF_NODES);
  const forest = new Float32Array(RELIEF_NODES * RELIEF_NODES);
  const forestBias = (params.forest - 0.5) * 0.5;
  for (let j = 0; j < RELIEF_NODES; j++) {
    const y = j * RELIEF_SPACING;
    for (let i = 0; i < RELIEF_NODES; i++) {
      const x = i * RELIEF_SPACING;
      relief[j * RELIEF_NODES + i] = fbm(reliefNoise, x / 2100, y / 2100, 4);
      const groves = fbm(forestNoise, x / 620, y / 620, 3);
      const region = fbm(regionNoise, x / 3200, y / 3200, 2);
      const lowRegion = region + 0.05 < 0 ? region + 0.05 : 0;
      forest[j * RELIEF_NODES + i] = clamp01(0.5 + (groves - 0.47) * 2.6 + lowRegion * 2.2 + forestBias);
    }
    if ((j & 63) === 63) yield 0.68 + 0.2 * (j / RELIEF_NODES);
  }

  const moist = new Float32Array(COARSE_NODES * COARSE_NODES);
  const meadow = new Float32Array(COARSE_NODES * COARSE_NODES);
  for (let j = 0; j < COARSE_NODES; j++) {
    const y = j * COARSE_SPACING;
    for (let i = 0; i < COARSE_NODES; i++) {
      const x = i * COARSE_SPACING;
      moist[j * COARSE_NODES + i] = clamp01(0.5 + 0.85 * fbm(moistNoise, x / 4200, y / 4200, 3));
      meadow[j * COARSE_NODES + i] = clamp01(0.5 + 0.9 * fbm(meadowNoise, x / 1300, y / 1300, 2));
    }
  }
  yield 0.92;

  // ---- 4. distance from land (for the fog) and summary -------------------
  const coastDist = distanceFromLand(e, n);
  const meta = summarize(params, e, forest, n, now() - t0);
  yield 1;

  return new WorldFields({ params, meta, e, relief, forest, moist, meadow, coastDist });
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
 *  - water not connected to the world border is a lake -> raised to land;
 *  - every land component except the largest is an island -> sunk to a shoal.
 */
function enforceSingleContinent(e: Float32Array, n: number): void {
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
  // Lakes -> land.
  for (let k = 0; k < total; k++) {
    if (label[k] === 0 && !(e[k] > 0)) e[k] = LAKE_FILL;
  }
  // Land components.
  let nextId = 2;
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
  for (let k = 0; k < total; k++) {
    if (label[k] !== OCEAN && label[k] !== bestId) e[k] = ISLAND_SINK;
  }
}

/** Two-pass chamfer distance transform on a coarse grid; result in wu. */
function distanceFromLand(e: Float32Array, n: number): Float32Array {
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
          if (e[jj * n + ii] > 0) {
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
  const rim = 800;
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
  forest: Float32Array,
  n: number,
  generationMs: number,
): WorldMeta {
  let minX = n;
  let minY = n;
  let maxX = -1;
  let maxY = -1;
  let land = 0;
  let buildable = 0;
  let wooded = 0;
  const fr = (RELIEF_NODES - 1) / (n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = e[j * n + i];
      if (v > 0) {
        land++;
        if (i < minX) minX = i;
        if (i > maxX) maxX = i;
        if (j < minY) minY = j;
        if (j > maxY) maxY = j;
        const f = forest[Math.round(j * fr) * RELIEF_NODES + Math.round(i * fr)];
        if (f > WOODED_DENSITY) wooded++;
        else if (v > BUILDABLE_E) buildable++;
      }
    }
  }
  const landBounds = {
    x: minX * GRID_CELL,
    y: minY * GRID_CELL,
    width: (maxX - minX) * GRID_CELL,
    height: (maxY - minY) * GRID_CELL,
  };
  const m = CAMERA.fitMargin;
  const cameraBounds = {
    x: landBounds.x - m,
    y: landBounds.y - m,
    width: landBounds.width + 2 * m,
    height: landBounds.height + 2 * m,
  };
  return {
    params,
    landBounds,
    cameraBounds,
    landArea: land * GRID_CELL * GRID_CELL,
    landFraction: land / (n * n),
    buildableFraction: land > 0 ? buildable / land : 0,
    forestFraction: land > 0 ? wooded / land : 0,
    generationMs,
  };
}
