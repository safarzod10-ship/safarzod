/**
 * Deterministic pseudo-random helpers.
 * Only integer math is used, so results are bit-identical on every device.
 */

/** mulberry32: small, fast, good-enough PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent 32-bit seed for a named sub-system. */
export function subSeed(seed: number, label: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

/** Stateless integer hash of a 2D lattice point -> uint32. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** hash2 mapped to [0, 1). */
export function hash2f(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296;
}

/** Parse a user supplied seed (number or arbitrary text) into uint32. */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  return subSeed(0x9e3779b9, trimmed);
}
