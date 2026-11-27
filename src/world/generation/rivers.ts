/**
 * River network as geometry: a list of segments with a half-width at each
 * end, plus a spatial hash for fast "how far is the nearest river bank"
 * queries. Rivers are too narrow for the world grid, so they are applied
 * analytically wherever terrain is evaluated (baker, queries, tree placement).
 */
import { WORLD_SIZE } from '../../core/config.ts';

/** Floats per segment: x0, y0, halfWidth0, x1, y1, halfWidth1. */
export const RIVER_STRIDE = 6;
/** Converts distance from a river bank (wu) into coast-function units. */
export const RIVER_GRADIENT = 8e-4;
/** Default search radius (wu) for point queries. */
export const RIVER_QUERY_RADIUS = 64;

const CELL = 512;
const CELLS = WORLD_SIZE / CELL;

export class RiverNetwork {
  readonly segments: Float32Array;
  readonly count: number;
  readonly maxHalfWidth: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;

  constructor(segments: Float32Array) {
    this.segments = segments;
    this.count = segments.length / RIVER_STRIDE;
    let maxW = 0;
    const counts = new Int32Array(CELLS * CELLS + 1);
    const each = (visit: (cell: number, seg: number) => void): void => {
      for (let i = 0; i < this.count; i++) {
        const o = i * RIVER_STRIDE;
        const x0 = segments[o];
        const y0 = segments[o + 1];
        const x1 = segments[o + 3];
        const y1 = segments[o + 4];
        const cx0 = clampCell(Math.floor(Math.min(x0, x1) / CELL));
        const cx1 = clampCell(Math.floor(Math.max(x0, x1) / CELL));
        const cy0 = clampCell(Math.floor(Math.min(y0, y1) / CELL));
        const cy1 = clampCell(Math.floor(Math.max(y0, y1) / CELL));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) visit(cy * CELLS + cx, i);
      }
    };
    for (let i = 0; i < this.count; i++) {
      const o = i * RIVER_STRIDE;
      if (segments[o + 2] > maxW) maxW = segments[o + 2];
      if (segments[o + 5] > maxW) maxW = segments[o + 5];
    }
    this.maxHalfWidth = maxW;
    each((cell) => counts[cell + 1]++);
    for (let c = 0; c < CELLS * CELLS; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[CELLS * CELLS]);
    const fill = counts.slice(0, CELLS * CELLS);
    each((cell, seg) => {
      this.cellItems[fill[cell]++] = seg;
    });
  }

  /**
   * Signed distance (wu) from a point to the bank of one segment: negative in
   * the water. `minHalfWidth` widens thin rivers (used by coarse LODs so a
   * river stays visible from far away).
   */
  segmentSd(i: number, x: number, y: number, minHalfWidth: number): number {
    const s = this.segments;
    const o = i * RIVER_STRIDE;
    const ax = s[o];
    const ay = s[o + 1];
    const bx = s[o + 3] - ax;
    const by = s[o + 4] - ay;
    const px = x - ax;
    const py = y - ay;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = px - bx * t;
    const dy = py - by * t;
    let w = s[o + 2] + (s[o + 5] - s[o + 2]) * t;
    if (w < minHalfWidth) w = minHalfWidth;
    return Math.sqrt(dx * dx + dy * dy) - w;
  }

  /** Larger of the two end half-widths of a segment. */
  segmentWidth(i: number): number {
    const o = i * RIVER_STRIDE;
    const a = this.segments[o + 2];
    const b = this.segments[o + 5];
    return a > b ? a : b;
  }

  /**
   * Signed distance (wu) to the nearest river bank within `radius`;
   * +Infinity when no river is that close.
   */
  sdAt(x: number, y: number, radius: number = RIVER_QUERY_RADIUS): number {
    if (this.count === 0) return Infinity;
    const reach = radius + this.maxHalfWidth;
    const cx0 = clampCell(Math.floor((x - reach) / CELL));
    const cx1 = clampCell(Math.floor((x + reach) / CELL));
    const cy0 = clampCell(Math.floor((y - reach) / CELL));
    const cy1 = clampCell(Math.floor((y + reach) / CELL));
    let best = Infinity;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * CELLS + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const sd = this.segmentSd(this.cellItems[k], x, y, 0);
          if (sd < best) best = sd;
        }
      }
    }
    return best <= radius ? best : Infinity;
  }

  /**
   * Indices of all segments that may come within `pad` of a rectangle.
   * May contain duplicates-free results (deduplicated).
   */
  collect(x0: number, y0: number, x1: number, y1: number, pad: number): number[] {
    const out: number[] = [];
    if (this.count === 0) return out;
    const reach = pad + this.maxHalfWidth;
    const cx0 = clampCell(Math.floor((x0 - reach) / CELL));
    const cx1 = clampCell(Math.floor((x1 + reach) / CELL));
    const cy0 = clampCell(Math.floor((y0 - reach) / CELL));
    const cy1 = clampCell(Math.floor((y1 + reach) / CELL));
    const seen = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cy * CELLS + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const i = this.cellItems[k];
          if (!seen.has(i)) {
            seen.add(i);
            out.push(i);
          }
        }
      }
    }
    return out;
  }

  /** Total length of all river segments, wu. */
  totalLength(): number {
    let sum = 0;
    const s = this.segments;
    for (let o = 0; o < s.length; o += RIVER_STRIDE) {
      const dx = s[o + 3] - s[o];
      const dy = s[o + 4] - s[o + 1];
      sum += Math.sqrt(dx * dx + dy * dy);
    }
    return sum;
  }
}

function clampCell(c: number): number {
  return c < 0 ? 0 : c >= CELLS ? CELLS - 1 : c;
}
