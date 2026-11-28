/**
 * Player regions: the land is divided into REGION_COUNT compact territories
 * of nearly equal area (a centroidal Voronoi diagram restricted to land).
 *
 *  - buildRegions()  pure + deterministic, runs inside world generation
 *  - RegionIndex     lookup structure for the running game (which region is
 *                    this point in, its outline, its starter plot)
 *
 * Who owns which region is game state and does NOT live here.
 */
import { Delaunay } from 'd3-delaunay';
import { BASE_SPACING, GRID_CELL, STARTER_PLOT_SHARE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { mulberry32, subSeed } from '../../core/rng.ts';

/** Floats per border piece: x0, y0, x1, y1, distance along its edge, regionA, regionB. */
export const BORDER_STRIDE = 7;

export interface RegionsRaw {
  /** x, y of each region's Voronoi generator: a point belongs to the nearest one. */
  sites: Float32Array;
  /** x, y of each region's home point: dry buildable land near its centre. */
  homes: Float32Array;
  /** Land area of each region, wu^2. */
  areas: Float32Array;
  /** Region borders clipped to land, see BORDER_STRIDE. */
  borders: Float32Array;
  /** Rectangle the Voronoi cells are clipped to. */
  bounds: Rect;
}

const LLOYD_ITERATIONS = 45;

/**
 * @param e            base coast grid (n x n), land where > 0
 * @param isGoodSite   true where a region's home point may sit (dry, away
 *                     from water)
 * @param landValue    smooth coast function, used to clip borders to land
 */
export function buildRegions(
  seed: number,
  count: number,
  e: Float32Array,
  n: number,
  bounds: Rect,
  isGoodSite: (x: number, y: number) => boolean,
  landValue: (x: number, y: number) => number,
): RegionsRaw {
  const S = BASE_SPACING;
  const rng = mulberry32(subSeed(seed, 'regions'));

  // land samples on every second node are plenty for relaxation
  const lx: number[] = [];
  const ly: number[] = [];
  for (let j = 0; j < n; j += 2) {
    for (let i = 0; i < n; i += 2) {
      if (e[j * n + i] > 0.004) {
        lx.push(i * S);
        ly.push(j * S);
      }
    }
  }
  const samples = lx.length;
  if (samples < count) throw new Error('not enough land for the requested number of regions');

  // initial sites: "best candidate" sampling - each new site is the farthest
  // from the existing ones among a handful of random land samples. Starting
  // from an even spread lets the relaxation below converge to equal areas.
  const pts = new Float64Array(count * 2);
  const CANDIDATES = 16;
  for (let c = 0; c < count; c++) {
    let bestK = 0;
    let bestD = -1;
    for (let t = 0; t < (c === 0 ? 1 : CANDIDATES); t++) {
      const k = Math.floor(rng() * samples);
      let d = Infinity;
      for (let q = 0; q < c; q++) {
        const dx = pts[q * 2] - lx[k];
        const dy = pts[q * 2 + 1] - ly[k];
        const dd = dx * dx + dy * dy;
        if (dd < d) d = dd;
      }
      if (d > bestD) {
        bestD = d;
        bestK = k;
      }
    }
    pts[c * 2] = lx[bestK];
    pts[c * 2 + 1] = ly[bestK];
  }

  // Lloyd relaxation: move every site to the centroid of its land
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const cnt = new Int32Array(count);
  for (let iter = 0; iter < LLOYD_ITERATIONS; iter++) {
    const delaunay = new Delaunay(pts);
    sumX.fill(0);
    sumY.fill(0);
    cnt.fill(0);
    let hint = 0;
    for (let k = 0; k < samples; k++) {
      hint = delaunay.find(lx[k], ly[k], hint);
      sumX[hint] += lx[k];
      sumY[hint] += ly[k];
      cnt[hint]++;
    }
    for (let c = 0; c < count; c++) {
      if (cnt[c] > 0) {
        pts[c * 2] = sumX[c] / cnt[c];
        pts[c * 2 + 1] = sumY[c] / cnt[c];
      } else {
        const k = Math.floor(rng() * samples);
        pts[c * 2] = lx[k];
        pts[c * 2 + 1] = ly[k];
      }
    }
  }

  // home point of every region: the land sample of its cell nearest to the
  // centroid that is a good place to start (dry, away from water); falls back
  // to any land sample. The generators themselves stay put, so the areas the
  // relaxation equalised are not disturbed.
  const homes = new Float32Array(count * 2);
  {
    const delaunay = new Delaunay(pts);
    const best = new Int32Array(count).fill(-1);
    const bestD = new Float64Array(count).fill(Infinity);
    const anyBest = new Int32Array(count).fill(-1);
    const anyD = new Float64Array(count).fill(Infinity);
    let hint = 0;
    for (let k = 0; k < samples; k++) {
      hint = delaunay.find(lx[k], ly[k], hint);
      const dx = lx[k] - pts[hint * 2];
      const dy = ly[k] - pts[hint * 2 + 1];
      const d = dx * dx + dy * dy;
      if (d < anyD[hint]) {
        anyD[hint] = d;
        anyBest[hint] = k;
      }
      if (d < bestD[hint] && isGoodSite(lx[k], ly[k])) {
        bestD[hint] = d;
        best[hint] = k;
      }
    }
    for (let c = 0; c < count; c++) {
      const k = best[c] >= 0 ? best[c] : anyBest[c];
      homes[c * 2] = k >= 0 ? lx[k] : pts[c * 2];
      homes[c * 2 + 1] = k >= 0 ? ly[k] : pts[c * 2 + 1];
    }
  }

  // final diagram: areas at full grid resolution
  const delaunay = new Delaunay(pts);
  const areas = new Float32Array(count);
  {
    let hint = 0;
    const cell = S * S;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (e[j * n + i] > 0) {
          hint = delaunay.find(i * S, j * S, hint);
          areas[hint] += cell;
        }
      }
    }
  }

  // borders: one Voronoi edge per pair of neighbouring sites, kept on land
  const voronoi = delaunay.voronoi([bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height]);
  const cc = voronoi.circumcenters;
  const { halfedges, triangles } = delaunay;
  const borders: number[] = [];
  const STEP = 40;
  for (let h = 0; h < halfedges.length; h++) {
    const o = halfedges[h];
    if (o < h) continue; // each pair once; hull edges (o = -1) run out to sea
    const ta = Math.floor(h / 3);
    const tb = Math.floor(o / 3);
    const clipped = clipSegment(cc[ta * 2], cc[ta * 2 + 1], cc[tb * 2], cc[tb * 2 + 1], bounds);
    if (!clipped) continue;
    const [x0, y0, x1, y1] = clipped;
    const a = triangles[h];
    const b = triangles[h % 3 === 2 ? h - 2 : h + 1];
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    if (len < 1) continue;
    const steps = Math.max(1, Math.ceil(len / STEP));
    let runStart = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const onLand = landValue(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) > 0.003;
      if (onLand && runStart < 0) runStart = s;
      if ((!onLand || s === steps) && runStart >= 0) {
        const end = onLand ? s : s - 1;
        if (end > runStart) {
          const t0 = runStart / steps;
          const t1 = end / steps;
          borders.push(
            x0 + (x1 - x0) * t0,
            y0 + (y1 - y0) * t0,
            x0 + (x1 - x0) * t1,
            y0 + (y1 - y0) * t1,
            len * t0,
            a,
            b,
          );
        }
        runStart = -1;
      }
    }
  }

  return { sites: Float32Array.from(pts), homes, areas, borders: new Float32Array(borders), bounds };
}

/** Liang-Barsky clip of a segment to a rectangle. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, r: Rect): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.width - x0, y0 - r.y, r.y + r.height - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

export interface RegionInfo {
  /** 0-based index; show `id + 1` to players. */
  id: number;
  /** Home point of the region, on buildable land. */
  x: number;
  y: number;
  /** Land area, wu^2 (1 wu = 1 m). */
  area: number;
  /** The small square a new player starts with (STARTER_PLOT_SHARE of the area). */
  starterPlot: Rect;
}

/** Runtime lookup over the generated regions. */
export class RegionIndex {
  readonly count: number;
  readonly raw: RegionsRaw;
  private readonly delaunay: Delaunay<Float64Array>;
  private readonly voronoi: ReturnType<Delaunay<Float64Array>['voronoi']>;
  private hint = 0;

  constructor(raw: RegionsRaw) {
    this.raw = raw;
    this.count = raw.sites.length / 2;
    this.delaunay = new Delaunay(Float64Array.from(raw.sites));
    const b = raw.bounds;
    this.voronoi = this.delaunay.voronoi([b.x, b.y, b.x + b.width, b.y + b.height]);
  }

  /** Region a point belongs to (callers check isLand first). */
  regionAt(x: number, y: number): number {
    this.hint = this.delaunay.find(x, y, this.hint);
    return this.hint;
  }

  info(id: number): RegionInfo {
    const x = this.raw.homes[id * 2];
    const y = this.raw.homes[id * 2 + 1];
    const area = this.raw.areas[id];
    const side = Math.max(GRID_CELL, Math.round(Math.sqrt(area * STARTER_PLOT_SHARE) / GRID_CELL) * GRID_CELL);
    const px = Math.round((x - side / 2) / GRID_CELL) * GRID_CELL;
    const py = Math.round((y - side / 2) / GRID_CELL) * GRID_CELL;
    return { id, x, y, area, starterPlot: { x: px, y: py, width: side, height: side } };
  }

  /** Outline of a region as a closed polygon [x0, y0, x1, y1, ...]. */
  polygon(id: number): number[] {
    const poly = this.voronoi.cellPolygon(id);
    const out: number[] = [];
    if (poly) for (const p of poly) out.push(p[0], p[1]);
    return out;
  }

  /** Ids of the regions that share a border with this one. */
  neighbors(id: number): number[] {
    return Array.from(this.voronoi.neighbors(id));
  }
}
