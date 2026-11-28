/** Land colours (sRGB 0..255). Tuned for a soft, slightly stylised look. */
import type { RGB } from '../ocean/oceanPalette.ts';

export const LAND = {
  grassDry: [152, 182, 52] as RGB,
  grassMid: [110, 166, 44] as RGB,
  grassLush: [70, 140, 38] as RGB,
  meadow: [154, 186, 52] as RGB,
  canopy: [62, 122, 62] as RGB,
  forestFloor: [82, 132, 50] as RGB,
  sandDry: [234, 218, 172] as RGB,
  sandWet: [205, 190, 146] as RGB,
} as const;

/** Elevation model used for hill shading (world units). */
export const RELIEF = {
  height: 200,
  /** Extra rise right behind the beach so the land reads as raised. */
  bank: 2.5,
  /** e range over which land rises from the waterline to full height. */
  riseE: 0.03,
  bankE: 0.008,
  /** Light direction (pointing from the surface to the light), normalised. */
  light: [-0.52, -0.62, 0.59] as readonly [number, number, number],
  strength: 1,
  min: 0.78,
  max: 1.2,
} as const;
