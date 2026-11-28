/**
 * The PixiJS side of the splash: one container that sits on top of the game's
 * stage and is drawn by the game's own renderer and ticker.
 *
 *   splash
 *   ├─ world        the illustration (full-screen quad, custom shader)
 *   ├─ ground space (camera)   borders + roads · cloud shadows · buildings
 *   ├─ cloud space  (camera with parallax)   clouds
 *   ├─ logo         (custom shader)
 *   └─ sparks       (additive particles)
 *
 * About seven draw calls in total. The timeline (timeline.ts) only changes the
 * plain `state` objects of the layers; update() copies them to the GPU.
 */
import { Container, Rectangle, type Application } from 'pixi.js';
import type { SplashImages } from './assets.ts';
import { computeLayout, LOGO_CENTER_Y, type SplashLayout } from './layout.ts';
import { CivilizationLayer } from './layers/CivilizationLayer.ts';
import { CLOUD_PARALLAX, CloudLayer } from './layers/CloudLayer.ts';
import { LogoLayer } from './layers/LogoLayer.ts';
import { SparkLayer } from './layers/SparkLayer.ts';
import { WorldLayer } from './layers/WorldLayer.ts';
import { createNoiseTexture } from './noise.ts';
import { SPLASH_DATA } from './splashData.ts';
import { createSpriteSet, type SpriteSet } from './sprites.ts';
import type { BufferImageSource } from 'pixi.js';

/** What a device gets. Chosen once before the scene is built (see quality.ts). */
export interface SceneQuality {
  /** Water refraction, two-layer glitter and swell in the world shader. */
  richWater: boolean;
  /** Size of the spark pool. */
  sparks: number;
  clouds: number;
  cloudShadows: boolean;
}

const GOLD_TINTS = [0xfff2c4, 0xffe08a, 0xffd166, 0xfffbe6] as const;

export class SplashScene {
  readonly root = new Container({ label: 'splash' });
  readonly world: WorldLayer;
  readonly civ: CivilizationLayer;
  readonly clouds: CloudLayer;
  readonly logo: LogoLayer;
  readonly sparks: SparkLayer;
  /** Camera zoom on top of the "cover" fit. Tweened by the timeline. */
  readonly camera = { zoom: 1 };
  /** Slow motes around the finished logo, 0..1. Tweened by the timeline. */
  readonly ambience = { motes: 0 };
  layout: SplashLayout;
  /** Running time of the scene, seconds. Frozen while `paused` (debug seeking). */
  timeSec = 0;
  paused = false;

  private readonly app: Application;
  private readonly sprites: SpriteSet;
  private readonly noise: BufferImageSource;
  private readonly groundSpace = new Container({ label: 'splash:ground-space' });
  private readonly cloudSpace = new Container({ label: 'splash:cloud-space' });
  private readonly head = { x: 0, y: 0 };
  private readonly point = { x: 0, y: 0 };
  private headValid = false;
  private lastStroke = 0;
  private moteDebt = 0;
  private twinkleDebt = 0;
  private sparkDebt = 0;
  private seed = 0x2f6e2b1;
  /** Share of the sparks that are actually emitted (lowered by relax()). */
  private sparkScale = 1;

  constructor(app: Application, images: SplashImages, quality: SceneQuality) {
    this.app = app;
    this.sprites = createSpriteSet();
    this.noise = createNoiseTexture();
    this.world = new WorldLayer(images.world, images.data, this.noise, quality.richWater);
    this.civ = new CivilizationLayer(this.sprites);
    this.clouds = new CloudLayer(this.sprites, quality.clouds, quality.cloudShadows);
    this.logo = new LogoLayer(images.data);
    this.sparks = new SparkLayer(this.sprites, quality.sparks);

    const cx = SPLASH_DATA.world.width / 2;
    const cy = SPLASH_DATA.world.height / 2;
    this.groundSpace.pivot.set(cx, cy);
    this.cloudSpace.pivot.set(cx, cy);
    this.groundSpace.addChild(this.civ.ground, this.clouds.shadows, this.civ.objects);
    this.cloudSpace.addChild(this.clouds.clouds);
    this.root.addChild(this.world.mesh, this.groundSpace, this.cloudSpace, this.logo.mesh, this.sparks.container);
    // nothing in the splash is interactive: keep the event system out of it
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;

    this.layout = this.measure();
    this.apply(0);
  }

  private measure(): SplashLayout {
    const screen = this.app.renderer.screen;
    return computeLayout(screen.width, screen.height, SPLASH_DATA.world, SPLASH_DATA.logo.box);
  }

  /** Call when the renderer was resized. */
  resize(): void {
    this.layout = this.measure();
    this.sparks.container.boundsArea = new Rectangle(0, 0, this.layout.width, this.layout.height);
    this.headValid = false;
  }

  /** Per-frame update: advance the ambient motion and copy the tweened state to the GPU. */
  update(deltaMs: number): void {
    const dt = this.paused ? 0 : Math.min(deltaMs, 50) / 1000;
    this.timeSec += dt;
    this.apply(dt);
  }

  private apply(dt: number): void {
    const L = this.layout;
    const zoom = this.camera.zoom;
    this.groundSpace.position.set(L.centerX, L.centerY);
    this.groundSpace.scale.set(L.worldScale * zoom);
    const cloudScale = L.worldScale * (1 + (zoom - 1) * CLOUD_PARALLAX);
    this.cloudSpace.position.set(L.centerX, L.centerY);
    this.cloudSpace.scale.set(cloudScale);
    this.clouds.frameHalf = L.frameWidth < L.width - 1 ? L.frameWidth / 2 / cloudScale : Infinity;

    const w = this.world.state;
    this.world.update(L, zoom, this.timeSec, LOGO_CENTER_Y);
    // buildings and clouds live in the same light as the picture
    this.civ.state.light = 1 - 0.8 * w.dim;
    this.civ.update(L.worldScale * zoom);
    const cl = this.clouds.state;
    cl.fade = w.fade;
    cl.dawn = w.dawn;
    cl.dim = w.dim;
    this.clouds.update(dt);
    this.logo.update(L, this.app.renderer.resolution, this.timeSec);

    if (dt > 0) {
      this.trailStroke();
      this.driftMotes(dt);
      this.twinkleWater(dt);
    }
    this.sparks.update(dt, this.timeSec);
  }

  private random(): number {
    // cosmetic: where a spark flies does not need a better generator
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** Sparks shed by the light while it draws the arc and the bar. */
  private trailStroke(): void {
    const s = this.logo.state.stroke;
    if (s <= 0 || s >= 1 || s <= this.lastStroke) {
      this.lastStroke = s;
      if (s <= 0 || s >= 1) this.headValid = false;
      return;
    }
    this.lastStroke = s;
    this.logo.strokePoint(s * 1.07, this.point);
    if (!this.headValid) {
      this.head.x = this.point.x;
      this.head.y = this.point.y;
      this.headValid = true;
      return;
    }
    const dx = this.point.x - this.head.x;
    const dy = this.point.y - this.head.y;
    const dist = Math.hypot(dx, dy);
    this.sparkDebt += (dist / 11) * this.sparkScale;
    const scale = this.layout.logoScale * 2.6;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      const k = this.random();
      const side = (this.random() - 0.5) * 2;
      const back = 20 + 70 * this.random();
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : 0;
      this.sparks.emit(this.head.x + dx * k, this.head.y + dy * k, {
        vx: (-nx * back - ny * side * 60) * scale,
        vy: (-ny * back + nx * side * 60) * scale - 14,
        life: 0.35 + 0.45 * this.random(),
        size: (5 + 9 * this.random()) * Math.max(0.8, scale),
        tint: GOLD_TINTS[(this.random() * GOLD_TINTS.length) | 0],
        gravity: 40,
        drag: 2.4,
      });
    }
    this.head.x = this.point.x;
    this.head.y = this.point.y;
  }

  /** Sparkles on the water: a glint lights up at one of the marked spots, then another. */
  private twinkleWater(dt: number): void {
    const w = this.world.state;
    // nothing glitters at night, little once the world has stepped back for the logo
    const strength = w.fade * (1 - 0.75 * w.dim) * this.sparkScale * (1 - w.reveal);
    if (strength <= 0.05) return;
    this.twinkleDebt += dt * 9 * strength;
    const spots = SPLASH_DATA.water.sparkles;
    const g = this.groundSpace;
    const front = -1 + 2.05 * w.dawn;
    while (this.twinkleDebt >= 1) {
      this.twinkleDebt -= 1;
      const i = ((this.random() * spots.length) / 2) | 0;
      const px = spots[i * 2] + (this.random() - 0.5) * 30;
      const py = spots[i * 2 + 1] + (this.random() - 0.5) * 30;
      // the same dawn front as in the world shader: only water it has reached glitters
      const along =
        ((px / SPLASH_DATA.world.width - 0.5) * SPLASH_DATA.world.width) / SPLASH_DATA.world.height * 0.447 +
        (py / SPLASH_DATA.world.height - 0.5) * 0.894;
      if (along > front - 0.25) continue;
      this.sparks.emit(g.x + (px - g.pivot.x) * g.scale.x, g.y + (py - g.pivot.y) * g.scale.y, {
        life: 0.7 + 0.7 * this.random(),
        size: (5 + 6 * this.random()) * (0.55 + 0.45 * strength),
        tint: this.random() < 0.5 ? 0xe8ffff : 0xc8f4ff,
        drag: 0,
      });
    }
  }

  /** A few slow motes rising around the finished logo. */
  private driftMotes(dt: number): void {
    const m = this.ambience.motes;
    if (m <= 0) return;
    this.moteDebt += dt * 5.5 * m * this.sparkScale * Math.min(1, this.sparks.capacity / 48);
    const L = this.layout;
    const w = SPLASH_DATA.logo.box.width * L.logoScale;
    const h = SPLASH_DATA.logo.box.height * L.logoScale;
    while (this.moteDebt >= 1) {
      this.moteDebt -= 1;
      this.sparks.emit(L.logoX + (this.random() - 0.5) * w * 1.25, L.logoY + (this.random() - 0.35) * h * 1.1, {
        vx: (this.random() - 0.5) * 10,
        vy: -(9 + 16 * this.random()),
        life: 2.2 + 1.6 * this.random(),
        size: 3 + 4.5 * this.random(),
        tint: this.random() < 0.3 ? 0xd8ffc0 : 0xffe9a8,
        gravity: -3,
        drag: 0.25,
        twinkle: 1,
      });
    }
  }

  /** The GPU does not keep up: drop the parts nobody will miss. */
  relax(): void {
    this.clouds.shadows.visible = false;
    this.sparkScale = 0.45;
  }

  /** A burst of glints at a point of the illustration (a building is finished). */
  glint(pictureX: number, pictureY: number, count: number): void {
    const g = this.groundSpace;
    const x = g.x + (pictureX - g.pivot.x) * g.scale.x;
    const y = g.y + (pictureY - g.pivot.y) * g.scale.y;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (this.random() - 0.5) * 2.2;
      const v = 26 + 46 * this.random();
      this.sparks.emit(x + (this.random() - 0.5) * 10, y, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.45 + 0.35 * this.random(),
        size: 5 + 6 * this.random(),
        tint: 0xfff3c8,
        gravity: 30,
        drag: 2,
      });
    }
  }

  /** The moment the logo is complete: a ring of sparks leaves it. */
  burst(count: number): void {
    const L = this.layout;
    const w = SPLASH_DATA.logo.box.width * L.logoScale;
    const h = SPLASH_DATA.logo.box.height * L.logoScale;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.random() * 0.5;
      const v = 40 + 90 * this.random();
      this.sparks.emit(L.logoX + Math.cos(a) * w * 0.34, L.logoY + Math.sin(a) * h * 0.3, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.7 - 12,
        life: 0.6 + 0.6 * this.random(),
        size: 5 + 8 * this.random(),
        tint: GOLD_TINTS[(this.random() * GOLD_TINTS.length) | 0],
        gravity: 16,
        drag: 1.8,
        twinkle: 0.6,
      });
    }
  }

  destroy(): void {
    this.root.removeFromParent();
    this.world.destroy();
    this.civ.destroy();
    this.clouds.destroy();
    this.logo.destroy();
    this.sparks.destroy();
    this.root.destroy({ children: true });
    this.sprites.destroy();
    this.noise.destroy();
  }
}
