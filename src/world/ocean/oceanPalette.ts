/**
 * Baked ocean colour: a function of how far below sea level a point is.
 * The animated part of the ocean (ripples, foam, waves) lives in oceanGlsl.ts.
 */
import { lerp, smoothstep } from '../../core/math.ts';

export type RGB = readonly [number, number, number];

export const OCEAN = {
  /** Seabed sand right at the waterline - matches the wet beach colour. */
  wetSand: [205, 190, 146] as RGB,
  shallow: [92, 201, 196] as RGB,
  mid: [44, 150, 186] as RGB,
  deep: [27, 104, 162] as RGB,
  abyss: [21, 82, 140] as RGB,
  /** Rivers: one calm colour regardless of depth. */
  river: [66, 168, 190] as RGB,
} as const;

const tmp: [number, number, number] = [0, 0, 0];

/**
 * @param depthE     how far below sea level the coast function is (>= 0)
 * @param shoreDist  estimated distance to the waterline, world units (>= 0)
 * @param shoreLen   length (wu) of the sand -> shallow water gradient
 */
export function oceanColor(depthE: number, shoreDist: number, shoreLen: number): [number, number, number] {
  const o = OCEAN;
  const s1 = smoothstep(0, shoreLen, shoreDist);
  const s2 = smoothstep(0.008, 0.07, depthE);
  const s3 = smoothstep(0.06, 0.34, depthE);
  const s4 = smoothstep(0.32, 1.3, depthE);
  let r = lerp(o.wetSand[0], o.shallow[0], s1);
  let g = lerp(o.wetSand[1], o.shallow[1], s1);
  let b = lerp(o.wetSand[2], o.shallow[2], s1);
  r = lerp(r, o.mid[0], s2);
  g = lerp(g, o.mid[1], s2);
  b = lerp(b, o.mid[2], s2);
  r = lerp(r, o.deep[0], s3);
  g = lerp(g, o.deep[1], s3);
  b = lerp(b, o.deep[2], s3);
  tmp[0] = lerp(r, o.abyss[0], s4);
  tmp[1] = lerp(g, o.abyss[1], s4);
  tmp[2] = lerp(b, o.abyss[2], s4);
  return tmp;
}
