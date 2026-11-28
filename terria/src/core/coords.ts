/**
 * Coordinate conversions shared by every system that places things on the map.
 * All functions are pure. See CLAUDE.md for the full coordinate-system notes.
 */
import { GRID_CELL, LODS, WORLD_SIZE } from './config.ts';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CellCoord {
  /** Column, 0 at the west edge of the world. */
  cx: number;
  /** Row, 0 at the north edge of the world. */
  cy: number;
}

/** World units -> land grid cell (cell = GRID_CELL wu, origin top-left). */
export function worldToCell(x: number, y: number, cellSize: number = GRID_CELL): CellCoord {
  return { cx: Math.floor(x / cellSize), cy: Math.floor(y / cellSize) };
}

/** Centre of a land grid cell in world units. */
export function cellToWorld(cx: number, cy: number, cellSize: number = GRID_CELL): Vec2 {
  return { x: (cx + 0.5) * cellSize, y: (cy + 0.5) * cellSize };
}

/** Snap a world position to the nearest cell corner. */
export function snapToGrid(x: number, y: number, cellSize: number = GRID_CELL): Vec2 {
  return { x: Math.round(x / cellSize) * cellSize, y: Math.round(y / cellSize) * cellSize };
}

export function isInsideWorld(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= WORLD_SIZE && y <= WORLD_SIZE;
}

/** Terrain chunk index containing a world position at the given LOD level. */
export function worldToChunk(x: number, y: number, level: number): CellCoord {
  const size = LODS[level].chunkSize;
  return { cx: Math.floor(x / size), cy: Math.floor(y / size) };
}

export function chunksPerSide(level: number): number {
  return WORLD_SIZE / LODS[level].chunkSize;
}

export function chunkKey(level: number, cx: number, cy: number): number {
  // level < 8, cx/cy < 4096
  return (level << 24) | (cy << 12) | cx;
}
