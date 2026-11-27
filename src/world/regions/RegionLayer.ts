/**
 * Draws the borders of the player regions as dashed lines of constant
 * on-screen width (one mesh, one draw call for all ~3000 border pieces), and
 * the outline + starter plot of the selected region.
 *
 * Lines are expanded to their pixel width in the vertex shader, so they stay
 * crisp at every zoom. From far away the dashes merge into a faint solid net.
 */
import { Container, GlProgram, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import type { Rect } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import { BORDER_STRIDE, type RegionIndex } from './regions.ts';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;      // x: distance along the border (wu), y: side (-1 / +1)
in vec2 aNormal;
out vec2 vLine;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uLine; // x: half width (wu), y: dash period (wu), z: alpha, w: dash amount

void main() {
  vec2 p = aPosition + aNormal * (aUV.y * uLine.x);
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
  vLine = aUV;
}
`;

const fragment = /* glsl */ `
in vec2 vLine;
out vec4 finalColor;

uniform vec4 uLine;
uniform vec4 uTint; // rgb: line colour, a: strength of the dark casing

void main() {
  float across = abs(vLine.y);
  float core = 1.0 - smoothstep(0.42, 0.72, across);
  float edge = 1.0 - smoothstep(0.82, 1.0, across);
  float dash = mix(1.0, step(fract(vLine.x / uLine.y), 0.56), uLine.w);
  vec3 col = mix(vec3(0.05, 0.19, 0.27), uTint.rgb, core);
  float a = edge * dash * uLine.z * mix(0.5 * uTint.a, 1.0, core);
  finalColor = vec4(col * a, a);
}
`;

let program: GlProgram | null = null;

interface LineMesh {
  mesh: Mesh<MeshGeometry, Shader>;
  line: Float32Array;
  group: UniformGroup;
}

/** Build a line mesh from packed pieces [x0, y0, x1, y1, along]. */
function createLineMesh(pieces: number[] | Float32Array, stride: number, tint: [number, number, number, number]): LineMesh {
  const count = pieces.length / stride;
  const positions = new Float32Array(count * 8);
  const uvs = new Float32Array(count * 8);
  const normals = new Float32Array(count * 8);
  const indices = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const x0 = pieces[o];
    const y0 = pieces[o + 1];
    const x1 = pieces[o + 2];
    const y1 = pieces[o + 3];
    const along = pieces[o + 4];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const v = i * 8;
    positions.set([x0, y0, x0, y0, x1, y1, x1, y1], v);
    uvs.set([along, -1, along, 1, along + len, -1, along + len, 1], v);
    normals.set([nx, ny, nx, ny, nx, ny, nx, ny], v);
    const q = i * 4;
    indices.set([q, q + 1, q + 2, q + 1, q + 3, q + 2], i * 6);
  }
  const geometry = new MeshGeometry({ positions, uvs, indices });
  geometry.addAttribute('aNormal', { buffer: normals, format: 'float32x2' });
  const line = new Float32Array([1, 100, 1, 1]);
  const group = new UniformGroup({
    uLine: { value: line, type: 'vec4<f32>' },
    uTint: { value: new Float32Array(tint), type: 'vec4<f32>' },
  });
  program ??= new GlProgram({ vertex, fragment, name: 'vcm-region-lines', preferredFragmentPrecision: 'highp' });
  const shader = new Shader({ glProgram: program, resources: { lines: group } });
  const mesh = new Mesh({ geometry, shader });
  return { mesh, line, group };
}

export class RegionLayer {
  readonly container = new Container({ label: 'regions' });
  private readonly borders: LineMesh;
  private outline: LineMesh | null = null;
  private plot: LineMesh | null = null;
  private selectedId = -1;
  private readonly index: RegionIndex;

  constructor(index: RegionIndex) {
    this.index = index;
    this.borders = createLineMesh(index.raw.borders, BORDER_STRIDE, [1, 1, 1, 1]);
    this.container.addChild(this.borders.mesh);
    this.container.eventMode = 'none';
  }

  get selected(): number {
    return this.selectedId;
  }

  /** Highlight one region and its starter plot; pass -1 to clear. */
  select(id: number): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const m of [this.outline, this.plot]) {
      if (m) {
        m.mesh.removeFromParent();
        m.mesh.geometry.destroy();
        m.mesh.shader?.destroy();
        m.mesh.destroy();
      }
    }
    this.outline = null;
    this.plot = null;
    if (id < 0) return;
    this.outline = createLineMesh(ringPieces(this.index.polygon(id)), 5, [1.0, 0.93, 0.55, 1]);
    const p = this.index.info(id).starterPlot;
    this.plot = createLineMesh(ringPieces(rectRing(p)), 5, [1, 1, 1, 1]);
    this.container.addChild(this.outline.mesh, this.plot.mesh);
  }

  /** @param scale CSS px per world unit */
  update(scale: number): void {
    // dash length snaps to powers of two so dashes do not crawl while zooming
    const period = 2 ** Math.round(Math.log2(26 / scale));
    const far = 1 - smoothstep(0.014, 0.05, scale);
    const b = this.borders;
    b.line[0] = (0.85 + 0.85 * (1 - far)) / scale;
    b.line[1] = period;
    b.line[2] = 0.3 + 0.55 * (1 - far);
    b.line[3] = 1 - far;
    b.group.update();
    if (this.outline) {
      this.outline.line[0] = 2.6 / scale;
      this.outline.line[1] = period;
      this.outline.line[2] = 0.95;
      this.outline.line[3] = 0;
      this.outline.group.update();
    }
    if (this.plot) {
      // the starter plot is tiny from far away: keep it at least a few px wide
      this.plot.line[0] = 1.8 / scale;
      this.plot.line[1] = period / 2;
      this.plot.line[2] = 0.95;
      this.plot.line[3] = 0;
      this.plot.group.update();
    }
  }

  destroy(): void {
    this.select(-1);
    this.container.destroy({ children: true });
  }
}

function rectRing(r: Rect): number[] {
  return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height, r.x, r.y];
}

/** Closed polygon [x0, y0, x1, y1, ...] -> pieces [x0, y0, x1, y1, along]. */
function ringPieces(poly: number[]): number[] {
  const out: number[] = [];
  let along = 0;
  for (let i = 0; i + 3 < poly.length; i += 2) {
    const x0 = poly[i];
    const y0 = poly[i + 1];
    const x1 = poly[i + 2];
    const y1 = poly[i + 3];
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    if (len < 0.01) continue;
    out.push(x0, y0, x1, y1, along);
    along += len;
  }
  return out;
}
