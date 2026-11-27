/**
 * Global, immutable configuration of the map layer.
 *
 * COORDINATE SYSTEM (see CLAUDE.md, "Coordinate system"):
 *  - World space is a square of WORLD_SIZE x WORLD_SIZE world units (wu).
 *  - Origin (0,0) is the top-left (north-west) corner, +x points east (right),
 *    +y points south (down) - the same handedness as screen space.
 *  - 1 wu is nominally 1 metre. At maximum zoom 1 wu = CAMERA.maxScale CSS px.
 *  - The continent is centred on (WORLD_CENTER, WORLD_CENTER).
 */

/** World square side, in world units. */
export const WORLD_SIZE = 16384;
export const WORLD_CENTER = WORLD_SIZE / 2;

/**
 * Spacing of the base generation grid and the recommended base cell for
 * anything placed on land (plots, buildings). Chunk sizes are multiples of it.
 */
export const GRID_CELL = 16;
/** Nodes per side of the base generation grid (shared-edge samples). */
export const GRID_NODES = WORLD_SIZE / GRID_CELL + 1;

/** Samples per side of one baked terrain chunk texture (shared edges). */
export const CHUNK_NODES = 257;

export interface LodSpec {
  readonly level: number;
  /** Chunk side in world units. */
  readonly chunkSize: number;
  /** World units covered by one texel. */
  readonly texel: number;
  /** Half-range (world units) of the shoreline distance stored in alpha. */
  readonly band: number;
}

/** Level 0 is the coarsest (always resident), the last one the finest. */
export const LODS: readonly LodSpec[] = [
  { level: 0, chunkSize: 4096, texel: 16, band: 128 },
  { level: 1, chunkSize: 2048, texel: 8, band: 64 },
  { level: 2, chunkSize: 1024, texel: 4, band: 40 },
  { level: 3, chunkSize: 512, texel: 2, band: 28 },
];

export const TERRAIN = {
  /** A finer LOD is requested once one texel would cover more device px. */
  maxTexelPx: 4,
  /** Non-base chunks kept in memory (LRU). */
  cacheChunks: 56,
  cacheChunksLowMemory: 36,
  /** Fade-in of a freshly baked chunk, ms. */
  fadeMs: 220,
  /** Tile sizes (world units) of the repeating detail textures. */
  grassTile: 128,
  grassTileFar: 733,
  noiseTile: 97,
} as const;

export const CAMERA = {
  /** Max zoom: CSS px per world unit. */
  maxScale: 1.6,
  /** Ocean + fog ring kept around the land bounding box, world units. */
  fitMargin: 1700,
  /** Extra zoom-out allowed beyond "continent fits the screen" (1 = none). */
  minScaleSlack: 1,
  wheelSmooth: 6,
  wheelPercent: 0.12,
  friction: 0.94,
} as const;

export const FOG = {
  /** Distance from the coast where fog starts / is fully opaque (wu). */
  start: 520,
  end: 2100,
  /** Distance encoded as 255 in the fog distance texture (wu). */
  range: 4096,
  /** Fog colour, linear-ish sRGB 0..1. Also the renderer clear colour. */
  color: [0.925, 0.949, 0.965] as readonly [number, number, number],
  colorHex: 0xecf2f6,
} as const;

export const TREES = {
  /** Tree chunk side (wu). */
  chunkSize: 1024,
  /** Jittered placement grid spacing (wu). */
  spacing: 12,
  /** Device px per wu where tree sprites start to fade in / are opaque. */
  showFrom: 0.36,
  fullAt: 0.5,
  cacheChunks: 72,
} as const;

export const RENDER = {
  /** Upper bound for the backing-store resolution (device pixel ratio cap). */
  maxResolution: 2,
  minResolution: 1,
  /** Frame rate while nothing moves (water keeps animating). 0 = uncapped. */
  idleFps: 30,
  idleAfterMs: 2500,
} as const;

/** Sea level in the `e` (coast function) field: land where e > 0. */
export const SEA_LEVEL = 0;
