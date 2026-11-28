/**
 * The assembled map: renderer + world + camera + scene + frame loop.
 * This is the object future systems receive (`map.scene.layers`, `map.query`,
 * `map.camera`); see CLAUDE.md for the contract.
 */
import { Container, UPDATE_PRIORITY, type Application } from 'pixi.js';
import { CameraController, type CameraView } from '../camera/CameraController.ts';
import { RENDER } from '../core/config.ts';
import { PerfMonitor } from '../core/perf.ts';
import type { WorldBackend } from '../world/generation/WorldBackend.ts';
import type { WorldFields } from '../world/generation/WorldFields.ts';
import type { DetailTextures } from '../world/terrain/detailTextures.ts';
import type { RegionInfo } from '../world/regions/regions.ts';
import { createWorldQuery, type WorldQuery } from '../world/WorldQuery.ts';
import { pickResolution, type RendererInfo } from './createRenderer.ts';
import { QualityController } from './QualityController.ts';
import { WorldScene } from './WorldScene.ts';

export interface MapStats {
  fps: number;
  frameMs: number;
  p99Ms: number;
  worstMs: number;
  longFrames: number;
  drawCalls: number;
  cpuMs: number;
  cpuMaxMs: number;
  resolution: number;
  lod: number;
  chunks: number;
  drawnChunks: number;
  pendingBakes: number;
  avgBakeMs: number;
  maxBakeMs: number;
  bakes: number;
  terrainTextureMB: number;
  trees: number;
  jsHeapMB: number | null;
  backend: string;
  api: string;
  gpu: string;
}

export class MapApp {
  readonly app: Application;
  readonly camera: CameraController;
  readonly scene: WorldScene;
  readonly query: WorldQuery;
  readonly perf = new PerfMonitor();
  readonly quality: QualityController;
  /** Called every frame after the scene update (HUD, future systems). */
  onFrame: ((view: CameraView, deltaMs: number) => void) | null = null;

  private timeSec = 0;
  private pointerDown = false;
  private throttled = false;
  private wokenAt = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly info: RendererInfo;
  private readonly backend: WorldBackend;
  private readonly host: HTMLElement;
  readonly world: WorldFields;

  constructor(info: RendererInfo, world: WorldFields, backend: WorldBackend, textures: DetailTextures, host: HTMLElement) {
    this.info = info;
    this.world = world;
    this.backend = backend;
    this.host = host;
    this.app = info.app;
    this.query = createWorldQuery(world);
    this.scene = new WorldScene(world, backend, textures, this.query.regions, { lowMemory: info.lowMemory });
    this.camera = new CameraController(this.app, world.meta.cameraBounds);
    // isometric view: the world is turned inside, then squashed outside
    const plane = new Container({ label: 'iso-plane' });
    plane.scale.y = this.camera.tilt;
    this.scene.root.rotation = this.camera.rotation;
    plane.addChild(this.scene.root);
    this.camera.viewport.addChild(plane);
    this.app.stage.addChild(this.camera.viewport);
    this.quality = new QualityController(this.app);

    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', () => (this.pointerDown = true));
    const up = (): void => void (this.pointerDown = false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // keep the page itself from scrolling / zooming under the map
    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('gesturestart', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    window.addEventListener('orientationchange', () => this.resize());
  }

  /** Bake the always-resident terrain level; call before start(). */
  preload(onProgress: (p: number) => void): Promise<void> {
    return this.scene.terrain.preloadBase(onProgress);
  }

  /**
   * Compile the terrain shader variants on the next rendered frames. Call
   * together with start(), while the loading screen still covers the map.
   */
  warmUp(): void {
    this.scene.terrain.warmUpShaders();
  }

  start(): void {
    // Bracket the whole tick (camera plugins, scene update, render) to know
    // how much main-thread time a frame really costs.
    let tickStart = 0;
    this.app.ticker.add(() => void (tickStart = performance.now()), undefined, UPDATE_PRIORITY.INTERACTION);
    this.app.ticker.add((ticker) => this.frame(ticker.elapsedMS));
    this.app.ticker.add(
      () => {
        if (!this.throttled) this.perf.cpu(performance.now() - tickStart);
      },
      undefined,
      UPDATE_PRIORITY.UTILITY,
    );
  }

  enableDrawCallCounter(): void {
    const gl = (this.app.renderer as unknown as { gl: WebGLRenderingContext }).gl;
    this.perf.hookDrawCalls(gl);
  }

  /**
   * Highlight a region (and its starter plot); null clears the selection.
   * @returns the region's facts, or null
   */
  selectRegion(id: number | null): RegionInfo | null {
    this.scene.regions.select(id ?? -1);
    this.wake();
    return id === null ? null : this.query.regions.info(id);
  }

  /** Fly to a region so that it fills most of the screen. */
  showRegion(id: number): RegionInfo {
    const info = this.query.regions.info(id);
    const r = this.app.renderer.screen;
    const scale = (0.55 * Math.min(r.width, r.height)) / Math.sqrt(info.area);
    this.camera.flyTo(info.x, info.y, scale, true);
    return info;
  }

  /** Keep rendering at full rate for a moment (after a programmatic change). */
  wake(): void {
    this.wokenAt = performance.now();
  }

  /** Re-read the host size (also called by Telegram viewport events). */
  resize(): void {
    const w = Math.max(1, Math.round(this.host.clientWidth));
    const h = Math.max(1, Math.round(this.host.clientHeight));
    const r = this.app.renderer;
    if (w === r.screen.width && h === r.screen.height) return;
    // A changed devicePixelRatio (moved to another monitor) raises the cap again.
    const resolution = Math.min(this.quality.resolution, pickResolution());
    r.resize(w, h, resolution);
    this.camera.resize(w, h);
  }

  stats(): MapStats {
    const p = this.perf.snapshot();
    const t = this.scene.terrain.stats();
    const trees = this.scene.trees.stats();
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: p.fps,
      frameMs: p.frameMs,
      p99Ms: p.p99Ms,
      worstMs: p.worstMs,
      longFrames: p.longFrames,
      drawCalls: p.drawCalls,
      cpuMs: p.cpuMs,
      cpuMaxMs: p.cpuMaxMs,
      resolution: this.quality.resolution,
      lod: t.targetLevel,
      chunks: t.residentChunks,
      drawnChunks: t.drawnChunks,
      pendingBakes: t.pendingBakes,
      avgBakeMs: t.avgBakeMs,
      maxBakeMs: t.maxBakeMs,
      bakes: t.bakes,
      terrainTextureMB: t.textureBytes / 1048576,
      trees: trees.visibleTrees,
      jsHeapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      backend: this.backend.mode,
      api: this.info.api,
      gpu: this.info.gpu,
    };
  }

  private frame(deltaMs: number): void {
    const now = performance.now();
    this.timeSec += Math.min(deltaMs, 100) / 1000;
    this.camera.update();
    const view = this.camera.getView();
    this.scene.update(view, this.quality.resolution, this.timeSec);

    // Full frame rate while something moves; a calmer one when only the sea does.
    const active =
      this.pointerDown ||
      this.camera.idleMs < RENDER.idleAfterMs ||
      now - this.wokenAt < RENDER.idleAfterMs ||
      this.scene.busy;
    const throttle = !active && RENDER.idleFps > 0;
    if (throttle !== this.throttled) {
      this.throttled = throttle;
      this.app.ticker.maxFPS = throttle ? RENDER.idleFps : 0;
      if (!throttle) this.perf.reset();
    }
    if (!this.throttled) {
      this.perf.frame(deltaMs);
      this.quality.sample(deltaMs, now);
    }
    this.onFrame?.(view, deltaMs);
  }
}
