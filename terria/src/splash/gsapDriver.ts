/**
 * One frame loop for everything: while the splash is alive GSAP does not run
 * its own requestAnimationFrame, it is stepped from the PixiJS ticker that
 * already renders the game. Tweens are therefore applied in the same frame
 * they are drawn in, and a stall of the main thread (the game is loading
 * underneath) pauses the animation instead of making it jump.
 */
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin';
import { UPDATE_PRIORITY, VERSION, type Ticker } from 'pixi.js';

let registered = false;

/** Register PixiPlugin once. Only the version is handed over: the plugin's filter features are not used. */
export function setupGsap(): void {
  if (registered) return;
  registered = true;
  // must come before registerPlugin: the plugin reads the version when it initialises
  PixiPlugin.registerPIXI({ VERSION });
  gsap.registerPlugin(PixiPlugin);
}

/** GSAP's defaults, restored when the splash lets go. */
const DEFAULT_LAG_THRESHOLD = 500;
const DEFAULT_LAG_ADJUSTED = 33;
/** A frame longer than this (ms) counts as a stall and advances the animation by one normal frame. */
const STALL_MS = 100;

/**
 * Step GSAP from `ticker` instead of from its own loop.
 * @returns a function that hands GSAP back its own loop
 */
export function driveGsapFrom(ticker: Ticker): () => void {
  setupGsap();
  gsap.ticker.lagSmoothing(STALL_MS, DEFAULT_LAG_ADJUSTED);
  const step = (): void => {
    gsap.ticker.tick();
    // creating or seeking a tween wakes GSAP's own loop: put it back to sleep
    gsap.ticker.sleep();
  };
  gsap.ticker.sleep();
  // before NORMAL listeners and before the render of the same frame
  ticker.add(step, undefined, UPDATE_PRIORITY.HIGH);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ticker.remove(step);
    gsap.ticker.lagSmoothing(DEFAULT_LAG_THRESHOLD, DEFAULT_LAG_ADJUSTED);
    // runs on its own again and falls asleep by itself once nothing animates
    gsap.ticker.wake();
  };
}
