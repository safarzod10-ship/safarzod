// Scene loading: builds the node tree and built-in components from the exported JSON,
// and instantiates game scripts registered by their C# type name.
import { Node, Component, Runtime, newNode, Time } from "./core.js";
import { Assets } from "./assets.js";
import { Collider2D, Rigidbody2D, TilemapCollider } from "./physics.js";

export const Scripts = {}; // "HypoFangs.Enemy" -> class
export function registerScript(cls) { Scripts[cls.typeName] = cls; }

export const Renderers = new Set();
export const Lights = new Set();

export class SpriteRenderer extends Component {
  constructor(d = {}) {
    super();
    this.enabled = d.e !== 0 && d.e !== false;
    this.sprite = d.s ? Assets.sprite(d.s) : null;
    const c = d.col || [1, 1, 1, 1];
    this.color = { r: c[0], g: c[1], b: c[2], a: c[3] };
    this.flipX = !!d.fx; this.flipY = !!d.fy;
    this.sortingOrder = d.o || 0;
    this.layerRank = d.l ?? 3;
    this.lit = !!d.lit;
    this.drawMode = d.dm || 0;
    this.size = d.sz ? { x: d.sz[0], y: d.sz[1] } : null;
  }
  awake() { Renderers.add(this); }
  onDestroy() { Renderers.delete(this); }
  setColor(r, g, b, a = 1) { this.color.r = r; this.color.g = g; this.color.b = b; this.color.a = a; }
  // world-space bounds of the sprite rect (used by SpriteSurfaces etc.)
  get bounds() {
    const s = this.sprite;
    if (!s) { const p = this.node.position; return { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, cx: p.x, cy: p.y }; }
    const m = this.node.worldMatrix();
    let x0 = s.minX, x1 = s.maxX, y0 = s.minY, y1 = s.maxY;
    if (this.drawMode && this.size) { x0 = -s.px * this.size.x; x1 = x0 + this.size.x; y0 = -s.py * this.size.y; y1 = y0 + this.size.y; }
    if (this.flipX) [x0, x1] = [-x1, -x0];
    if (this.flipY) [y0, y1] = [-y1, -y0];
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    b.cx = (b.minX + b.maxX) / 2; b.cy = (b.minY + b.maxY) / 2;
    return b;
  }
}
SpriteRenderer.typeName = "SpriteRenderer";

export class Tilemap extends Component {
  constructor(d) {
    super();
    this.d = d;
    this.color = d.color;
    this.sprites = d.sprites.map((s) => (s ? Assets.sprite(s) : null));
    this.renderer = null; // TilemapRenderer settings
  }
  awake() { Renderers.add(this); }
  onDestroy() { Renderers.delete(this); }
  get enabledRender() { return this.renderer && this.renderer.e !== false && this.renderer.e !== 0; }
}
Tilemap.typeName = "Tilemap";

// flat-colour quad (LineRenderer stand-in): pts = 4 world corners in strip order
export class QuadRenderer extends Component {
  constructor() { super(); this.pts = [0, 0, 0, 0, 0, 0, 0, 0]; this.color = { r: 1, g: 1, b: 1, a: 1 }; this.sortingOrder = 0; this.layerRank = 3; this.lit = false; this.life = 0; }
  awake() { Renderers.add(this); }
  onDestroy() { Renderers.delete(this); }
  update() { if (this.life > 0) { this.life -= Time.deltaTime; if (this.life <= 0) this.node.destroy(); } }
}
QuadRenderer.typeName = "QuadRenderer";

export class TextMesh extends Component {
  constructor(d) {
    super();
    this.text = d.text; this.fontSize = d.fs || 13; this.characterSize = d.cs || 1; this.lineSpacing = d.ls || 1;
    this.anchor = d.anchor || 0; this.alignment = d.align || 0;
    this.color = { r: d.col[0], g: d.col[1], b: d.col[2], a: d.col[3] };
    this.font = d.font; this.mr = null; this.enabled = true;
  }
  awake() { Renderers.add(this); }
  onDestroy() { Renderers.delete(this); }
}
TextMesh.typeName = "TextMesh";

export class Light2D extends Component {
  constructor(d) {
    super();
    this.enabled = !!d.e;
    this.type = d.type; this.falloff = d.falloff;
    this.color = { r: d.color[0], g: d.color[1], b: d.color[2], a: d.color[3] };
    this.intensity = d.int; this.innerRadius = d.inR; this.outerRadius = d.outR;
  }
  awake() { Lights.add(this); }
  onDestroy() { Lights.delete(this); }
}
Light2D.typeName = "Light2D";

export class Camera extends Component {
  constructor(d) { super(); this.orthographicSize = d.size || 5; this.backgroundColor = { r: d.bg[0], g: d.bg[1], b: d.bg[2] }; this.aspect = 16 / 9; }
  static get main() { return Camera._main; }
  awake() { if (!Camera._main || !Camera._main.node.activeInHierarchy || Camera._main._dead) Camera._main = this; }
  onEnable() { if (!Camera._main || Camera._main._dead || !Camera._main.node.activeInHierarchy) Camera._main = this; }
  onDestroy() { if (Camera._main === this) Camera._main = null; }
  screenToWorld(sx, sy, vw, vh) {
    const p = this.node.position, h = this.orthographicSize, w = h * this.aspect;
    return { x: p.x + (sx / vw * 2 - 1) * w, y: p.y + (1 - sy / vh * 2) * h };
  }
}
Camera.typeName = "Camera";

export class GenericComponent extends Component {
  constructor(d) { super(); this.d = d; this.T = d.T; this.typeName = d.s || d.T; this.enabled = d.e !== 0 && d.e !== false; }
}

export class PlatformEffector extends Component {
  constructor(d) { super(); this.d = d; }
}
PlatformEffector.typeName = "PlatformEffector2D";

// ---------------------------------------------------------------- loading
function resolve(v, nodes) {
  if (Array.isArray(v)) return v.map((x) => resolve(x, nodes));
  if (v && typeof v === "object") {
    if ("n" in v && Object.keys(v).length <= 2 && typeof v.n === "number") {
      const node = nodes[v.n];
      if (!node) return null;
      if (v.c === undefined || v.c === 0) return node;
      return node.comps[v.c] || null;
    }
    const o = {};
    for (const k in v) o[k] = resolve(v[k], nodes);
    return o;
  }
  if (typeof v === "string" && v.startsWith("S:")) return Assets.sprite(v);
  return v;
}

export function buildScene(data, parentNode = null, beforeActivate = null) {
  const nodes = [];
  for (const nd of data) {
    const parent = nd.p >= 0 ? nodes[nd.p] : parentNode;
    const n = new Node(nd.n, null);
    if (parent) parent.addChild(n); else Runtime.roots.push(n);
    n.activeSelf = nd.a !== 0;
    n.layer = nd.l || 0;
    const t = nd.t;
    n.lx = t[0]; n.ly = t[1]; n.lrot = t[2]; n.lsx = t[3]; n.lsy = t[4]; n.lz = t[5] || 0;
    if (nd.rt) n.rt = nd.rt;
    nodes.push(n);
  }
  // create components without activating them
  const pending = [];
  data.forEach((nd, i) => {
    const n = nodes[i];
    let effector = false;
    let tilemap = null, tmr = null, tmc = null, text = null, mr = null;
    nd.c.forEach((cd, ci) => {
      let comp = null;
      if (!cd) { n.comps.push(null); return; }
      switch (cd.T) {
        case "sr": comp = new SpriteRenderer(cd); break;
        case "box": case "cap": case "circ": comp = new Collider2D(cd); break;
        case "rb": comp = new Rigidbody2D(cd); break;
        case "peff": comp = new PlatformEffector(cd); effector = true; break;
        case "tm": comp = tilemap = new Tilemap(cd); break;
        case "tmr": comp = new GenericComponent(cd); tmr = cd; break;
        case "tmc": comp = tmc = new TilemapCollider(cd); break;
        case "cam": comp = new Camera(cd); break;
        case "text": comp = text = new TextMesh(cd); break;
        case "mr": comp = new GenericComponent(cd); mr = cd; break;
        case "light": comp = new Light2D(cd); break;
        case "mb": {
          const cls = cd.s && Scripts[cd.s];
          if (cls) { comp = new cls(); comp._data = cd.d || {}; comp.enabled = cd.e !== 0; }
          else comp = new GenericComponent(cd);
          break;
        }
        default: comp = new GenericComponent(cd);
      }
      comp.node = n;
      n.comps.push(comp);
    });
    if (effector) for (const c of n.comps) if (c instanceof Collider2D && c.usedByEffector) c.oneWay = true;
    if (tilemap) tilemap.renderer = tmr;
    if (text) text.mr = mr;
    if (tmc && tilemap) {
      const cells = new Set();
      for (const tl of tilemap.d.tiles) if (tl[5]) cells.add(tl[0] + "," + tl[1]);
      const grid = n.parent && n.parent.comps.find((c) => c && c.T === "grid");
      const cell = grid ? grid.d.cell : [1, 1];
      const p = n.position;
      tmc.build(cells, cell[0], cell[1], p.x, p.y);
      tilemap.collider = tmc;
    }
    if (tilemap) {
      const grid = n.parent && n.parent.comps.find((c) => c && c.T === "grid");
      tilemap.cell = grid ? grid.d.cell : [1, 1];
    }
  });
  // resolve script data references, then register everything (Awake/OnEnable in hierarchy order)
  data.forEach((nd, i) => {
    for (const c of nodes[i].comps) if (c && c._data !== undefined) {
      const d = resolve(c._data, nodes);
      if (c.init) c.init(d); else Object.assign(c, d);
    }
  });
  if (beforeActivate) beforeActivate(nodes);
  for (const n of nodes) for (const c of n.comps) if (c) { Runtime.comps.push(c); Runtime._dirty = true; }
  for (const n of nodes) if (n.activeInHierarchy) for (const c of n.comps) if (c) Runtime.activate(c);
  return nodes;
}

export { newNode };
