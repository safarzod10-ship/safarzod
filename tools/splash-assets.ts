/**
 * Builds the loading-splash assets from the two source images:
 *
 *   node tools/splash-assets.ts --world <illustration.png> --logo <logo-on-black.png>
 *        [--out src/splash/assets] [--debug <dir>]
 *
 * World illustration  ->  world.avif + world.webp (same pixels, two codecs)
 * Logo (white on black) is NEVER redrawn: every output is measured from its
 * pixels, so the geometry stays exactly the artist's.
 *   terria-logo.png   the logo cut out of the black background (alpha = luminance)
 *   terria-logo.svg   outline traced at the 50 % luminance contour
 *   splash-data.png   one RGB data atlas (no alpha, so nothing gets premultiplied):
 *     logo field   R  distance to the outline, +-EDGE_RANGE px   (crisp edge at any scale)
 *                  G  which part is nearest: 0..200 the stroke (bar + arc) with the
 *                     order in which the light draws it, 228 the wordmark, 255 the stem
 *                  B  relief: how much a soft bevel along the outline faces the light
 *                     (upper left); 128 = flat
 *     logo wide    R  distance to the outline, -WIDE_OUT..+WIDE_IN px, half resolution
 *                     (glow, shadow, bevel: soft things that need reach, not detail)
 *     water mask   R  1 on open water of the illustration (quarter resolution)
 *     ambient      RGB thumbnail of the illustration (soft fill beside the frame)
 * src/splash/splashData.ts gets the matching numbers (regions, ranges, stroke path).
 *
 * The script checks its own tracing: it rasterises the SVG again and reports how
 * far it is from the source logo.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type Sharp } from 'sharp';
import {
  geodesicDistance,
  labelComponents,
  marchingSquares,
  signedDistance,
  simplifyLoop,
  smoothstep,
  spreadOutwards,
  type Component,
} from './splash/ops.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- tunables -------------------------------------------------------------
/** Transparent margin kept around the logo inside the data field, source px. */
const PAD = 48;
/** Half-range of the precise edge distance (R), source px. */
const EDGE_RANGE = 2.5;
/** Range of the wide distance (B), source px: outside / inside the shape. */
const WIDE_OUT = 40;
const WIDE_IN = 24;
/** G values: 0..STROKE_LEVELS along the light stroke, then one value per other part. */
const STROKE_LEVELS = 200;
const WORD_LEVEL = 228;
const STEM_LEVEL = 255;
/** The bevel rises over this many px from the outline; its light comes from the upper left. */
const BEVEL = 11;
const BEVEL_LIGHT = [0.55, 0.835] as const;
const BEVEL_GAIN = 7.5;
/** Supersampling used to place the outline between pixels. */
const SUPER = 4;
/** Luminance window that removes compression noise without moving the edge. */
const LEVEL_LO = 20 / 255;
const LEVEL_HI = 235 / 255;
/** Largest deviation allowed when the traced outline is simplified, source px. */
const SVG_TOLERANCE = 0.1;
const WATER_SCALE = 0.25;
const AMBIENT_W = 32;
const STROKE_POINTS = 56;
const SPARKLE_SPOTS = 30;
const GAP = 2;

// ---- cli ------------------------------------------------------------------
function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing --${name}. Usage: node tools/splash-assets.ts --world <png> --logo <png> [--out dir] [--debug dir]`);
  process.exit(1);
}
const worldPath = arg('world');
const logoPath = arg('logo');
const outDir = resolve(ROOT, arg('out', 'src/splash/assets'));
const debugDir = process.argv.includes('--debug') ? resolve(arg('debug')) : null;
mkdirSync(outDir, { recursive: true });
if (debugDir) mkdirSync(debugDir, { recursive: true });

const kib = (path: string): string => `${(statSync(path).size / 1024).toFixed(1)} KiB`;
const report: string[] = [];
const note = (line: string): void => {
  report.push(line);
  console.log(line);
};

async function grayFloat(input: Sharp): Promise<{ data: Float32Array; width: number; height: number }> {
  const { data, info } = await input.removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255;
  return { data: out, width: info.width, height: info.height };
}

/** Raw pixels of a one-channel pipeline. sharp may widen grey to RGB on the way out, so pin it. */
async function rawGray(input: Sharp): Promise<Buffer> {
  const { data, info } = await input.toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error(`expected 1 channel, got ${info.channels}`);
  return data;
}

function grayPng(data: Float32Array | Uint8Array, width: number, height: number, path: string): Promise<unknown> {
  const buf = Buffer.alloc(width * height);
  const scale = data instanceof Float32Array ? 255 : 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(0, Math.min(255, Math.round(data[i] * scale)));
  return sharp(buf, { raw: { width, height, channels: 1 } }).png().toFile(path);
}

// ===========================================================================
// 1. Logo
// ===========================================================================
interface LogoResult {
  fieldW: number;
  fieldH: number;
  rgb: Uint8Array;
  wide: Uint8Array;
  wideW: number;
  wideH: number;
  meta: Record<string, unknown>;
}

async function buildLogo(): Promise<LogoResult> {
  const src = await grayFloat(sharp(logoPath));
  // levels: black noise floor -> 0, white -> 1; the 50 % crossing barely moves
  const level = (v: number): number => Math.min(1, Math.max(0, (v - LEVEL_LO) / (LEVEL_HI - LEVEL_LO)));
  let x0 = src.width;
  let y0 = src.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (level(src.data[y * src.width + x]) >= 0.5) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x + 1 > x1) x1 = x + 1;
        if (y + 1 > y1) y1 = y + 1;
      }
    }
  }
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  const W = boxW + PAD * 2;
  const H = boxH + PAD * 2;
  if (x0 < PAD || y0 < PAD || x1 + PAD > src.width || y1 + PAD > src.height) {
    throw new Error('logo is too close to the image border for the requested padding');
  }
  note(`logo: source ${src.width}x${src.height}, lockup ${boxW}x${boxH} at (${x0}, ${y0}); field ${W}x${H}`);

  // cleaned coverage of the field region
  const alpha = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) alpha[y * W + x] = level(src.data[(y + y0 - PAD) * src.width + (x + x0 - PAD)]);
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 0.5 ? 1 : 0;

  // ---- parts ---------------------------------------------------------------
  const { labels, components } = labelComponents(mask, W, H);
  const bySize = [...components].sort((a, b) => b.area - a.area);
  if (components.length !== 8) {
    throw new Error(`expected 8 shapes (stroke, stem, six letters), found ${components.length}: the logo changed, adjust the tool`);
  }
  const stroke = bySize[0]; // top bar + orbit arc, one connected shape
  const stem = bySize[1];
  const letters = bySize.slice(2).sort((a, b) => a.x0 - b.x0);
  const symbolBottom = Math.max(stroke.y1, stem.y1);
  const wordTop = Math.min(...letters.map((c) => c.y0));
  const wordBottom = Math.max(...letters.map((c) => c.y1));
  const wordLeft = Math.min(...letters.map((c) => c.x0));
  const wordRight = Math.max(...letters.map((c) => c.x1));
  if (wordTop <= symbolBottom) throw new Error('wordmark overlaps the symbol vertically: adjust the tool');
  const describe = (c: Component): string => `${c.x1 - c.x0}x${c.y1 - c.y0} at (${c.x0 - PAD}, ${c.y0 - PAD}), ${c.area} px`;
  note(`  stroke (bar + arc) ${describe(stroke)}`);
  note(`  stem ${describe(stem)}`);
  note(`  letters ${letters.map((c) => `${c.x1 - c.x0}x${c.y1 - c.y0}`).join(', ')}`);

  // ---- signed distance, placed between pixels by supersampling -------------
  const alphaBytes = Buffer.alloc(W * H);
  for (let i = 0; i < alphaBytes.length; i++) alphaBytes[i] = Math.round(alpha[i] * 255);
  const big = await rawGray(
    sharp(alphaBytes, { raw: { width: W, height: H, channels: 1 } }).resize(W * SUPER, H * SUPER, { kernel: 'cubic' }),
  );
  const bigMask = new Uint8Array(big.length);
  for (let i = 0; i < big.length; i++) bigMask[i] = big[i] >= 128 ? 1 : 0;
  const bigSd = signedDistance(bigMask, W * SUPER, H * SUPER);
  const sd = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let j = 0; j < SUPER; j++) {
        const row = (y * SUPER + j) * W * SUPER + x * SUPER;
        for (let i = 0; i < SUPER; i++) sum += bigSd[row + i];
      }
      sd[y * W + x] = sum / (SUPER * SUPER) / SUPER;
    }
  }

  // ---- order in which the light draws the stroke ---------------------------
  const strokeMask = new Uint8Array(W * H);
  const stemMask = new Uint8Array(W * H);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === stroke.id) strokeMask[i] = 1;
    else if (labels[i] === stem.id) stemMask[i] = 1;
  }
  // The light runs along the orbit: it starts at the tip of the arc's tail,
  // sweeps round the left, climbs to the bar, rounds the hook on the right and
  // ends in the hook's point. Both ends are found by walking inside the shape:
  // the hook's point is the pixel farthest from the bar's top-left corner, the
  // tail the pixel farthest from the hook's point.
  let corner = -1;
  for (let i = 0; i < strokeMask.length && corner < 0; i++) if (strokeMask[i]) corner = i;
  const farthest = (dist: Float32Array): number => {
    let best = -1;
    for (let i = 0; i < dist.length; i++) {
      if (strokeMask[i] && Number.isFinite(dist[i]) && (best < 0 || dist[i] > dist[best])) best = i;
    }
    return best;
  };
  const hookTip = farthest(geodesicDistance(strokeMask, W, H, corner));
  const fromHook = geodesicDistance(strokeMask, W, H, hookTip);
  const tail = farthest(fromHook);
  const fromTail = geodesicDistance(strokeMask, W, H, tail);
  const strokeLength = fromTail[hookTip];
  let reach = 0;
  for (let i = 0; i < fromTail.length; i++) if (strokeMask[i] && fromTail[i] > reach) reach = fromTail[i];
  if (reach > strokeLength + 1) throw new Error('the hook point is not the far end of the stroke: adjust the tool');
  const at = (i: number): string => `(${(i % W) - PAD}, ${Math.floor(i / W) - PAD})`;
  note(`  light stroke: tail ${at(tail)} -> hook point ${at(hookTip)}, ${strokeLength.toFixed(0)} px; bar corner at ${((fromTail[corner] / strokeLength) * 100).toFixed(0)} %`);

  const order = new Float32Array(W * H);
  const partMask = new Uint8Array(W * H);
  for (let i = 0; i < order.length; i++) {
    if (strokeMask[i]) {
      order[i] = Math.round((fromTail[i] / strokeLength) * STROKE_LEVELS);
      partMask[i] = 1;
    } else if (stemMask[i]) {
      order[i] = STEM_LEVEL;
      partMask[i] = 1;
    } else if (mask[i]) {
      order[i] = WORD_LEVEL; // a letter
      partMask[i] = 1;
    }
  }
  // glow and shadow around a part appear together with that part
  const orderAll = spreadOutwards(order, partMask, W, H);

  // Centre line of the stroke, for the sparks that follow the light. Only
  // pixels close to a shortest tail-to-hook route count, which leaves out the
  // left half of the bar (a side branch the light fills on its way past).
  const sumX = new Float64Array(STROKE_POINTS);
  const sumY = new Float64Array(STROKE_POINTS);
  const count = new Float64Array(STROKE_POINTS);
  for (let i = 0; i < strokeMask.length; i++) {
    if (!strokeMask[i] || fromTail[i] + fromHook[i] > strokeLength + 60) continue;
    const b = Math.min(STROKE_POINTS - 1, Math.floor((fromTail[i] / strokeLength) * STROKE_POINTS));
    sumX[b] += (i % W) + 0.5;
    sumY[b] += Math.floor(i / W) + 0.5;
    count[b]++;
  }
  const strokePath: number[] = [];
  for (let b = 0; b < STROKE_POINTS; b++) {
    if (!count[b]) throw new Error('empty stroke bucket');
    strokePath.push(Math.round((sumX[b] / count[b]) * 10) / 10, Math.round((sumY[b] / count[b]) * 10) / 10);
  }
  // Where the arc meets the bar: the first point of the centre line that lies
  // inside the bar's band (measured on the bar's plain left part).
  let barBottom = 0;
  const cx0 = (corner % W) + 30;
  for (let y = stroke.y0; y < stroke.y1; y++) {
    let hit = false;
    for (let x = cx0; x < cx0 + 30; x++) hit ||= strokeMask[y * W + x] === 1;
    if (hit) barBottom = y + 1;
    else if (barBottom) break;
  }
  let junction = 1;
  for (let b = 0; b < STROKE_POINTS; b++) {
    if (strokePath[b * 2 + 1] < barBottom) {
      junction = b / STROKE_POINTS;
      break;
    }
  }
  note(`  bar is ${barBottom - stroke.y0} px thick; the arc joins it at ${(junction * 100).toFixed(0)} % of the stroke`);

  // slant of the italic letters, measured on the "I" (a plain slanted bar)
  const iLetter = [...letters].sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0))[0];
  let n = 0;
  let sy = 0;
  let sx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = iLetter.y0; y < iLetter.y1; y++) {
    let cx = 0;
    let c = 0;
    for (let x = iLetter.x0; x < iLetter.x1; x++) {
      if (labels[y * W + x] === iLetter.id) {
        cx += x;
        c++;
      }
    }
    if (!c) continue;
    cx /= c;
    n++;
    sy += y;
    sx += cx;
    syy += y * y;
    sxy += y * cx;
  }
  const slant = -(n * sxy - sy * sx) / (n * syy - sy * sy); // px to the right per px up
  note(`  wordmark ${wordRight - wordLeft}x${wordBottom - wordTop}, slant ${slant.toFixed(3)} (${((Math.atan(slant) * 180) / Math.PI).toFixed(1)} deg)`);

  // ---- data field ----------------------------------------------------------
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = Math.round(Math.min(1, Math.max(0, 0.5 + sd[i] / (2 * EDGE_RANGE))) * 255);
    rgb[i * 3 + 1] = Math.round(orderAll[i]);
  }
  // Relief, lit once here at full precision: a height that rises smoothly from
  // the outline, lightly blurred, then its slope towards the light.
  const height = new Float32Array(W * H);
  for (let i = 0; i < height.length; i++) height[i] = smoothstep(0, BEVEL, sd[i]);
  const soft = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      soft[i] =
        (height[i] * 4 +
          (height[i - 1] + height[i + 1] + height[i - W] + height[i + W]) * 2 +
          height[i - W - 1] + height[i - W + 1] + height[i + W - 1] + height[i + W + 1]) /
        16;
    }
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (soft[i + 1] - soft[i - 1]) / 2;
      const gy = (soft[i + W] - soft[i - W]) / 2;
      const facing = Math.min(1, Math.max(-1, (gx * BEVEL_LIGHT[0] + gy * BEVEL_LIGHT[1]) * BEVEL_GAIN));
      rgb[i * 3 + 2] = Math.round(127.5 + 127.5 * facing);
    }
  }
  for (let i = 0; i < W * H; i++) if (rgb[i * 3 + 2] === 0) rgb[i * 3 + 2] = 128; // the 1 px frame skipped above
  const wideW = Math.ceil(W / 2);
  const wideH = Math.ceil(H / 2);
  const wide = new Uint8Array(wideW * wideH);
  for (let y = 0; y < wideH; y++) {
    for (let x = 0; x < wideW; x++) {
      let sum = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) sum += sd[Math.min(H - 1, y * 2 + j) * W + Math.min(W - 1, x * 2 + i)];
      }
      wide[y * wideW + x] = Math.round(Math.min(1, Math.max(0, (sum / 4 + WIDE_OUT) / (WIDE_OUT + WIDE_IN))) * 255);
    }
  }

  // ---- cut-out PNG (alpha = cleaned luminance) -----------------------------
  const PNG_PAD = 16;
  const pw = boxW + PNG_PAD * 2;
  const ph = boxH + PNG_PAD * 2;
  const ga = Buffer.alloc(pw * ph * 2);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const a = alpha[(y + PAD - PNG_PAD) * W + (x + PAD - PNG_PAD)];
      ga[(y * pw + x) * 2] = 255;
      ga[(y * pw + x) * 2 + 1] = Math.round(a * 255);
    }
  }
  const pngPath = join(outDir, 'terria-logo.png');
  await sharp(ga, { raw: { width: pw, height: ph, channels: 2 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
    .toFile(pngPath);
  note(`  terria-logo.png ${pw}x${ph}  ${kib(pngPath)}`);

  // ---- SVG: the 50 % contour of the same pixels ----------------------------
  const loops = marchingSquares(alpha, W, H, 0.5);
  let rawPoints = 0;
  let keptPoints = 0;
  let d = '';
  for (const loop of loops) {
    rawPoints += loop.length / 2;
    const s = simplifyLoop(loop, SVG_TOLERANCE);
    keptPoints += s.length / 2;
    for (let i = 0; i < s.length; i += 2) {
      d += `${i === 0 ? 'M' : 'L'}${(s[i] - PAD).toFixed(2)} ${(s[i + 1] - PAD).toFixed(2)}`;
    }
    d += 'Z';
  }
  d = d.replace(/\.00(?=[ LMZ])/g, '').replace(/(\.\d)0(?=[ LMZ])/g, '$1');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boxW} ${boxH}" width="${boxW}" height="${boxH}" role="img" aria-label="TERRIA">` +
    `<path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>\n`;
  const svgPath = join(outDir, 'terria-logo.svg');
  writeFileSync(svgPath, svg);
  note(`  terria-logo.svg ${loops.length} contours, ${rawPoints} -> ${keptPoints} points  ${kib(svgPath)}`);

  // ---- self-check: rasterise the SVG and compare with the source pixels -----
  const back = await rawGray(
    sharp(Buffer.from(svg.replace('currentColor', '#fff')), { density: 72 })
      .resize(boxW, boxH, { fit: 'fill' })
      .flatten({ background: '#000' }),
  );
  let diff = 0;
  let inter = 0;
  let union = 0;
  let worst = 0;
  for (let y = 0; y < boxH; y++) {
    for (let x = 0; x < boxW; x++) {
      const a = alpha[(y + PAD) * W + x + PAD];
      const b = back[y * boxW + x] / 255;
      diff += Math.abs(a - b);
      if (Math.abs(a - b) > worst) worst = Math.abs(a - b);
      const ia = a >= 0.5;
      const ib = b >= 0.5;
      if (ia && ib) inter++;
      if (ia || ib) union++;
    }
  }
  note(
    `  check: SVG vs source pixels - IoU ${((inter / union) * 100).toFixed(3)} %, mean |diff| ${((diff / (boxW * boxH)) * 100).toFixed(3)} %, ` +
      `worst pixel ${(worst * 100).toFixed(0)} % (edge anti-aliasing)`,
  );
  if (inter / union < 0.995) throw new Error('traced outline deviates from the source logo');

  if (debugDir) {
    await grayPng(alpha, W, H, join(debugDir, 'logo-alpha.png'));
    const ch = (c: number): Uint8Array => {
      const o = new Uint8Array(W * H);
      for (let i = 0; i < o.length; i++) o[i] = rgb[i * 3 + c];
      return o;
    };
    await grayPng(ch(0), W, H, join(debugDir, 'logo-edge.png'));
    await grayPng(ch(1), W, H, join(debugDir, 'logo-order.png'));
    await grayPng(wide, wideW, wideH, join(debugDir, 'logo-wide.png'));
    await sharp(back, { raw: { width: boxW, height: boxH, channels: 1 } }).png().toFile(join(debugDir, 'logo-svg-raster.png'));
  }

  return {
    fieldW: W,
    fieldH: H,
    rgb,
    wide,
    wideW,
    wideH,
    meta: {
      pad: PAD,
      box: { width: boxW, height: boxH },
      edgeRange: EDGE_RANGE,
      wideOut: WIDE_OUT,
      wideIn: WIDE_IN,
      strokeLevels: STROKE_LEVELS,
      wordLevel: WORD_LEVEL,
      stemLevel: STEM_LEVEL,
      strokeLength: Math.round(strokeLength),
      /** Fraction of the stroke where the arc runs into the bar. */
      junction: Math.round(junction * 1000) / 1000,
      bar: { top: stroke.y0, bottom: barBottom },
      symbol: { top: Math.min(stroke.y0, stem.y0), bottom: symbolBottom, left: stroke.x0, right: stroke.x1 },
      stem: { top: stem.y0, bottom: stem.y1, left: stem.x0, right: stem.x1 },
      word: { top: wordTop, bottom: wordBottom, left: wordLeft, right: wordRight, slant: Math.round(slant * 1000) / 1000 },
      split: Math.round((symbolBottom + wordTop) / 2),
      strokePath,
    },
  };
}

// ===========================================================================
// 2. World illustration
// ===========================================================================
interface WorldResult {
  width: number;
  height: number;
  water: Uint8Array;
  waterW: number;
  waterH: number;
  ambient: Uint8Array;
  ambientW: number;
  ambientH: number;
  sparkles: number[];
}

async function buildWorld(): Promise<WorldResult> {
  const image = sharp(worldPath).removeAlpha();
  const { data, info } = await image.clone().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const avifPath = join(outDir, 'world.avif');
  const webpPath = join(outDir, 'world.webp');
  await image.clone().avif({ quality: 56, effort: 8 }).toFile(avifPath);
  await image.clone().webp({ quality: 80, effort: 6, smartSubsample: true }).toFile(webpPath);
  note(`world: ${W}x${H}  world.avif ${kib(avifPath)}  world.webp ${kib(webpPath)}`);

  // ---- open water ----------------------------------------------------------
  // Measured on the picture: river, lakes and sea have blue 0.4-0.65 above red
  // and blue/green of 0.9 or more; teal tree crowns stay below 0.15 and 0.75,
  // thin cloud over the sea below 0.3.
  const water = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    const w = smoothstep(0.22, 0.38, b - r) * smoothstep(0.78, 0.88, b / Math.max(g, 1e-3));
    water[i] = w > 0.5 ? 1 : 0;
  }
  // small blobs are tree shadows and flowers, not water
  const { labels, components } = labelComponents(water, W, H);
  const keep = new Set(components.filter((c) => c.area >= 700).map((c) => c.id));
  for (let i = 0; i < water.length; i++) if (!keep.has(labels[i])) water[i] = 0;
  // pull the mask back from the banks so sparkles never touch sand or grass
  const sd = signedDistance(water, W, H);
  const soft = Buffer.alloc(W * H);
  for (let i = 0; i < soft.length; i++) soft[i] = Math.round(smoothstep(1.5, 7, sd[i]) * 255);
  const waterW = Math.round(W * WATER_SCALE);
  const waterH = Math.round(H * WATER_SCALE);
  const small = await rawGray(
    sharp(soft, { raw: { width: W, height: H, channels: 1 } }).blur(1.2).resize(waterW, waterH, { kernel: 'mitchell', fit: 'fill' }),
  );
  let covered = 0;
  for (let i = 0; i < small.length; i++) covered += small[i] / 255;
  note(`  water mask ${waterW}x${waterH}, ${((covered / small.length) * 100).toFixed(1)} % of the picture`);

  // ---- spots for sparkles: well inside the water, spread out -----------------
  // (seeded, so the same picture always gives the same spots)
  let seed = 0x51ed270b;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const sparkles: number[] = [];
  for (let tries = 0; tries < 20000 && sparkles.length < 2 * SPARKLE_SPOTS; tries++) {
    const x = Math.floor(rand() * waterW);
    const y = Math.floor(rand() * waterH);
    if (small[y * waterW + x] < 245) continue;
    const px = Math.round((x + 0.5) / WATER_SCALE);
    const py = Math.round((y + 0.5) / WATER_SCALE);
    let free = true;
    for (let i = 0; i < sparkles.length && free; i += 2) free = Math.hypot(sparkles[i] - px, sparkles[i + 1] - py) >= 58;
    if (free) sparkles.push(px, py);
  }
  note(`  ${sparkles.length / 2} sparkle spots on the water`);

  // ---- ambient thumbnail ---------------------------------------------------
  const ambientW = AMBIENT_W;
  const ambientH = Math.round((AMBIENT_W * H) / W);
  // blurred well beyond its own pixel size: it is stretched over the sides of wide screens
  const ambient = await image.clone().resize(ambientW, ambientH, { kernel: 'cubic', fit: 'fill' }).blur(1.7).raw().toBuffer();

  if (debugDir) {
    await sharp(small, { raw: { width: waterW, height: waterH, channels: 1 } }).png().toFile(join(debugDir, 'world-water.png'));
    // red overlay to eyeball the mask against the picture
    const up = await rawGray(sharp(small, { raw: { width: waterW, height: waterH, channels: 1 } }).resize(W, H, { fit: 'fill' }));
    const over = Buffer.from(data);
    for (let i = 0; i < W * H; i++) {
      const m = up[i] / 255;
      over[i * 3] = Math.round(over[i * 3] * (1 - m) + 255 * m);
      over[i * 3 + 1] = Math.round(over[i * 3 + 1] * (1 - m * 0.7));
      over[i * 3 + 2] = Math.round(over[i * 3 + 2] * (1 - m * 0.7));
    }
    await sharp(over, { raw: { width: W, height: H, channels: 3 } }).resize(Math.round(W / 2)).png().toFile(join(debugDir, 'world-water-overlay.png'));
  }

  return { width: W, height: H, water: new Uint8Array(small), waterW, waterH, ambient: new Uint8Array(ambient), ambientW, ambientH, sparkles };
}

// ===========================================================================
// 3. Atlas + metadata
// ===========================================================================
const logo = await buildLogo();
const world = await buildWorld();

// field | wide    | water
//       | ambient |
const wideX = logo.fieldW + GAP;
const ambientX = wideX;
const ambientY = logo.wideH + GAP;
const waterX = wideX + logo.wideW + GAP;
const atlasW = waterX + world.waterW;
const atlasH = Math.max(logo.fieldH, world.waterH, ambientY + world.ambientH);
const atlas = new Uint8Array(atlasW * atlasH * 3);
for (let y = 0; y < logo.fieldH; y++) {
  atlas.set(logo.rgb.subarray(y * logo.fieldW * 3, (y + 1) * logo.fieldW * 3), y * atlasW * 3);
}
for (let y = 0; y < logo.wideH; y++) {
  for (let x = 0; x < logo.wideW; x++) atlas[(y * atlasW + wideX + x) * 3] = logo.wide[y * logo.wideW + x];
}
for (let y = 0; y < world.waterH; y++) {
  for (let x = 0; x < world.waterW; x++) atlas[(y * atlasW + waterX + x) * 3] = world.water[y * world.waterW + x];
}
for (let y = 0; y < world.ambientH; y++) {
  atlas.set(
    world.ambient.subarray(y * world.ambientW * 3, (y + 1) * world.ambientW * 3),
    ((ambientY + y) * atlasW + ambientX) * 3,
  );
}
const atlasPath = join(outDir, 'splash-data.png');
await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 3 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
  .toFile(atlasPath);
note(`atlas: ${atlasW}x${atlasH}  splash-data.png ${kib(atlasPath)}`);
if (debugDir) {
  const webp = await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 3 } }).webp({ lossless: true, effort: 6 }).toBuffer();
  console.log(`  (for comparison: lossless WebP would be ${(webp.length / 1024).toFixed(1)} KiB)`);
}

const meta = {
  atlas: { width: atlasW, height: atlasH },
  world: { width: world.width, height: world.height },
  logo: {
    rect: { x: 0, y: 0, width: logo.fieldW, height: logo.fieldH },
    wideRect: { x: wideX, y: 0, width: logo.wideW, height: logo.wideH },
    ...logo.meta,
  },
  water: {
    rect: { x: waterX, y: 0, width: world.waterW, height: world.waterH },
    /** Points well inside the water, px of the illustration: x0, y0, x1, y1, ... */
    sparkles: world.sparkles,
  },
  ambient: { rect: { x: ambientX, y: ambientY, width: world.ambientW, height: world.ambientH } },
};
const metaPath = resolve(ROOT, 'src/splash/splashData.ts');
writeFileSync(
  metaPath,
  `/**\n * GENERATED by tools/splash-assets.ts - do not edit by hand.\n * Numbers that describe assets/splash-data.png (all in pixels of that image).\n * Logo coordinates are in the logo field, which includes \`pad\` px of margin.\n */\nexport const SPLASH_DATA = ${JSON.stringify(meta, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:')} as const;\n`,
);
note(`metadata: src/splash/splashData.ts`);
