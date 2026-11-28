/**
 * Pure camera math: zoom limits and position clamping. Kept free of PixiJS so
 * it can be unit-tested and reused (e.g. by a server validating a viewport).
 */
import type { Rect } from '../core/math.ts';

export interface ZoomLimits {
  /** CSS px per world unit at which `bounds` exactly fits the screen. */
  minScale: number;
  maxScale: number;
}

export function computeZoomLimits(
  screenW: number,
  screenH: number,
  bounds: Rect,
  maxScale: number,
  slack = 1,
): ZoomLimits {
  const fit = Math.min(screenW / bounds.width, screenH / bounds.height) / slack;
  return { minScale: Math.min(fit, maxScale), maxScale };
}

/**
 * Keep the visible rectangle inside `bounds`. On an axis where the view is
 * larger than the bounds (letterboxing at minimum zoom) the view is centred,
 * and what shows beyond the bounds is fog by construction.
 */
export function clampCenter(
  x: number,
  y: number,
  scale: number,
  screenW: number,
  screenH: number,
  bounds: Rect,
): { x: number; y: number } {
  const halfW = screenW / scale / 2;
  const halfH = screenH / scale / 2;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const nx = 2 * halfW >= bounds.width ? cx : Math.min(Math.max(x, bounds.x + halfW), bounds.x + bounds.width - halfW);
  const ny = 2 * halfH >= bounds.height ? cy : Math.min(Math.max(y, bounds.y + halfH), bounds.y + bounds.height - halfH);
  return { x: nx, y: ny };
}
