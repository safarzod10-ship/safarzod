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

export interface WorldQuery {
  readonly meta: WorldMeta;
  /** True if the point is on land (matches the finest rendered coastline). */
  isLand(x: number, y: number): boolean;
  /** Land, clear of the beach and of the water's edge. Trees do not block. */
  isBuildable(x: number, y: number): boolean;
  /** Every sampled point of the footprint is buildable (GRID_CELL lattice). */
  isAreaBuildable(rect: Rect): boolean;
  /** Grove density 0..1; above ~0.5 the spot is wooded. */
  forestDensity(x: number, y: number): number;
  isWooded(x: number, y: number): boolean;
  /** Gentle hill height in [-1, 1]; cosmetic, never blocks building. */
  relief(x: number, y: number): number;
  /** Signed coast function: > 0 land, < 0 water, magnitude grows inland/offshore. */
  coastValue(x: number, y: number): number;
}

export function createWorldQuery(world: WorldFields): WorldQuery {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x <= WORLD_SIZE && y <= WORLD_SIZE;
  const query: WorldQuery = {
    meta: world.meta,
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
    forestDensity: (x, y) => (inside(x, y) ? world.forest.sample(x, y) : 0),
    isWooded: (x, y) => inside(x, y) && world.forest.sample(x, y) > WOODED_DENSITY && world.coastValue(x, y) > 0,
    relief: (x, y) => (inside(x, y) ? world.relief.sample(x, y) : 0),
  };
  return query;
}
