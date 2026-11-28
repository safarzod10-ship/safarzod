/**
 * A square grid of float samples covering the whole world with shared edges:
 * node (i, j) sits at world position (i * spacing, j * spacing).
 *
 * Sampling uses Catmull-Rom (C1 continuous) interpolation so that derived
 * quantities such as hill shading show no creases at cell borders.
 */
export class ScalarGrid {
  readonly nodes: number;
  readonly spacing: number;
  readonly data: Float32Array;

  constructor(nodes: number, spacing: number, data?: Float32Array) {
    this.nodes = nodes;
    this.spacing = spacing;
    this.data = data ?? new Float32Array(nodes * nodes);
  }

  /** Bicubic (Catmull-Rom) sample at a world position; clamps at the edges. */
  sample(x: number, y: number): number {
    const n = this.nodes;
    const max = n - 1;
    let gx = x / this.spacing;
    let gy = y / this.spacing;
    if (gx < 0) gx = 0;
    else if (gx > max) gx = max;
    if (gy < 0) gy = 0;
    else if (gy > max) gy = max;
    let ix = Math.floor(gx);
    let iy = Math.floor(gy);
    if (ix >= max) ix = max - 1;
    if (iy >= max) iy = max - 1;
    const tx = gx - ix;
    const ty = gy - iy;

    const x0 = ix > 0 ? ix - 1 : 0;
    const x3 = ix + 2 <= max ? ix + 2 : max;
    const y0 = iy > 0 ? iy - 1 : 0;
    const y3 = iy + 2 <= max ? iy + 2 : max;

    const wx0 = ((-tx + 2) * tx - 1) * tx * 0.5;
    const wx1 = ((3 * tx - 5) * tx * tx + 2) * 0.5;
    const wx2 = ((-3 * tx + 4) * tx + 1) * tx * 0.5;
    const wx3 = (tx - 1) * tx * tx * 0.5;
    const wy0 = ((-ty + 2) * ty - 1) * ty * 0.5;
    const wy1 = ((3 * ty - 5) * ty * ty + 2) * 0.5;
    const wy2 = ((-3 * ty + 4) * ty + 1) * ty * 0.5;
    const wy3 = (ty - 1) * ty * ty * 0.5;

    const d = this.data;
    const r0 = y0 * n;
    const r1 = iy * n;
    const r2 = (iy + 1) * n;
    const r3 = y3 * n;
    const x1 = ix;
    const x2 = ix + 1;
    return (
      wy0 * (wx0 * d[r0 + x0] + wx1 * d[r0 + x1] + wx2 * d[r0 + x2] + wx3 * d[r0 + x3]) +
      wy1 * (wx0 * d[r1 + x0] + wx1 * d[r1 + x1] + wx2 * d[r1 + x2] + wx3 * d[r1 + x3]) +
      wy2 * (wx0 * d[r2 + x0] + wx1 * d[r2 + x1] + wx2 * d[r2 + x2] + wx3 * d[r2 + x3]) +
      wy3 * (wx0 * d[r3 + x0] + wx1 * d[r3 + x1] + wx2 * d[r3 + x2] + wx3 * d[r3 + x3])
    );
  }

  /**
   * Fill `out` (n x n, row-major) with samples on a regular lattice starting
   * at (x0, y0) with the given step. Same result as calling sample() per
   * point, but hoists the per-column work out of the inner loop.
   */
  upsample(x0: number, y0: number, step: number, n: number, out: Float32Array): void {
    for (let j = 0; j < n; j++) {
      const y = y0 + j * step;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        out[row + i] = this.sample(x0 + i * step, y);
      }
    }
  }
}
