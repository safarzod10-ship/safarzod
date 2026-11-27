import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32, subSeed } from '../../core/rng.ts';

export type Noise2D = NoiseFunction2D;

/** Seeded simplex noise in [-1, 1]. Uses only IEEE-exact arithmetic. */
export function makeNoise(seed: number, label: string): Noise2D {
  return createNoise2D(mulberry32(subSeed(seed, label)));
}

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Per-octave offset de-correlates octaves around the origin.
    sum += amp * noise(x * freq + i * 19.31, y * freq - i * 7.77);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
