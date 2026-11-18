// Main Phaser scene: turns authoritative server state into staging, camera moves and animated consequences.
import Phaser from 'phaser';
import { C, G, hex } from './palette.js';
import { exhibitKey, makeExhibit, makeTextures } from './art.js';
import { Robot } from './robot.js';
import { RoomView, type FX } from './roomview.js';
import type { Level, PublicState, ResolutionView } from '../../shared/types.js';
import { getLevel } from '../../shared/levels/campaign.js';

export interface SceneHooks {
  now(): number;
  sfx(name: string, alert?: boolean): void;
  voice(event: string): void;
  music(track: number): void;
}

export class MuseumScene extends Phaser.Scene {
  private hooks!: SceneHooks;
  private robot!: Robot;
  private rooms: RoomView[] = [];
  private levelKey = '';
  private level!: Level;
  private robotRoom = 0;
  private played = new Set<string>();
  private token = 0;
  private busyUntil = 0;
  private busy = false;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private sirens: Phaser.GameObjects.Image[] = [];
  private shieldRing!: Phaser.GameObjects.Graphics;
  private state: PublicState | null = null;
  private lastVoteId = '';
  private lastTick = -1;
  private phaseSeen = '';
  private exhibitTex = '';
  private escapeLights = 0;

  constructor() {
    super('museum');
  }

  init(data: { hooks: SceneHooks }): void {
    this.hooks = data.hooks;
  }

  create(): void {
    makeTextures(this);
    this.robot = new Robot(this);
    this.shieldRing = this.add.graphics().setDepth(55);
    this.flashRect = this.add.rectangle(640, 360, G.W, G.H, 0xffffff).setScrollFactor(0).setDepth(200).setAlpha(0);
    for (const x of [0, G.W]) {
      this.sirens.push(this.add.image(x, 0, 'siren-glow').setScrollFactor(0).setDepth(150).setAlpha(0).setScale(1.6));
    }
    this.cameras.main.setBackgroundColor(C.cream);
    this.events.emit('ready');
  }

  exhibitDataUrl(lvl: Level): string {
    const key = exhibitKey(lvl.exhibit.name);
    if (!this.textures.exists(key)) makeExhibit(this, key, lvl.exhibit.shape, toCss(lvl.exhibit.colorA), toCss(lvl.exhibit.colorB));
    const src = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    return src.toDataURL();
  }

  // --------------------------------------------------------------------------------------- FX

  private fx: FX = {
    burst: (x, y, keys, n, spread = 200) => {
      for (const k of keys) {
        const e = this.add.particles(x, y, k, {
          speed: { min: spread * 0.3, max: spread },
          angle: { min: 200, max: 340 },
          gravityY: 600,
          lifespan: { min: 500, max: 900 },
          scale: { start: 1.2, end: 0.3 },
          emitting: false,
        });
        e.setDepth(120);
        e.explode(Math.ceil(n / keys.length));
        this.time.delayedCall(1200, () => e.destroy());
      }
    },
    flash: (color, ms, alpha = 0.6) => {
      this.flashRect.setFillStyle(color).setAlpha(alpha);
      this.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms });
    },
    shake: (ms, intensity = 0.006) => this.cameras.main.shake(ms, intensity),
    floatText: (x, y, text, color) => {
      const t = this.add.text(x, y, text, { fontFamily: 'Fredoka', fontSize: '44px', color, fontStyle: 'bold' }).setOrigin(0.5).setDepth(130);
      t.setStroke(C.paper, 9);
      this.tweens.add({ targets: t, y: y - 70, alpha: { from: 1, to: 0 }, duration: 1600, ease: 'Sine.Out', onComplete: () => t.destroy() });
    },
    sfx: (name) => this.hooks.sfx(name, name === 'alarm'),
    voice: (ev) => this.hooks.voice(ev),
    siren: (ms) => {
      for (const s of this.sirens) {
        this.tweens.killTweensOf(s);
        s.setAlpha(0);
        this.tweens.add({ targets: s, alpha: 0.9, duration: 220, yoyo: true, repeat: Math.max(1, Math.round(ms / 440)) - 1 });
      }
    },
    wait: (ms) => new Promise((r) => this.time.delayedCall(ms, r)),
    pickup: (x, y, key) => {
      const s = this.add.image(x, y, key).setDepth(140).setScale(key === 'keycard' ? 1.4 : 0.5);
      const cam = this.cameras.main;
      this.tweens.add({ targets: s, x: cam.scrollX + 1150, y: cam.scrollY + 70, scale: 0.3, duration: 900, ease: 'Sine.InOut', onComplete: () => s.destroy() });
    },
  };

  // --------------------------------------------------------------------------------------- level

  private buildLevel(s: PublicState): void {
    this.token++;
    this.busy = false;
    for (const r of this.rooms) r.destroy();
    this.rooms = [];
    this.level = getLevel(s.level);
    this.exhibitTex = exhibitKey(this.level.exhibit.name);
    if (!this.textures.exists(this.exhibitTex))
      makeExhibit(this, this.exhibitTex, this.level.exhibit.shape, toCss(this.level.exhibit.colorA), toCss(this.level.exhibit.colorB));
    this.level.beats.forEach((b, i) => {
      const rv = new RoomView(this, b, i, this.fx, this.exhibitTex, this.level.n);
      rv.build(s.run, false);
      this.rooms.push(rv);
    });
    const exit = new RoomView(this, null, this.level.beats.length, this.fx, this.exhibitTex, this.level.n);
    exit.build(s.run, true);
    this.rooms.push(exit);
    this.cameras.main.setBounds(0, 0, G.W * this.rooms.length, G.H);
    this.robot.carry(null);
    this.played.clear();
  }

  private roomStart(i: number): number {
    return i * G.W + G.startX;
  }

  private placeRobotAt(i: number, s: PublicState): void {
    this.robot.place(this.roomStart(i), G.floorY);
    this.robot.face(1);
    this.robot.setDepthScale(1);
    this.robot.c.setDepth(50);
    this.robot.carry(s.run.carrying ? this.exhibitTex : null);
    this.robot.express('normal');
    this.robotRoom = i;
    this.cameras.main.scrollX = i * G.W;
  }

  // --------------------------------------------------------------------------------------- sync

  sync(s: PublicState): void {
    this.state = s;
    const key = `${s.cycle}-${s.level}-${s.attempt}`;
    const now = this.hooks.now();
    if (key !== this.levelKey) {
      this.levelKey = key;
      this.buildLevel(s);
      if (s.phase === 'intro' && now - s.phaseStartedAt < 2500) void this.walkIn();
      else this.placeRobotAt(Math.min(s.beatIndex, this.level.beats.length), s);
    }
    for (const r of this.rooms) r.refresh(s.run, r.beat?.phase ?? 'infiltrate');

    const beat = this.level.beats[Math.min(s.beatIndex, this.level.beats.length - 1)]!;
    this.hooks.music(beat.phase === 'escape' || s.run.carrying ? 1 : 0);
    this.escapeLights = beat.phase === 'escape' && s.phase !== 'levelComplete' ? s.run.alarm + 1 : 0;

    const phaseKey = `${key}-${s.phase}-${s.beatIndex}-${s.vote?.id ?? ''}-${s.resolution?.voteId ?? ''}`;
    const fresh = phaseKey !== this.phaseSeen;
    this.phaseSeen = phaseKey;

    switch (s.phase) {
      case 'intro':
        if (fresh) this.hooks.voice('intro');
        break;
      case 'vote':
        if (s.vote && s.vote.id !== this.lastVoteId) {
          this.lastVoteId = s.vote.id;
          this.hooks.sfx('vote_open');
          if (s.vote.revoted) this.hooks.voice('revote');
          else if (s.beatIndex > 0 && beat.phase === 'escape' && this.level.beats[s.beatIndex - 1]?.phase !== 'escape') this.hooks.voice('escape');
          else this.hooks.voice('vote');
        }
        if (!this.busy && this.robotRoom !== s.beatIndex) this.placeRobotAt(s.beatIndex, s);
        if (!this.busy) this.robot.express('focus');
        break;
      case 'resolve':
        if (s.resolution && !this.played.has(s.resolution.voteId)) {
          this.played.add(s.resolution.voteId);
          void this.playResolution(s, s.resolution, now - s.resolution.startedAt);
        }
        break;
      case 'defeat':
        if (fresh) {
          this.hooks.voice('defeat');
          this.hooks.sfx('defeat', true);
          if (!this.busy) void this.robot.collapse();
          else this.time.delayedCall(Math.max(0, this.busyUntil - Date.now()), () => void this.robot.collapse());
        }
        break;
      case 'levelComplete':
        if (fresh) void this.playEscape(now - s.phaseStartedAt);
        break;
      case 'campaignComplete':
        if (fresh) {
          this.hooks.voice('campaign');
          this.hooks.sfx('level_complete', true);
          this.fx.burst(this.cameras.main.scrollX + 640, 300, ['px-gold', 'px-mint', 'px-terra', 'px-white'], 120, 500);
        }
        break;
    }
  }

  private async walkIn(): Promise<void> {
    const t = ++this.token;
    this.robot.place(this.roomStart(0) - 300, G.floorY);
    this.robot.carry(null);
    this.robotRoom = 0;
    this.cameras.main.scrollX = 0;
    this.busy = true;
    await this.robot.moveTo(this.roomStart(0), G.floorY, 1800, 'sneak');
    if (t === this.token) this.busy = false;
  }

  private async playResolution(s: PublicState, r: ResolutionView, offset: number): Promise<void> {
    const t = ++this.token;
    const beat = this.level.beats[r.beatIndex]!;
    const opt = beat.options.find((o) => o.id === r.optionId)!;
    const damage = r.shieldUsed ? 0 : r.outcome.damage > 0 ? r.outcome.damage + r.extraDamage : 0;
    const dead = s.run.hp <= 0;
    // Late join (reconnect / restart): skip straight to the result.
    if (offset > 2500) {
      if (dead) {
        this.placeRobotAt(r.beatIndex, s);
        void this.robot.collapse();
      } else this.placeRobotAt(r.beatIndex + 1, s);
      return;
    }
    this.busy = true;
    this.busyUntil = Date.now() + 9000;
    if (this.robotRoom !== r.beatIndex) this.placeRobotAt(r.beatIndex, { ...s, run: { ...s.run, carrying: beat.challenge === 'case' ? false : s.run.carrying } });
    this.hooks.sfx('result');
    if (r.mode === 'auto') this.hooks.voice('auto');
    this.robot.express('focus');
    await this.fx.wait(Math.max(0, 700 - offset));
    if (t !== this.token) return;
    try {
      await this.rooms[r.beatIndex]!.act(this.robot, opt, r.outcome, damage, r.shieldUsed);
    } catch (e) {
      console.warn('animation error', e);
    }
    if (t !== this.token) return;
    if (dead) {
      this.robot.c.setAlpha(1);
      await this.robot.collapse();
      this.busy = false;
      return;
    }
    await this.transit(r.beatIndex + 1, t);
    if (t === this.token) this.busy = false;
  }

  private async transit(next: number, t: number): Promise<void> {
    const cam = this.cameras.main;
    this.robot.express('normal');
    this.robot.setDepthScale(1);
    if (this.robot.c.alpha < 1) {
      this.robot.c.setPosition(next * G.W - 120, G.floorY);
      this.tweens.add({ targets: cam, scrollX: next * G.W, duration: 1300, ease: 'Sine.InOut' });
      await this.fx.wait(500);
      if (t !== this.token) return;
      this.robot.c.setAlpha(1);
      await this.robot.moveTo(this.roomStart(next), G.floorY, 1100);
    } else {
      this.tweens.add({ targets: cam, scrollX: next * G.W, duration: 1700, ease: 'Sine.InOut' });
      await this.robot.moveTo(this.roomStart(next), G.floorY, 1700, this.robot.isCarrying ? 'run' : 'walk');
    }
    this.robotRoom = next;
  }

  private async playEscape(offset: number): Promise<void> {
    const t = ++this.token;
    const exitIdx = this.level.beats.length;
    this.hooks.voice('level');
    this.hooks.sfx('level_complete', true);
    if (offset > 3000) {
      this.placeRobotAt(exitIdx, this.state!);
      this.robot.c.setAlpha(0);
      return;
    }
    // wait for the last transit if it is still running
    while (this.busy && t === this.token && Date.now() < this.busyUntil) await this.fx.wait(100);
    if (t !== this.token) return;
    if (this.robotRoom !== exitIdx) this.placeRobotAt(exitIdx, this.state!);
    this.robot.carry(this.exhibitTex);
    this.robot.express('happy');
    await this.robot.hop(2);
    this.fx.burst(this.robot.x, this.robot.y - 260, ['px-gold', 'px-mint', 'px-white'], 60, 360);
    await this.robot.moveTo(exitIdx * G.W + 830, G.floorY, 1400, 'run');
    await this.robot.fade(0, 300);
    const van = this.children.list.find((o) => o instanceof Phaser.GameObjects.Image && o.texture.key === 'van') as Phaser.GameObjects.Image | undefined;
    if (van) this.tweens.add({ targets: van, x: van.x + 900, duration: 2200, ease: 'Quad.In', delay: 400 });
    this.hooks.sfx('whoosh');
  }

  // --------------------------------------------------------------------------------------- frame

  override update(time: number): void {
    for (const r of this.rooms) {
      const visible = Math.abs(r.ox - this.cameras.main.scrollX) < G.W * 1.2;
      if (visible) r.update(time);
    }
    const s = this.state;
    // shield bubble
    this.shieldRing.clear();
    if (s?.shield && this.robot.c.alpha > 0.5) {
      const pulse = 0.5 + Math.sin(time / 300) * 0.15;
      this.shieldRing.lineStyle(5, hex(C.mint), pulse).strokeEllipse(this.robot.x, this.robot.y - 95, 190, 230);
      this.shieldRing.fillStyle(hex(C.mintLight), 0.12).fillEllipse(this.robot.x, this.robot.y - 95, 190, 230);
    }
    // escape alarm lights
    if (this.escapeLights > 0) {
      const a = Math.max(0, Math.sin(time / (420 - this.escapeLights * 60))) * 0.22 * this.escapeLights;
      for (const sl of this.sirens) if (!this.tweens.isTweening(sl)) sl.setAlpha(a);
    } else for (const sl of this.sirens) if (!this.tweens.isTweening(sl)) sl.setAlpha(0);
    // last-five-seconds ticks
    if (s?.phase === 'vote' && s.vote) {
      const left = Math.ceil((s.vote.endsAt - this.hooks.now()) / 1000);
      if (left <= 5 && left >= 1 && left !== this.lastTick) {
        this.lastTick = left;
        this.hooks.sfx('tick');
      }
    }
  }
}

function toCss(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}
