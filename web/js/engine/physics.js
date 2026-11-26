// 2D physics subset: axis-aligned colliders (boxes, capsules as boxes, circles), tilemap colliders merged into rectangles,
// one-way platforms (PlatformEffector2D), dynamic bodies moved with swept axis-separated resolution, and the queries
// Physics2D offers (Raycast(All), BoxCast(All), OverlapBox, OverlapCircleAll).
import { Component, Time } from "./core.js";

export const LAYER = { Default: 0, IgnoreRaycast: 2, Ground: 8, OneWay: 9, Player: 10, Enemy: 11, Corpse: 12 };
export const mask = (...names) => names.reduce((m, n) => m | (1 << LAYER[n]), 0);
export const ALL = 0xffffffff;

// layer pairs that never collide (LevelManager.Awake)
const ignorePairs = new Set();
function pairKey(a, b) { return a < b ? a * 64 + b : b * 64 + a; }
export function ignoreLayerCollision(a, b, v = true) { if (v) ignorePairs.add(pairKey(a, b)); else ignorePairs.delete(pairKey(a, b)); }
export function layersCollide(a, b) { return !ignorePairs.has(pairKey(a, b)); }

export const Physics = {
  colliders: new Set(),
  bodies: new Set(),
  gravity: -9.81,
  reset() { this.colliders.clear(); this.bodies.clear(); },
  live(c) { return c.enabled && !c._dead && c.node.activeInHierarchy; },
};

export class Collider2D extends Component {
  constructor(d) {
    super();
    this.enabled = d.e !== 0 && d.e !== false;
    this.offset = { x: d.off ? d.off[0] : 0, y: d.off ? d.off[1] : 0 };
    this.size = { x: d.size ? d.size[0] : 1, y: d.size ? d.size[1] : 1 };
    this.radius = d.r || 0;
    this.isTrigger = !!d.trig;
    this.usedByEffector = !!d.eff;
    this.kind = d.T;
    this.oneWay = false; // set when a PlatformEffector2D is present
  }
  awake() { Physics.colliders.add(this); }
  onDestroy() { Physics.colliders.delete(this); }
  get layer() { return this.node.layer; }
  get bounds() {
    const m = this.node.worldMatrix();
    let hx, hy;
    if (this.kind === "circ") { hx = hy = this.radius; }
    else { hx = this.size.x / 2; hy = this.size.y / 2; }
    const cx = m[0] * this.offset.x + m[2] * this.offset.y + m[4];
    const cy = m[1] * this.offset.x + m[3] * this.offset.y + m[5];
    const ex = Math.abs(m[0]) * hx + Math.abs(m[2]) * hy;
    const ey = Math.abs(m[1]) * hx + Math.abs(m[3]) * hy;
    return new Bounds(cx, cy, ex, ey);
  }
  rects() { return [this.bounds]; }
}

export class Bounds {
  constructor(cx, cy, ex, ey) { this.cx = cx; this.cy = cy; this.ex = ex; this.ey = ey; }
  get minX() { return this.cx - this.ex; } get maxX() { return this.cx + this.ex; }
  get minY() { return this.cy - this.ey; } get maxY() { return this.cy + this.ey; }
  get center() { return { x: this.cx, y: this.cy }; }
  get size() { return { x: this.ex * 2, y: this.ey * 2 }; }
  get extents() { return { x: this.ex, y: this.ey }; }
}

// merged rectangles of a TilemapCollider2D
export class TilemapCollider extends Component {
  constructor(d) { super(); this.enabled = d.e !== 0; this.isTrigger = false; this.kind = "tm"; this.rectList = []; this.grid = null; this.oneWay = false; }
  awake() { Physics.colliders.add(this); }
  onDestroy() { Physics.colliders.delete(this); }
  get layer() { return this.node.layer; }
  build(cells, cellW, cellH, ox, oy) {
    // cells: Set of "x,y"; merge horizontal runs, then stack identical runs vertically
    const rows = new Map();
    for (const k of cells) {
      const [x, y] = k.split(",").map(Number);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(x);
    }
    let runs = [];
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      let s = xs[0], p = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === p + 1) { p = xs[i]; continue; }
        runs.push({ x0: s, x1: p + 1, y0: y, y1: y + 1 });
        if (i < xs.length) { s = p = xs[i]; }
      }
    }
    runs.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.y0 - b.y0);
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.x0 === r.x0 && last.x1 === r.x1 && last.y1 === r.y0) last.y1 = r.y1;
      else merged.push({ ...r });
    }
    this.rectList = merged.map((r) => new Bounds(ox + (r.x0 + r.x1) / 2 * cellW, oy + (r.y0 + r.y1) / 2 * cellH, (r.x1 - r.x0) / 2 * cellW, (r.y1 - r.y0) / 2 * cellH));
    // spatial hash
    this.grid = new Map();
    this.cell = 4;
    this.rectList.forEach((b, i) => {
      for (let gx = Math.floor(b.minX / 4); gx <= Math.floor(b.maxX / 4); gx++)
        for (let gy = Math.floor(b.minY / 4); gy <= Math.floor(b.maxY / 4); gy++) {
          const k = gx * 100003 + gy;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(i);
        }
    });
    this.cells = cells; this.cellW = cellW; this.cellH = cellH; this.ox = ox; this.oy = oy;
  }
  hasCell(x, y) { return this.cells && this.cells.has(x + "," + y); }
  rectsIn(minX, minY, maxX, maxY) {
    if (!this.grid) return [];
    const out = new Set();
    for (let gx = Math.floor(minX / 4); gx <= Math.floor(maxX / 4); gx++)
      for (let gy = Math.floor(minY / 4); gy <= Math.floor(maxY / 4); gy++) {
        const l = this.grid.get(gx * 100003 + gy);
        if (l) for (const i of l) out.add(i);
      }
    return [...out].map((i) => this.rectList[i]);
  }
  rects(minX, minY, maxX, maxY) { return this.rectsIn(minX, minY, maxX, maxY); }
  get bounds() { return new Bounds(0, 0, 1e6, 1e6); }
}

export class Rigidbody2D extends Component {
  constructor(d) {
    super();
    this.bodyType = d.bt || 0; // 0 dynamic, 1 kinematic, 2 static
    this.gravityScale = d.g ?? 1;
    this.velocity = { x: 0, y: 0 };
    this.ignored = new Set();
    this.prevX = 0; this.prevY = 0;
    this.angularVelocity = 0;
    this.collider = null;
  }
  awake() { Physics.bodies.add(this); const p = this.node.position; this.prevX = p.x; this.prevY = p.y; }
  onDestroy() { Physics.bodies.delete(this); }
  get linearVelocity() { return { x: this.velocity.x, y: this.velocity.y }; }
  set linearVelocity(v) { this.velocity.x = v.x; this.velocity.y = v.y; }
  get position() { return this.node.position; }
  set position(p) { this.node.setPosition(p.x, p.y); }
  ignore(col, v) { if (v) this.ignored.add(col); else this.ignored.delete(col); }
}

// ---------------------------------------------------------------- queries
function rayBox(ox, oy, dx, dy, b, maxD) {
  // slab test; returns {t, nx, ny} or null. Origin inside -> t 0, normal -dir
  if (ox >= b.minX && ox <= b.maxX && oy >= b.minY && oy <= b.maxY) return { t: 0, nx: -dx, ny: -dy, inside: true };
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return null; }
  else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return null; }
  else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmin < 0 || tmin > maxD) return null;
  return { t: tmin, nx, ny };
}

function candidates(m, minX, minY, maxX, maxY, opts = {}) {
  const out = [];
  for (const c of Physics.colliders) {
    if (!Physics.live(c) || !(m & (1 << c.layer))) continue;
    if (c.isTrigger && opts.noTriggers) continue;
    if (opts.skip && opts.skip(c)) continue;
    if (c.kind === "tm") {
      for (const r of c.rects(minX, minY, maxX, maxY)) out.push([c, r]);
    } else out.push([c, c.bounds]);
  }
  return out;
}

export function raycastAll(ox, oy, dx, dy, dist, m = ALL, opts) {
  const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const ex = ox + dx * dist, ey = oy + dy * dist;
  const hits = [];
  const best = new Map();
  for (const [c, b] of candidates(m, Math.min(ox, ex) - 0.01, Math.min(oy, ey) - 0.01, Math.max(ox, ex) + 0.01, Math.max(oy, ey) + 0.01, opts)) {
    if (b.maxX < Math.min(ox, ex) || b.minX > Math.max(ox, ex) || b.maxY < Math.min(oy, ey) || b.minY > Math.max(oy, ey)) continue;
    const h = rayBox(ox, oy, dx, dy, b, dist);
    if (!h) continue;
    const prev = best.get(c);
    if (prev && prev.distance <= h.t) continue;
    best.set(c, { collider: c, distance: h.t, point: { x: ox + dx * h.t, y: oy + dy * h.t }, normal: { x: h.nx, y: h.ny } });
  }
  for (const v of best.values()) hits.push(v);
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

export function raycast(ox, oy, dx, dy, dist, m = ALL, opts) {
  const h = raycastAll(ox, oy, dx, dy, dist, m, opts);
  return h.length ? h[0] : null;
}

export function boxCastAll(cx, cy, w, h, dx, dy, dist, m = ALL, opts) {
  const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const hx = w / 2, hy = h / 2;
  const ex = cx + dx * dist, ey = cy + dy * dist;
  const best = new Map();
  for (const [c, b] of candidates(m, Math.min(cx, ex) - hx - 0.01, Math.min(cy, ey) - hy - 0.01, Math.max(cx, ex) + hx + 0.01, Math.max(cy, ey) + hy + 0.01, opts)) {
    const eb = new Bounds(b.cx, b.cy, b.ex + hx, b.ey + hy);
    let r = rayBox(cx, cy, dx, dy, eb, dist);
    if (!r) continue;
    if (r.inside) {
      // initial overlap: Unity reports distance 0 and a normal against the cast direction
      r = { t: 0, nx: -dx, ny: -dy };
    }
    const prev = best.get(c);
    if (prev && prev.distance <= r.t) continue;
    const px = cx + dx * r.t - r.nx * hx, py = cy + dy * r.t - r.ny * hy;
    best.set(c, { collider: c, distance: r.t, point: { x: px, y: py }, normal: { x: r.nx, y: r.ny }, rect: b });
  }
  const hits = [...best.values()];
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

export function boxCast(cx, cy, w, h, dx, dy, dist, m = ALL, opts) {
  const hs = boxCastAll(cx, cy, w, h, dx, dy, dist, m, opts);
  return hs.length ? hs[0] : null;
}

export function overlapBoxAll(cx, cy, w, h, m = ALL, opts) {
  const out = [];
  const seen = new Set();
  for (const [c, b] of candidates(m, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, opts)) {
    if (seen.has(c)) continue;
    if (b.maxX < cx - w / 2 || b.minX > cx + w / 2 || b.maxY < cy - h / 2 || b.minY > cy + h / 2) continue;
    seen.add(c); out.push(c);
  }
  return out;
}
export function overlapBox(cx, cy, w, h, m = ALL, opts) {
  const l = overlapBoxAll(cx, cy, w, h, m, opts);
  return l.length ? l[0] : null;
}

export function overlapCircleAll(cx, cy, r, m = ALL, opts) {
  const out = [];
  const seen = new Set();
  for (const [c, b] of candidates(m, cx - r, cy - r, cx + r, cy + r, opts)) {
    if (seen.has(c)) continue;
    let ok;
    if (c.kind === "circ") ok = Math.hypot(b.cx - cx, b.cy - cy) <= r + b.ex;
    else {
      const qx = Math.max(b.minX, Math.min(cx, b.maxX)), qy = Math.max(b.minY, Math.min(cy, b.maxY));
      ok = (qx - cx) ** 2 + (qy - cy) ** 2 <= r * r;
    }
    if (ok) { seen.add(c); out.push(c); }
  }
  return out;
}

// ---------------------------------------------------------------- simulation step
function solidsFor(body, col, minX, minY, maxX, maxY) {
  const out = [];
  for (const c of Physics.colliders) {
    if (c === col || c.isTrigger || !Physics.live(c)) continue;
    if (!layersCollide(body.node.layer, c.layer)) continue;
    if (body.ignored.has(c)) continue;
    if (c.node === body.node) continue;
    if (c.kind !== "tm" && c.node.getComponentInParent(Rigidbody2D) && c.node.getComponentInParent(Rigidbody2D).bodyType === 0) continue; // dynamic vs dynamic: game ignores those layers anyway
    if (c.kind === "tm") { for (const r of c.rects(minX, minY, maxX, maxY)) out.push([c, r]); }
    else out.push([c, c.bounds]);
  }
  return out;
}

export function stepBodies(dt) {
  for (const body of Physics.bodies) {
    if (body._dead || !body.node.activeInHierarchy || body.bodyType === 2) continue;
    const col = body.collider || (body.collider = body.node.comps.find((c) => c instanceof Collider2D && !c.isTrigger));
    const p0 = body.node.position;
    body.prevX = p0.x; body.prevY = p0.y;
    if (body.bodyType === 0) body.velocity.y += Physics.gravity * body.gravityScale * dt;
    let dx = body.velocity.x * dt, dy = body.velocity.y * dt;
    if (!col || !Physics.live(col) || body.bodyType === 1) { body.node.setPosition(p0.x + dx, p0.y + dy); continue; }
    let b = col.bounds;
    const EPS = 0.002;
    const sol = solidsFor(body, col, b.minX - Math.abs(dx) - 1, b.minY - Math.abs(dy) - 1, b.maxX + Math.abs(dx) + 1, b.maxY + Math.abs(dy) + 1);
    // depenetrate from solids we already overlap (spawned inside, door closing...)
    // X axis
    if (dx !== 0) {
      let allow = dx;
      for (const [c, r] of sol) {
        if (c.oneWay) continue;
        if (r.maxY <= b.minY + EPS || r.minY >= b.maxY - EPS) continue;
        if (dx > 0 && r.minX >= b.maxX - EPS) allow = Math.min(allow, Math.max(0, r.minX - b.maxX));
        else if (dx < 0 && r.maxX <= b.minX + EPS) allow = Math.max(allow, Math.min(0, r.maxX - b.minX));
      }
      if (allow !== dx) body.velocity.x = 0;
      dx = allow;
    }
    let x = p0.x + dx;
    b = new Bounds(b.cx + dx, b.cy, b.ex, b.ey);
    if (dy !== 0) {
      let allow = dy;
      for (const [c, r] of sol) {
        if (r.maxX <= b.minX + EPS || r.minX >= b.maxX - EPS) continue;
        if (c.oneWay) {
          if (dy >= 0) continue;
          if (b.minY < r.maxY - 0.02) continue; // only from above
        }
        if (dy > 0 && r.minY >= b.maxY - EPS) allow = Math.min(allow, Math.max(0, r.minY - b.maxY));
        else if (dy < 0 && r.maxY <= b.minY + EPS) allow = Math.max(allow, Math.min(0, r.maxY - b.minY));
      }
      if (allow !== dy) body.velocity.y = 0;
      dy = allow;
    }
    let y = p0.y + dy;
    b = new Bounds(b.cx, b.cy + dy, b.ex, b.ey);
    // push out of solid overlaps (smallest axis)
    for (const [c, r] of sol) {
      if (c.oneWay) continue;
      const ox = Math.min(b.maxX, r.maxX) - Math.max(b.minX, r.minX);
      const oy = Math.min(b.maxY, r.maxY) - Math.max(b.minY, r.minY);
      if (ox <= EPS || oy <= EPS) continue;
      if (ox < oy) { const s = b.cx < r.cx ? -ox : ox; x += s; b = new Bounds(b.cx + s, b.cy, b.ex, b.ey); }
      else { const s = b.cy < r.cy ? -oy : oy; y += s; b = new Bounds(b.cx, b.cy + s, b.ex, b.ey); if (s > 0 && body.velocity.y < 0) body.velocity.y = 0; }
    }
    body.node.setPosition(x, y);
  }
}

// OnTriggerStay2D for scripts that implement it: trigger colliders vs dynamic body colliders
export function triggerPass() {
  const triggers = [];
  for (const c of Physics.colliders) if (c.isTrigger && Physics.live(c) && c.kind !== "tm") {
    const handlers = c.node.comps.filter((s) => s && s.onTriggerStay && s.enabled);
    if (handlers.length) triggers.push([c, handlers]);
  }
  if (!triggers.length) return;
  for (const body of Physics.bodies) {
    if (!body.node.activeInHierarchy) continue;
    const col = body.collider;
    if (!col || !Physics.live(col)) continue;
    const b = col.bounds;
    for (const [t, hs] of triggers) {
      if (!layersCollide(t.layer, body.node.layer)) continue;
      const r = t.bounds;
      if (r.maxX < b.minX || r.minX > b.maxX || r.maxY < b.minY || r.minY > b.maxY) continue;
      for (const h of hs) h.onTriggerStay(col);
    }
  }
}
