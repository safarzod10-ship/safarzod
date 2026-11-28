/**
 * Fields that are too detailed for a world-sized grid and are therefore
 * evaluated directly from seeded noise wherever they are needed (chunk baker,
 * tree placement, queries). Pure and deterministic.
 */
import type { Noise2D } from './noise.ts';

/** Hill wavelengths (wu), largest first; each octave has RELIEF_GAIN of the previous amplitude. */
export const RELIEF_WAVELENGTHS: readonly number[] = [12000, 5450, 2480, 1127, 512, 233, 106];
const RELIEF_GAIN = 0.42; // < 1 / 2.2, so finer hills are also gentler
let reliefNorm = 0;
for (let k = 0; k < RELIEF_WAVELENGTHS.length; k++) reliefNorm += RELIEF_GAIN ** k;
const RELIEF_NORM = reliefNorm;

/**
 * Gentle rolling relief, roughly in [-0.7, 0.7].
 * @param minWavelength octaves shorter than this are skipped (a coarse LOD
 *        cannot represent them; a subset is still the same landscape)
 */
export function reliefValue(noise: Noise2D, x: number, y: number, minWavelength: number): number {
  let sum = 0;
  let amp = 1;
  for (let k = 0; k < RELIEF_WAVELENGTHS.length; k++) {
    const w = RELIEF_WAVELENGTHS[k];
    if (w < minWavelength) break;
    sum += amp * noise(x / w + k * 19.31, y / w - k * 7.77);
    amp *= RELIEF_GAIN;
  }
  return sum / RELIEF_NORM;
}

/**
 * Tree cover 0..1 at a point. Above ~0.5 the ground is wooded.
 *
 *   regional  slow field from the world grid: where the big forests and the
 *             open plains are (tens of km)
 *   + groves  1-3 km clumps that ragged the forest edges and scatter woods
 *             across the in-between country
 *   + fine    ~400 m texture (skipped on LODs too coarse to show it)
 */
export function forestValue(regional: number, noise: Noise2D, x: number, y: number, texel: number): number {
  let v = regional + 0.42 * (0.62 * noise(x / 2600, y / 2600) + 0.38 * noise(x / 1100 + 40.3, y / 1100 - 17.9));
  if (texel <= 64) v += 0.16 * noise(x / 420 - 9.1, y / 420 + 3.3);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
