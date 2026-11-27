/**
 * Small image-processing kernels for the splash asset pipeline
 * (tools/splash-assets.ts). Pure typed-array code, Node only.
 */

const INF = 1e20;

export interface Component {
  id: number;
  area: number;
  x0: number;
  y0: number;
  /** exclusive */
  x1: number;
  y1: number;
}

/** 8-connected components of the non-zero pixels. Labels start at 1. */
export function labelComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = components.length + 1;
    const c: Component = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x + 1 > c.x1) c.x1 = x + 1;
      if (y + 1 > c.y1) c.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    components.push(c);
  }
  return { labels, components };
}

/** One pass of the Felzenszwalb-Huttenlocher squared distance transform. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Exact Euclidean distance (in pixels) from every pixel to the nearest set pixel. */
export function distanceToSet(mask: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : INF;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * Signed distance to the outline of a binary shape: positive inside, negative
 * outside, measured to the pixel edge between "in" and "out" (hence the 0.5).
 */
export function signedDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const toShape = distanceToSet(mask, w, h);
  const toOutside = distanceToSet(inv, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? toOutside[i] - 0.5 : 0.5 - toShape[i];
  return out;
}

/** Binary min-heap of (key, value) pairs. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** Pops the smallest pair; read it from `key` / `val`. */
  key = 0;
  val = 0;
  pop(): void {
    const k = this.keys;
    const v = this.vals;
    this.key = k[0];
    this.val = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n === 0) return;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      k[i] = k[c];
      v[i] = v[c];
      i = c;
    }
    k[i] = lastK;
    v[i] = lastV;
  }
}

/**
 * Shortest path length (pixels, 8-neighbourhood) from `seed` to every pixel,
 * walking only through set pixels. Unreachable pixels get Infinity.
 */
export function geodesicDistance(mask: Uint8Array, w: number, h: number, seed: number): Float32Array {
  const dist = new Float32Array(w * h).fill(Infinity);
  const heap = new Heap();
  dist[seed] = 0;
  heap.push(0, seed);
  const DIAG = Math.SQRT2;
  while (heap.size > 0) {
    heap.pop();
    const d = heap.key;
    const i = heap.val;
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (!mask[j]) continue;
        const nd = d + (dx && dy ? DIAG : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
  }
  return dist;
}

/**
 * Spread the values of the set pixels outwards: every unset pixel receives the
 * value of (approximately) its nearest set pixel.
 */
export function spreadOutwards(values: Float32Array, mask: Uint8Array, w: number, h: number): Float32Array {
  const out = Float32Array.from(values);
  const dist = new Float32Array(w * h).fill(Infinity);
  const heap = new Heap();
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      dist[i] = 0;
      heap.push(0, i);
    }
  }
  const DIAG = Math.SQRT2;
  while (heap.size > 0) {
    heap.pop();
    const d = heap.key;
    const i = heap.val;
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        const nd = d + (dx && dy ? DIAG : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          out[j] = out[i];
          heap.push(nd, j);
        }
      }
    }
  }
  return out;
}

/**
 * Iso-contours of a scalar field sampled at pixel centres, as closed loops of
 * [x0, y0, x1, y1, ...] in image coordinates (pixel centre = +0.5). The field
 * must be below `iso` along the image border, so every loop closes.
 */
export function marchingSquares(field: Float32Array, w: number, h: number, iso: number): number[][] {
  // crossing point of each grid edge, keyed by edge id
  const px = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const segments: [number, number][] = [];
  const hKey = (x: number, y: number): number => (y * w + x) * 2;
  const vKey = (x: number, y: number): number => (y * w + x) * 2 + 1;
  const lerp = (a: number, b: number): number => (iso - a) / (b - a);
  const add = (a: number, b: number): void => {
    const id = segments.length;
    segments.push([a, b]);
    for (const k of [a, b]) {
      const l = links.get(k);
      if (l) l.push(id);
      else links.set(k, [id]);
    }
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = field[y * w + x];
      const tr = field[y * w + x + 1];
      const bl = field[(y + 1) * w + x];
      const br = field[(y + 1) * w + x + 1];
      const code = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = hKey(x, y);
      const B = hKey(x, y + 1);
      const L = vKey(x, y);
      const R = vKey(x + 1, y);
      if (!px.has(T) && tl >= iso !== tr >= iso) px.set(T, [x + lerp(tl, tr) + 0.5, y + 0.5]);
      if (!px.has(B) && bl >= iso !== br >= iso) px.set(B, [x + lerp(bl, br) + 0.5, y + 1.5]);
      if (!px.has(L) && tl >= iso !== bl >= iso) px.set(L, [x + 0.5, y + lerp(tl, bl) + 0.5]);
      if (!px.has(R) && tr >= iso !== br >= iso) px.set(R, [x + 1.5, y + lerp(tr, br) + 0.5]);
      switch (code) {
        case 1:
        case 14:
          add(L, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(L, R);
          break;
        case 4:
        case 11:
          add(T, R);
          break;
        case 6:
        case 9:
          add(T, B);
          break;
        case 7:
        case 8:
          add(L, T);
          break;
        case 5:
        case 10: {
          // saddle: the cell centre decides which corners are joined
          const centreIn = (tl + tr + bl + br) / 4 >= iso;
          const joinTlBr = code === 10 ? centreIn : !centreIn;
          if (joinTlBr) {
            add(T, R);
            add(L, B);
          } else {
            add(L, T);
            add(B, R);
          }
          break;
        }
      }
    }
  }
  const used = new Uint8Array(segments.length);
  const loops: number[][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    const loop: number[] = [];
    let seg = s;
    let from = segments[s][0];
    for (;;) {
      used[seg] = 1;
      const [a, b] = segments[seg];
      const to = a === from ? b : a;
      const p = px.get(from)!;
      loop.push(p[0], p[1]);
      const next = links.get(to)!.find((id) => id !== seg && !used[id]);
      if (next === undefined) break;
      from = to;
      seg = next;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

function rdp(pts: number[], first: number, last: number, eps: number, keep: Uint8Array): void {
  const stack = [first, last];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
}

/** Ramer-Douglas-Peucker on a closed loop; `eps` is the largest allowed deviation. */
export function simplifyLoop(loop: number[], eps: number): number[] {
  const n = loop.length / 2;
  if (n < 4) return loop;
  // split at the point farthest from the first one, so both halves are open polylines
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(loop[i * 2] - loop[0], loop[i * 2 + 1] - loop[1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const pts = loop.concat([loop[0], loop[1]]); // closing point at index n
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  rdp(pts, 0, far, eps, keep);
  rdp(pts, far, n, eps, keep);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
