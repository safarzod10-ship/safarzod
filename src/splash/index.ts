/**
 * TERRIA loading splash ("World Awakening").
 *
 * A self-contained module: it draws on the game's PixiJS application while the
 * game loads, shows the real loading state, opens onto the map when the game
 * is ready and then frees everything it created. It knows nothing about the
 * map itself; `main.ts` wires the two together.
 */
export { createSplash } from './SplashScreen.ts';
export type { Splash, SplashMode, SplashOptions, SplashPhase, SplashQuality } from './SplashScreen.ts';
export { SPLASH_DARK } from './layers/WorldLayer.ts';
