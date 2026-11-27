/**
 * Rivers and lakes.
 *
 * Rivers are the cheapest paths from inland sources to the sea, where walking
 * over hills is expensive: a Dijkstra flood from the coast gives every land
 * node a "downstream" neighbour, so paths follow valleys, merge into larger
 * rivers and always reach the ocean. Lakes are carved on some of those paths
 * (the river flows in and out) and at some river heads.
 *
 * Deterministic: integer hashing, seeded RNG, + - * / sqrt only.
 */
import { BASE_SPACING } from '../../core/config.ts';
import { smoothstep } from '../../core/math.ts';
import { hash2, mulberry32, subSeed } from '../../core/rng.ts';
import type { Noise2D } from './noise.ts';
import { RIVER_STRIDE } from './rivers.ts';
import type { WorldParams } from './WorldParams.ts';

export interface Hydrology {
  /** Packed river segments, see RIVER_STRIDE. */
  rivers: Float32Array;
  /** Packed lakes: x, y, radius. */
  lakes: Float32Array;
}

/** Converts distance from a lake shore (wu) into coast-function units. */
const LAKE_GRADIENT = 2.5e-4;
const MAX_HALF_WIDTH = 30;
/** Coast-function value up to which a lake basin reshapes the land. */
const LAKE_REACH_E = 0.06;

/**
 * @param e      base coast grid (n x n). Lakes are carved into it in place.
 * @param ocean  1 for nodes that belong to the ocean
 * @param hill   0..1 "how hilly" at a world position (rivers avoid hills)
 */
export function buildHydrology(
  params: WorldParams,
  e: Float32Array,
  n: number,
  ocean: Uint8Array,
  hill: (x: number, y: number) => number,
  lakeNoise: Noise2D,
): Hydrology {
  const total = n * n;
  const S = BASE_SPACING;
  const seed = params.seed;
  const rng = mulberry32(subSeed(seed, 'hydrology'));

  // ---- 1. cost of standing on a node, distance to the sea ----------------
  const nodeCost = new Float32Array(total);
  const land: number[] = [];
  for (let k = 0; k < total; k++) {
    if (ocean[k]) continue;
    const i = k % n;
    const j = (k - i) / n;
    nodeCost[k] = 1 + 2.6 * hill(i * S, j * S) + 0.7 * (hash2(i, j, seed ^ 0x51ed270b) / 4294967296);
    land.push(k);
  }

  const seaDist = new Int32Array(total).fill(-1);
  {
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    for (const k of land) {
      const i = k % n;
      if ((i > 0 && ocean[k - 1]) || (i < n - 1 && ocean[k + 1]) || ocean[k - n] || ocean[k + n]) {
        seaDist[k] = 1;
        queue[tail++] = k;
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const i = c % n;
      const d = seaDist[c] + 1;
      if (i > 0 && !ocean[c - 1] && seaDist[c - 1] < 0) (seaDist[c - 1] = d), (queue[tail++] = c - 1);
      if (i < n - 1 && !ocean[c + 1] && seaDist[c + 1] < 0) (seaDist[c + 1] = d), (queue[tail++] = c + 1);
      if (!ocean[c - n] && seaDist[c - n] < 0) (seaDist[c - n] = d), (queue[tail++] = c - n);
      if (!ocean[c + n] && seaDist[c + n] < 0) (seaDist[c + n] = d), (queue[tail++] = c + n);
    }
  }

  // ---- 2. Dijkstra from the coast: parent[] points downstream ------------
  const cost = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const heapNode: number[] = [];
  const heapKey: number[] = [];
  const less = (a: number, b: number): boolean =>
    heapKey[a] < heapKey[b] || (heapKey[a] === heapKey[b] && heapNode[a] < heapNode[b]);
  const push = (node: number, key: number): void => {
    let i = heapNode.length;
    heapNode.push(node);
    heapKey.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const swap = (a: number, b: number): void => {
    const tn = heapNode[a];
    heapNode[a] = heapNode[b];
    heapNode[b] = tn;
    const tk = heapKey[a];
    heapKey[a] = heapKey[b];
    heapKey[b] = tk;
  };
  const pop = (): number => {
    const top = heapNode[0];
    const lastN = heapNode.pop()!;
    const lastK = heapKey.pop()!;
    if (heapNode.length > 0) {
      heapNode[0] = lastN;
      heapKey[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapNode.length && less(l, m)) m = l;
        if (r < heapNode.length && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };

  for (const k of land) {
    if (seaDist[k] !== 1) continue;
    const i = k % n;
    // downstream of a shore node is the adjacent ocean node
    parent[k] = i > 0 && ocean[k - 1] ? k - 1 : i < n - 1 && ocean[k + 1] ? k + 1 : ocean[k - n] ? k - n : k + n;
    cost[k] = 0;
    push(k, 0);
  }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const done = new Uint8Array(total);
  while (heapNode.length > 0) {
    const key = heapKey[0];
    const c = pop();
    if (done[c] || key > cost[c]) continue;
    done[c] = 1;
    const ci = c % n;
    const cj = (c - ci) / n;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DX[d];
      const nj = cj + DY[d];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = nj * n + ni;
      if (ocean[k] || done[k]) continue;
      const step = (d < 4 ? 1 : 1.41421356) * 0.5 * (nodeCost[c] + nodeCost[k]);
      const nc = cost[c] + step;
      if (nc < cost[k]) {
        cost[k] = nc;
        parent[k] = c;
        push(k, nc);
      }
    }
  }

  // ---- 3. sources, spread over the interior ------------------------------
  const sources: number[] = [];
  const minSeaDist = 14; // nodes: at least ~1.8 km from the sea
  const minGap2 = 24 * 24;
  for (let attempt = 0; attempt < 40000 && sources.length < params.rivers && land.length > 0; attempt++) {
    const k = land[Math.floor(rng() * land.length)];
    if (seaDist[k] < minSeaDist || parent[k] < 0) continue;
    const i = k % n;
    const j = (k - i) / n;
    let ok = true;
    for (const s of sources) {
      const si = s % n;
      const sj = (s - si) / n;
      if ((si - i) * (si - i) + (sj - j) * (sj - j) < minGap2) {
        ok = false;
        break;
      }
    }
    if (ok) sources.push(k);
  }

  // ---- 4. flow accumulation ---------------------------------------------
  const flow = new Uint16Array(total);
  for (const s of sources) {
    let c = s;
    while (c >= 0 && !ocean[c]) {
      flow[c]++;
      c = parent[c];
    }
  }
  const halfWidth = (f: number): number => Math.min(MAX_HALF_WIDTH, 5 + 4.2 * Math.sqrt(f));

  // ---- 5. chains: longest first claims the trunk -------------------------
  const order = sources.slice().sort((a, b) => cost[b] - cost[a] || a - b);
  const claimed = new Uint8Array(total);
  const px = (k: number): number => {
    const i = k % n;
    const j = (k - i) / n;
    return (i + (ocean[k] ? 0 : (hash2(i, j, seed ^ 0x2f6b9d1) / 4294967296 - 0.5) * 0.62)) * S;
  };
  const py = (k: number): number => {
    const i = k % n;
    const j = (k - i) / n;
    return (j + (ocean[k] ? 0 : (hash2(i, j, seed ^ 0x7c1e5a3) / 4294967296 - 0.5) * 0.62)) * S;
  };
  const chains: { xs: number[]; ys: number[]; ws: number[]; nodes: number[] }[] = [];
  for (const s of order) {
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    const nodes: number[] = [];
    let c = s;
    let idx = 0;
    let lastW = 0;
    while (c >= 0) {
      if (ocean[c]) {
        // run a little way out to sea so the mouth is open
        const m = xs.length;
        const ox = px(c);
        const oy = py(c);
        xs.push(ox, m > 0 ? ox + (ox - xs[m - 1]) * 1.2 : ox);
        ys.push(oy, m > 0 ? oy + (oy - ys[m - 1]) * 1.2 : oy);
        ws.push(lastW, lastW);
        break;
      }
      if (claimed[c]) {
        // confluence: overlap two nodes of the receiving river so no gap can
        // open between the smoothed curves
        xs.push(px(c));
        ys.push(py(c));
        ws.push(lastW);
        const next = parent[c];
        if (next >= 0) {
          xs.push(px(next));
          ys.push(py(next));
          ws.push(lastW);
        }
        break;
      }
      claimed[c] = 1;
      nodes.push(c);
      lastW = halfWidth(flow[c]) * Math.min(1, 0.25 + idx * 0.15);
      xs.push(px(c));
      ys.push(py(c));
      ws.push(lastW);
      idx++;
      c = parent[c];
    }
    if (xs.length >= 3) chains.push({ xs, ys, ws, nodes });
  }

  // ---- 6. lakes ----------------------------------------------------------
  const lakes: number[] = [];
  const lakeOk = (k: number, r: number): boolean => {
    if (seaDist[k] * S < r * 1.5 + 900) return false;
    const x = (k % n) * S;
    const y = Math.floor(k / n) * S;
    for (let l = 0; l < lakes.length; l += 3) {
      const dx = lakes[l] - x;
      const dy = lakes[l + 1] - y;
      const gap = lakes[l + 2] + r + 2600;
      if (dx * dx + dy * dy < gap * gap) return false;
    }
    return true;
  };
  for (let pass = 0; pass < 6 && lakes.length / 3 < params.lakes; pass++) {
    for (const chain of chains) {
      if (lakes.length / 3 >= params.lakes) break;
      const len = chain.nodes.length;
      if (len < 6) continue;
      const roll = rng();
      const atHead = roll < 0.3;
      const r = atHead ? 260 + 320 * rng() : 380 + 1000 * rng() * rng();
      const idx = atHead ? 0 : Math.floor(len * (0.2 + 0.5 * rng()));
      const k = chain.nodes[Math.min(len - 1, idx)];
      if (roll > 0.75 || !lakeOk(k, r)) continue;
      lakes.push((k % n) * S, Math.floor(k / n) * S, r);
    }
  }
  for (let l = 0; l < lakes.length; l += 3) {
    const lx = lakes[l];
    const ly = lakes[l + 1];
    const r = lakes[l + 2];
    const reach = Math.ceil((r * 1.7) / S);
    const ci = Math.round(lx / S);
    const cj = Math.round(ly / S);
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
        const x = i * S;
        const y = j * S;
        const dx = x - lx;
        const dy = y - ly;
        const d = Math.sqrt(dx * dx + dy * dy);
        // an uneven shoreline: the radius breathes with direction-free noise
        const wobble =
          1 + 0.3 * lakeNoise(x / (r * 1.3) + l * 7.1, y / (r * 1.3)) + 0.12 * lakeNoise(x / (r * 0.45), y / (r * 0.45) + l);
        const v = (d - r * wobble) * LAKE_GRADIENT;
        const k = j * n + i;
        // the basin fades out a short way up the shore, so the ground around
        // the lake joins the surrounding land without a step
        if (v < e[k] && v < LAKE_REACH_E) {
          const w = 1 - smoothstep(0.6 * LAKE_REACH_E, LAKE_REACH_E, v);
          e[k] += (v - e[k]) * w;
        }
      }
    }
  }

  // ---- 7. smooth the chains into segments --------------------------------
  const segs: number[] = [];
  for (const chain of chains) {
    let { xs, ys, ws } = chain;
    for (let iter = 0; iter < 2; iter++) {
      const nx: number[] = [xs[0]];
      const ny: number[] = [ys[0]];
      const nw: number[] = [ws[0]];
      for (let i = 0; i < xs.length - 1; i++) {
        nx.push(0.75 * xs[i] + 0.25 * xs[i + 1], 0.25 * xs[i] + 0.75 * xs[i + 1]);
        ny.push(0.75 * ys[i] + 0.25 * ys[i + 1], 0.25 * ys[i] + 0.75 * ys[i + 1]);
        nw.push(0.75 * ws[i] + 0.25 * ws[i + 1], 0.25 * ws[i] + 0.75 * ws[i + 1]);
      }
      nx.push(xs[xs.length - 1]);
      ny.push(ys[ys.length - 1]);
      nw.push(ws[ws.length - 1]);
      xs = nx;
      ys = ny;
      ws = nw;
    }
    for (let i = 0; i < xs.length - 1; i++) {
      segs.push(xs[i], ys[i], ws[i], xs[i + 1], ys[i + 1], ws[i + 1]);
    }
  }
  if (segs.length % RIVER_STRIDE !== 0) throw new Error('river packing');
  return { rivers: new Float32Array(segs), lakes: new Float32Array(lakes) };
}
