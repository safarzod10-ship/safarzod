/**
 * Procedural, seamless detail textures shared by every terrain chunk.
 * Generated once at start-up, so the app ships no image assets at all.
 *
 *  grass  RGB multiplier centred on mid-grey (128 = "no change"): painted
 *         blades, tufts and soft blotches. Tiled over the land by the shader
 *         at two scales, which hides the repetition.
 *  noise  four independent tileable noise channels:
 *         R, G, B  smooth clouds (water ripples, fog, shoreline wobble)
 *         A        fine grain (sand)
 */
import { BufferImageSource } from 'pixi.js';
import { hash2, mulberry32 } from '../../core/rng.ts';

export interface DetailTextures {
  readonly grass: BufferImageSource;
  readonly noise: BufferImageSource;
  destroy(): void;
}

const GRASS_SIZE = 512;
const NOISE_SIZE = 256;

export function createDetailTextures(seed: number): DetailTextures {
  const grass = makeSource(paintGrass(seed), GRASS_SIZE);
  const noise = makeSource(buildNoise(seed), NOISE_SIZE);
  return {
    grass,
    noise,
    destroy() {
      grass.destroy();
      noise.destroy();
    },
  };
}

function makeSource(pixels: Uint8Array, size: number): BufferImageSource {
  return new BufferImageSource({
    resource: pixels,
    width: size,
    height: size,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
    addressMode: 'repeat',
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    autoGenerateMipmaps: true,
  });
}

// --------------------------------------------------------------------------
// Grass: painted with Canvas 2D so it reads as brush work, not as noise.
// --------------------------------------------------------------------------
function paintGrass(seed: number): Uint8Array {
  const S = GRASS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const rnd = mulberry32(seed ^ 0x6a09e667);
  const range = (a: number, b: number): number => a + (b - a) * rnd();

  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, S, S);

  /** Run a draw call at every wrapped position that can touch the tile. */
  const wrapped = (x: number, y: number, reach: number, draw: (x: number, y: number) => void): void => {
    for (let oy = -S; oy <= S; oy += S) {
      for (let ox = -S; ox <= S; ox += S) {
        const px = x + ox;
        const py = y + oy;
        if (px < -reach || px > S + reach || py < -reach || py > S + reach) continue;
        draw(px, py);
      }
    }
  };

  // 1. soft light / dark blotches
  for (let i = 0; i < 150; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = range(16, 58);
    const light = rnd() < 0.5;
    const a = range(0.08, 0.2);
    const col = light ? '178,184,150' : '88,104,92';
    wrapped(x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }

  ctx.lineCap = 'round';
  const blade = (x: number, y: number, len: number, angle: number, width: number, style: string): void => {
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    const bend = (rnd() - 0.5) * len * 0.7;
    const mx = (x + ex) / 2 - Math.sin(angle) * bend;
    const my = (y + ey) / 2 + Math.cos(angle) * bend;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    wrapped(x, y, len + 2, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + mx - x, py + my - y, px + ex - x, py + ey - y);
      ctx.stroke();
    });
  };
  const tone = (lum: number, alpha: number): string => {
    const r = Math.round(lum + range(-8, 12));
    const g = Math.round(lum + 5);
    const b = Math.round(lum - range(4, 20));
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  };

  // 2. loose blades everywhere (mostly pointing "up" the screen)
  for (let i = 0; i < 9000; i++) {
    const lum = 128 + range(-40, 44);
    blade(rnd() * S, rnd() * S, range(3, 7.5), -Math.PI / 2 + range(-1.3, 1.3), range(0.9, 1.6), tone(lum, range(0.22, 0.46)));
  }

  // 3. tufts: a dark base with a fan of lighter blades
  for (let i = 0; i < 300; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rad = range(2.2, 3.6);
    wrapped(x, y, 6, (px, py) => {
      const g = ctx.createRadialGradient(px, py + 1, 0, px, py + 1, rad * 1.8);
      g.addColorStop(0, 'rgba(66,86,72,0.3)');
      g.addColorStop(1, 'rgba(66,86,72,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - rad * 2, py - rad * 2, rad * 4, rad * 4);
    });
    const blades = 7 + Math.floor(rnd() * 5);
    const lum = range(146, 176);
    for (let k = 0; k < blades; k++) {
      blade(x + range(-2.4, 2.4), y + range(-1, 1.5), range(3.5, 7), -Math.PI / 2 + range(-0.6, 0.6), range(0.9, 1.4), tone(lum + range(-16, 16), 0.36));
    }
  }

  // 4. specks: seeds, pebbles, tiny shadows
  for (let i = 0; i < 700; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = range(0.5, 1.2);
    const light = rnd() < 0.4;
    ctx.fillStyle = light ? `rgba(196,204,168,${range(0.14, 0.28)})` : `rgba(74,90,72,${range(0.14, 0.26)})`;
    wrapped(x, y, 2, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // High-pass: remove everything broader than a few world units and re-centre
  // on 128. Large light/dark areas would make the tile repetition visible;
  // broad variation comes from the baked chunk colours instead.
  const data = ctx.getImageData(0, 0, S, S).data;
  const out = new Uint8Array(S * S * 4);
  const plane = new Float32Array(S * S);
  const blurred = new Float32Array(S * S);
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < S * S; k++) plane[k] = data[k * 4 + c];
    blurred.set(plane);
    boxBlurWrap(blurred, S, 22);
    boxBlurWrap(blurred, S, 22);
    for (let k = 0; k < S * S; k++) {
      const v = 128 + (plane[k] - blurred[k]) * 1.05;
      out[k * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  for (let k = 0; k < S * S; k++) out[k * 4 + 3] = 255;
  canvas.width = canvas.height = 0;
  return out;
}

/** Separable box blur with wrap-around (keeps the texture seamless). */
function boxBlurWrap(img: Float32Array, size: number, radius: number): void {
  const tmp = new Float32Array(size);
  const norm = 1 / (2 * radius + 1);
  for (let pass = 0; pass < 2; pass++) {
    const stride = pass === 0 ? 1 : size;
    const lineStride = pass === 0 ? size : 1;
    for (let line = 0; line < size; line++) {
      const base = line * lineStride;
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += img[base + ((i + size) % size) * stride];
      for (let i = 0; i < size; i++) {
        tmp[i] = sum * norm;
        sum += img[base + ((i + radius + 1) % size) * stride] - img[base + ((i - radius + size) % size) * stride];
      }
      for (let i = 0; i < size; i++) img[base + i * stride] = tmp[i];
    }
  }
}

// --------------------------------------------------------------------------
// Tileable gradient noise
// --------------------------------------------------------------------------
const GRAD_X = [1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071];
const GRAD_Y = [0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071];

function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;
  const g00 = hash2(ix0, iy0, seed) & 7;
  const g10 = hash2(ix1, iy0, seed) & 7;
  const g01 = hash2(ix0, iy1, seed) & 7;
  const g11 = hash2(ix1, iy1, seed) & 7;
  const n00 = GRAD_X[g00] * fx + GRAD_Y[g00] * fy;
  const n10 = GRAD_X[g10] * (fx - 1) + GRAD_Y[g10] * fy;
  const n01 = GRAD_X[g01] * fx + GRAD_Y[g01] * (fy - 1);
  const n11 = GRAD_X[g11] * (fx - 1) + GRAD_Y[g11] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

function periodicFbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * p, v * p, p, seed + o * 101);
    amp *= 0.5;
    p *= 2;
  }
  return sum;
}

function buildNoise(seed: number): Uint8Array {
  const S = NOISE_SIZE;
  const channels: { period: number; octaves: number; spread: number }[] = [
    { period: 4, octaves: 5, spread: 0.2 },
    { period: 6, octaves: 4, spread: 0.2 },
    { period: 5, octaves: 4, spread: 0.2 },
    { period: 48, octaves: 2, spread: 0.2 },
  ];
  const out = new Uint8Array(S * S * 4);
  const tmp = new Float32Array(S * S);
  channels.forEach((ch, c) => {
    let mean = 0;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const v = periodicFbm(i / S, j / S, ch.period, ch.octaves, seed + c * 7919);
        tmp[j * S + i] = v;
        mean += v;
      }
    }
    mean /= S * S;
    let variance = 0;
    for (let k = 0; k < S * S; k++) variance += (tmp[k] - mean) * (tmp[k] - mean);
    const std = Math.sqrt(variance / (S * S)) || 1;
    for (let k = 0; k < S * S; k++) {
      const v = 0.5 + ((tmp[k] - mean) / std) * ch.spread;
      out[k * 4 + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  });
  return out;
}
