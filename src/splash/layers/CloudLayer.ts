/**
 * A few soft clouds drifting over the map, and their shadows on the ground.
 * Clouds live in their own space that zooms faster than the ground, so the
 * slow camera push makes them part and gives the picture depth.
 */
import { Container, Sprite } from 'pixi.js';
import { SPLASH_DATA } from '../splashData.ts';
import type { SpriteSet } from '../sprites.ts';

interface CloudSpec {
  /** Position in px of the illustration. */
  x: number;
  y: number;
  scale: number;
  /** Drift to the east, px of the illustration per second. */
  speed: number;
  alpha: number;
  variant: number;
}

const CLOUDS: readonly CloudSpec[] = [
  { x: 70, y: 250, scale: 1.75, speed: 9, alpha: 0.8, variant: 0 },
  { x: 880, y: 380, scale: 1.45, speed: 13, alpha: 0.72, variant: 1 },
  { x: 10, y: 1210, scale: 1.9, speed: 7, alpha: 0.78, variant: 1 },
  { x: 900, y: 1400, scale: 2.0, speed: 10, alpha: 0.8, variant: 0 },
  { x: 560, y: 60, scale: 1.3, speed: 15, alpha: 0.6, variant: 0 },
  { x: 318, y: 1590, scale: 1.55, speed: 11, alpha: 0.64, variant: 1 },
];

/** Where a cloud's shadow falls relative to the cloud, px of the illustration (sun in the upper left). */
const SHADOW_DX = 52;
const SHADOW_DY = 86;
/** How much faster than the ground the cloud space zooms. */
export const CLOUD_PARALLAX = 2.3;

export class CloudLayer {
  /** Clouds: put into the parallax space. */
  readonly clouds = new Container({ label: 'splash:clouds' });
  /** Shadows: put into the ground space. */
  readonly shadows = new Container({ label: 'splash:cloud-shadows' });
  /**
   * `alpha`: overall opacity; `fade`, `dawn`, `dim` mirror the world's light,
   * so a cloud is moonlit until the dawn front has reached it.
   */
  readonly state = { alpha: 1, fade: 0, dawn: 0, dim: 0 };
  /**
   * Half width of the frame in px of the cloud space, when the screen is wider
   * than the picture; clouds fade out beyond it. Infinity on phones.
   */
  frameHalf = Infinity;
  private readonly items: { cloud: Sprite; shadow: Sprite | null; spec: CloudSpec }[] = [];

  /** @param withShadows skip the ground shadows on weak devices (they are a second full pass of sprites) */
  constructor(sprites: SpriteSet, count: number, withShadows: boolean) {
    for (const spec of CLOUDS.slice(0, count)) {
      const texture = sprites.clouds[spec.variant];
      const cloud = new Sprite({ texture, anchor: 0.5 });
      cloud.position.set(spec.x, spec.y);
      cloud.scale.set(spec.scale);
      cloud.alpha = spec.alpha;
      this.clouds.addChild(cloud);
      let shadow: Sprite | null = null;
      if (withShadows) {
        shadow = new Sprite({ texture, anchor: 0.5 });
        shadow.position.set(spec.x + SHADOW_DX, spec.y + SHADOW_DY);
        shadow.scale.set(spec.scale * 1.08);
        shadow.tint = 0x0a2b1e;
        shadow.alpha = 0.2 * spec.alpha;
        this.shadows.addChild(shadow);
      }
      this.items.push({ cloud, shadow, spec });
    }
  }

  update(dtSec: number): void {
    const W = SPLASH_DATA.world.width;
    const H = SPLASH_DATA.world.height;
    const s = this.state;
    // same front as in the world shader (WorldLayer.ts, "dawn")
    const front = -1 + 2.05 * s.dawn;
    for (const { cloud, shadow, spec } of this.items) {
      const half = 128 * spec.scale;
      let x = cloud.x + spec.speed * dtSec;
      // far beyond the right edge: come back in on the left
      if (x - half > W + 260) x = -260 - half;
      cloud.x = x;
      const along = ((x / W - 0.5) * W) / H * 0.447 + (cloud.y / H - 0.5) * 0.894;
      const t = Math.min(1, Math.max(0, (along - (front - 0.4)) / 0.4));
      const lit = (1 - t * t * (3 - 2 * t)) * s.fade * (1 - 0.6 * s.dim);
      // moonlit blue-grey at night, white by day
      cloud.tint = (Math.round(34 + 221 * lit) << 16) | (Math.round(50 + 205 * lit) << 8) | Math.round(74 + 181 * lit);
      // beside the frame there is no sky to float in
      const e = Math.min(1, Math.max(0, (Math.abs(x - W / 2) - (this.frameHalf - 70)) / 150));
      const inside = 1 - e * e * (3 - 2 * e);
      cloud.alpha = spec.alpha * inside;
      if (shadow) {
        shadow.x = x + SHADOW_DX;
        shadow.alpha = 0.2 * spec.alpha * lit * inside;
      }
    }
    this.clouds.alpha = s.alpha * (0.35 + 0.65 * s.fade);
    this.shadows.alpha = s.alpha;
  }

  destroy(): void {
    this.clouds.destroy({ children: true });
    this.shadows.destroy({ children: true });
  }
}
