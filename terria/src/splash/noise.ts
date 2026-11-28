/**
 * A small tileable noise texture for the splash shaders: four independent
 * smooth channels (R, G large and soft; B, A finer). Built in a few
 * milliseconds at start-up, so it costs no download.
 */
import { BufferImageSource } from 'pixi.js';

const SIZE = 128;

function lattice(cells: number, seed: number): Float32Array {
  // xorshift: cosmetic only, any decent sequence will do
  let s = seed | 0 || 1;
  const out = new Float32Array(cells * cells);
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = (s >>> 0) / 4294967296;
  }
  return out;
}

/** One octave of periodic value noise, smoothly interpolated. */
function octave(out: Float32Array, cells: number, seed: number, weight: number): void {
  const g = lattice(cells, seed);
  const step = cells / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cells) * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < SIZE; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells;
      const c1 = (x0 + 1) % cells;
      const top = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
      const bottom = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
      out[y * SIZE + x] += (top + (bottom - top) * sy) * weight;
    }
  }
}

function channel(seed: number, cells: readonly number[]): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let weight = 1;
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    octave(out, cells[i], seed + i * 7919, weight);
    total += weight;
    weight *= 0.5;
  }
  // stretch to the full 0..1 range so thresholds in the shaders are predictable
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < lo) lo = out[i];
    if (out[i] > hi) hi = out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

export function createNoiseTexture(): BufferImageSource {
  const channels = [
    channel(0x1f2e3d, [4, 8, 16]),
    channel(0x5a17c3, [4, 8, 16]),
    channel(0x9b03f1, [8, 16, 32]),
    channel(0x3c6ef3, [16, 32, 64]),
  ];
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 4; c++) pixels[i * 4 + c] = Math.round(channels[c][i] * 255);
  }
  return new BufferImageSource({
    resource: pixels,
    width: SIZE,
    height: SIZE,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
    addressMode: 'repeat',
    scaleMode: 'linear',
    label: 'splash-noise',
  });
}
