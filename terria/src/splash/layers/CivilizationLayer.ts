/**
 * The first settlement on the central meadow: glowing borders of future plots,
 * a few roads, a handful of buildings. Everything is positioned in pixels of
 * the illustration, so it moves and zooms with the picture.
 *
 *   borders + roads  one mesh with a "drawn so far" uniform (one draw call).
 *                    Plots are Voronoi cells, like the regions of the real map;
 *                    their borders spread outwards from the middle along the
 *                    edge graph.
 *   buildings        sprites from the painted atlas (one batched draw call),
 *                    y-sorted; each one rises from its base with a puff of dust.
 */
import { Delaunay } from 'd3-delaunay';
import { Container, GlProgram, Mesh, MeshGeometry, Shader, Sprite, UniformGroup } from 'pixi.js';
import type { SpriteSet } from '../sprites.ts';

/** Middle of the settlement, px of the illustration. */
export const VILLAGE = { x: 470, y: 818 } as const;
/** The ground is seen from above at an angle: depth is drawn shorter than width. */
const GROUND_SQUASH = 0.76;

/** Plot centres on the ground plane, relative to VILLAGE (before the squash). First one is the heart. */
const PLOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [158, -52],
  [42, -176],
  [-128, -124],
  [-166, 44],
  [-34, 178],
  [134, 122],
];
/** Outer ring that only shapes the outline of the settlement; its cells are not drawn. */
const RING: readonly (readonly [number, number])[] = [
  [318, -22],
  [262, -206],
  [118, -338],
  [-74, -330],
  [-248, -244],
  [-322, -68],
  [-312, 128],
  [-204, 268],
  [-28, 348],
  [152, 304],
  [284, 190],
  [392, -150],
];

interface BuildingSpec {
  /** Position on the ground plane relative to VILLAGE. */
  x: number;
  y: number;
  kind: 'hall' | 'house' | 'field';
  variant: number;
  scale: number;
}
/** In the order they are built. */
const BUILDINGS: readonly BuildingSpec[] = [
  { x: 4, y: 2, kind: 'hall', variant: 0, scale: 1.02 },
  { x: 150, y: -64, kind: 'house', variant: 0, scale: 1.08 },
  { x: -120, y: -128, kind: 'house', variant: 1, scale: 1.04 },
  { x: -86, y: 150, kind: 'field', variant: 1, scale: 0.92 },
  { x: 140, y: 124, kind: 'house', variant: 3, scale: 1.06 },
  { x: -176, y: 36, kind: 'house', variant: 2, scale: 1.05 },
  { x: 22, y: -186, kind: 'field', variant: 0, scale: 0.86 },
  { x: 6, y: 196, kind: 'house', variant: 0, scale: 1.0 },
];

/** Roads as quadratic curves on the ground plane: start, control, end. Drawn one after another. */
const ROADS: readonly (readonly number[])[] = [
  [4, 22, 82, 16, 146, -44],
  [4, 22, -76, 30, -170, 56],
  [-6, 24, -52, -62, -116, -108],
  [10, 26, 82, 70, 136, 144],
  [2, 28, -8, 110, 4, 214],
];

const toPicture = (x: number, y: number): [number, number] => [VILLAGE.x + x, VILLAGE.y + y * GROUND_SQUASH];

// ---------------------------------------------------------------------------
// Borders and roads: geometry
// ---------------------------------------------------------------------------
interface Ribbon {
  positions: number[];
  uvs: number[];
  indices: number[];
}

/** A quad along a segment. `u` runs -1..1 across (shifted by `uShift`), `v` carries the reveal time. */
function addSegment(r: Ribbon, ax: number, ay: number, bx: number, by: number, half: number, va: number, vb: number, uShift: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  // small caps so neighbouring quads overlap at the joints
  const cx = (dx / len) * half * 0.35;
  const cy = (dy / len) * half * 0.35;
  const base = r.positions.length / 2;
  r.positions.push(ax - cx + nx, ay - cy + ny, ax - cx - nx, ay - cy - ny, bx + cx - nx, by + cy - ny, bx + cx + nx, by + cy + ny);
  r.uvs.push(uShift + 1, va, uShift - 1, va, uShift - 1, vb, uShift + 1, vb);
  r.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Half width of a border ribbon (core + glow), px of the illustration. */
const BORDER_HALF = 9;

function buildBorders(r: Ribbon): void {
  const sites = [...PLOTS, ...RING];
  const voronoi = Delaunay.from(sites as [number, number][]).voronoi([-900, -900, 900, 900]);
  // unique edges of the inner cells
  const key = (x: number, y: number): string => `${Math.round(x * 4)}:${Math.round(y * 4)}`;
  const nodes = new Map<string, { x: number; y: number; links: { to: string; len: number }[]; dist: number }>();
  const edges = new Map<string, [string, string]>();
  for (let i = 0; i < PLOTS.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly) continue;
    for (let k = 0; k < poly.length - 1; k++) {
      const [ax, ay] = poly[k];
      const [bx, by] = poly[k + 1];
      const a = key(ax, ay);
      const b = key(bx, by);
      if (a === b) continue;
      if (!nodes.has(a)) nodes.set(a, { x: ax, y: ay, links: [], dist: Infinity });
      if (!nodes.has(b)) nodes.set(b, { x: bx, y: by, links: [], dist: Infinity });
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (edges.has(id)) continue;
      edges.set(id, [a, b]);
      const len = Math.hypot(bx - ax, (by - ay) * GROUND_SQUASH);
      nodes.get(a)!.links.push({ to: b, len });
      nodes.get(b)!.links.push({ to: a, len });
    }
  }
  // the light starts at the corner of the heart plot that faces the sun (upper left)
  const heart = voronoi.cellPolygon(0)!;
  let start = key(heart[0][0], heart[0][1]);
  let best = Infinity;
  for (const [x, y] of heart) {
    if (x + y < best) {
      best = x + y;
      start = key(x, y);
    }
  }
  // distances along the graph (plain Dijkstra: a few dozen nodes)
  nodes.get(start)!.dist = 0;
  const open = new Set(nodes.keys());
  while (open.size) {
    let cur = '';
    let d = Infinity;
    for (const k of open) {
      const nd = nodes.get(k)!.dist;
      if (nd < d) {
        d = nd;
        cur = k;
      }
    }
    if (!cur) break;
    open.delete(cur);
    for (const l of nodes.get(cur)!.links) {
      const n = nodes.get(l.to)!;
      if (d + l.len < n.dist) n.dist = d + l.len;
    }
  }
  let reach = 0;
  for (const [a, b] of edges.values()) {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const len = Math.hypot(nb.x - na.x, (nb.y - na.y) * GROUND_SQUASH);
    reach = Math.max(reach, (na.dist + nb.dist + len) / 2);
  }
  for (const [a, b] of edges.values()) {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const [ax, ay] = toPicture(na.x, na.y);
    const [bx, by] = toPicture(nb.x, nb.y);
    const len = Math.hypot(bx - ax, by - ay);
    // the light may reach an edge from both ends: it then meets itself at `m`
    const m = Math.min(len, Math.max(0, (nb.dist - na.dist + len) / 2));
    const t = m / len;
    const mx = ax + (bx - ax) * t;
    const my = ay + (by - ay) * t;
    const vm = (na.dist + m) / reach;
    if (m > 0.5) addSegment(r, ax, ay, mx, my, BORDER_HALF, na.dist / reach, vm, 0);
    if (len - m > 0.5) addSegment(r, bx, by, mx, my, BORDER_HALF, nb.dist / reach, vm, 0);
  }
}

function buildRoads(r: Ribbon): void {
  const STEPS = 10;
  ROADS.forEach((q, i) => {
    // each road takes its own slice of the 0..1 "roads" progress, overlapping the next
    const t0 = (i / ROADS.length) * 0.62;
    const span = 0.38;
    let [px, py] = toPicture(q[0], q[1]);
    for (let s = 1; s <= STEPS; s++) {
      const t = s / STEPS;
      const k = 1 - t;
      const [x, y] = toPicture(k * k * q[0] + 2 * k * t * q[2] + t * t * q[4], k * k * q[1] + 2 * k * t * q[3] + t * t * q[5]);
      addSegment(r, px, py, x, y, 7.5, t0 + ((s - 1) / STEPS) * span, t0 + t * span, 3);
      px = x;
      py = y;
    }
  });
}

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

uniform vec4 uDraw; // x: borders drawn 0..1, y: roads drawn 0..1, z: opacity, w: daylight (1 = full, less when the world dims)
uniform vec4 uPx;   // x: one CSS px, measured across a border ribbon (whose half width is 1)

void main() {
  float road = step(1.5, vUV.x);
  float across = abs(vUV.x - 3.0 * road);

  // plot border: a thin bright core in a soft glow; brightest where it is being drawn
  float pb = uDraw.x * 1.1 - vUV.y;
  float shownB = smoothstep(0.0, 0.04, pb);
  float headB = exp(-max(pb, 0.0) / 0.07) * step(0.0, pb) * (1.0 - smoothstep(0.82, 1.0, uDraw.x));
  // the core stays about 1.5 CSS px wide on any screen and at any zoom
  float core = 1.0 - smoothstep(uPx.x * 0.45, uPx.x * 1.15, across);
  float glow = exp(-across * 3.6) * (1.0 - smoothstep(0.7, 1.0, across));
  vec3 border = (vec3(1.0, 0.86, 0.52) * glow * (0.26 + headB * 0.9) + vec3(1.0, 0.985, 0.92) * core * (0.8 + headB)) * shownB;
  float borderA = core * 0.8 * shownB;

  // road: packed sand with a darker verge
  float pr = uDraw.y * 1.06 - vUV.y;
  float shownR = smoothstep(0.0, 0.03, pr);
  float body = 1.0 - smoothstep(0.42, 0.62, across);
  float roadA = (1.0 - smoothstep(0.6, 0.86, across)) * shownR * 0.9;
  vec3 roadC = mix(vec3(0.60, 0.50, 0.27), vec3(0.93, 0.85, 0.60), body) * uDraw.w * roadA;

  finalColor = vec4(mix(border * mix(0.45, 1.0, uDraw.w), roadC, road), mix(borderA, roadA, road)) * uDraw.z;
}
`;

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------
export interface Building {
  sprite: Sprite;
  dust: Sprite;
  /** Final scale of the sprite. */
  scale: number;
  /** Position in px of the illustration (base of the building). */
  x: number;
  y: number;
  isField: boolean;
}

export class CivilizationLayer {
  /** Roads and borders: goes under the buildings. */
  readonly ground: Mesh<MeshGeometry, Shader>;
  /** Buildings, fields, dust. */
  readonly objects = new Container({ label: 'splash:buildings' });
  readonly buildings: Building[] = [];
  /** Tweened by the timeline. `light` follows the world's dimming. */
  readonly state = { borders: 0, roads: 0, alpha: 1, light: 1 };
  private readonly draw = new Float32Array(4);
  private readonly px = new Float32Array(4);
  private readonly group: UniformGroup;
  private readonly geometry: MeshGeometry;

  constructor(sprites: SpriteSet) {
    const ribbon: Ribbon = { positions: [], uvs: [], indices: [] };
    buildRoads(ribbon);
    buildBorders(ribbon); // after the roads, so borders glow on top of them
    this.geometry = new MeshGeometry({
      positions: new Float32Array(ribbon.positions),
      uvs: new Float32Array(ribbon.uvs),
      indices: new Uint32Array(ribbon.indices),
    });
    this.group = new UniformGroup({
      uDraw: { value: this.draw, type: 'vec4<f32>' },
      uPx: { value: this.px, type: 'vec4<f32>' },
    });
    const shader = new Shader({
      glProgram: new GlProgram({ vertex, fragment, name: 'splash-ground', preferredFragmentPrecision: 'highp' }),
      resources: { ground: this.group },
    });
    this.ground = new Mesh({ geometry: this.geometry, shader });
    this.ground.label = 'splash:ground';

    // back to front, so nearer buildings overlap farther ones
    const order = BUILDINGS.map((spec, index) => ({ spec, index })).sort((a, b) => a.spec.y - b.spec.y);
    const built: Building[] = [];
    for (const { spec, index } of order) {
      const [x, y] = toPicture(spec.x, spec.y);
      const isField = spec.kind === 'field';
      const texture = spec.kind === 'hall' ? sprites.hall : isField ? sprites.fields[spec.variant] : sprites.houses[spec.variant];
      const anchor = spec.kind === 'hall' ? sprites.hallAnchor : isField ? { x: 0.5, y: 0.5 } : sprites.houseAnchor;
      const sprite = new Sprite({ texture, anchor });
      sprite.position.set(x, y);
      sprite.scale.set(spec.scale, isField ? spec.scale * GROUND_SQUASH * 1.1 : spec.scale);
      sprite.alpha = 0;
      const dust = new Sprite({ texture: sprites.dust, anchor: 0.5 });
      dust.position.set(x, y + 2);
      dust.alpha = 0;
      this.objects.addChild(sprite);
      built[index] = { sprite, dust, scale: spec.scale, x, y, isField };
    }
    // dust in front of everything it belongs to
    for (const b of built) {
      this.objects.addChild(b.dust);
      this.buildings.push(b);
    }
  }

  /** @param scale CSS px per px of the illustration (camera included) */
  update(scale: number): void {
    const s = this.state;
    this.px[0] = 1 / (BORDER_HALF * scale);
    this.draw[0] = s.borders;
    this.draw[1] = s.roads;
    this.draw[2] = s.alpha;
    this.draw[3] = s.light;
    this.group.update();
    this.objects.alpha = s.alpha;
    // sprites follow the daylight through their tint (grey level), the mesh through its uniform
    const c = Math.round(255 * (0.36 + 0.64 * s.light));
    this.objects.tint = (c << 16) | (c << 8) | Math.min(255, Math.round(c * 1.06));
  }

  destroy(): void {
    const shader = this.ground.shader;
    this.ground.destroy();
    shader?.destroy(true);
    this.geometry.destroy();
    this.objects.destroy({ children: true });
  }
}
