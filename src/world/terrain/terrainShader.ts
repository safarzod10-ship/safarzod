import { GlProgram, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import { CHUNK_NODES, TERRAIN } from '../../core/config.ts';
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
uniform vec4 uChunk;  // x: shoreline band (wu), y: fade 0..1
uniform vec4 uGlobal; // x: time (s), y: wu per device px, z: detail strength

#ifndef LAND_ONLY
${OCEAN_GLSL}
#endif

#ifndef SEA_ONLY
vec3 shadeLand(vec3 base, vec4 nz, float sd, float t, float aa, float close) {
  vec3 g1 = texture(uGrass, vWorld * ${(1 / TERRAIN.grassTile).toFixed(8)}).rgb * 2.0;
  vec2 rw = vec2(vWorld.x * 0.8387 - vWorld.y * 0.5446, vWorld.x * 0.5446 + vWorld.y * 0.8387);
  vec3 g2 = texture(uGrass, rw * ${(1 / TERRAIN.grassTileFar).toFixed(8)}).rgb * 2.0;
  vec3 detail = g1 * mix(vec3(1.0), g2, 0.55);
  float grassy = smoothstep(-0.03, 0.07, base.g - base.r);
  vec3 col = base * mix(vec3(1.0), detail, uGlobal.z * (0.3 + 0.7 * grassy));
  // sand grain
  col *= 1.0 + (nz.a - 0.5) * 0.14 * (1.0 - grassy);
#ifndef LAND_ONLY
  // sand darkened by the last wave
  float reach = 2.2 + 1.4 * sin(6.2831853 * (t * 0.13) + nz.r * 6.2831853);
  float wet = (1.0 - smoothstep(0.0, max(reach, aa), sd)) * close;
  col *= 1.0 - 0.17 * wet;
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
  vec3 col = shadeOcean(d.rgb, uChunk.x, vWorld, t, px, uNoise);
#else
  vec4 nz = texture(uNoise, vWorld * ${(1 / TERRAIN.noiseTile).toFixed(8)});
#ifdef LAND_ONLY
  vec3 col = shadeLand(d.rgb, nz, uChunk.x, t, 1.0, 0.0);
#else
  // signed distance to the waterline in world units, + is land
  float sd = (d.a - 0.5) * 2.0 * uChunk.x;
  float close = 1.0 - smoothstep(0.5, 1.8, px);
  sd += (nz.g - 0.5) * 2.6 * close;
  float aa = max(px * 0.75, 0.06);
  float land = smoothstep(-aa, aa, sd);
  vec3 landCol = shadeLand(d.rgb, nz, sd, t, aa, close);
  vec3 seaCol = shadeOcean(d.rgb, -sd, vWorld, t, px, uNoise);
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
