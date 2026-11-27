/**
 * Read-only questions other systems may ask about the terrain.
 *
 * This is THE extension point for building placement, plots, pathfinding and
 * server-side validation: everything here is a pure function of WorldParams,
 * so a server running the same generator gets the same answers.
 */
import { GRID_CELL, WORLD_SIZE } from '../core/config.ts';
import type { Rect } from '../core/math.ts';
import { BUILDABLE_E, WOODED_DENSITY, type WorldFields, type WorldMeta } from './generation/WorldFields.ts';
import { RegionIndex, type RegionInfo } from './regions/regions.ts';

export interface WorldQuery {
  readonly meta: WorldMeta;
  /** The 1000 player regions: outlines, neighbours, starter plots. */
  readonly regions: RegionIndex;
  /** True on dry land: not sea, not a lake, not a river. */
  isLand(x: number, y: number): boolean;
  /** Land, clear of beaches and river banks. Trees do not block. */
  isBuildable(x: number, y: number): boolean;
  /** Every sampled point of the footprint is buildable (GRID_CELL lattice). */
  isAreaBuildable(rect: Rect): boolean;
  /** Tree cover 0..1; above ~0.5 the spot is wooded. */
  forestDensity(x: number, y: number): number;
  isWooded(x: number, y: number): boolean;
  /** Gentle hill height in about [-0.7, 0.7]; cosmetic, never blocks building. */
  relief(x: number, y: number): number;
  /** Signed coast function: > 0 land, < 0 water, magnitude grows away from the shore. */
  coastValue(x: number, y: number): number;
  /** Distance (wu) to the nearest river bank within 64 wu, else Infinity; negative in the river. */
  riverDistance(x: number, y: number): number;
  /** Region containing a land point, or null over water / outside the world. */
  regionAt(x: number, y: number): RegionInfo | null;
}

export function createWorldQuery(world: WorldFields): WorldQuery {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x <= WORLD_SIZE && y <= WORLD_SIZE;
  const regions = new RegionIndex(world.regions);
  const query: WorldQuery = {
    meta: world.meta,
    regions,
    coastValue: (x, y) => (inside(x, y) ? world.coastValue(x, y) : -1),
    isLand: (x, y) => inside(x, y) && world.coastValue(x, y) > 0,
    isBuildable: (x, y) => inside(x, y) && world.coastValue(x, y) > BUILDABLE_E,
    isAreaBuildable(rect) {
      const x1 = rect.x + rect.width;
      const y1 = rect.y + rect.height;
      for (let y = rect.y; ; y += GRID_CELL) {
        const yy = y > y1 ? y1 : y;
        for (let x = rect.x; ; x += GRID_CELL) {
          const xx = x > x1 ? x1 : x;
          if (!query.isBuildable(xx, yy)) return false;
          if (xx >= x1) break;
        }
        if (yy >= y1) break;
      }
      return true;
    },
    forestDensity: (x, y) => (inside(x, y) ? world.forestAt(x, y) : 0),
    isWooded: (x, y) => inside(x, y) && world.forestAt(x, y) > WOODED_DENSITY && world.coastValue(x, y) > 0,
    relief: (x, y) => (inside(x, y) ? world.reliefAt(x, y) : 0),
    riverDistance: (x, y) => world.rivers.sdAt(x, y),
    regionAt: (x, y) => (inside(x, y) && world.coastValue(x, y) > 0 ? regions.info(regions.regionAt(x, y)) : null),
  };
  return query;
}
