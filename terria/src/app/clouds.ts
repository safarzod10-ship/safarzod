/**
 * Clouds drifting over the continent, with their shadows sliding over the
 * land. Seen from afar only: as the camera comes down to a city they thin out
 * and vanish, so they never cover the buildings being played with.
 *
 * Cloud pictures are rendered in Blender (tools/blender/clouds.py) in the
 * game's camera and light; they are drawn upright (turned and stretched back
 * like buildings). Their shadows lie on the ground, so they take the world's
 * isometric squash.
 */
import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import { CAMERA } from '../core/config.ts';
import type { MapApp } from '../rendering/MapApp.ts';

const FILES = ['cloud-0.webp', 'cloud-1.webp', 'cloud-2.webp', 'cloud-3.webp'];
const COUNT = 34;
/** wind, metres per second (towards the east-north-east) */
const WIND = { x: 9, y: -3 };
/** css px per metre where clouds are fully visible / gone */
const FULL_BELOW = 0.06;
const GONE_ABOVE = 0.18;

interface Cloud {
  s: Sprite;
  sh: Sprite;
  x: number;
  y: number;
  size: number;
  speed: number;
}

export class Clouds {
  private readonly top = new Container({ label: 'clouds' });
  private readonly under = new Container({ label: 'cloud-shadows' });
  private readonly clouds: Cloud[] = [];
  private readonly area: { x: number; y: number; w: number; h: number };
  private readonly unsubscribe: () => void;

  static async create(map: MapApp, base = './models/'): Promise<Clouds | null> {
    try {
      const textures = (await Promise.all(FILES.map((f) => Assets.load<Texture>(base + f)))).filter(Boolean);
      return textures.length ? new Clouds(map, textures) : null;
    } catch (e) {
      console.warn('[clouds] not loaded', e);
      return null;
    }
  }

  private constructor(map: MapApp, textures: Texture[]) {
    const b = map.query.meta.landBounds;
    const pad = 6000;
    this.area = { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
    this.top.eventMode = 'none';
    this.under.eventMode = 'none';
    map.scene.layers.overlay.addChild(this.top);
    map.scene.layers.shadows.addChild(this.under);
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < COUNT; i++) {
      const tex = textures[i % textures.length];
      const size = 1400 + rnd() * 2200;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.rotation = -CAMERA.rotation;
      const k = size / tex.width;
      s.scale.set(k, k / CAMERA.tilt);
      const sh = new Sprite(tex);
      sh.anchor.set(0.5);
      sh.tint = 0x0e2412;
      sh.scale.set(k * 0.95);
      this.top.addChild(s);
      this.under.addChild(sh);
      this.clouds.push({ s, sh, x: this.area.x + rnd() * this.area.w, y: this.area.y + rnd() * this.area.h, size, speed: 0.75 + rnd() * 0.5 });
    }
    this.unsubscribe = map.addFrameListener((view, dt) => this.update(view.scale, dt));
  }

  private update(scale: number, dtMs: number): void {
    const vis = 1 - Math.min(1, Math.max(0, (scale - FULL_BELOW) / (GONE_ABOVE - FULL_BELOW)));
    this.top.visible = vis > 0.01;
    this.under.visible = vis > 0.01;
    if (!this.top.visible) return;
    const dt = Math.min(dtMs, 100) / 1000;
    const a = this.area;
    for (const c of this.clouds) {
      c.x += WIND.x * c.speed * dt;
      c.y += WIND.y * c.speed * dt;
      if (c.x > a.x + a.w) c.x -= a.w;
      if (c.y < a.y) c.y += a.h;
      c.s.position.set(c.x, c.y);
      c.s.alpha = 0.92 * vis;
      // the shadow falls away from the sun (to the right and down on screen)
      c.sh.position.set(c.x + c.size * 0.55, c.y + c.size * 0.12);
      c.sh.alpha = 0.16 * vis;
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.top.destroy({ children: true });
    this.under.destroy({ children: true });
  }
}
