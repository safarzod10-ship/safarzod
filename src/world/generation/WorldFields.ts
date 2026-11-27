import { FOG, GRID_CELL, GRID_NODES, WORLD_SIZE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import { makeNoise, type Noise2D } from './noise.ts';
import { ScalarGrid } from './ScalarGrid.ts';
import type { WorldParams } from './WorldParams.ts';

/** Facts about the generated world that other systems can rely on. */
export interface WorldMeta {
  readonly params: WorldParams;
  /** Bounding box of all land, world units. */
  readonly landBounds: Rect;
  /** Area the camera may show: land + ocean ring + fog. */
  readonly cameraBounds: Rect;
  /** Land area in wu^2 and as a fraction of the world square. */
  readonly landArea: number;
  readonly landFraction: number;
  /** Share of land that is open, non-beach ground suitable for building. */
  readonly buildableFraction: number;
  /** Share of land covered by groves. */
  readonly forestFraction: number;
  readonly generationMs: number;
}

/** Plain, transferable form of the generated fields (worker <-> main). */
export interface WorldFieldsRaw {
  params: WorldParams;
  meta: WorldMeta;
  e: Float32Array;
  relief: Float32Array;
  forest: Float32Array;
  moist: Float32Array;
  meadow: Float32Array;
  coastDist: Float32Array;
}

export const RELIEF_NODES = 513;
export const RELIEF_SPACING = WORLD_SIZE / (RELIEF_NODES - 1);
export const COARSE_NODES = 257;
export const COARSE_SPACING = WORLD_SIZE / (COARSE_NODES - 1);

/** e-value above which ground counts as buildable (clear of the beach). */
export const BUILDABLE_E = 0.02;
/** Forest density above which a spot is considered wooded. */
export const WOODED_DENSITY = 0.5;

/** Wavelengths (wu) and amplitudes of the fine coastline octaves. */
const DETAIL_OCTAVES: readonly { wavelength: number; amp: number; minLevel: number }[] = [
  { wavelength: 52, amp: 0.0026, minLevel: 1 },
  { wavelength: 25, amp: 0.0013, minLevel: 2 },
  { wavelength: 12, amp: 0.0006, minLevel: 3 },
];
export const FINEST_LEVEL = 3;

/**
 * The generated world: low-frequency fields on grids plus the seeded noise
 * functions used for fine detail. Immutable after generation.
 *
 *  e       coast function. Land where e > 0. |e| grows away from the shore.
 *  relief  gentle hills in [-1, 1], used for shading only.
 *  forest  grove density in [0, 1].
 *  moist   grass colour driver in [0, 1].
 *  meadow  flowering-meadow mask in [0, 1].
 *  coastDist  distance (wu) from the nearest land, 0 on land (for the fog).
 */
export class WorldFields {
  readonly params: WorldParams;
  readonly meta: WorldMeta;
  readonly e: ScalarGrid;
  readonly relief: ScalarGrid;
  readonly forest: ScalarGrid;
  readonly moist: ScalarGrid;
  readonly meadow: ScalarGrid;
  readonly coastDist: ScalarGrid;

  readonly detailNoise: Noise2D;
  readonly colorNoise: Noise2D;
  readonly beachNoise: Noise2D;
  readonly decoSeed: number;

  constructor(raw: WorldFieldsRaw) {
    this.params = raw.params;
    this.meta = raw.meta;
    this.e = new ScalarGrid(GRID_NODES, GRID_CELL, raw.e);
    this.relief = new ScalarGrid(RELIEF_NODES, RELIEF_SPACING, raw.relief);
    this.forest = new ScalarGrid(RELIEF_NODES, RELIEF_SPACING, raw.forest);
    this.moist = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.moist);
    this.meadow = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.meadow);
    this.coastDist = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.coastDist);
    const seed = raw.params.seed;
    this.detailNoise = makeNoise(seed, 'coast-detail');
    this.colorNoise = makeNoise(seed, 'color');
    this.beachNoise = makeNoise(seed, 'beach');
    this.decoSeed = seed ^ 0x5bd1e995;
  }

  toRaw(): WorldFieldsRaw {
    return {
      params: this.params,
      meta: this.meta,
      e: this.e.data,
      relief: this.relief.data,
      forest: this.forest.data,
      moist: this.moist.data,
      meadow: this.meadow.data,
      coastDist: this.coastDist.data,
    };
  }

  /**
   * Fine coastline detail added on top of the interpolated base field.
   * `level` selects how many octaves a given LOD can represent; the finest
   * level is the authoritative shape of the coast.
   */
  coastDetail(x: number, y: number, level: number): number {
    let sum = 0;
    for (let i = 0; i < DETAIL_OCTAVES.length; i++) {
      const o = DETAIL_OCTAVES[i];
      if (level < o.minLevel) break;
      sum += o.amp * this.detailNoise(x / o.wavelength + i * 11.7, y / o.wavelength - i * 5.3);
    }
    return sum;
  }

  /** Authoritative coast value at a world position (finest detail). */
  coastValue(x: number, y: number, level: number = FINEST_LEVEL): number {
    const e = this.e.sample(x, y);
    if (level < 1 || e > 0.06 || e < -0.06) return e;
    const fade = 1 - smoothstep(0.03, 0.06, e < 0 ? -e : e);
    return e + fade * this.coastDetail(x, y, level);
  }
}

/** Normalised (0..1) distance value used by the fog texture. */
export function fogDistanceByte(distWu: number): number {
  const v = Math.round((distWu / FOG.range) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
