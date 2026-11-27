import { BASE_SPACING, FINEST_LEVEL, FOG, GRID_NODES, LODS, WORLD_SIZE } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { RegionsRaw } from '../regions/regions.ts';
import { makeNoise, type Noise2D } from './noise.ts';
import { forestValue, reliefValue } from './procedural.ts';
import { RIVER_GRADIENT, RiverNetwork } from './rivers.ts';
import { ScalarGrid } from './ScalarGrid.ts';
import type { WorldParams } from './WorldParams.ts';

/** Facts about the generated world that other systems can rely on. */
export interface WorldMeta {
  readonly params: WorldParams;
  /** Bounding box of all land, world units. */
  readonly landBounds: Rect;
  /** Area the camera may show: land + ocean ring + fog. */
  readonly cameraBounds: Rect;
  /** Land area in wu^2 (= m^2) and as a fraction of the world square. */
  readonly landArea: number;
  readonly landFraction: number;
  /** Share of land that is dry ground clear of beaches and banks. */
  readonly buildableFraction: number;
  /** Share of land covered by forest or groves. */
  readonly forestFraction: number;
  readonly lakeCount: number;
  /** Total length of rivers, wu. */
  readonly riverLength: number;
  readonly regionCount: number;
  /** Smallest / average / largest region land area, wu^2. */
  readonly regionAreaMin: number;
  readonly regionAreaAvg: number;
  readonly regionAreaMax: number;
  readonly generationMs: number;
}

/** Plain, transferable form of the generated world (worker <-> main). */
export interface WorldFieldsRaw {
  params: WorldParams;
  meta: WorldMeta;
  e: Float32Array;
  forest: Float32Array;
  moist: Float32Array;
  meadow: Float32Array;
  coastDist: Float32Array;
  inland: Float32Array;
  rivers: Float32Array;
  lakes: Float32Array;
  regions: RegionsRaw;
}

export const COARSE_NODES = 257;
export const COARSE_SPACING = WORLD_SIZE / (COARSE_NODES - 1);

/** e-value above which ground counts as buildable (clear of beach / bank). */
export const BUILDABLE_E = 0.008;
/** Tree cover above which a spot is considered wooded. */
export const WOODED_DENSITY = 0.5;

/** Noise coordinates of the coast are world units divided by this. */
export const NOISE_SCALE = 40000;
export const COAST_FREQUENCY = 1.35;
export const COAST_GAIN = 0.54;
/** Octaves of the coast noise stored in the base grid. */
export const COAST_BASE_OCTAVES = 6;
/** Further octaves added procedurally, one per finer LOD level. */
const COAST_DETAIL_OCTAVES = 6;

export { FINEST_LEVEL };

/**
 * The generated world. Immutable after generation.
 *
 * Grids (Catmull-Rom sampled):
 *   e          coast function incl. lakes. Land where e > 0. (128 wu)
 *   forest     regional tree cover, before local detail (512 wu)
 *   moist      grass colour driver 0..1 (512 wu)
 *   meadow     flowering-meadow mask 0..1 (512 wu)
 *   coastDist  distance (wu) from the continent, 0 on it (for the fog)
 *   inland     coast function before lakes, coarse: tells sea from fresh water
 * Geometry:
 *   rivers     RiverNetwork (segments + spatial hash)
 *   lakes      packed x, y, radius
 *   regions    the 1000 player regions (see regions/regions.ts)
 * Procedural (seeded noise, evaluated on demand):
 *   reliefAt, forestAt, coastDetail
 */
export class WorldFields {
  readonly params: WorldParams;
  readonly meta: WorldMeta;
  readonly e: ScalarGrid;
  readonly forest: ScalarGrid;
  readonly moist: ScalarGrid;
  readonly meadow: ScalarGrid;
  readonly coastDist: ScalarGrid;
  readonly inland: ScalarGrid;
  readonly rivers: RiverNetwork;
  readonly lakes: Float32Array;
  readonly regions: RegionsRaw;

  readonly detailNoise: Noise2D;
  readonly colorNoise: Noise2D;
  readonly beachNoise: Noise2D;
  readonly reliefNoise: Noise2D;
  readonly groveNoise: Noise2D;
  readonly decoSeed: number;

  private readonly detailWavelength: number[] = [];
  private readonly detailAmp: number[] = [];

  constructor(raw: WorldFieldsRaw) {
    this.params = raw.params;
    this.meta = raw.meta;
    this.e = new ScalarGrid(GRID_NODES, BASE_SPACING, raw.e);
    this.forest = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.forest);
    this.moist = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.moist);
    this.meadow = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.meadow);
    this.coastDist = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.coastDist);
    this.inland = new ScalarGrid(COARSE_NODES, COARSE_SPACING, raw.inland);
    this.rivers = new RiverNetwork(raw.rivers);
    this.lakes = raw.lakes;
    this.regions = raw.regions;

    const seed = raw.params.seed;
    this.detailNoise = makeNoise(seed, 'coast-detail');
    this.colorNoise = makeNoise(seed, 'color');
    this.beachNoise = makeNoise(seed, 'beach');
    this.reliefNoise = makeNoise(seed, 'relief');
    this.groveNoise = makeNoise(seed, 'forest-groves');
    this.decoSeed = seed ^ 0x5bd1e995;

    // The fine coastline continues the fractal of the base grid: octave k has
    // half the wavelength and COAST_GAIN times the amplitude of octave k - 1.
    let norm = 0;
    for (let k = 0; k < COAST_BASE_OCTAVES; k++) norm += COAST_GAIN ** k;
    for (let d = 0; d < COAST_DETAIL_OCTAVES; d++) {
      const k = COAST_BASE_OCTAVES + d;
      this.detailWavelength.push(NOISE_SCALE / (COAST_FREQUENCY * 2 ** k));
      this.detailAmp.push((raw.params.coastRoughness * COAST_GAIN ** k) / norm);
    }
  }

  toRaw(): WorldFieldsRaw {
    return {
      params: this.params,
      meta: this.meta,
      e: this.e.data,
      forest: this.forest.data,
      moist: this.moist.data,
      meadow: this.meadow.data,
      coastDist: this.coastDist.data,
      inland: this.inland.data,
      rivers: this.rivers.segments,
      lakes: this.lakes,
      regions: this.regions,
    };
  }

  /**
   * Fine coastline detail on top of the interpolated base field. LOD level
   * L adds the first L detail octaves (it cannot represent shorter ones); the
   * finest level is the authoritative shape of every shore.
   */
  coastDetail(x: number, y: number, level: number): number {
    let sum = 0;
    const count = level < this.detailAmp.length ? level : this.detailAmp.length;
    for (let i = 0; i < count; i++) {
      const w = this.detailWavelength[i];
      sum += this.detailAmp[i] * this.detailNoise(x / w + i * 11.7, y / w - i * 5.3);
    }
    return sum;
  }

  /**
   * Authoritative coast value at a world position: sea, lakes and rivers.
   * > 0 is land. Matches what the finest terrain LOD draws.
   */
  coastValue(x: number, y: number, level: number = FINEST_LEVEL): number {
    let v = this.e.sample(x, y);
    if (level >= 1 && v < 0.06 && v > -0.06) {
      const fade = 1 - smoothstep(0.03, 0.06, v < 0 ? -v : v);
      v += fade * this.coastDetail(x, y, level);
    }
    const sd = this.rivers.sdAt(x, y);
    if (sd !== Infinity) {
      const r = sd * RIVER_GRADIENT;
      if (r < v) v = r;
    }
    return v;
  }

  /** Gentle hills in about [-0.7, 0.7]; `texel` limits the detail (wu). */
  reliefAt(x: number, y: number, texel: number = LODS[FINEST_LEVEL].texel): number {
    return reliefValue(this.reliefNoise, x, y, texel * 5);
  }

  /** Tree cover 0..1 (forests, groves, open country). */
  forestAt(x: number, y: number, texel: number = LODS[FINEST_LEVEL].texel): number {
    return forestValue(this.forest.sample(x, y), this.groveNoise, x, y, texel);
  }
}

/** Normalised (0..1) distance value used by the fog texture. */
export function fogDistanceByte(distWu: number): number {
  const v = Math.round((distWu / FOG.range) * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
