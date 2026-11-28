/**
 * Ground of the city field: stylised lush grass painted in the fragment
 * shader from world-space noise (patches, clumps, blade strokes, sunlit
 * clump edges), plus the editing grid. Built on MeshLambertMaterial so it
 * takes the scene's lights and building shadows like any other surface.
 *
 * World units: 1 = one build tile. The field is centred on the origin.
 */
import { Color, MeshLambertMaterial, Vector2, Vector3, type IUniform } from 'three';

export interface GrassUniforms {
  [k: string]: IUniform;
  uTime: { value: number };
  /** half size of the buildable field, tiles */
  uField: { value: Vector2 };
  /** sun direction projected on the ground (for clump highlights) */
  uSun2: { value: Vector2 };
  /** editing grid: centre, radius (tiles), strength 0..1 */
  uGridC: { value: Vector2 };
  uGridR: { value: number };
  uGrid: { value: number };
  /** strength of the tile checker on the field, 0..1 */
  uChecker: { value: number };
  uDark: { value: Color };
  uMid: { value: Color };
  uLight: { value: Color };
  uDry: { value: Color };
}

export const NOISE_GLSL = /* glsl */ `
vec3 g_perm(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = g_perm(g_perm(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm3(vec2 p){ return .55*snoise(p) + .28*snoise(p*2.07+13.1) + .17*snoise(p*4.13-7.7); }
`;

export function createGrassMaterial(halfField: number): { material: MeshLambertMaterial; uniforms: GrassUniforms } {
  const uniforms: GrassUniforms = {
    uTime: { value: 0 },
    uField: { value: new Vector2(halfField, halfField) },
    uSun2: { value: new Vector2(-0.6, -0.8) },
    uGridC: { value: new Vector2(0, 0) },
    uGridR: { value: 6 },
    uGrid: { value: 0 },
    uChecker: { value: 0.035 },
    uDark: { value: new Color('#2f6b1c') },
    uMid: { value: new Color('#4f9a26') },
    uLight: { value: new Color('#7fc23a') },
    uDry: { value: new Color('#a6b84a') },
  };
  const material = new MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGW;
uniform float uTime, uGrid, uGridR, uChecker;
uniform vec2 uField, uSun2, uGridC;
uniform vec3 uDark, uMid, uLight, uDry;
${NOISE_GLSL}
vec3 grassColor(vec2 p, out float edge){
  float px = length(fwidth(p));                 // tiles per screen pixel
  float fClump = 1. - smoothstep(.06, .25, px);
  float fBlade = 1. - smoothstep(.025, .09, px);
  float fFine  = 1. - smoothstep(.012, .045, px);
  float big = fbm3(p * .045);                   // meadow patches, ~20 tiles
  float clump = snoise(p * .55);                // clumps, ~2 tiles
  float clumpLit = snoise((p - uSun2 * .22) * .55);
  // blade strokes: anisotropic noise whose direction wanders over the field
  float ang = snoise(p * .11 + 3.7) * 2.6;
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  float blades = snoise(q * vec2(2.2, 13.0));
  float fine = snoise(p * 9.0 + 51.0);
  float t = clamp(.52 + .5 * big + .16 * clump * fClump, 0., 1.);
  vec3 col = mix(uDark, uMid, smoothstep(.0, .5, t));
  col = mix(col, uLight, smoothstep(.5, 1., t));
  col = mix(col, uDry, smoothstep(.35, .85, snoise(p * .028 + 40.)) * .22);
  // clumps: sun-facing side brighter, the far side in shade
  float lit = (clumpLit - clump);
  col *= 1. + lit * .22 * fClump;
  col *= 1. + blades * .09 * fBlade + fine * .05 * fFine;
  // tiny dark gaps between clumps
  col *= 1. - smoothstep(.55, .9, -clump) * .12 * fClump;
  // buildable field vs. the wild ring around it
  float inside = max(abs(p.x) - uField.x, abs(p.y) - uField.y);
  edge = inside;
  float wild = smoothstep(-.5, 2.5, inside);
  col = mix(col, col * vec3(.82, .9, .8), wild * .7);
  // subtle tile checker on the field
  float ch = mod(floor(p.x) + floor(p.y), 2.);
  col *= 1. + (ch - .5) * uChecker * (1. - wild) * fClump;
  return col;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float edge;
  vec3 gcol = grassColor(vGW, edge);
  // editing grid around the building being placed
  vec2 cell = abs(fract(vGW) - .5);
  vec2 fw = fwidth(vGW);
  float line = 1. - smoothstep(0., 1.2, min((.5 - cell.x) / fw.x, (.5 - cell.y) / fw.y));
  float reach = 1. - smoothstep(uGridR * .55, uGridR, length(vGW - uGridC));
  float onField = 1. - step(0., edge);
  gcol = mix(gcol, vec3(1.), line * reach * uGrid * .32 * onField);
  // the field's edge line while editing
  float border = 1. - smoothstep(0., 1.5, abs(edge) / max(fw.x, 1e-4));
  gcol = mix(gcol, vec3(1., .96, .8), border * uGrid * .55);
  diffuseColor.rgb = gcol;
}`,
      );
  };
  material.customProgramCacheKey = () => 'terria-grass-v1';
  return { material, uniforms };
}

/** Sun direction on the ground plane (for the clump highlights), from a 3D light direction. */
export function sunOnGround(dir: Vector3): Vector2 {
  return new Vector2(dir.x, dir.z).normalize();
}
