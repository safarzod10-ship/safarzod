import { GlProgram, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import { CHUNK_NODES, TERRAIN, WORLD_SIZE } from '../../core/config.ts';
import { OCEAN_GLSL } from '../ocean/oceanGlsl.ts';

/**
 * One program for the whole terrain. Each chunk owns a tiny Shader instance
 * (its data texture + per-chunk uniforms) that shares this compiled program
 * and the global uniform group.
 *
 * Written in PixiJS' GLSL ES 1.0 compatible dialect so it runs on WebGL 2 and
 * falls back to WebGL 1. WebGPU is not targeted (see createRenderer.ts).
 */
const N = CHUNK_NODES;

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out vec2 vWorld;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uRect; // chunk origin (xy) and size (zw) in world units

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  // texel centres sit on the chunk edges (shared-edge samples)
  vUV = aUV * ${((N - 1) / N).toFixed(8)} + ${(0.5 / N).toFixed(8)};
  vWorld = uRect.xy + aUV * uRect.zw;
}
`;

/**
 * Three variants of the fragment shader. Most pixels on screen belong to
 * chunks that are entirely inland or entirely open sea; those skip the half of
 * the work (and of the texture fetches) they cannot need.
 */
export type ChunkKind = 'mixed' | 'land' | 'sea';

const fragmentSource = /* glsl */ `
in vec2 vUV;
in vec2 vWorld;
out vec4 finalColor;

uniform sampler2D uData;
uniform sampler2D uGrass;
uniform sampler2D uNoise;
uniform sampler2D uCoast; // G: 0 at sea, 1 inland (fresh water)
uniform vec4 uChunk;  // x: shoreline band (wu), y: fade 0..1
uniform vec4 uGlobal; // x: time (s), y: wu per device px, z: detail strength

#ifndef LAND_ONLY
${OCEAN_GLSL}
#endif

#ifndef SEA_ONLY
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * Wild flowers, drawn crisp at any zoom: one candidate per cell of
 * FLOWER_CELL wu, kept where a drift of flowers grows. Far away the drifts
 * only tint the grass a little.
 */
vec3 flowers(vec3 col, vec2 w, float open, float px, float drift, float kind) {
  const float CELL = ${TERRAIN.flowerCell.toFixed(2)};
  vec2 c = floor(w / CELL);
  vec2 f = w / CELL - c;
  float h = hash12(c);
  float dens = smoothstep(0.52, 0.72, drift) * open;
  // pick the colour of the drift (one colour dominates), sometimes another
  float pick = hash12(c + 17.3) < 0.8 ? kind : hash12(c + 3.1);
  vec3 fc = pick < 0.45 ? vec3(0.97, 0.96, 0.9) : pick < 0.8 ? vec3(0.98, 0.84, 0.3) : vec3(0.86, 0.66, 0.9);
  vec2 at = vec2(hash12(c + 5.7), hash12(c + 9.1)) * 0.6 + 0.2;
  float r = 0.26 + 0.16 * hash12(c + 1.9);
  float d = length((f - at) * CELL);
  float edge = max(px * 0.9, 0.02);
  float m = (1.0 - smoothstep(r - edge, r + edge, d)) * step(h, dens * 0.7);
  // the same flowers seen from afar: a faint tint of their colour
  float far = smoothstep(0.35, 0.9, px);
  vec3 tinted = mix(col, fc, dens * 0.05);
  vec3 near = mix(col * (1.0 - 0.18 * (1.0 - smoothstep(r, r + 0.14, d)) * step(h, dens * 0.7)), fc, m * 0.95);
  return mix(near, tinted, far);
}

vec3 shadeLand(vec3 base, vec4 nz, float sd, float t, float aa, float close, float fresh) {
  float px = uGlobal.y;
  vec2 w = vWorld;
  // The grass texture is sampled in screen-aligned coordinates (the map is
  // turned 45 degrees and squashed 2:1), so its blades stand upright on screen
  // like painted grass instead of lying in diagonal stripes. Each layer is
  // turned a little and scaled differently to hide the repetition.
  vec2 sc = vec2(w.x - w.y, (w.x + w.y) * 0.5) * 0.70710678;
  vec2 s1 = vec2(sc.x * 0.9945 - sc.y * 0.1045, sc.x * 0.1045 + sc.y * 0.9945);
  vec2 s2 = vec2(sc.x * 0.9848 + sc.y * 0.1736, -sc.x * 0.1736 + sc.y * 0.9848);
  vec3 g1 = texture(uGrass, s1 * ${(1 / TERRAIN.grassTile).toFixed(8)}).rgb * 2.0;
  vec3 g2 = texture(uGrass, s2 * ${(1 / TERRAIN.grassTileFar).toFixed(8)} + vec2(0.37, 0.61)).rgb * 2.0;
  vec3 detail = g1 * mix(vec3(1.0), g2, 0.5);
  // close up: a finer layer of the same blades keeps the turf sharp
  float nearK = 1.0 - smoothstep(0.18, 0.4, px);
  vec2 s0 = vec2(sc.x * 0.9962 + sc.y * 0.0872, -sc.x * 0.0872 + sc.y * 0.9962);
  vec3 g0 = texture(uGrass, s0 * ${(1 / TERRAIN.grassTileNear).toFixed(8)} + vec2(0.13, 0.29)).rgb * 2.0;
  detail *= mix(vec3(1.0), g0, 0.8 * nearK);
  float grassy = smoothstep(-0.03, 0.07, base.g - base.r);
  // open grass (not the dark painted canopy of a forest)
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  float open = grassy * smoothstep(0.38, 0.5, lum);
  vec3 col = base * mix(vec3(1.0), detail, uGlobal.z * (0.3 + 0.7 * grassy));

  // patches of lusher and drier turf (tens of metres), so a meadow is never one flat colour
  float pA = texture(uNoise, w * ${(1 / 233).toFixed(8)} + vec2(0.31, 0.77)).g;
  float pB = texture(uNoise, w * ${(1 / 61).toFixed(8)} + vec2(0.53, 0.11)).b;
  float pVis = 1.0 - smoothstep(1.5, 6.0, px);
  float patchV = ((pA - 0.5) * 1.0 + (pB - 0.5) * 0.6 * (1.0 - smoothstep(0.6, 2.0, px))) * pVis;
  // lush: deeper, bluer green; dry: lighter, warmer
  vec3 lushC = col * vec3(0.84, 0.95, 0.86);
  vec3 dryC = col * vec3(1.1, 1.06, 0.9) + vec3(0.018, 0.012, 0.0);
  col = mix(col, patchV < 0.0 ? lushC : dryC, min(1.0, abs(patchV) * 1.6) * open);

  // wind: gusts roll over the grass, bent blades show their lighter side
  float wK = open * (1.0 - smoothstep(3.0, 12.0, px));
  if (wK > 0.0) {
    vec2 wind = vec2(t * 4.2, t * 1.6);
    float gust = texture(uNoise, (w - wind) * ${(1 / 170).toFixed(8)}).r;
    float ripple = texture(uNoise, (w - wind * 1.7) * ${(1 / 41).toFixed(8)} + vec2(0.2, 0.6)).g;
    float g = smoothstep(0.5, 0.85, gust) * (0.65 + 0.7 * ripple);
    col = mix(col, col * vec3(1.06, 1.09, 1.02) + vec3(0.012, 0.016, 0.0), g * 0.4 * wK);
  }

  // wild flowers in drifts on the open meadows
  float drift = texture(uNoise, w * ${(1 / 83).toFixed(8)} + vec2(0.71, 0.43)).r * 0.7
              + texture(uNoise, w * ${(1 / 29).toFixed(8)} + vec2(0.13, 0.91)).b * 0.3;
  float kind = texture(uNoise, w * ${(1 / 400).toFixed(8)} + vec2(0.37, 0.05)).g;
  kind = smoothstep(0.35, 0.65, kind);
  col = flowers(col, w, open * smoothstep(0.55, 0.62, lum), px, drift, kind * 0.95);

  // painted forest seen from afar (no tree sprites there): clumps of crowns
  // with lit tops and shaded gaps instead of a flat carpet
  float canopy = grassy * (1.0 - smoothstep(0.34, 0.44, lum));
  float cK = canopy * smoothstep(1.6, 2.6, px);
  if (cK > 0.0) {
    float c1 = texture(uNoise, w * ${(1 / 47).toFixed(8)} + vec2(0.61, 0.17)).b;
    float c1l = texture(uNoise, (w + vec2(-5.8, -6.9)) * ${(1 / 47).toFixed(8)} + vec2(0.61, 0.17)).b;
    float c2 = texture(uNoise, w * ${(1 / 163).toFixed(8)} + vec2(0.07, 0.53)).r;
    col *= 1.0 + ((c1l - c1) * 1.1 + (c2 - 0.5) * 0.4) * cK;
  }

  // sand grain
  col *= 1.0 + (nz.a - 0.5) * 0.14 * (1.0 - grassy);
#ifndef LAND_ONLY
  // sand darkened by the last wave
  float reach = 2.2 + 1.4 * sin(6.2831853 * (t * 0.13) + nz.r * 6.2831853);
  float wet = (1.0 - smoothstep(0.0, max(reach, aa), sd)) * close;
  col *= 1.0 - 0.17 * wet * (1.0 - 0.6 * fresh);
#endif
  return col;
}
#endif

void main() {
  vec4 d = texture(uData, vUV);
  float t = uGlobal.x;
  float px = uGlobal.y;

#ifdef SEA_ONLY
  // open water: further from any coast than the shoreline band
  vec3 col = shadeOcean(d.rgb, uChunk.x, vWorld, t, px, uNoise, 0.0);
#else
  vec4 nz = texture(uNoise, vWorld * ${(1 / TERRAIN.noiseTile).toFixed(8)});
#ifdef LAND_ONLY
  vec3 col = shadeLand(d.rgb, nz, uChunk.x, t, 1.0, 0.0, 0.0);
#else
  // signed distance to the waterline in world units, + is land
  float sd = (d.a - 0.5) * 2.0 * uChunk.x;
  float close = 1.0 - smoothstep(0.5, 1.8, px);
  sd += (nz.g - 0.5) * 2.6 * close;
  float aa = max(px * 0.75, 0.06);
  float land = smoothstep(-aa, aa, sd);
  float fresh = smoothstep(0.25, 0.75, texture(uCoast, vWorld * ${(1 / WORLD_SIZE).toExponential(8)}).g);
  vec3 landCol = shadeLand(d.rgb, nz, sd, t, aa, close, fresh);
  vec3 seaCol = shadeOcean(d.rgb, -sd, vWorld, t, px, uNoise, fresh);
  vec3 col = mix(seaCol, landCol, land);
#endif
#endif

  finalColor = vec4(col, 1.0) * uChunk.y;
}
`;

const programs: Partial<Record<ChunkKind, GlProgram>> = {};

function getProgram(kind: ChunkKind): GlProgram {
  let program = programs[kind];
  if (!program) {
    const define = kind === 'land' ? '#define LAND_ONLY\n' : kind === 'sea' ? '#define SEA_ONLY\n' : '';
    program = new GlProgram({
      vertex,
      fragment: define + fragmentSource,
      name: `vcm-terrain-${kind}`,
      preferredFragmentPrecision: 'highp',
    });
    programs[kind] = program;
  }
  return program;
}

/** Classify a baked chunk by its shoreline channel (alpha). */
export function classifyChunk(pixels: Uint8Array): ChunkKind {
  let lo = 255;
  let hi = 0;
  for (let k = 3; k < pixels.length; k += 4) {
    const a = pixels[k];
    if (a < lo) lo = a;
    if (a > hi) hi = a;
    if (lo < 255 && hi > 0) return 'mixed';
  }
  return lo === 255 ? 'land' : hi === 0 ? 'sea' : 'mixed';
}

export interface TerrainGlobals {
  readonly group: UniformGroup;
  set(timeSec: number, worldPerDevicePx: number, detailStrength: number): void;
}

export function createTerrainGlobals(): TerrainGlobals {
  const value = new Float32Array([0, 1, 1, 0]);
  const group = new UniformGroup({ uGlobal: { value, type: 'vec4<f32>' } });
  return {
    group,
    set(timeSec, worldPerDevicePx, detailStrength) {
      value[0] = timeSec % 1000;
      value[1] = worldPerDevicePx;
      value[2] = detailStrength;
      group.update();
    },
  };
}

export interface ChunkShader {
  readonly shader: Shader;
  setFade(fade: number): void;
}

export function createChunkShader(
  data: TextureSource,
  grass: TextureSource,
  noise: TextureSource,
  coast: TextureSource,
  globals: TerrainGlobals,
  rect: { x: number; y: number; size: number; band: number },
  kind: ChunkKind = 'mixed',
): ChunkShader {
  const chunkValue = new Float32Array([rect.band, 1, 0, 0]);
  const chunk = new UniformGroup({
    uRect: { value: new Float32Array([rect.x, rect.y, rect.size, rect.size]), type: 'vec4<f32>' },
    uChunk: { value: chunkValue, type: 'vec4<f32>' },
  });
  const shader = new Shader({
    glProgram: getProgram(kind),
    resources: {
      uData: data,
      uGrass: grass,
      uNoise: noise,
      ...(kind === 'mixed' ? { uCoast: coast } : {}),
      chunk,
      globals: globals.group,
    },
  });
  return {
    shader,
    setFade(fade) {
      if (chunkValue[1] !== fade) {
        chunkValue[1] = fade;
        chunk.update();
      }
    },
  };
}
