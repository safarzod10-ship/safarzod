/**
 * Sparks: the trail of the light that draws the logo, a few glints when a
 * building is finished, slow motes around the finished mark. A fixed pool in
 * one ParticleContainer - one additive draw call, nothing allocated per frame.
 */
import { Particle, ParticleContainer, ParticleShader, Rectangle } from 'pixi.js';
import type { SpriteSet } from '../sprites.ts';

interface Spark {
  p: Particle;
  vx: number;
  vy: number;
  /** Seconds left / total. 0 = free. */
  life: number;
  span: number;
  size: number;
  /** Vertical pull, px/s^2 (negative rises). */
  gravity: number;
  drag: number;
  twinkle: number;
}

export interface SparkOptions {
  vx?: number;
  vy?: number;
  life?: number;
  size?: number;
  tint?: number;
  gravity?: number;
  drag?: number;
  twinkle?: number;
}

export class SparkLayer {
  readonly container: ParticleContainer<Particle>;
  /**
   * Our own instance of the stock particle shader. The renderer's shared one
   * would keep pointing at the sprite atlas after the splash has destroyed it.
   */
  private readonly shader = new ParticleShader();
  private readonly pool: Spark[] = [];
  private next = 0;
  private readonly dotSize: number;

  constructor(sprites: SpriteSet, capacity: number) {
    this.container = new ParticleContainer<Particle>({
      texture: sprites.dot,
      shader: this.shader,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
      boundsArea: new Rectangle(0, 0, 1, 1),
      label: 'splash:sparks',
    });
    this.container.blendMode = 'add';
    this.dotSize = sprites.dot.width;
    const particles: Particle[] = [];
    for (let i = 0; i < capacity; i++) {
      // every third one is a four-point glint, the rest soft dots (same atlas, so one batch)
      const p = new Particle({ texture: i % 3 === 0 ? sprites.sparkle : sprites.dot, anchorX: 0.5, anchorY: 0.5, alpha: 0 });
      p.scaleX = p.scaleY = 0;
      particles.push(p);
      this.pool.push({ p, vx: 0, vy: 0, life: 0, span: 1, size: 1, gravity: 0, drag: 0, twinkle: 0 });
    }
    this.container.addParticle(...particles);
  }

  get capacity(): number {
    return this.pool.length;
  }

  /** Screen px. Reuses the oldest slot when the pool is full. */
  emit(x: number, y: number, o: SparkOptions = {}): void {
    if (!this.pool.length) return;
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    s.p.x = x;
    s.p.y = y;
    s.vx = o.vx ?? 0;
    s.vy = o.vy ?? 0;
    s.span = s.life = o.life ?? 0.6;
    s.size = (o.size ?? 8) / this.dotSize;
    s.gravity = o.gravity ?? 0;
    s.drag = o.drag ?? 1.6;
    s.twinkle = o.twinkle ?? 0;
    s.p.tint = o.tint ?? 0xfff0c0;
    s.p.alpha = 0;
    s.p.scaleX = s.p.scaleY = 0;
  }

  update(dtSec: number, timeSec: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (s.life <= 0) continue;
      s.life -= dtSec;
      const p = s.p;
      if (s.life <= 0) {
        p.alpha = 0;
        p.scaleX = p.scaleY = 0;
        continue;
      }
      const k = Math.max(0, 1 - s.drag * dtSec);
      s.vx *= k;
      s.vy = s.vy * k + s.gravity * dtSec;
      p.x += s.vx * dtSec;
      p.y += s.vy * dtSec;
      const age = 1 - s.life / s.span;
      // quick flare up, slow fade
      const env = Math.min(1, age * 8) * (1 - age) * (1 - age * 0.4);
      const tw = s.twinkle ? 0.65 + 0.35 * Math.sin(timeSec * 9 + i * 1.7) * s.twinkle : 1;
      p.alpha = Math.min(1, env * 1.6 * tw);
      p.scaleX = p.scaleY = s.size * (0.6 + 0.4 * env);
    }
  }

  /** Let living sparks fade out fast (used when the splash leaves). */
  hurry(): void {
    for (const s of this.pool) if (s.life > 0.25) s.life = 0.25;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.shader.destroy(); // not its program: the game's own particles (trees) use the same one
    this.pool.length = 0;
  }
}
