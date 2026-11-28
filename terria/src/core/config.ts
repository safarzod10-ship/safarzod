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

/** World square side, in world units (131 km). */
export const WORLD_SIZE = 131072;
export const WORLD_CENTER = WORLD_SIZE / 2;

/**
 * Recommended base cell for anything placed on land (plots, buildings).
 * Chunk sizes are multiples of it.
 */
export const GRID_CELL = 16;
/** Spacing (wu) of the base generation grid; finer detail is procedural. */
export const BASE_SPACING = 128;
/** Nodes per side of the base generation grid (shared-edge samples). */
export const GRID_NODES = WORLD_SIZE / BASE_SPACING + 1;

/** The continent is divided into this many player regions. */
export const REGION_COUNT = 1000;
/** Share of a region handed out as the starting plot. */
export const STARTER_PLOT_SHARE = 0.01;

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
  { level: 0, chunkSize: 32768, texel: 128, band: 1024 },
  { level: 1, chunkSize: 16384, texel: 64, band: 512 },
  { level: 2, chunkSize: 8192, texel: 32, band: 256 },
  { level: 3, chunkSize: 4096, texel: 16, band: 128 },
  { level: 4, chunkSize: 2048, texel: 8, band: 64 },
  { level: 5, chunkSize: 1024, texel: 4, band: 40 },
  { level: 6, chunkSize: 512, texel: 2, band: 28 },
];
export const FINEST_LEVEL = LODS.length - 1;
/** Up to this level groves are painted into the terrain; finer levels use sprites. */
export const CANOPY_MAX_LEVEL = 4;

export const TERRAIN = {
  /** A finer LOD is requested once one texel would cover more device px. */
  maxTexelPx: 3,
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
  /**
   * The camera looks at the ground from 40 degrees above the horizon (2.5D):
   * the world is drawn squashed vertically by sin(40 deg). Buildings and trees
   * are drawn upright (counter-scaled), pre-rendered from the same angle.
   */
  tilt: 0.6428,
  /** Max zoom: CSS px per world unit. */
  maxScale: 1.6,
  /** Ocean + fog ring kept around the land bounding box, world units. */
  fitMargin: 11000,
  /** Extra zoom-out allowed beyond "continent fits the screen" (1 = none). */
  minScaleSlack: 1,
  wheelSmooth: 6,
  wheelPercent: 0.12,
  friction: 0.94,
} as const;

export const FOG = {
  /** Distance from the coast where fog starts / is fully opaque (wu). */
  start: 3500,
  end: 15000,
  /** Amplitude (wu) of the noise that breaks the fog edge into wisps. */
  wisp: 5000,
  /** Distance encoded as 255 in the fog distance texture (wu). */
  range: 32768,
  /** Fog colour, linear-ish sRGB 0..1. Also the renderer clear colour. */
  color: [0.925, 0.949, 0.965] as readonly [number, number, number],
  colorHex: 0xecf2f6,
} as const;

export const TREES = {
  /** Tree chunk side (wu). */
  chunkSize: 1024,
  /** Jittered placement grid spacing (wu). */
  spacing: 13,
  /** Device px per wu where tree sprites start to fade in / are opaque. */
  showFrom: 0.42,
  fullAt: 0.56,
  cacheChunks: 28,
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
