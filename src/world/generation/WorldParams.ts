/**
 * Everything needed to regenerate the world bit-for-bit.
 * Persisting this small object (see core/storage.ts) is enough to always get
 * the same continent back - no map data has to be stored.
 */
export interface WorldParams {
  /** Schema version of the generator. Bump when the algorithm changes shape. */
  readonly version: 2;
  /** 32-bit unsigned seed. */
  readonly seed: number;
  /** Half extents (wu) of the ellipse the continent is sculpted inside. */
  readonly radiusX: number;
  readonly radiusY: number;
  /** Number of mask lobes; more lobes = more irregular silhouette. */
  readonly lobes: number;
  /** Amplitude of the coastline noise (bays / peninsulas). */
  readonly coastRoughness: number;
  /** Strength of the domain warp that twists the silhouette. */
  readonly warp: number;
  /** 0..1, how wooded the continent is (forests and groves). */
  readonly forest: number;
  /** Number of river sources and of lakes. */
  readonly rivers: number;
  readonly lakes: number;
}

export const GENERATOR_VERSION = 2 as const;

/** The canonical world of the game. Changing it changes the map for everyone. */
export const DEFAULT_WORLD_PARAMS: WorldParams = {
  version: GENERATOR_VERSION,
  seed: 20261127,
  radiusX: 34400,
  radiusY: 43200,
  lobes: 7,
  coastRoughness: 0.34,
  warp: 0.2,
  forest: 0.5,
  rivers: 90,
  lakes: 34,
};

export function normalizeWorldParams(input: Partial<WorldParams> | null | undefined): WorldParams {
  const d = DEFAULT_WORLD_PARAMS;
  if (!input || input.version !== GENERATOR_VERSION) return d;
  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    version: GENERATOR_VERSION,
    seed: num(input.seed, d.seed, 0, 0xffffffff) >>> 0,
    radiusX: num(input.radiusX, d.radiusX, 20000, 36000),
    radiusY: num(input.radiusY, d.radiusY, 20000, 44000),
    lobes: Math.round(num(input.lobes, d.lobes, 3, 10)),
    coastRoughness: num(input.coastRoughness, d.coastRoughness, 0.05, 0.5),
    warp: num(input.warp, d.warp, 0, 0.3),
    forest: num(input.forest, d.forest, 0, 1),
    rivers: Math.round(num(input.rivers, d.rivers, 0, 200)),
    lakes: Math.round(num(input.lakes, d.lakes, 0, 80)),
  };
}
