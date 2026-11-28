/**
 * The TERRIA logo, drawn from data measured on the artist's file (see
 * tools/splash-assets.ts) - its outline is never redrawn or re-typed here.
 * One quad, one draw call, three texture reads per pixel.
 *
 *   outline   a distance field: sharp at any size, on any pixel density
 *   stroke    the orbit arc and the bar of the T are one shape; the atlas
 *             stores the order in which a light running along it reaches each
 *             pixel, so the light can draw the shape
 *   stem      grows from its foot upwards
 *   wordmark  a wipe parallel to the italic slant; letters rise into place
 *   material  gold at the top through bronze to green at the foot; a soft
 *             bevel whose lighting is stored in the atlas; a glow and a ground
 *             shadow taken from a wider distance field
 */
import { GlProgram, Mesh, MeshGeometry, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import type { SplashLayout } from '../layout.ts';
import { SPLASH_DATA } from '../splashData.ts';

const D = SPLASH_DATA;
const L = D.logo;
const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const rgb = (hex: number): string =>
  `vec3(${f(((hex >> 16) & 255) / 255)}, ${f(((hex >> 8) & 255) / 255)}, ${f((hex & 255) / 255)})`;

/** Softness of the three reveals, in units of their own 0..1 order. */
const STROKE_SOFT = 0.07;
const STEM_SOFT = 0.16;
const WORD_SOFT = 0.2;

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const fragment = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uData;
uniform vec4 uReveal; // x: light stroke, y: stem, z: wordmark (each 0..1), w: flash
uniform vec4 uLook;   // x: time, y: glow, z: position of the sheen, w: opacity
uniform vec4 uParams; // x: device px per logo px, y: strength of the drawing light, z: shadow strength

const vec2 ATLAS = vec2(${f(D.atlas.width)}, ${f(D.atlas.height)});
const vec2 FIELD = vec2(${f(L.rect.width)}, ${f(L.rect.height)});
const vec2 FIELD_ORIGIN = vec2(${f(L.rect.x)}, ${f(L.rect.y)});
const vec2 WIDE_ORIGIN = vec2(${f(L.wideRect.x)}, ${f(L.wideRect.y)});
const vec2 WIDE_SIZE = vec2(${f(L.wideRect.width)}, ${f(L.wideRect.height)});
const float EDGE_SPAN = ${f(L.edgeRange * 2)};
const float WIDE_OUT = ${f(L.wideOut)};
const float WIDE_SPAN = ${f(L.wideOut + L.wideIn)};
const float STROKE_LEVELS = ${f(L.strokeLevels)};
const float JUNCTION = ${f(L.junction)};
const float SYM_TOP = ${f(L.symbol.top)};
const float SYM_H = ${f(L.symbol.bottom - L.symbol.top)};
const float STEM_BOTTOM = ${f(L.stem.bottom)};
const float STEM_H = ${f(L.stem.bottom - L.stem.top)};
const float WORD_TOP = ${f(L.word.top)};
const float WORD_BOTTOM = ${f(L.word.bottom)};
const float WORD_H = ${f(L.word.bottom - L.word.top)};
const float SLANT = ${f(L.word.slant)};
const float XS0 = ${f(L.word.left - L.word.slant * (L.word.bottom - L.word.top))};
const float XS_SPAN = ${f(L.word.right - (L.word.left - L.word.slant * (L.word.bottom - L.word.top)))};

const vec3 GOLD = ${rgb(0xffd468)};
const vec3 BRONZE = ${rgb(0xc07f3c)};
const vec3 GREEN = ${rgb(0x4bb062)};
const vec3 ARC = ${rgb(0xffe7a0)};
const vec3 IVORY = ${rgb(0xfff6dc)};
const vec3 PALE = ${rgb(0xf4cf78)};
const vec3 HOT = vec3(1.0, 0.97, 0.86);
const vec3 SPROUT = vec3(0.78, 1.0, 0.66);

float wide(vec2 halfPx) {
  vec2 c = clamp(halfPx, vec2(0.5), WIDE_SIZE - 0.5);
  return texture(uData, (WIDE_ORIGIN + c) / ATLAS).r * WIDE_SPAN - WIDE_OUT;
}

void main() {
  vec2 px = vUV * FIELD;

  // ---- wordmark: the wipe runs parallel to the slant, letters rise into place
  float gw = clamp((px.x - SLANT * (WORD_BOTTOM - px.y) - XS0) / XS_SPAN, 0.0, 1.0);
  float pw = uReveal.z * (1.0 + ${f(WORD_SOFT)}) - gw;
  float rw = clamp(pw / ${f(WORD_SOFT)}, 0.0, 1.0);
  rw = rw * rw * (3.0 - 2.0 * rw);
  float below = step(WORD_TOP - 6.0, px.y);
  float lift = (1.0 - rw) * 13.0 * below;
  vec2 spx = px + vec2(SLANT * lift, -lift);
  // a lifted read must stay in the wordmark's own band, or it would pull the symbol's glow down
  spx.y = mix(spx.y, max(spx.y, WORD_TOP - 6.0), below);

  vec4 field = texture(uData, (FIELD_ORIGIN + clamp(spx, vec2(0.5), FIELD - 0.5)) / ATLAS);
  float cover = clamp((field.r - 0.5) * EDGE_SPAN * uParams.x + 0.5, 0.0, 1.0);

  // which part is nearest: 0..200 stroke (with its order), 228 wordmark, 255 stem
  float g = field.g * 255.0;
  float stem = step(241.5, g);
  float word = step(214.0, g) * (1.0 - stem);
  float strokePart = 1.0 - stem - word;

  float so = clamp(g / STROKE_LEVELS, 0.0, 1.0);
  float ps = uReveal.x * (1.0 + ${f(STROKE_SOFT)}) - so;
  float rs = smoothstep(0.0, ${f(STROKE_SOFT)}, ps);
  float to = clamp((STEM_BOTTOM - px.y) / STEM_H, 0.0, 1.0);
  float pt = uReveal.y * (1.0 + ${f(STEM_SOFT)}) - to;
  float rt = smoothstep(0.0, ${f(STEM_SOFT)}, pt);
  float shown = strokePart * rs + stem * rt + word * rw;

  // ---- relief (lit in the asset tool) and the wide distance for glow / shadow
  float facing = (field.b * 255.0 - 128.0) / 127.0;
  vec2 hp = spx * 0.5;
  float wd = wide(hp);

  // ---- material --------------------------------------------------------------
  float v = clamp((px.y - SYM_TOP) / SYM_H, 0.0, 1.0); // 0 at the top of the mark, 1 at its foot
  vec3 body = mix(mix(GOLD, BRONZE, smoothstep(0.1, 0.6, v)), GREEN, smoothstep(0.6, 0.98, v));
  // the same metal is a little deeper away from the light (towards the right)
  body *= 1.04 - 0.12 * vUV.x;
  // the orbit arc is light itself: paler and brighter than the letter it circles
  float arc = strokePart * (1.0 - smoothstep(JUNCTION - 0.12, JUNCTION + 0.03, so));
  body = mix(body, mix(ARC, body, 0.25), arc);
  body = mix(body, mix(IVORY, PALE, clamp((px.y - WORD_TOP) / WORD_H, 0.0, 1.0)), word);
  body *= 1.0 + max(facing, 0.0) * 0.5 + min(facing, 0.0) * 0.42;
  body += max(facing, 0.0) * vec3(0.26, 0.24, 0.17);
  // a sheen that crosses the whole lockup
  float sheen = exp(-pow(((px.x + px.y * 0.5) / (FIELD.x + FIELD.y * 0.5) - uLook.z) / 0.06, 2.0));
  body += sheen * vec3(1.0, 0.95, 0.8) * (0.26 + 0.5 * max(facing, 0.0));

  // ---- the light that draws: hottest right behind its front -------------------
  float hs = exp(-max(ps, 0.0) / 0.05) * step(0.0, ps);
  float ht = exp(-max(pt, 0.0) / 0.14) * step(0.0, pt);
  float hw = exp(-max(pw, 0.0) / 0.09) * step(0.0, pw);
  float head = (strokePart * hs + stem * ht + word * hw) * uParams.y;
  body = mix(body, mix(HOT, SPROUT, stem), clamp(head, 0.0, 1.0) * 0.9);
  // the stem is still fresh and green for a moment after it has grown
  body = mix(body, GREEN * 1.25, stem * exp(-max(pt, 0.0) / 0.5) * uParams.y * 0.45);
  body = mix(body, vec3(1.0, 0.98, 0.9), uReveal.w * 0.7);

  // ---- glow outside the shape, shadow on the ground ----------------------------
  float halo = exp(min(wd, 0.0) / 11.0) * smoothstep(-WIDE_OUT + 2.0, -WIDE_OUT + 18.0, wd);
  vec3 glowColor = mix(vec3(1.0, 0.80, 0.40), vec3(0.55, 0.95, 0.5), stem * 0.45);
  float glow = halo * shown * (uLook.y * 0.4 + head * 1.1 + uReveal.w * 0.9);
  float shadow = smoothstep(-10.0, 4.0, wide(hp - vec2(3.0, 5.0))) * 0.5 * shown * uParams.z;

  float a = cover * shown;
  vec3 colour = body * a + glowColor * glow * (1.0 - a);
  finalColor = vec4(colour, a + shadow * (1.0 - a)) * uLook.w;
}
`;

export class LogoLayer {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  /** Tweened by the timeline; copied into the uniforms every frame. */
  readonly state = {
    stroke: 0,
    stem: 0,
    word: 0,
    flash: 0,
    glow: 0,
    sheen: -0.3,
    head: 1,
    shadow: 1,
    alpha: 1,
    scale: 1,
  };
  private readonly reveal = new Float32Array(4);
  private readonly look = new Float32Array(4);
  private readonly params = new Float32Array(4);
  private readonly group: UniformGroup;
  private readonly geometry: MeshGeometry;

  constructor(data: TextureSource) {
    this.group = new UniformGroup({
      uReveal: { value: this.reveal, type: 'vec4<f32>' },
      uLook: { value: this.look, type: 'vec4<f32>' },
      uParams: { value: this.params, type: 'vec4<f32>' },
    });
    const w = L.rect.width;
    const h = L.rect.height;
    this.geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, w, 0, w, h, 0, h]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const shader = new Shader({
      glProgram: new GlProgram({ vertex, fragment, name: 'splash-logo', preferredFragmentPrecision: 'highp' }),
      resources: { uData: data, logo: this.group },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader });
    this.mesh.label = 'splash:logo';
    this.mesh.pivot.set(w / 2, h / 2);
  }

  /**
   * Position on the stroke's centre line, in screen px.
   * @param t 0 (tip of the arc's tail) .. 1 (point of the hook)
   */
  strokePoint(t: number, out: { x: number; y: number }): void {
    const path = L.strokePath;
    const n = path.length / 2;
    const ft = Math.min(1, Math.max(0, t)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(ft));
    const k = ft - i;
    const x = path[i * 2] + (path[i * 2 + 2] - path[i * 2]) * k;
    const y = path[i * 2 + 1] + (path[i * 2 + 3] - path[i * 2 + 1]) * k;
    const m = this.mesh;
    out.x = m.x + (x - L.rect.width / 2) * m.scale.x;
    out.y = m.y + (y - L.rect.height / 2) * m.scale.y;
  }

  /** @param resolution renderer resolution (device px per CSS px) */
  update(layout: SplashLayout, resolution: number, timeSec: number): void {
    const s = this.state;
    const scale = layout.logoScale * s.scale;
    this.mesh.position.set(layout.logoX, layout.logoY);
    this.mesh.scale.set(scale);
    this.reveal[0] = s.stroke;
    this.reveal[1] = s.stem;
    this.reveal[2] = s.word;
    this.reveal[3] = s.flash;
    this.look[0] = timeSec;
    this.look[1] = s.glow;
    this.look[2] = s.sheen;
    this.look[3] = s.alpha;
    this.params[0] = scale * resolution;
    this.params[1] = s.head;
    this.params[2] = s.shadow;
    this.group.update();
  }

  destroy(): void {
    const shader = this.mesh.shader;
    this.mesh.destroy();
    shader?.destroy(true);
    this.geometry.destroy();
  }
}
