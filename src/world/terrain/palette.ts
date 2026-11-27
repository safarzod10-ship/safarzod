/** Land colours (sRGB 0..255). Tuned for a soft, slightly stylised look. */
import type { RGB } from '../ocean/oceanPalette.ts';

export const LAND = {
  grassDry: [160, 190, 98] as RGB,
  grassMid: [114, 176, 82] as RGB,
  grassLush: [74, 152, 74] as RGB,
  meadow: [176, 200, 104] as RGB,
  canopy: [62, 122, 62] as RGB,
  forestFloor: [86, 138, 66] as RGB,
  sandDry: [234, 218, 172] as RGB,
  sandWet: [205, 190, 146] as RGB,
  flowers: [
    [246, 244, 230],
    [242, 216, 96],
    [222, 176, 214],
  ] as readonly RGB[],
} as const;

/** Elevation model used for hill shading (world units). */
export const RELIEF = {
  height: 34,
  /** Extra rise right behind the beach so the land reads as raised. */
  bank: 2.5,
  /** Light direction (pointing from the surface to the light), normalised. */
  light: [-0.52, -0.62, 0.59] as readonly [number, number, number],
  strength: 1,
  min: 0.78,
  max: 1.2,
} as const;
