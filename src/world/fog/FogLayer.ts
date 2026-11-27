/**
 * The fog that closes the world: starts some distance off the coast, thickens
 * into an opaque bank and continues forever, so nothing beyond the designed
 * area can ever be seen. Its density follows the distance from land (a small
 * texture derived from the world fields), with drifting noise for wisps - no
 * straight or circular edge anywhere.
 *
 * One large quad, one draw call. Skipped entirely when the camera is close
 * enough to the land that no fog is in view.
 */
import { BufferImageSource, GlProgram, Mesh, MeshGeometry, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import { FOG, WORLD_SIZE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { COARSE_NODES, COARSE_SPACING, fogDistanceByte, type WorldFields } from '../generation/WorldFields.ts';

/** The quad extends this many world sizes beyond the world on every side. */
const EXTENT = 6;

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vPos;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition; // in world sizes: 0..1 spans the world square
}
`;

const fragment = /* glsl */ `
in vec2 vPos;
out vec4 finalColor;

uniform sampler2D uDist;
uniform sampler2D uNoise;
uniform vec4 uFog; // x: time, y: start, z: end (fractions of FOG.range), w: wisp amplitude

void main() {
  float t = uFog.x;
  float dist = texture(uDist, clamp(vPos, 0.0, 1.0)).r;

  float n1 = texture(uNoise, vPos * 2.3 + t * vec2(0.002, 0.001)).r;
  float n2 = texture(uNoise, vPos * 5.9 + t * vec2(-0.003, 0.002)).g;
  float n3 = texture(uNoise, vPos * 17.0 + t * vec2(0.005, -0.004)).b;
  float n = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;

  float a = smoothstep(uFog.y, uFog.z, dist + (n - 0.5) * uFog.w);
  a = a * a * (3.0 - 2.0 * a);

  // slow billows inside the bank so it reads as volume, not as a flat fill
  float billow = (n2 * 0.6 + n3 * 0.4 - 0.5);
  vec3 col = vec3(${FOG.color[0].toFixed(4)}, ${FOG.color[1].toFixed(4)}, ${FOG.color[2].toFixed(4)});
  col *= 1.0 + billow * 0.07 * (1.0 - a * 0.6);
  // thin fog picks up a little of the sea's blue
  col = mix(col * vec3(0.9, 0.955, 0.99), col, a);

  finalColor = vec4(col * a, a);
}
`;

export class FogLayer {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly source: BufferImageSource;
  private readonly uniforms: Float32Array;
  private readonly group: UniformGroup;
  private readonly world: WorldFields;
  /** Fog cannot be closer to land than this (wu). */
  private readonly clearDistance: number;
  /** Beyond this distance from land the fog is certainly opaque (wu). */
  private readonly opaqueDistance: number;

  constructor(world: WorldFields, noise: TextureSource) {
    this.world = world;
    const n = COARSE_NODES;
    const pixels = new Uint8Array(n * n * 4);
    const dist = world.coastDist.data;
    for (let k = 0; k < n * n; k++) {
      const v = fogDistanceByte(dist[k]);
      pixels[k * 4] = v;
      pixels[k * 4 + 1] = v;
      pixels[k * 4 + 2] = v;
      pixels[k * 4 + 3] = 255;
    }
    this.source = new BufferImageSource({
      resource: pixels,
      width: n,
      height: n,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      addressMode: 'clamp-to-edge',
      scaleMode: 'linear',
      autoGenerateMipmaps: false,
    });

    const wisp = 620;
    this.uniforms = new Float32Array([0, FOG.start / FOG.range, FOG.end / FOG.range, wisp / FOG.range]);
    this.group = new UniformGroup({ uFog: { value: this.uniforms, type: 'vec4<f32>' } });

    const lo = -EXTENT;
    const hi = 1 + EXTENT;
    const geometry = new MeshGeometry({
      positions: new Float32Array([lo, lo, hi, lo, hi, hi, lo, hi]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const shader = new Shader({
      glProgram: new GlProgram({ vertex, fragment, name: 'vcm-fog', preferredFragmentPrecision: 'highp' }),
      resources: { uDist: this.source, uNoise: noise, fog: this.group },
    });
    this.mesh = new Mesh({ geometry, shader });
    this.mesh.label = 'fog';
    this.mesh.scale.set(WORLD_SIZE);

    this.clearDistance = Math.max(0, FOG.start - wisp / 2 - COARSE_SPACING);
    this.opaqueDistance = FOG.end + wisp / 2 + COARSE_SPACING;
  }

  /**
   * True if the fog completely hides this world rectangle - whatever is
   * underneath does not need to be drawn at all.
   */
  hides(rect: Rect): boolean {
    const n = COARSE_NODES;
    const d = this.world.coastDist.data;
    const i0 = Math.max(0, Math.floor(rect.x / COARSE_SPACING));
    const i1 = Math.min(n - 1, Math.ceil((rect.x + rect.width) / COARSE_SPACING));
    const j0 = Math.max(0, Math.floor(rect.y / COARSE_SPACING));
    const j1 = Math.min(n - 1, Math.ceil((rect.y + rect.height) / COARSE_SPACING));
    const limit = this.opaqueDistance;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (d[j * n + i] < limit) return false;
      }
    }
    return true;
  }

  update(viewBounds: Rect, timeSec: number): void {
    this.mesh.visible = this.fogInView(viewBounds);
    if (!this.mesh.visible) return;
    this.uniforms[0] = timeSec % 1000;
    this.group.update();
  }

  /** Conservative test on the coarse distance grid: any fog inside the view? */
  private fogInView(b: Rect): boolean {
    if (b.x < 0 || b.y < 0 || b.x + b.width > WORLD_SIZE || b.y + b.height > WORLD_SIZE) return true;
    const n = COARSE_NODES;
    const d = this.world.coastDist.data;
    const i0 = Math.max(0, Math.floor(b.x / COARSE_SPACING));
    const i1 = Math.min(n - 1, Math.ceil((b.x + b.width) / COARSE_SPACING));
    const j0 = Math.max(0, Math.floor(b.y / COARSE_SPACING));
    const j1 = Math.min(n - 1, Math.ceil((b.y + b.height) / COARSE_SPACING));
    const limit = this.clearDistance;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (d[j * n + i] > limit) return true;
      }
    }
    return false;
  }

  destroy(): void {
    this.mesh.destroy();
    this.source.destroy();
  }
}
