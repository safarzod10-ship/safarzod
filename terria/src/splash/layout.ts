/**
 * PURE layout maths of the splash: where the illustration and the logo sit on
 * a screen of any shape. No PixiJS, no DOM - covered by tests/splash.test.ts.
 *
 * The illustration is portrait (9:16). On a phone it covers the screen. On a
 * wide screen it would have to be blown up to several times its resolution,
 * so there it fills a centred column ("frame") and the sides are painted with
 * a soft, dark echo of it.
 */

/** The frame never gets wider than this share of the screen height. */
export const MAX_FRAME_ASPECT = 0.8;
/** Logo width as a share of the frame, and its hard limits (CSS px / share of height). */
export const LOGO_WIDTH_SHARE = 0.68;
export const LOGO_MAX_WIDTH = 430;
export const LOGO_MAX_HEIGHT_SHARE = 0.36;
/** Vertical position of the logo centre: a touch above the middle reads as centred. */
export const LOGO_CENTER_Y = 0.48;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface SplashLayout {
  /** Screen size, CSS px. */
  width: number;
  height: number;
  /** The column that shows the illustration. */
  frameX: number;
  frameWidth: number;
  /** CSS px per illustration px at camera zoom 1 ("cover" fit of the frame). */
  worldScale: number;
  /** Screen position of the illustration's centre. */
  centerX: number;
  centerY: number;
  /** CSS px per logo px (the logo's own source pixels). */
  logoScale: number;
  /** Screen position of the logo's centre. */
  logoX: number;
  logoY: number;
}

/**
 * @param world size of the illustration in its own pixels
 * @param logo size of the logo lockup in its own pixels (without padding)
 */
export function computeLayout(width: number, height: number, world: Size, logo: Size): SplashLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const frameWidth = Math.min(w, h * MAX_FRAME_ASPECT);
  const frameX = (w - frameWidth) / 2;
  const worldScale = Math.max(frameWidth / world.width, h / world.height);

  const logoWidth = Math.min(frameWidth * LOGO_WIDTH_SHARE, LOGO_MAX_WIDTH, (h * LOGO_MAX_HEIGHT_SHARE * logo.width) / logo.height);
  return {
    width: w,
    height: h,
    frameX,
    frameWidth,
    worldScale,
    centerX: w / 2,
    centerY: h / 2,
    logoScale: logoWidth / logo.width,
    logoX: w / 2,
    logoY: h * LOGO_CENTER_Y,
  };
}

/**
 * Real loading progress never runs backwards and never sits at "done" before
 * the game says so: clamp to 0..1 and keep the largest value seen.
 */
export function mergeProgress(previous: number, next: number): number {
  if (!Number.isFinite(next)) return previous;
  return Math.max(previous, Math.min(1, Math.max(0, next)));
}
