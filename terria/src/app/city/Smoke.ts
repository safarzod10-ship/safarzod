/**
 * Chimney smoke: soft puffs that rise, drift with the wind, swell and fade.
 * Emitters are the chimney tops the building renders report (atlas `pt`).
 *
 * Puffs live in a container that undoes the world's isometric turn and squash
 * (like the progress bars), so its units are metres on the screen plane and
 * "up" is straight up the screen. Pooled sprites, no allocation per frame.
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { CAMERA } from '../../core/config.ts';

interface Puff {
  s: Sprite;
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
}

let puffTexture: Texture | null = null;
function texture(): Texture {
  if (puffTexture) return puffTexture;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // a soft, slightly lumpy puff: a few overlapping radial blobs
  const blob = (x: number, y: number, r: number, a: number): void => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  blob(32, 34, 28, 0.85);
  blob(24, 28, 16, 0.5);
  blob(40, 26, 15, 0.45);
  blob(34, 40, 14, 0.4);
  puffTexture = new Texture({ source: new CanvasSource({ resource: c }) });
  return puffTexture;
}

/** Wind on the screen plane, metres per second. */
const WIND_X = 1.1;
const RISE = 2.4;
const RATE = 2.6; // puffs per second per chimney
const MAX_PUFFS = 160;

export class Smoke {
  private readonly layer = new Container({ label: 'city:smoke' });
  private readonly puffs: Puff[] = [];
  private readonly pool: Sprite[] = [];
  private emitters: { x: number; y: number; acc: number; phase: number }[] = [];

  constructor(parent: Container) {
    this.layer.eventMode = 'none';
    this.layer.rotation = -CAMERA.rotation;
    this.layer.scale.y = 1 / CAMERA.tilt;
    parent.addChild(this.layer);
  }

  /** Chimney tops on the screen plane (metres), replacing the previous ones. */
  setEmitters(points: { x: number; y: number }[]): void {
    this.emitters = points.map((p, i) => ({ x: p.x, y: p.y, acc: (i * 0.37) % 1, phase: i * 1.7 }));
  }

  get active(): boolean {
    return this.emitters.length > 0 || this.puffs.length > 0;
  }

  setVisible(v: boolean): void {
    this.layer.visible = v;
  }

  update(dtMs: number, timeSec: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (!this.layer.visible) return;
    for (const e of this.emitters) {
      e.acc += dt * RATE;
      while (e.acc >= 1 && this.puffs.length < MAX_PUFFS) {
        e.acc -= 1;
        this.spawn(e.x, e.y, timeSec + e.phase);
      }
      if (e.acc > 1) e.acc = 1;
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.s.visible = false;
        this.pool.push(p.s);
        this.puffs[i] = this.puffs[this.puffs.length - 1];
        this.puffs.pop();
        continue;
      }
      // rises fast, then slows and bends with the wind
      p.x += (p.vx + WIND_X * t) * dt;
      p.y -= p.vy * (1 - 0.55 * t) * dt;
      const size = p.size * (0.45 + 1.6 * t);
      p.s.position.set(p.x, p.y);
      p.s.scale.set(size / 64);
      p.s.rotation += p.spin * dt;
      // fade in quickly, out slowly; puffs grey a little as they thin out
      p.s.alpha = Math.min(1, t * 6) * (1 - t) * (1 - t) * 0.62;
    }
  }

  private spawn(x: number, y: number, seed: number): void {
    const s = this.pool.pop() ?? this.newSprite();
    s.visible = true;
    const r = Math.sin(seed * 12.9898 + this.puffs.length * 78.233) * 43758.5453;
    const f = r - Math.floor(r);
    s.rotation = f * 6.283;
    s.tint = 0xf1eeea - Math.floor(f * 3) * 0x060606;
    this.puffs.push({
      s,
      age: 0,
      life: 3.2 + f * 1.6,
      x: x + (f - 0.5) * 0.6,
      y,
      vx: (f - 0.5) * 0.5,
      vy: RISE * (0.85 + f * 0.3),
      size: 2.4 + f * 1.2,
      spin: (f - 0.5) * 0.6,
    });
  }

  private newSprite(): Sprite {
    const s = new Sprite(texture());
    s.anchor.set(0.5);
    s.eventMode = 'none';
    this.layer.addChild(s);
    return s;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.puffs.length = 0;
    this.pool.length = 0;
  }
}
