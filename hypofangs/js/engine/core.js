// Minimal runtime that mirrors the parts of Unity the game code relies on:
// GameObject/Transform hierarchy, components with Awake/Start/Update/FixedUpdate/LateUpdate,
// OnEnable/OnDisable, coroutines, time (scaled, unscaled, fixed) and random helpers.

export const Mathf = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  clamp01: (v) => (v < 0 ? 0 : v > 1 ? 1 : v),
  lerp: (a, b, t) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t),
  lerpUnclamped: (a, b, t) => a + (b - a) * t,
  inverseLerp: (a, b, v) => (a !== b ? Mathf.clamp01((v - a) / (b - a)) : 0),
  moveTowards(cur, target, maxDelta) {
    if (Math.abs(target - cur) <= maxDelta) return target;
    return cur + Math.sign(target - cur) * maxDelta;
  },
  sign: (v) => (v >= 0 ? 1 : -1), // Unity's Mathf.Sign returns 1 for 0
  repeat: (t, len) => Mathf.clamp(t - Math.floor(t / len) * len, 0, len),
  pingPong(t, len) {
    t = Mathf.repeat(t, len * 2);
    return len - Math.abs(t - len);
  },
  floorToInt: (v) => Math.floor(v),
  roundToInt(v) {
    // banker's rounding like Mathf.RoundToInt
    const f = Math.floor(v), d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  },
  smoothDamp(cur, target, state, key, smoothTime, dt) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime, x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = cur - target;
    const orig = target;
    target = cur - change;
    const temp = (state[key] + omega * change) * dt;
    state[key] = (state[key] - omega * temp) * exp;
    let out = target + (change + temp) * exp;
    if (orig - cur > 0 === out > orig) {
      out = orig;
      state[key] = (out - orig) / dt;
    }
    return out;
  },
  approximately: (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-45 * 8),
  DEG: 180 / Math.PI,
  RAD: Math.PI / 180,
};

export const Random = {
  value: () => Math.random(),
  range: (a, b) => a + Math.random() * (b - a),
  rangeInt: (a, b) => a + Math.floor(Math.random() * (b - a)), // max exclusive
  insideUnitCircle() {
    const r = Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  },
};

export const V = {
  len: (x, y) => Math.sqrt(x * x + y * y),
  norm(x, y) {
    const l = Math.sqrt(x * x + y * y);
    return l > 1e-5 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  },
  dist: (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2),
};

// ---------------------------------------------------------------- time
export const Time = {
  time: 0, // scaled
  unscaledTime: 0,
  deltaTime: 0,
  unscaledDeltaTime: 0,
  fixedDeltaTime: 0.02,
  timeScale: 1,
  frameCount: 0,
  inFixed: false,
};

// ---------------------------------------------------------------- hierarchy
let nodeSerial = 0;

export class Node {
  constructor(name, parent = null) {
    this.name = name;
    this.id = nodeSerial++;
    this.parent = null;
    this.children = [];
    this.activeSelf = true;
    this.layer = 0;
    this.tag = 0;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lrot = 0; this.lsx = 1; this.lsy = 1;
    this.comps = [];
    this.destroyed = false;
    this.order = this.id;
    if (parent) parent.addChild(this);
  }
  addChild(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = this;
    this.children.push(n);
  }
  get activeInHierarchy() {
    for (let n = this; n; n = n.parent) if (!n.activeSelf || n.destroyed) return false;
    return true;
  }
  // local -> world affine [a b c d tx ty]
  worldMatrix() {
    const r = this.lrot * Mathf.RAD, c = Math.cos(r), s = Math.sin(r);
    const a = c * this.lsx, b = s * this.lsx, cc = -s * this.lsy, d = c * this.lsy;
    if (!this.parent) return [a, b, cc, d, this.lx, this.ly];
    const p = this.parent.worldMatrix();
    return [p[0] * a + p[2] * b, p[1] * a + p[3] * b, p[0] * cc + p[2] * d, p[1] * cc + p[3] * d,
      p[0] * this.lx + p[2] * this.ly + p[4], p[1] * this.lx + p[3] * this.ly + p[5]];
  }
  get position() {
    if (!this.parent) return { x: this.lx, y: this.ly };
    const p = this.parent.worldMatrix();
    return { x: p[0] * this.lx + p[2] * this.ly + p[4], y: p[1] * this.lx + p[3] * this.ly + p[5] };
  }
  setPosition(x, y) {
    if (!this.parent) { this.lx = x; this.ly = y; return; }
    const p = this.parent.worldMatrix();
    const det = p[0] * p[3] - p[1] * p[2] || 1e-9;
    const dx = x - p[4], dy = y - p[5];
    this.lx = (p[3] * dx - p[2] * dy) / det;
    this.ly = (-p[1] * dx + p[0] * dy) / det;
  }
  get rotation() { // world z angle (degrees)
    let r = 0;
    for (let n = this; n; n = n.parent) r += n.lrot;
    return r;
  }
  setRotation(deg) {
    let pr = 0;
    for (let n = this.parent; n; n = n.parent) pr += n.lrot;
    this.lrot = deg - pr;
  }
  get lossyScale() {
    let x = 1, y = 1;
    for (let n = this; n; n = n.parent) { x *= n.lsx; y *= n.lsy; }
    return { x, y };
  }
  transformPoint(px, py) {
    const m = this.worldMatrix();
    return { x: m[0] * px + m[2] * py + m[4], y: m[1] * px + m[3] * py + m[5] };
  }
  setActive(v) {
    v = !!v;
    if (this.activeSelf === v) return;
    const was = this.activeInHierarchy;
    this.activeSelf = v;
    const now = this.activeInHierarchy;
    if (was !== now) Runtime.hierarchyChanged(this, now);
  }
  getComponent(type) {
    for (const c of this.comps) if (c && isType(c, type)) return c;
    return null;
  }
  getComponents(type) { return this.comps.filter((c) => c && isType(c, type)); }
  getComponentInParent(type) {
    for (let n = this; n; n = n.parent) {
      const c = n.getComponent(type);
      if (c) return c;
    }
    return null;
  }
  getComponentsInChildren(type, includeInactive = false, out = []) {
    if (!includeInactive && !this.activeSelf) return out;
    for (const c of this.comps) if (c && isType(c, type)) out.push(c);
    for (const ch of this.children) ch.getComponentsInChildren(type, includeInactive, out);
    return out;
  }
  find(name) {
    for (const ch of this.children) if (ch.name === name) return ch;
    return null;
  }
  addComponent(comp) {
    comp.node = this;
    this.comps.push(comp);
    Runtime.register(comp);
    return comp;
  }
  destroy() { Runtime.destroy(this); }
}

function isType(c, type) {
  if (typeof type === "string") return c.constructor.typeName === type || c.T === type;
  return c instanceof type;
}

// ---------------------------------------------------------------- components
export class Component {
  constructor() { this.node = null; this.enabled = true; this._awoken = false; this._started = false; }
  get transform() { return this.node; }
  get gameObject() { return this.node; }
  get isActiveAndEnabled() { return this.enabled && this.node.activeInHierarchy; }
  getComponent(t) { return this.node.getComponent(t); }
  getComponentInParent(t) { return this.node.getComponentInParent(t); }
  startCoroutine(gen) { return Runtime.startCoroutine(gen, this); }
  stopCoroutine(co) { if (co) co.dead = true; }
}

// ---------------------------------------------------------------- coroutines
// A coroutine is a generator. Yield values: undefined (next frame), {realtime: s}, {seconds: s}, another generator (nested), a Coroutine handle.
class Coroutine {
  constructor(gen, owner) { this.stack = [gen]; this.owner = owner; this.dead = false; this.wait = 0; this.waitReal = 0; this.waitFor = null; }
  get done() { return this.dead; }
}

// ---------------------------------------------------------------- runtime
export const Runtime = {
  comps: [],
  pendingStart: [],
  coroutines: [],
  toDestroy: [],
  roots: [],
  register(c) {
    this.comps.push(c);
    this._dirty = true;
    if (c.node.activeInHierarchy) this.activate(c);
  },
  activate(c) {
    if (!c._awoken) { c._awoken = true; c.awake && c.awake(); }
    if (c.enabled && !c._onEnabled) { c._onEnabled = true; c.onEnable && c.onEnable(); }
    if (!c._started && !c._queued) { c._queued = true; this.pendingStart.push(c); }
  },
  deactivate(c) {
    if (c._onEnabled) { c._onEnabled = false; c.onDisable && c.onDisable(); }
  },
  hierarchyChanged(node, nowActive) {
    const walk = (n) => {
      if (n !== node && !n.activeSelf) return;
      for (const c of n.comps) if (c && c._registered !== false) nowActive ? this.activate(c) : this.deactivate(c);
      for (const ch of n.children) walk(ch);
    };
    walk(node);
    if (!nowActive) for (const co of this.coroutines) if (co.owner && co.owner.node && !co.owner.node.activeInHierarchy) co.dead = true;
  },
  setEnabled(c, v) {
    if (c.enabled === v) return;
    c.enabled = v;
    if (c.node.activeInHierarchy) {
      if (v) this.activate(c); else this.deactivate(c);
    }
  },
  startCoroutine(gen, owner) {
    const co = new Coroutine(gen, owner);
    this.coroutines.push(co);
    this.stepCoroutine(co); // runs synchronously up to the first yield, like Unity
    return co;
  },
  stepCoroutine(co) {
    while (!co.dead && co.stack.length) {
      if (co.waitFor) { if (!co.waitFor.dead) return; co.waitFor = null; }
      if (co.wait > 0) { co.wait -= Time.deltaTime; if (co.wait > 0) return; co.wait = 0; }
      if (co.waitReal > 0) { co.waitReal -= Time.unscaledDeltaTime; if (co.waitReal > 0) return; co.waitReal = 0; }
      const g = co.stack[co.stack.length - 1];
      let r;
      try { r = g.next(); } catch (e) { console.error(e); co.dead = true; return; }
      if (r.done) { co.stack.pop(); continue; }
      const v = r.value;
      if (v === undefined || v === null) return;
      if (v instanceof Coroutine) { co.waitFor = v; continue; }
      if (typeof v.next === "function") { co.stack.push(v); continue; }
      if (v.realtime !== undefined) { co.waitReal = v.realtime; return; }
      if (v.seconds !== undefined) { co.wait = v.seconds; return; }
      return;
    }
    co.dead = true;
  },
  tickCoroutines() {
    const list = this.coroutines.slice();
    for (const co of list) if (!co.dead && co._fresh !== Time.frameCount) this.stepCoroutine(co);
    this.coroutines = this.coroutines.filter((c) => !c.dead);
  },
  destroy(node) {
    if (node.destroyed) return;
    this.toDestroy.push(node);
  },
  flushDestroy() {
    if (!this.toDestroy.length) return;
    const list = this.toDestroy; this.toDestroy = [];
    const kill = (n) => {
      if (n.destroyed) return;
      const wasActive = n.activeInHierarchy;
      for (const ch of n.children.slice()) kill(ch);
      if (wasActive) for (const c of n.comps) if (c) this.deactivate(c);
      for (const c of n.comps) if (c) { c._dead = true; c.onDestroy && c.onDestroy(); }
      n.destroyed = true;
    };
    for (const n of list) {
      kill(n);
      if (n.parent) {
        const i = n.parent.children.indexOf(n);
        if (i >= 0) n.parent.children.splice(i, 1);
      } else {
        const i = this.roots.indexOf(n);
        if (i >= 0) this.roots.splice(i, 1);
      }
    }
    this.comps = this.comps.filter((c) => !c._dead);
    this._dirty = true;
  },
  runStarts() {
    while (this.pendingStart.length) {
      const list = this.pendingStart; this.pendingStart = [];
      for (const c of list) {
        c._queued = false;
        if (c._dead || c._started) continue;
        if (!c.node.activeInHierarchy || !c.enabled) continue; // started when enabled later
        c._started = true;
        c.start && c.start();
      }
    }
  },
  sortedComps() {
    // DefaultExecutionOrder emulation: lower first; stable by registration
    if (this._sortedLen !== this.comps.length || this._dirty) {
      this._sorted = this.comps.slice().sort((a, b) => (a.constructor.order || 0) - (b.constructor.order || 0));
      this._sortedLen = this.comps.length; this._dirty = false;
    }
    return this._sorted;
  },
  each(method, ...args) {
    const list = this.sortedComps();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c._dead || !c[method] || !c.enabled || !c._onEnabled || !c._started) continue;
      try { c[method](...args); } catch (e) { console.error(method, c.constructor.name, e); }
    }
  },
  reset() {
    this.comps = []; this.pendingStart = []; this.coroutines = []; this.toDestroy = []; this.roots = []; this._sorted = null; this._sortedLen = -1;
  },
};

export function newNode(name, parent = null, x = 0, y = 0) {
  const n = new Node(name, parent);
  if (!parent) Runtime.roots.push(n);
  n.setPosition(x, y);
  return n;
}
