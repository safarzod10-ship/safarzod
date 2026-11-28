/**
 * The illustration, alive: one full-screen quad, one draw call.
 *
 *   dawn     the picture comes out of the dark as a front of morning light
 *            crosses it from the upper left
 *   water    a mask marks sea, lakes and river; there the picture is refracted
 *            by a pixel or so and soft light breathes on it (the sparkles on
 *            top are particles, see SplashScene)
 *   land     slow patches of light and shade, and a band of sun that sweeps
 *            over the grass
 *   dim      the world steps back when the logo appears
 *   reveal   at the end the quad opens from the centre and the real map shows
 *            through (alpha), so there is no cut and no black frame
 *
 * On screens wider than the picture the sides are filled with a soft, dark
 * echo of it (a 32 px thumbnail from the data atlas).
 */
import { GlProgram, Mesh, MeshGeometry, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import type { SplashLayout } from '../layout.ts';
import { SPLASH_DATA } from '../splashData.ts';

const D = SPLASH_DATA;
const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const rectUv = (r: { x: number; y: number; width: number; height: number }, inset: number): string =>
  `vec4(${f((r.x + inset) / D.atlas.width)}, ${f((r.y + inset) / D.atlas.height)}, ` +
  `${f((r.width - inset * 2) / D.atlas.width)}, ${f((r.height - inset * 2) / D.atlas.height)})`;

/** Colour the splash starts from and the DOM veil is painted with (#06120f). */
export const SPLASH_DARK: readonly [number, number, number] = [0.0235, 0.0706, 0.0588];

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

function fragment(rich: boolean): string {
  return /* glsl */ `
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uWorld;
uniform sampler2D uData;
uniform sampler2D uNoise;
uniform vec4 uScreen; // xy: screen size (CSS px), z: frame centre x, w: frame half width
uniform vec4 uView;   // xy: screen position of the picture's top-left corner, zw: 1 / its size on screen
uniform vec4 uLight;  // x: time (s), y: fade in from the dark, z: dawn 0..1, w: dim 0..1
uniform vec4 uFx;     // x: sun band position, y: sun band strength, z: reveal 0..1, w: logo centre y (share of height)

const vec2 WORLD = vec2(${f(D.world.width)}, ${f(D.world.height)});
const vec4 WATER = ${rectUv(D.water.rect, 0.5)};
const vec4 AMBIENT = ${rectUv(D.ambient.rect, 0.5)};
const vec2 AMBIENT_SIZE = vec2(${f(D.ambient.rect.width - 1)}, ${f(D.ambient.rect.height - 1)});
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
const vec3 DARK = vec3(${SPLASH_DARK.map(f).join(', ')});
const vec2 SUN = vec2(0.447, 0.894); // the light travels from the upper left to the lower right

void main() {
  vec2 screen = vUV * uScreen.xy;
  vec2 uv = (screen - uView.xy) * uView.zw;
  vec2 cuv = clamp(uv, 0.0, 1.0);
  vec2 p = uv * WORLD / 512.0; // pattern space: one noise tile per 512 px of the picture
  float t = uLight.x;

  // how far outside the frame this pixel is (0 inside, 1 well outside): wide screens only
  float side = smoothstep(uScreen.w - 28.0, uScreen.w + 44.0, abs(screen.x - uScreen.z));

  // ---- water ---------------------------------------------------------------
  float water = texture(uData, WATER.xy + cuv * WATER.zw).r * (1.0 - side);
${
  rich
    ? `  vec2 flow = texture(uNoise, p * 1.7 + t * vec2(0.021, 0.013)).rg - 0.5;
  vec3 col = texture(uWorld, cuv + flow * water * (3.0 / WORLD)).rgb;`
    : `  vec3 col = texture(uWorld, cuv).rgb;`
}
  // Two soft layers slide against each other; light gathers where both are
  // high. No thresholds with hard edges: the water only breathes.
  float c1 = texture(uNoise, p * 2.3 + t * vec2(0.034, 0.018)).r;
  float c2 = texture(uNoise, p * 3.1 - t * vec2(0.022, 0.038)).g;
  float caustic = c1 * c2;
  col += water * (smoothstep(0.2, 0.7, caustic) - 0.22) * vec3(0.08, 0.15, 0.16);

  // ---- sides: a dark, blurred echo of the picture ----------------------------
  if (side > 0.0) {
    // the thumbnail covers the screen like the picture would, so its blur is the same in both directions
    float screenAspect = uScreen.x / uScreen.y;
    float thumbAspect = AMBIENT_SIZE.x / AMBIENT_SIZE.y;
    vec2 fit = screenAspect > thumbAspect ? vec2(1.0, thumbAspect / screenAspect) : vec2(screenAspect / thumbAspect, 1.0);
    vec2 st = (0.5 + (vUV - 0.5) * fit * 0.86) * AMBIENT_SIZE;
    vec2 cell = floor(st);
    vec2 fr = st - cell;
    fr = fr * fr * (3.0 - 2.0 * fr); // smoother than plain bilinear: no creases in a 32 px image
    vec3 amb = texture(uData, AMBIENT.xy + (cell + fr) / AMBIENT_SIZE * AMBIENT.zw).rgb;
    // darker towards the outer edges, so the eye stays on the frame
    float outer = smoothstep(uScreen.w, uScreen.x * 0.5, abs(screen.x - uScreen.z));
    col = mix(col, mix(vec3(dot(amb, LUMA)), amb, 0.75) * (0.44 - 0.2 * outer), side);
  }

  // ---- light on the land -----------------------------------------------------
  float land = 1.0 - water;
  float drift = texture(uNoise, p * 0.42 + t * vec2(0.006, 0.0025)).r; // cloud shadows passing
  col *= 1.0 + land * (drift - 0.5) * 0.24;
  vec2 w = (uv - 0.5) * vec2(WORLD.x / WORLD.y, 1.0);
  float along = dot(w, SUN); // about -0.57 (upper left) .. 0.57 (lower right)
  float band = exp(-pow((along - uFx.x) / 0.115, 2.0)) * uFx.y;
  float grass = smoothstep(0.02, 0.22, col.g - max(col.r, col.b));
  col *= 1.0 + band * land * (0.25 + 0.75 * drift) * (0.45 + 0.55 * grass) * 0.85;
  col += band * land * grass * vec3(0.10, 0.08, 0.02);

  // ---- dawn ------------------------------------------------------------------
  float front = mix(-1.0, 1.05, uLight.z);
  float lit = 1.0 - smoothstep(front - 0.40, front, along);
  lit = lit * lit * (3.0 - 2.0 * lit); // most of the picture is either night or day, the band between is narrow
  float lum = dot(col, LUMA);
  vec3 night = vec3(0.010, 0.028, 0.044) + lum * vec3(0.05, 0.12, 0.18);
  float edge = exp(-pow((along - front + 0.17) / 0.12, 2.0)) * (1.0 - uLight.z) * 1.6;
  col = mix(night, col, lit) + min(edge, 1.0) * (0.2 + lum) * vec3(1.0, 0.70, 0.32) * 0.5;
  col = mix(DARK, col, uLight.y);

  // ---- the world steps back for the logo --------------------------------------
  vec2 q = (screen - vec2(uScreen.z, uScreen.y * uFx.w)) / (uScreen.y * 0.6);
  float far = length(q);
  lum = dot(col, LUMA);
  vec3 dimmed = mix(vec3(lum), col, 0.78) * mix(vec3(0.40, 0.45, 0.50), vec3(0.13, 0.17, 0.22), smoothstep(0.1, 1.05, far));
  col = mix(col, dimmed, uLight.w);
  col *= 1.0 - 0.16 * smoothstep(0.6, 1.3, far);

  // ---- reveal: open from the centre, edge broken up by noise ------------------
  float aspect = uScreen.x / uScreen.y;
  float r = length((vUV - vec2(0.5, uFx.w)) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5 + vec2(0.0, abs(uFx.w - 0.5)));
  float n = texture(uNoise, vUV * vec2(aspect, 1.0) * 1.3 + 0.37).r + 0.5 * texture(uNoise, vUV * vec2(aspect, 1.0) * 3.1 + t * 0.02).g;
  float hole = uFx.z * 1.95 - 0.35; // -0.35: closed for every pixel, 1.6: open for every pixel
  float a = smoothstep(hole - 0.26, hole, r + (n - 0.75) * 0.3);
  col += (1.0 - a) * a * 4.0 * vec3(1.0, 0.93, 0.74) * 0.35 * step(0.0001, uFx.z);
  finalColor = vec4(col * a, a);
}
`;
}

export class WorldLayer {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  /** Tweened by the timeline; copied into the uniforms every frame. */
  readonly state = { fade: 0, dawn: 0, dim: 0, glint: -1, glintGain: 0, reveal: 0 };
  private readonly screen = new Float32Array(4);
  private readonly view = new Float32Array(4);
  private readonly light = new Float32Array(4);
  private readonly fx = new Float32Array(4);
  private readonly group: UniformGroup;
  private readonly geometry: MeshGeometry;

  constructor(world: TextureSource, data: TextureSource, noise: TextureSource, rich: boolean) {
    this.group = new UniformGroup({
      uScreen: { value: this.screen, type: 'vec4<f32>' },
      uView: { value: this.view, type: 'vec4<f32>' },
      uLight: { value: this.light, type: 'vec4<f32>' },
      uFx: { value: this.fx, type: 'vec4<f32>' },
    });
    this.geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const shader = new Shader({
      glProgram: new GlProgram({
        vertex,
        fragment: fragment(rich),
        name: rich ? 'splash-world' : 'splash-world-lite',
        preferredFragmentPrecision: 'highp',
      }),
      resources: { uWorld: world, uData: data, uNoise: noise, world: this.group },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader });
    this.mesh.label = 'splash:world';
  }

  /**
   * @param zoom camera zoom on top of the "cover" fit (1 = fit)
   * @param timeSec running time of the splash
   */
  update(layout: SplashLayout, zoom: number, timeSec: number, logoCenterY: number): void {
    const s = this.state;
    this.mesh.scale.set(layout.width, layout.height);
    this.screen[0] = layout.width;
    this.screen[1] = layout.height;
    this.screen[2] = layout.frameX + layout.frameWidth / 2;
    this.screen[3] = layout.frameWidth / 2;
    const scale = layout.worldScale * zoom;
    const w = SPLASH_DATA.world.width * scale;
    const h = SPLASH_DATA.world.height * scale;
    this.view[0] = layout.centerX - w / 2;
    this.view[1] = layout.centerY - h / 2;
    this.view[2] = 1 / w;
    this.view[3] = 1 / h;
    this.light[0] = timeSec;
    this.light[1] = s.fade;
    this.light[2] = s.dawn;
    this.light[3] = s.dim;
    this.fx[0] = s.glint;
    this.fx[1] = s.glintGain;
    this.fx[2] = s.reveal;
    this.fx[3] = logoCenterY;
    this.group.update();
  }

  destroy(): void {
    const shader = this.mesh.shader;
    this.mesh.destroy();
    shader?.destroy(true);
    this.geometry.destroy();
  }
}
