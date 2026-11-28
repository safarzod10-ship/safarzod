/**
 * Keeps the frame rate up on weak GPUs by lowering the backing-store
 * resolution (the single most effective lever for a full-screen shader).
 * It only ever steps down; nothing oscillates.
 */
import type { Application } from 'pixi.js';
import { RENDER } from '../core/config.ts';

const WINDOW_FRAMES = 90;
const SLOW_FRAME_MS = 1000 / 45;
const STEP = 0.25;

export class QualityController {
  private sum = 0;
  private frames = 0;
  private slowWindows = 0;
  private settleUntil = 0;
  readonly initialResolution: number;
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
    this.initialResolution = app.renderer.resolution;
  }

  get resolution(): number {
    return this.app.renderer.resolution;
  }

  /** Feed with frame times measured while the camera is moving / animating. */
  sample(deltaMs: number, now: number): void {
    if (deltaMs > 250 || now < this.settleUntil) return; // stalls and warm-up are not GPU load
    this.sum += deltaMs;
    if (++this.frames < WINDOW_FRAMES) return;
    const avg = this.sum / this.frames;
    this.sum = 0;
    this.frames = 0;
    this.slowWindows = avg > SLOW_FRAME_MS ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.resolution > RENDER.minResolution) {
      this.slowWindows = 0;
      this.setResolution(Math.max(RENDER.minResolution, this.resolution - STEP));
      this.settleUntil = now + 1500;
    }
  }

  setResolution(resolution: number): void {
    const r = this.app.renderer;
    if (Math.abs(r.resolution - resolution) < 1e-3) return;
    r.resize(r.screen.width, r.screen.height, resolution);
  }
}
