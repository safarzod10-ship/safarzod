/**
 * Camera: one-finger pan, pinch zoom, wheel zoom, inertia - all via
 * pixi-viewport - plus the limits that keep the player inside the designed
 * world (see constraints.ts).
 *
 * Other systems should talk to the camera only through this class:
 * screenToWorld / worldToScreen for picking, visibleBounds for culling,
 * flyTo for navigation, onChange for reacting to movement.
 */
import type { Application } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { CAMERA } from '../core/config.ts';
import type { Rect } from '../core/math.ts';
import { clampCenter, computeZoomLimits, type ZoomLimits } from './constraints.ts';

export interface CameraView {
  /** World position at the centre of the screen. */
  x: number;
  y: number;
  /** CSS pixels per world unit. */
  scale: number;
  /** Visible world rectangle. */
  bounds: Rect;
}

export class CameraController {
  readonly viewport: Viewport;
  private limits: ZoomLimits;
  private screenW: number;
  private screenH: number;
  private readonly listeners = new Set<(view: CameraView) => void>();
  private lastX = NaN;
  private lastY = NaN;
  private lastScale = NaN;
  private lastMoveAt = 0;
  private readonly view: CameraView = { x: 0, y: 0, scale: 1, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  private readonly bounds: Rect;

  /** Vertical squash of the ground plane (2.5D tilt). Viewport y = world y * tilt. */
  readonly tilt = CAMERA.tilt;

  /** @param bounds world rectangle the camera may show (WorldMeta.cameraBounds) */
  constructor(app: Application, bounds: Rect) {
    // the viewport works in "screen plane" units: x as in the world, y squashed
    this.bounds = { x: bounds.x, y: bounds.y * CAMERA.tilt, width: bounds.width, height: bounds.height * CAMERA.tilt };
    this.screenW = app.screen.width;
    this.screenH = app.screen.height;
    this.limits = computeZoomLimits(this.screenW, this.screenH, bounds, CAMERA.maxScale, CAMERA.minScaleSlack);

    this.viewport = new Viewport({
      screenWidth: this.screenW,
      screenHeight: this.screenH,
      events: app.renderer.events,
      ticker: app.ticker,
      passiveWheel: false,
      disableOnContextMenu: true,
    });
    this.viewport.label = 'camera';
    this.viewport
      .drag()
      .pinch()
      .wheel({ smooth: CAMERA.wheelSmooth, percent: CAMERA.wheelPercent, trackpadPinch: true })
      .decelerate({ friction: CAMERA.friction })
      .clampZoom({ minScale: this.limits.minScale, maxScale: this.limits.maxScale });

    this.fitWorld(false);
  }

  /** Current view. The returned object is reused between calls. */
  getView(): CameraView {
    const vp = this.viewport;
    const scale = vp.scale.x;
    const v = this.view;
    v.scale = scale;
    v.bounds.width = this.screenW / scale;
    v.bounds.height = this.screenH / scale / this.tilt;
    v.bounds.x = -vp.x / scale;
    v.bounds.y = -vp.y / scale / this.tilt;
    v.x = v.bounds.x + v.bounds.width / 2;
    v.y = v.bounds.y + v.bounds.height / 2;
    return v;
  }

  get zoomLimits(): ZoomLimits {
    return this.limits;
  }

  /** ms since the camera last moved. */
  get idleMs(): number {
    return performance.now() - this.lastMoveAt;
  }

  onChange(listener: (view: CameraView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Enforce the world limits and notify listeners. Call once per frame after
   * the viewport plugins have run.
   */
  update(): void {
    const vp = this.viewport;
    let scale = vp.scale.x;
    if (scale < this.limits.minScale || scale > this.limits.maxScale) {
      const c = vp.center;
      scale = Math.min(this.limits.maxScale, Math.max(this.limits.minScale, scale));
      vp.scale.set(scale);
      vp.moveCenter(c.x, c.y);
    }
    const c = vp.center;
    const p = clampCenter(c.x, c.y, scale, this.screenW, this.screenH, this.bounds);
    const hitX = Math.abs(p.x - c.x) > 1e-6;
    const hitY = Math.abs(p.y - c.y) > 1e-6;
    if (hitX || hitY) {
      vp.moveCenter(p.x, p.y);
      // kill inertia against the wall so the camera does not keep pushing
      const decel = vp.plugins.get('decelerate') as { x: number | null; y: number | null } | undefined | null;
      if (decel) {
        if (hitX) decel.x = 0;
        if (hitY) decel.y = 0;
      }
    }
    if (p.x !== this.lastX || p.y !== this.lastY || scale !== this.lastScale) {
      this.lastX = p.x;
      this.lastY = p.y;
      this.lastScale = scale;
      this.lastMoveAt = performance.now();
      const view = this.getView();
      for (const l of this.listeners) l(view);
    }
  }

  resize(screenW: number, screenH: number): void {
    const view = this.getView();
    const cx = view.x;
    const cy = view.y;
    const wasAtMin = view.scale <= this.limits.minScale * 1.001;
    this.screenW = screenW;
    this.screenH = screenH;
    this.limits = computeZoomLimits(screenW, screenH, this.bounds, CAMERA.maxScale, CAMERA.minScaleSlack);
    this.viewport.resize(screenW, screenH);
    this.viewport.clampZoom({ minScale: this.limits.minScale, maxScale: this.limits.maxScale });
    if (wasAtMin) this.viewport.scale.set(this.limits.minScale);
    this.viewport.moveCenter(cx, cy * this.tilt);
    this.update();
  }

  /** Show the whole continent with its ocean and fog ring. */
  fitWorld(animate = true): void {
    const b = this.bounds;
    this.flyTo(b.x + b.width / 2, (b.y + b.height / 2) / this.tilt, this.limits.minScale, animate);
  }

  zoomBy(factor: number, animate = true): void {
    const v = this.getView();
    this.flyTo(v.x, v.y, v.scale * factor, animate);
  }

  flyTo(x: number, y: number, scale?: number, animate = true): void {
    const vp = this.viewport;
    const s = Math.min(this.limits.maxScale, Math.max(this.limits.minScale, scale ?? vp.scale.x));
    const p = clampCenter(x, y * this.tilt, s, this.screenW, this.screenH, this.bounds);
    if (!animate) {
      vp.plugins.remove('animate');
      vp.scale.set(s);
      vp.moveCenter(p.x, p.y);
      return;
    }
    vp.animate({ position: p, scale: s, time: 320, ease: 'easeOutCubic', removeOnInterrupt: true });
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const vp = this.viewport;
    return { x: (screenX - vp.x) / vp.scale.x, y: (screenY - vp.y) / vp.scale.y / this.tilt };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const vp = this.viewport;
    return { x: worldX * vp.scale.x + vp.x, y: worldY * this.tilt * vp.scale.y + vp.y };
  }
}
