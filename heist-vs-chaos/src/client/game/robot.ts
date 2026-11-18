// The plush robot: a container of soft parts with squash/stretch animation helpers. Origin = feet centre.
import Phaser from 'phaser';

export type Expr = 'normal' | 'blink' | 'happy' | 'scared' | 'hurt' | 'focus';
export const ROBOT_SCALE = 0.72;

export class Robot {
  readonly c: Phaser.GameObjects.Container;
  private rig: Phaser.GameObjects.Container;
  private legL: Phaser.GameObjects.Image;
  private legR: Phaser.GameObjects.Image;
  private armL: Phaser.GameObjects.Image;
  private armR: Phaser.GameObjects.Image;
  private body: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Container;
  private eyes: Phaser.GameObjects.Image;
  private shadowImg: Phaser.GameObjects.Image;
  private carried: Phaser.GameObjects.Image | null = null;
  private expr: Expr = 'normal';
  private walkTween: Phaser.Tweens.Tween | null = null;
  private idleTween: Phaser.Tweens.Tween | null = null;
  private blinkTimer: Phaser.Time.TimerEvent;
  facing = 1;
  depthScale = 1;

  constructor(private scene: Phaser.Scene) {
    this.shadowImg = scene.add.image(0, 0, 'ground-shadow');
    this.legL = scene.add.image(-22, -40, 'robot-leg').setOrigin(0.5, 0);
    this.legR = scene.add.image(22, -40, 'robot-leg').setOrigin(0.5, 0);
    this.body = scene.add.image(0, -88, 'robot-body');
    this.armL = scene.add.image(-66, -112, 'robot-arm').setOrigin(0.5, 0.1);
    this.armR = scene.add.image(66, -112, 'robot-arm').setOrigin(0.5, 0.1);
    const headImg = scene.add.image(0, 0, 'robot-head');
    this.eyes = scene.add.image(0, 12, 'eyes-normal');
    this.head = scene.add.container(0, -190, [headImg, this.eyes]);
    this.rig = scene.add.container(0, 0, [this.legL, this.legR, this.body, this.armL, this.armR, this.head]);
    this.c = scene.add.container(0, 0, [this.shadowImg, this.rig]);
    this.c.setScale(ROBOT_SCALE);
    this.c.setDepth(50);
    this.blinkTimer = scene.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        if (this.expr !== 'normal') return;
        this.eyes.setTexture('eyes-blink');
        scene.time.delayedCall(140, () => this.expr === 'normal' && this.eyes.setTexture('eyes-normal'));
      },
    });
    this.idle();
  }

  get x(): number {
    return this.c.x;
  }
  get y(): number {
    return this.c.y;
  }

  place(x: number, y: number): void {
    this.stopAll();
    this.c.setPosition(x, y);
    this.rig.setPosition(0, 0).setAngle(0).setScale(1, 1);
    this.c.setAlpha(1);
    this.idle();
  }

  setDepthScale(s: number): void {
    this.depthScale = s;
    this.c.setScale(ROBOT_SCALE * s * this.facing, ROBOT_SCALE * s);
  }

  face(dir: 1 | -1): void {
    this.facing = dir;
    this.c.setScale(ROBOT_SCALE * this.depthScale * dir, ROBOT_SCALE * this.depthScale);
  }

  express(e: Expr): void {
    this.expr = e;
    this.eyes.setTexture(`eyes-${e}`);
  }

  carry(texKey: string | null): void {
    this.carried?.destroy();
    this.carried = null;
    if (texKey) {
      this.carried = this.scene.add.image(0, -300, texKey).setScale(0.9);
      this.rig.add(this.carried);
      this.armL.setAngle(160);
      this.armR.setAngle(-160);
    } else {
      this.armL.setAngle(0);
      this.armR.setAngle(0);
    }
  }
  get isCarrying(): boolean {
    return this.carried !== null;
  }

  private idle(): void {
    this.idleTween?.stop();
    this.idleTween = this.scene.tweens.add({
      targets: this.rig,
      y: { from: 0, to: -5 },
      scaleY: { from: 1, to: 1.02 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  stopAll(): void {
    this.scene.tweens.killTweensOf([this.c, this.rig, this.legL, this.legR, this.armL, this.armR, this.head]);
    this.walkTween = null;
    this.idleTween = null;
    this.legL.setAngle(0);
    this.legR.setAngle(0);
    this.head.setAngle(0);
    if (!this.carried) {
      this.armL.setAngle(0);
      this.armR.setAngle(0);
    }
  }

  private legs(speed: number, amp: number): void {
    this.walkTween?.stop();
    this.walkTween = this.scene.tweens.add({
      targets: this.legL,
      angle: { from: -amp, to: amp },
      duration: speed,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      onUpdate: () => this.legR.setAngle(-this.legL.angle),
    });
  }

  private stopLegs(): void {
    this.walkTween?.stop();
    this.walkTween = null;
    this.legL.setAngle(0);
    this.legR.setAngle(0);
  }

  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((res) => {
      this.scene.tweens.add({ ...cfg, onComplete: () => res(), onStop: () => res() });
    });
  }

  async moveTo(x: number, y: number, ms: number, style: 'walk' | 'tiptoe' | 'run' | 'sneak' = 'walk'): Promise<void> {
    this.idleTween?.stop();
    this.face(x >= this.c.x ? 1 : -1);
    const speed = style === 'run' ? 110 : style === 'tiptoe' ? 260 : style === 'sneak' ? 220 : 170;
    const amp = style === 'run' ? 30 : style === 'tiptoe' ? 12 : 20;
    this.legs(speed, amp);
    const bob = this.scene.tweens.add({
      targets: this.rig,
      y: style === 'sneak' ? { from: 10, to: 14 } : { from: 0, to: style === 'run' ? -12 : -7 },
      scaleY: style === 'sneak' ? 0.85 : 1,
      duration: speed,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.head.setAngle(style === 'run' ? 6 : style === 'sneak' ? 4 : 0);
    await this.tween({ targets: this.c, x, y, duration: ms, ease: 'Sine.InOut' });
    bob.stop();
    this.rig.setY(0).setScale(1, 1);
    this.head.setAngle(0);
    this.stopLegs();
    this.idle();
  }

  async jumpTo(x: number, y: number, ms: number, height: number): Promise<void> {
    this.idleTween?.stop();
    this.face(x >= this.c.x ? 1 : -1);
    await this.tween({ targets: this.rig, scaleY: 0.8, scaleX: 1.12, duration: 120, yoyo: true });
    const sx = this.c.x;
    const sy = this.c.y;
    const p = { t: 0 };
    await this.tween({
      targets: p,
      t: 1,
      duration: ms,
      ease: 'Linear',
      onUpdate: () => {
        this.c.x = sx + (x - sx) * p.t;
        this.c.y = sy + (y - sy) * p.t - Math.sin(p.t * Math.PI) * height;
        this.rig.setAngle(p.t * 12 - 6);
        this.legL.setAngle(-25);
        this.legR.setAngle(25);
      },
    });
    this.rig.setAngle(0);
    this.stopLegs();
    await this.tween({ targets: this.rig, scaleY: 0.82, scaleX: 1.1, duration: 110, yoyo: true });
    this.idle();
  }

  async slide(x: number, ms: number): Promise<void> {
    this.idleTween?.stop();
    this.face(x >= this.c.x ? 1 : -1);
    await this.tween({ targets: this.rig, scaleY: 0.5, scaleX: 1.15, angle: -8, duration: 160 });
    await this.tween({ targets: this.c, x, duration: ms, ease: 'Quad.Out' });
    await this.tween({ targets: this.rig, scaleY: 1, scaleX: 1, angle: 0, duration: 200, ease: 'Back.Out' });
    this.idle();
  }

  async climb(toY: number, ms: number): Promise<void> {
    this.idleTween?.stop();
    this.armL.setAngle(160);
    this.armR.setAngle(-160);
    const arms = this.scene.tweens.add({ targets: this.armL, angle: { from: 150, to: 175 }, duration: 160, yoyo: true, repeat: -1, onUpdate: () => this.armR.setAngle(-this.armL.angle) });
    await this.tween({ targets: this.c, y: toY, duration: ms, ease: 'Sine.InOut' });
    arms.stop();
    if (!this.carried) {
      this.armL.setAngle(0);
      this.armR.setAngle(0);
    }
    this.idle();
  }

  async squashTo(sx: number, sy: number, ms: number): Promise<void> {
    await this.tween({ targets: this.rig, scaleX: sx, scaleY: sy, duration: ms, ease: 'Sine.InOut' });
  }

  async fade(alpha: number, ms: number): Promise<void> {
    await this.tween({ targets: this.c, alpha, duration: ms });
  }

  async wiggle(ms: number): Promise<void> {
    this.idleTween?.stop();
    await this.tween({ targets: this.rig, angle: { from: -6, to: 6 }, duration: 90, yoyo: true, repeat: Math.max(1, Math.round(ms / 180)) });
    this.rig.setAngle(0);
    this.idle();
  }

  async armWork(ms: number): Promise<void> {
    const t = this.scene.tweens.add({ targets: this.armR, angle: { from: -40, to: -110 }, duration: 140, yoyo: true, repeat: -1 });
    await new Promise<void>((r) => this.scene.time.delayedCall(ms, r));
    t.stop();
    if (!this.carried) this.armR.setAngle(0);
  }

  async hop(times = 2): Promise<void> {
    this.idleTween?.stop();
    for (let i = 0; i < times; i++) {
      await this.tween({ targets: this.rig, y: -46, duration: 220, ease: 'Quad.Out', yoyo: true });
    }
    this.idle();
  }

  async hurt(): Promise<void> {
    this.express('hurt');
    this.idleTween?.stop();
    await this.tween({ targets: this.rig, x: { from: -10, to: 10 }, duration: 50, yoyo: true, repeat: 5 });
    this.rig.setX(0);
    this.idle();
  }

  async tumble(): Promise<void> {
    this.express('hurt');
    this.idleTween?.stop();
    await this.tween({ targets: this.rig, angle: 360, duration: 500, ease: 'Quad.Out' });
    this.rig.setAngle(0);
    await this.tween({ targets: this.rig, scaleY: 0.7, scaleX: 1.15, duration: 120, yoyo: true });
    this.idle();
  }

  async collapse(): Promise<void> {
    this.stopAll();
    this.express('hurt');
    await this.tween({ targets: this.rig, angle: -88, y: -10, duration: 600, ease: 'Bounce.Out' });
  }

  destroy(): void {
    this.blinkTimer.remove();
    this.c.destroy();
  }
}
