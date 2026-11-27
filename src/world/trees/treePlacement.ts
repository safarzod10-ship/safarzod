/**
 * Deterministic tree placement for one tree chunk. Pure: depends only on the
 * world fields, so every client sees the same trees in the same places and a
 * future building system can query / clear them by position.
 */
import { TREES } from '../../core/config.ts';
import { smoothstep } from '../../core/math.ts';
import { hash2 } from '../../core/rng.ts';
import type { WorldFields } from '../generation/WorldFields.ts';

export const TREE_VARIANTS = 4;
/** Floats per tree in the packed result: x, y, size, variant, shade. */
export const TREE_STRIDE = 5;

/** Probability of a lone tree per placement cell: anywhere / near woods. */
const SOLITARY = 0.0012;
const OUTLIER = 0.035;
/** Trees keep off beaches and river banks. */
const MIN_E = 0.006;

/**
 * @returns packed Float32Array [x, y, size(wu, canopy diameter), variant, shade]*
 *          sorted by y so later trees overlap earlier ones.
 */
export function placeTrees(world: WorldFields, cx: number, cy: number): Float32Array {
  const size = TREES.chunkSize;
  const s = TREES.spacing;
  const seed = world.params.seed;
  const x0 = cx * size;
  const y0 = cy * size;
  const gx0 = Math.floor(x0 / s);
  const gx1 = Math.ceil((x0 + size) / s);
  const gy0 = Math.floor(y0 / s);
  const gy1 = Math.ceil((y0 + size) / s);
  const out: number[] = [];

  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const h1 = hash2(gx, gy, seed ^ 0x1f3d5b79);
      const x = (gx + 0.12 + 0.76 * ((h1 & 0xffff) / 65536)) * s;
      const y = (gy + 0.12 + 0.76 * ((h1 >>> 16) / 65536)) * s;
      if (x < x0 || x >= x0 + size || y < y0 || y >= y0 + size) continue;

      const h2 = hash2(gx, gy, seed ^ 0x7ed55d16);
      const roll = (h2 & 0xffff) / 65536;
      const density = world.forestAt(x, y);
      const lone = SOLITARY + OUTLIER * smoothstep(0.24, 0.44, density);
      const p = smoothstep(0.44, 0.74, density) * 0.92 + lone;
      if (roll >= p) continue;
      if (world.coastValue(x, y) < MIN_E) continue;

      const h3 = hash2(gx, gy, seed ^ 0x2545f491);
      const grove = roll >= lone ? 1 : 0;
      // lone trees are a little larger and rounder
      const diameter = (grove ? 12.5 : 16) + 8.5 * ((h3 & 0xff) / 255);
      const variant = (h3 >>> 8) % TREE_VARIANTS;
      const shade = 0.86 + 0.14 * (((h3 >>> 16) & 0xff) / 255);
      out.push(x, y, diameter, variant, shade);
    }
  }

  // sort by y (stable, deterministic)
  const count = out.length / TREE_STRIDE;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => out[a * TREE_STRIDE + 1] - out[b * TREE_STRIDE + 1] || a - b);
  const packed = new Float32Array(out.length);
  for (let i = 0; i < count; i++) {
    const src = order[i] * TREE_STRIDE;
    for (let k = 0; k < TREE_STRIDE; k++) packed[i * TREE_STRIDE + k] = out[src + k];
  }
  return packed;
}
