// One room = one decision. Builds the challenge's moving props from the beat cues + run state and plays the
// physical consequence of the chosen option (movement, trap, alarm, capture) with the robot.
import Phaser from 'phaser';
import { C, G, hex } from './palette.js';
import { paintRoom, routeX } from './rooms.js';
import type { Robot } from './robot.js';
import type { Beat, BeatOption, Outcome, Phase, RunState } from '../../shared/types.js';

export interface FX {
  burst(x: number, y: number, keys: string[], n: number, spread?: number): void;
  flash(color: number, ms: number, alpha?: number): void;
  shake(ms: number, intensity?: number): void;
  floatText(x: number, y: number, text: string, color: string): void;
  sfx(name: string): void;
  voice(event: string): void;
  siren(ms: number): void;
  wait(ms: number): Promise<void>;
  /** Robot "inventory" pickup animation towards the HUD. */
  pickup(x: number, y: number, key: string): void;
}

const F = G.floorY;

export class RoomView {
  readonly ox: number;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private beams: Phaser.GameObjects.Graphics | null = null;
  private beamLevels: { y0: number; heights: number[] }[] = [];
  private beamsOn = true;
  private pulse = false;
  private camCone: Phaser.GameObjects.Image | null = null;
  private camImg: Phaser.GameObjects.Image | null = null;
  private guard: Phaser.GameObjects.Container | null = null;
  private guardCone: Phaser.GameObjects.Image | null = null;
  private statue: Phaser.GameObjects.Image | null = null;
  private crate: Phaser.GameObjects.Image | null = null;
  private cat: Phaser.GameObjects.Image | null = null;
  private door: Phaser.GameObjects.Image | null = null;
  private exhibitImg: Phaser.GameObjects.Image | null = null;
  private sensor: Phaser.GameObjects.Image | null = null;
  private net: Phaser.GameObjects.Image | null = null;
  private dim: Phaser.GameObjects.Rectangle | null = null;
  private blockers: Phaser.GameObjects.GameObject[] = [];
  private searchCones: Phaser.GameObjects.Image[] = [];
  private bgKey: string;
  private texKeys: string[] = [];
  private t0 = 0;
  private powerCut = false;

  constructor(
    private scene: Phaser.Scene,
    readonly beat: Beat | null,
    readonly index: number,
    private fx: FX,
    private exhibitKey: string,
    private levelN: number,
  ) {
    this.ox = index * G.W;
    const style = beat ? beat.room.style : 'courtyard';
    const seed = beat ? beat.room.seed : levelN * 77;
    const wall = beat ? beat.room.wall : 0;
    this.bgKey = `room-${levelN}-${index}-${seed}`;
    if (!scene.textures.exists(this.bgKey)) {
      scene.textures.addCanvas(this.bgKey, paintRoom(beat, style, seed, wall));
      this.texKeys.push(this.bgKey);
    }
    this.add(scene.add.image(this.ox, 0, this.bgKey).setOrigin(0, 0).setDepth(0));
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objs.push(o);
    return o;
  }
  private X(x: number): number {
    return this.ox + x;
  }

  // ---------------------------------------------------------------------------------------- build

  build(run: RunState, exitRoom: boolean): void {
    if (exitRoom) {
      this.add(this.scene.add.image(this.X(900), F + 10, 'van').setOrigin(0.5, 1).setDepth(30));
      return;
    }
    const b = this.beat!;
    const cue = b.cue;
    switch (b.challenge) {
      case 'entry':
        this.buildEntry(String(cue.safe));
        break;
      case 'laser':
        this.buildLasers(String(cue.mode), false);
        break;
      case 'camera':
        this.buildCamera(String(cue.zone));
        this.crate = this.add(this.scene.add.image(this.X(560), F + 6, 'crate').setOrigin(0.5, 1).setDepth(40));
        break;
      case 'laserCam':
        this.buildLasers(String(cue.laser), true);
        this.buildCamera(String(cue.zone));
        break;
      case 'guard':
        this.buildGuardScene(String(cue.mode));
        break;
      case 'guardPlates':
        this.buildGuardScene(String(cue.guard));
        break;
      case 'plates':
        break;
      case 'fusebox':
        this.add(this.scene.add.image(this.X(620), F - 150, cue.linked ? 'fusebox-linked' : 'fusebox').setDepth(20));
        break;
      case 'keycard': {
        this.add(this.scene.add.image(this.X(480), F + 8, 'desk').setOrigin(0.5, 1).setDepth(30));
        if (cue.desk) {
          this.add(this.scene.add.image(this.X(420), F - 64, 'drawer-open').setDepth(31));
        }
        const asleep = cue.guard === 'asleep';
        this.guard = this.makeGuard(this.X(850), F + 4, -1, asleep ? 'guard-sleep' : 'guard');
        this.guard.setAngle(asleep ? -6 : 0);
        const card = this.add(this.scene.add.image(this.X(840), F - 90, 'keycard').setDepth(46).setScale(0.8));
        if (asleep) this.addZzz(this.X(820), F - 230);
        else this.scene.tweens.add({ targets: this.guard, angle: { from: -2, to: 2 }, duration: 260, yoyo: true, repeat: -1 });
        card.setData('role', 'guardcard');
        break;
      }
      case 'door':
        this.door = this.add(this.scene.add.image(this.X(930), F + 8, cue.lock === 'brass' ? 'door-brass' : 'door-magnetic').setOrigin(0.5, 1).setDepth(20));
        this.add(this.scene.add.image(this.X(640), 210, 'vent').setDepth(20));
        break;
      case 'cat':
        this.cat = this.add(this.scene.add.image(this.X(660), F + 6, cue.awake ? 'cat-awake' : 'cat-sleep').setOrigin(0.5, 1).setDepth(40));
        if (!cue.awake) this.addZzz(this.X(700), F - 120);
        else this.scene.tweens.add({ targets: this.cat, scaleY: { from: 1, to: 1.04 }, duration: 500, yoyo: true, repeat: -1 });
        break;
      case 'giftshop': {
        const shelf = this.scene.add.graphics().setDepth(18);
        shelf.fillStyle(hex(C.wood), 1).fillRect(this.X(560), F - 130, 220, 14);
        this.add(shelf);
        this.add(this.scene.add.image(this.X(640), F - 160, this.exhibitKey).setScale(0.45).setDepth(19));
        this.add(this.scene.add.image(this.X(700), F - 160, this.exhibitKey).setScale(0.45).setDepth(19));
        if (cue.gate === 'barred') {
          const bars = this.scene.add.graphics().setDepth(45);
          bars.lineStyle(10, hex(C.sageDeep), 1);
          for (let x = 540; x <= 820; x += 40) bars.lineBetween(this.X(x), F - 300, this.X(x), F + 4);
          bars.lineBetween(this.X(530), F - 300, this.X(830), F - 300);
          bars.fillStyle(hex(C.laser), 1).fillCircle(this.X(530), F - 300, 9);
          this.add(bars);
          this.blink(this.add(this.scene.add.image(this.X(530), F - 300, 'px-red').setScale(2).setDepth(46)), 500);
        }
        break;
      }
      case 'case':
        this.buildCase(String(cue.sensor));
        break;
      case 'chase':
        break;
      case 'searchlight':
        this.buildSearch(String(cue.mode));
        break;
    }
    this.refresh(run, b.phase);
  }

  private addZzz(x: number, y: number): void {
    const z = this.add(this.scene.add.image(x, y, 'zzz').setDepth(60));
    this.scene.tweens.add({ targets: z, y: y - 26, alpha: { from: 1, to: 0.2 }, duration: 1600, repeat: -1 });
  }

  private blink(o: Phaser.GameObjects.Image, ms: number): void {
    this.scene.tweens.add({ targets: o, alpha: { from: 1, to: 0.15 }, duration: ms, yoyo: true, repeat: -1 });
  }

  private makeGuard(x: number, y: number, dir: 1 | -1, tex = 'guard', withCone = false): Phaser.GameObjects.Container {
    const img = this.scene.add.image(0, 0, tex).setOrigin(0.5, 1);
    const parts: Phaser.GameObjects.GameObject[] = [img];
    if (withCone) {
      this.guardCone = this.scene.add.image(58, -128, 'flash-cone').setOrigin(0, 0.5).setAlpha(0.85);
      parts.unshift(this.guardCone);
    }
    const c = this.scene.add.container(x, y, parts).setDepth(45).setScale(0.82 * dir, 0.82);
    this.add(c);
    return c;
  }

  private buildEntry(safe: string): void {
    if (safe !== 'dock') {
      const g = this.makeGuard(this.X(1010), F + 4, -1);
      g.setDepth(25);
      const steam = this.add(this.scene.add.image(this.X(960), F - 150, 'px-white').setDepth(26));
      this.scene.tweens.add({ targets: steam, y: F - 200, alpha: 0, duration: 1400, repeat: -1 });
    } else {
      const open = this.add(this.scene.add.rectangle(this.X(1065), F - 85, 110, 170, hex(C.nightDeep)).setDepth(5));
      open.setAlpha(0.9);
    }
    if (safe !== 'window') this.blink(this.add(this.scene.add.image(this.X(270), 316, 'px-red').setScale(2.4).setDepth(20)), 350);
    else this.add(this.scene.add.rectangle(this.X(205), 375, 146, 40, hex(C.mintLight)).setAlpha(0.5).setDepth(6));
    if (safe !== 'skylight') {
      const rain = this.add(this.scene.add.graphics().setDepth(20));
      const drops = Array.from({ length: 26 }, (_, i) => ({ x: 530 + ((i * 37) % 220), y: (i * 53) % 60 }));
      this.add(
        this.scene.add.particles(0, 0, 'px-white', {
          x: { min: this.X(520), max: this.X(760) },
          y: 150,
          speedY: { min: 300, max: 420 },
          lifespan: 300,
          frequency: 40,
          scale: { start: 0.5, end: 0.3 },
          alpha: 0.6,
        }).setDepth(21),
      );
      rain.lineStyle(2, 0xffffff, 0.5);
      for (const d of drops) rain.lineBetween(this.X(d.x), 180 + d.y * 0.4, this.X(d.x - 4), 192 + d.y * 0.4);
    } else {
      const rope = this.add(this.scene.add.graphics().setDepth(19));
      rope.lineStyle(5, hex(C.goldLight), 1).lineBetween(this.X(640), 214, this.X(640), 400);
    }
  }

  private buildLasers(mode: string, withLedge: boolean): void {
    const heights = mode === 'low' ? [22, 52] : mode === 'high' ? [122, 156] : [36, 86, 136];
    this.pulse = mode === 'pulse';
    this.beamLevels = [{ y0: F, heights }];
    if (withLedge) this.beamLevels.push({ y0: G.ledgeY, heights });
    for (const lv of this.beamLevels) {
      for (const x of [560, 820]) this.add(this.scene.add.image(this.X(x), lv.y0 + 4, 'laser-post').setOrigin(0.5, 1).setDepth(42).setScale(1, lv.y0 === F ? 1 : 0.95));
    }
    this.beams = this.add(this.scene.add.graphics().setDepth(43));
  }

  private drawBeams(t: number): void {
    const g = this.beams;
    if (!g) return;
    g.clear();
    const on = this.beamsOn && (!this.pulse || Math.floor(t / 1100) % 2 === 0);
    if (!on) return;
    const flick = 0.75 + Math.sin(t / 60) * 0.1;
    for (const lv of this.beamLevels)
      for (const h of lv.heights) {
        const y = lv.y0 - h;
        g.lineStyle(22, hex(C.laser), 0.16 * flick).lineBetween(this.X(566), y, this.X(814), y);
        g.lineStyle(10, hex(C.laser), 0.35 * flick).lineBetween(this.X(566), y, this.X(814), y);
        g.lineStyle(5, hex(C.laser), 0.95 * flick).lineBetween(this.X(566), y, this.X(814), y);
        g.lineStyle(2, 0xffffff, 0.85).lineBetween(this.X(566), y, this.X(814), y);
      }
  }

  private buildCamera(zone: string): void {
    const cx = this.X(1110);
    const cy = 150;
    this.camCone = this.add(this.scene.add.image(cx - 10, cy + 12, 'cam-cone').setOrigin(0, 0.5).setDepth(41));
    this.camImg = this.add(this.scene.add.image(cx, cy, 'cam').setDepth(42).setFlipX(true));
    const floor = Math.atan2(F - 40 - cy, 560 - 1110);
    const ledge = Math.atan2(G.ledgeY - 40 - cy, 560 - 1110);
    this.camCone.setScale(2.1, 1);
    if (zone === 'floor') this.camCone.setRotation(floor);
    else if (zone === 'ledge') this.camCone.setRotation(ledge);
    else {
      this.camCone.setRotation(floor);
      this.scene.tweens.add({ targets: this.camCone, rotation: ledge, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  private buildGuardScene(mode: string): void {
    const statueX = mode === 'away' ? 1010 : mode === 'statue' ? 620 : 470;
    this.statue = this.add(this.scene.add.image(this.X(statueX), F + 8, 'statue').setOrigin(0.5, 1).setDepth(48));
    if (mode === 'statue') {
      const sh = this.add(this.scene.add.graphics().setDepth(4));
      sh.fillStyle(hex(C.ink), 0.45).fillRoundedRect(this.X(320), F - 260, 130, 260, { tl: 60, tr: 60, bl: 0, br: 0 });
    }
    if (mode === 'toward') {
      this.guard = this.makeGuard(this.X(960), F + 4, -1, 'guard', true);
      this.scene.tweens.add({ targets: this.guard, x: this.X(880), duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    } else if (mode === 'away') {
      this.guard = this.makeGuard(this.X(700), F + 4, 1, 'guard', true);
      this.scene.tweens.add({ targets: this.guard, x: this.X(800), duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    } else if (mode === 'statue') {
      this.guard = this.makeGuard(this.X(770), F + 4, -1, 'guard', true);
      this.scene.tweens.add({ targets: this.guardCone, angle: { from: -22, to: 22 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    } else {
      this.guard = this.makeGuard(this.X(840), F + 4, -1, 'guard', false);
      for (const x of [300, 330, 352]) this.add(this.scene.add.image(this.X(x), F - 4, 'coin').setDepth(30));
      const note = this.add(this.scene.add.image(this.X(800), F - 220, 'px-gold').setScale(1.6).setDepth(60));
      this.scene.tweens.add({ targets: note, y: F - 280, alpha: 0, duration: 1200, repeat: -1 });
    }
  }

  private buildCase(sensor: string): void {
    this.add(this.scene.add.image(this.X(720), F + 8, 'case').setOrigin(0.5, 1).setDepth(30));
    this.exhibitImg = this.add(this.scene.add.image(this.X(720), F - 190, this.exhibitKey).setDepth(29));
    this.scene.tweens.add({ targets: this.exhibitImg, y: F - 198, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.sensor = this.add(this.scene.add.image(this.X(720), F - 330, `sensor-${sensor}`).setDepth(31));
    if (sensor === 'beam') {
      const g = this.add(this.scene.add.graphics().setDepth(32));
      g.lineStyle(4, hex(C.laser), 0.9).lineBetween(this.X(630), F - 220, this.X(810), F - 140);
    }
    if (sensor === 'motion') this.blink(this.sensor, 900);
    if (sensor === 'heat') this.scene.tweens.add({ targets: this.sensor, scale: { from: 1, to: 1.12 }, duration: 600, yoyo: true, repeat: -1 });
    // glow halo
    this.add(this.scene.add.image(this.X(720), F - 190, 'siren-glow').setDepth(28).setAlpha(0.2).setScale(0.8));
  }

  private buildSearch(mode: string): void {
    const mk = (x: number) => this.add(this.scene.add.image(this.X(x), 0, 'search-cone').setOrigin(0.5, 0).setDepth(44).setScale(0.9, 1.05));
    if (mode === 'leaving') {
      const c = mk(700);
      this.searchCones.push(c);
      this.scene.tweens.add({ targets: c, x: this.X(1150), duration: 2600, repeat: -1, ease: 'Sine.In' });
    } else if (mode === 'coming') {
      const c = mk(1150);
      this.searchCones.push(c);
      this.scene.tweens.add({ targets: c, x: this.X(620), duration: 2600, repeat: -1, ease: 'Sine.Out' });
    } else {
      const a = mk(300);
      const b2 = mk(1000);
      this.searchCones.push(a, b2);
      this.scene.tweens.add({ targets: a, x: this.X(800), duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.scene.tweens.add({ targets: b2, x: this.X(500), duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /** Apply state-dependent visuals (power cut, alert-dependent guard routes). */
  refresh(run: RunState, phase: Phase): void {
    const b = this.beat;
    if (!b) return;
    this.powerCut = run.flags.includes('powerCut') && phase !== 'escape';
    if (b.challenge === 'laser' || b.challenge === 'laserCam' || b.challenge === 'camera') {
      this.beamsOn = !this.powerCut;
      this.camCone?.setVisible(!this.powerCut);
      if (this.powerCut && !this.dim) this.dim = this.add(this.scene.add.rectangle(this.X(640), 360, G.W, G.H, hex(C.nightDeep)).setAlpha(0.22).setDepth(39));
    }
    if (b.challenge === 'chase') this.buildBlockers(run);
  }

  private buildBlockers(run: RunState): void {
    for (const o of this.blockers) o.destroy();
    this.blockers = [];
    const routes = String(this.beat!.cue.routes).split(',');
    const free = run.alarm >= 2 ? String(this.beat!.cue.freeIfAlarm) : String(this.beat!.cue.free);
    for (const r of routes) {
      if (r === free) continue;
      const x = this.X(routeX(r));
      if (r === 'stairs') {
        const g = this.makeGuard(x - 40, F - 150, -1);
        g.setScale(-0.7, 0.7).setDepth(35);
        this.blockers.push(g);
      } else if (r === 'elevator') {
        const g = this.makeGuard(x, F + 4, -1);
        g.setScale(-0.75, 0.75).setDepth(35);
        this.blockers.push(g);
      } else if (r === 'window') {
        const bars = this.scene.add.graphics().setDepth(36);
        bars.lineStyle(9, hex(C.ink), 1);
        for (let i = -1; i <= 1; i++) bars.lineBetween(x + i * 40, F - 318, x + i * 40, F - 122);
        bars.lineBetween(x - 68, F - 220, x + 68, F - 220);
        this.add(bars);
        this.blockers.push(bars);
      } else if (r === 'chute') {
        const tape = this.scene.add.graphics().setDepth(36);
        tape.fillStyle(hex(C.goldLight), 1);
        tape.fillRect(x - 70, F - 160, 140, 22);
        tape.fillStyle(hex(C.ink), 1);
        for (let i = 0; i < 7; i++) tape.fillRect(x - 66 + i * 20, F - 160, 8, 22);
        this.add(tape);
        this.blockers.push(tape);
      }
    }
  }

  update(t: number): void {
    this.t0 = t;
    if (this.beams) this.drawBeams(t);
  }

  // ---------------------------------------------------------------------------------------- act

  /** Play the chosen option. Leaves the robot ready to walk to the next room. */
  async act(robot: Robot, opt: BeatOption, out: Outcome, damage: number, shieldUsed: boolean): Promise<void> {
    const b = this.beat!;
    const fail = !out.ok;
    const hurt = damage > 0;
    const say = (x: number) => this.feedback(robot, out, damage, shieldUsed, x);
    switch (b.challenge) {
      case 'entry':
        await this.actEntry(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'laser':
      case 'laserCam':
        await this.actLaser(robot, opt, out, damage, shieldUsed);
        return;
      case 'camera': {
        if (opt.id === 'ledge') {
          await robot.moveTo(this.X(330), F, 700);
          await robot.climb(G.ledgeY, 600);
          const p = robot.moveTo(this.X(1000), G.ledgeY, 1300, 'tiptoe');
          if (fail) await this.fx.wait(600).then(() => this.camSpot(robot, out, damage, shieldUsed));
          await p;
          await robot.jumpTo(this.X(1080), F, 500, 40);
        } else if (opt.id === 'box') {
          await robot.moveTo(this.X(520), F, 800);
          robot.c.setDepth(35);
          await robot.squashTo(1.1, 0.7, 200);
          if (fail) await this.camSpot(robot, out, damage, shieldUsed);
          else {
            await this.fx.wait(500);
            this.fx.sfx('step');
            this.scene.tweens.add({ targets: this.crate, x: this.X(760), duration: 900, ease: 'Sine.InOut' });
            await robot.moveTo(this.X(720), F, 900, 'sneak');
            say(this.X(720));
          }
          await robot.squashTo(1, 1, 200);
          robot.c.setDepth(50);
        } else {
          const p = robot.moveTo(this.X(1000), F, 1900, opt.id === 'walk' ? 'walk' : 'sneak');
          await this.fx.wait(800);
          if (fail) await this.camSpot(robot, out, damage, shieldUsed);
          else say(robot.x);
          await p;
        }
        if (!fail && opt.id === 'ledge') say(robot.x);
        return;
      }
      case 'guard':
      case 'guardPlates': {
        if (opt.id.startsWith('row')) {
          await this.actRows(robot, opt.id, out, damage, shieldUsed);
          return;
        }
        await this.actGuard(robot, opt.id, out, damage, shieldUsed);
        return;
      }
      case 'plates':
        await this.actRows(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'fusebox':
        if (opt.id === 'leave') {
          await robot.moveTo(this.X(960), F, 1500);
          say(robot.x);
          return;
        }
        await robot.moveTo(this.X(560), F, 900);
        robot.face(1);
        await robot.armWork(700);
        if (opt.id === 'cut') {
          this.fx.sfx('lever');
          if (out.set?.includes('powerCut')) {
            this.fx.flash(hex(C.nightDeep), 400, 0.5);
            this.add(this.scene.add.rectangle(this.X(640), 360, G.W, G.H, hex(C.nightDeep)).setAlpha(0.25).setDepth(39));
          }
        }
        if (opt.id === 'overload') this.fx.burst(this.X(620), F - 150, ['px-gold', 'px-white', 'px-red'], 40, 260);
        say(this.X(560));
        await this.fx.wait(500);
        return;
      case 'keycard': {
        if (opt.id === 'skip') {
          await robot.moveTo(this.X(1000), F, 1700);
          say(robot.x);
          return;
        }
        const tx = opt.id === 'lift' ? 780 : 470;
        await robot.moveTo(this.X(tx), F, 1100, 'tiptoe');
        robot.face(1);
        await robot.armWork(800);
        if (out.gain?.includes('keycard')) {
          const card = opt.id === 'lift' ? (this.objs.find((o) => o.getData?.('role') === 'guardcard') as Phaser.GameObjects.Image | undefined) : undefined;
          card?.setVisible(false);
          this.fx.pickup(opt.id === 'lift' ? this.X(840) : this.X(420), F - 80, 'keycard');
          this.fx.sfx('pickup');
        }
        if (opt.id === 'lift' && fail && this.guard) {
          (this.guard.list[this.guard.list.length - 1] as Phaser.GameObjects.Image).setTexture('guard');
          this.scene.tweens.add({ targets: this.guard, angle: 0, duration: 120 });
          this.exclaim(this.guard.x, F - 230);
        }
        say(robot.x);
        await this.fx.wait(500);
        return;
      }
      case 'door':
        await this.actDoor(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'cat':
        await this.actCat(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'giftshop': {
        if (opt.id === 'skip') {
          await robot.moveTo(this.X(1000), F, 1700);
          say(robot.x);
          return;
        }
        await robot.moveTo(this.X(opt.id === 'walk' ? 640 : 520), F, 1100);
        robot.face(1);
        await robot.armWork(700);
        if (fail && opt.id === 'reach') this.fx.burst(this.X(640), F - 160, ['px-terra', 'px-white', 'px-gold'], 30, 200);
        if (out.gain?.includes('decoy')) {
          this.fx.pickup(this.X(660), F - 160, this.exhibitKey);
          this.fx.sfx('pickup');
        }
        say(robot.x);
        await this.fx.wait(400);
        return;
      }
      case 'case':
        await this.actCase(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'chase':
        await this.actChase(robot, opt.id, out, damage, shieldUsed);
        return;
      case 'searchlight':
        await this.actSearch(robot, opt.id, out, damage, shieldUsed);
        return;
    }
    void hurt;
  }

  /** Damage / success reaction (popups, sounds, robot face). */
  feedback(robot: Robot, out: Outcome, damage: number, shieldUsed: boolean, x: number): void {
    const y = robot.y - 220;
    if (out.ok) {
      robot.express('happy');
      this.fx.burst(robot.x, robot.y - 90, ['px-mint', 'px-gold'], 14, 140);
      this.fx.sfx('success');
      this.fx.voice('success');
      return;
    }
    if (shieldUsed) {
      this.fx.floatText(x, y, 'SHIELD!', C.mint);
      this.fx.sfx('shield');
      this.fx.voice('shield');
    }
    switch (out.anim) {
      case 'zap':
      case 'sparks':
        this.fx.burst(robot.x, robot.y - 100, ['px-red', 'px-gold', 'px-white'], 34, 260);
        this.fx.flash(0xffffff, 120, 0.5);
        this.fx.sfx('zap');
        break;
      case 'spotted':
      case 'caught':
      case 'meow':
      case 'alarm':
        this.fx.siren(1400);
        this.fx.sfx(out.anim === 'meow' ? 'meow' : 'alarm');
        break;
      case 'trap':
        this.fx.sfx('trap');
        break;
      case 'fall':
        this.fx.sfx('thud');
        break;
    }
    if (damage > 0) {
      this.fx.floatText(x, y, `-${damage} HP`, C.laser);
      this.fx.shake(300, 0.008);
      this.fx.voice('hurt');
      void robot.hurt();
    } else if (!shieldUsed) {
      robot.express('scared');
      this.fx.floatText(x, y, `ALERT +${out.alarm ?? 1}`, C.terracotta);
      this.fx.voice('noisy');
    }
  }

  private exclaim(x: number, y: number): void {
    const t = this.scene.add.text(x, y, '!', { fontFamily: 'Fredoka', fontSize: '72px', color: C.laser, fontStyle: 'bold' }).setOrigin(0.5).setDepth(80);
    t.setStroke(C.paper, 8);
    this.scene.tweens.add({ targets: t, y: y - 30, scale: { from: 0.4, to: 1.2 }, duration: 300, ease: 'Back.Out' });
    this.scene.time.delayedCall(1300, () => t.destroy());
  }

  private async camSpot(robot: Robot, out: Outcome, damage: number, shield: boolean): Promise<void> {
    this.camCone?.setAlpha(1);
    this.fx.flash(0xffffff, 160, 0.6);
    if (this.camImg) this.exclaim(this.camImg.x, this.camImg.y - 40);
    this.feedback(robot, out, damage, shield, robot.x);
    await this.fx.wait(600);
  }

  private async actEntry(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    if (id === 'skylight') {
      await robot.moveTo(this.X(640), F, 1200);
      if (!out.ok) {
        await robot.climb(F - 140, 700);
        await robot.climb(F, 220);
        await robot.tumble();
        this.feedback(robot, out, damage, shield, robot.x);
        await this.fx.wait(500);
      } else this.feedback(robot, out, damage, shield, robot.x);
      await robot.climb(220, 1100);
      await robot.fade(0, 300);
    } else if (id === 'window') {
      await robot.moveTo(this.X(220), F, 900);
      await robot.climb(440, 700);
      if (!out.ok) this.fx.burst(this.X(250), 330, ['px-red', 'px-gold'], 26, 200);
      this.feedback(robot, out, damage, shield, robot.x);
      await this.fx.wait(500);
      await robot.fade(0, 400);
    } else {
      await robot.moveTo(this.X(1040), F, 1600, 'sneak');
      if (!out.ok) {
        const g = this.objs.find((o) => o instanceof Phaser.GameObjects.Container) as Phaser.GameObjects.Container | undefined;
        if (g) this.exclaim(g.x, F - 240);
      }
      this.feedback(robot, out, damage, shield, robot.x);
      await this.fx.wait(600);
      await robot.fade(0, 400);
    }
  }

  private async actLaser(robot: Robot, opt: BeatOption, out: Outcome, damage: number, shield: boolean): Promise<void> {
    const [move, path] = opt.id.includes('-') ? (opt.id.split('-') as [string, string]) : [opt.id, 'floor'];
    const y = path === 'ledge' ? G.ledgeY : F;
    if (path === 'ledge') {
      await robot.moveTo(this.X(330), F, 700);
      await robot.climb(G.ledgeY, 600);
    }
    await robot.moveTo(this.X(450), y, path === 'ledge' ? 400 : 800);
    const zapAt = (ms: number) =>
      this.fx.wait(ms).then(() => {
        if (!out.ok && out.anim === 'spotted') {
          if (this.camImg) this.exclaim(this.camImg.x, this.camImg.y - 40);
          this.fx.flash(0xffffff, 160, 0.6);
        }
        this.feedback(robot, out, damage, shield, robot.x);
      });
    if (move === 'jump') await Promise.all([robot.jumpTo(this.X(930), y, 1000, 170), zapAt(500)]);
    else if (move === 'slide') await Promise.all([robot.slide(this.X(930), 1100), zapAt(650)]);
    else if (move === 'wait') {
      robot.express('focus');
      await this.fx.wait(1200);
      await Promise.all([robot.moveTo(this.X(930), y, 900, 'run'), zapAt(450)]);
    } else await Promise.all([robot.moveTo(this.X(930), y, 1400), zapAt(700)]);
    if (path === 'ledge') await robot.jumpTo(this.X(1080), F, 500, 40);
  }

  private async actRows(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    const r = Number(id.slice(3));
    const rows = this.beat!.challenge === 'plates' ? Number(this.beat!.cue.rows) : 3;
    const ry = G.rows[Math.min(r, rows - 1)]!;
    await robot.moveTo(this.X(290), ry, 800);
    robot.setDepthScale(0.92 + r * 0.04);
    robot.c.setDepth(50 + r);
    const p = robot.moveTo(this.X(980), ry, 2200, 'tiptoe');
    await this.fx.wait(900);
    if (!out.ok && out.anim === 'trap') {
      this.fx.sfx('click');
      this.net ??= this.add(this.scene.add.image(0, 0, 'net').setDepth(70));
      this.net.setPosition(robot.x, -100).setAlpha(1);
      this.scene.tweens.add({ targets: this.net, y: ry - 80, duration: 350, ease: 'Bounce.Out' });
      await this.fx.wait(350);
      this.feedback(robot, out, damage, shield, robot.x);
      this.scene.tweens.add({ targets: this.net, alpha: 0, delay: 900, duration: 400 });
    } else if (!out.ok) {
      if (this.guard) this.exclaim(this.guard.x, F - 240);
      this.feedback(robot, out, damage, shield, robot.x);
    } else this.feedback(robot, out, damage, shield, robot.x);
    await p;
    robot.setDepthScale(1);
    robot.c.setDepth(50);
    await robot.moveTo(this.X(1040), F, 400);
  }

  private async actGuard(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    const g = this.guard;
    if (id === 'statue' && this.statue) {
      await robot.moveTo(this.statue.x - 30, F, 1000, 'sneak');
      robot.c.setDepth(47);
      robot.express('focus');
      await this.fx.wait(700);
      if (!out.ok) {
        if (g) {
          this.scene.tweens.killTweensOf(g);
          await new Promise<void>((r) => this.scene.tweens.add({ targets: g, x: this.statue!.x + 90, duration: 600, onComplete: () => r() }));
          this.exclaim(g.x, F - 240);
        }
        this.feedback(robot, out, damage, shield, robot.x);
        await this.fx.wait(600);
      } else this.feedback(robot, out, damage, shield, robot.x);
      robot.c.setDepth(50);
      await robot.moveTo(this.X(1060), F, 1000, 'run');
      return;
    }
    if (id === 'shadow') {
      await robot.moveTo(this.X(385), F, 700, 'sneak');
      await robot.fade(0.55, 300);
      robot.express('focus');
      await this.fx.wait(900);
      await robot.fade(1, 200);
      if (!out.ok) {
        if (g) this.exclaim(g.x, F - 240);
        this.feedback(robot, out, damage, shield, robot.x);
        await this.fx.wait(500);
      } else {
        if (g) this.scene.tweens.add({ targets: g, x: g.x + 400, alpha: 0, duration: 900 });
        this.feedback(robot, out, damage, shield, robot.x);
      }
      await robot.moveTo(this.X(1060), F, 1100, 'run');
      return;
    }
    if (id === 'coin') {
      robot.face(1);
      await robot.armWork(300);
      const coin = this.add(this.scene.add.image(robot.x, robot.y - 120, 'coin').setDepth(70));
      this.fx.sfx('coin');
      await new Promise<void>((r) =>
        this.scene.tweens.add({ targets: coin, x: this.X(1220), y: F - 10, duration: 700, ease: 'Quad.Out', onComplete: () => r() }),
      );
      if (out.ok && g) {
        this.scene.tweens.killTweensOf(g);
        g.setScale(Math.abs(g.scaleX), g.scaleY);
        this.scene.tweens.add({ targets: g, x: this.X(1350), duration: 1300 });
      } else if (g) this.exclaim(g.x, F - 240);
      this.feedback(robot, out, damage, shield, robot.x);
      await robot.moveTo(this.X(1000), F, 1500, out.ok ? 'tiptoe' : 'run');
      return;
    }
    // tiptoe behind the guard
    const p = robot.moveTo(this.X(1060), F, 2300, 'tiptoe');
    await this.fx.wait(1000);
    if (!out.ok && g) {
      this.scene.tweens.killTweensOf(g);
      g.setScale(-Math.abs(g.scaleX), g.scaleY);
      this.exclaim(g.x, F - 240);
    }
    this.feedback(robot, out, damage, shield, robot.x);
    await p;
  }

  private async actDoor(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    if (id === 'vent') {
      await robot.moveTo(this.X(640), F, 1000);
      await robot.climb(270, 500);
      await robot.fade(0, 200);
      for (let i = 0; i < 3; i++) {
        this.fx.sfx('clang');
        this.fx.shake(120, 0.004);
        await this.fx.wait(330);
      }
      this.feedback(robot, out, damage, shield, this.X(800));
      robot.c.setPosition(this.X(1060), 270);
      await robot.fade(1, 150);
      await robot.climb(F, 450);
      return;
    }
    await robot.moveTo(this.X(id === 'swipe' ? 870 : 880), F, 1300);
    robot.face(1);
    await robot.armWork(id === 'pick' ? 1000 : 500);
    if (out.ok) {
      this.fx.sfx(id === 'swipe' ? 'beep' : 'unlock');
      if (this.door) this.scene.tweens.add({ targets: this.door, y: F - 300, duration: 700, ease: 'Quad.In' });
      await this.fx.wait(500);
      this.feedback(robot, out, damage, shield, robot.x);
    } else {
      this.feedback(robot, out, damage, shield, robot.x);
      await this.fx.wait(700);
      if (this.door) this.scene.tweens.add({ targets: this.door, y: F - 300, duration: 900, delay: 300 });
      await this.fx.wait(900);
    }
    await robot.moveTo(this.X(1080), F, 600);
  }

  private async actCat(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    if (id === 'yarn') {
      robot.face(1);
      await robot.armWork(300);
      const y = this.add(this.scene.add.image(robot.x, robot.y - 110, 'yarn').setDepth(70));
      await new Promise<void>((r) => this.scene.tweens.add({ targets: y, x: this.X(420), y: F - 14, angle: 540, duration: 700, ease: 'Quad.Out', onComplete: () => r() }));
      if (this.cat) {
        if (out.ok) this.scene.tweens.add({ targets: [this.cat, y], x: '-=600', duration: 1800, ease: 'Sine.In' });
        else this.cat.setTexture('cat-awake');
      }
      this.feedback(robot, out, damage, shield, robot.x);
      await robot.moveTo(this.X(1060), F, 1600, 'tiptoe');
      return;
    }
    if (id === 'shelves') {
      await robot.moveTo(this.X(520), F, 800);
      await robot.climb(F - 200, 600);
      await robot.moveTo(this.X(720), F - 200, 700, 'tiptoe');
      await robot.climb(F, 300);
      await robot.tumble();
      this.feedback(robot, out, damage, shield, robot.x);
      await robot.moveTo(this.X(1060), F, 900);
      return;
    }
    const p = robot.moveTo(this.X(1060), F, 2400, 'tiptoe');
    await this.fx.wait(1100);
    if (!out.ok && this.cat) {
      this.cat.setTexture('cat-awake');
      this.scene.tweens.add({ targets: this.cat, x: robot.x, y: F - 60, duration: 300, yoyo: true, ease: 'Quad.Out' });
    }
    this.feedback(robot, out, damage, shield, robot.x);
    await p;
  }

  private async actCase(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    await robot.moveTo(this.X(600), F, 1100, 'tiptoe');
    robot.face(1);
    robot.express('focus');
    if (id === 'mirror') {
      const m = this.add(this.scene.add.image(this.X(640), F - 170, 'mirror').setDepth(60).setScale(0));
      this.scene.tweens.add({ targets: m, scale: 1, duration: 300, ease: 'Back.Out' });
      await robot.armWork(700);
    } else if (id === 'wait') {
      await this.fx.wait(1100);
      if (this.sensor) this.sensor.setAlpha(0.15);
    } else if (id === 'cool') {
      this.fx.burst(this.X(660), F - 150, ['px-white', 'px-mint'], 30, 160);
      this.fx.sfx('fan');
      await robot.armWork(900);
    } else {
      await robot.armWork(900);
      if (out.ok || out.anim === 'alarm') this.fx.sfx('swap');
    }
    if (!out.ok) {
      this.feedback(robot, out, damage, shield, robot.x);
      await this.fx.wait(600);
    }
    // lift the exhibit into the robot's arms
    if (this.exhibitImg) {
      this.scene.tweens.killTweensOf(this.exhibitImg);
      await new Promise<void>((r) =>
        this.scene.tweens.add({ targets: this.exhibitImg, x: robot.x, y: robot.y - 220, scale: 0.65, duration: 600, ease: 'Sine.InOut', onComplete: () => r() }),
      );
      this.exhibitImg.setVisible(false);
    }
    robot.carry(this.exhibitKey);
    this.fx.sfx('steal');
    this.fx.voice('steal');
    if (out.ok) this.feedback(robot, out, damage, shield, robot.x);
    await robot.hop(1);
    await robot.moveTo(this.X(1060), F, 900, 'run');
  }

  private async actChase(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    const x = this.X(routeX(id));
    await robot.moveTo(x - (id === 'stairs' ? 80 : 0), F, 1300, 'run');
    if (!out.ok) {
      const g = this.blockers.find((o) => o instanceof Phaser.GameObjects.Container) as Phaser.GameObjects.Container | undefined;
      if (g) {
        this.scene.tweens.add({ targets: g, x: robot.x + 60, y: F + 4, duration: 400 });
        this.exclaim(robot.x + 60, F - 230);
      }
      this.feedback(robot, out, damage, shield, robot.x);
      await this.fx.wait(800);
      await robot.moveTo(this.X(routeX(id)) + 100, F, 500, 'run');
    } else this.feedback(robot, out, damage, shield, robot.x);
    if (id === 'stairs') await robot.moveTo(x + 60, F - 240, 900, 'run');
    else if (id === 'window') await robot.jumpTo(x, F - 220, 600, 80);
    else if (id === 'chute') await robot.jumpTo(x, F - 130, 500, 70);
    else {
      await robot.moveTo(x, F, 300);
      this.fx.sfx('ding');
    }
    await robot.fade(0, 400);
  }

  private async actSearch(robot: Robot, id: string, out: Outcome, damage: number, shield: boolean): Promise<void> {
    if (id === 'duck') {
      await robot.moveTo(this.X(560), F, 1000, 'run');
      await robot.squashTo(1.1, 0.7, 200);
      robot.express('focus');
      await this.fx.wait(900);
      if (!out.ok) {
        for (const c of this.searchCones) this.scene.tweens.killTweensOf(c);
        this.searchCones[0]?.setX(robot.x);
        this.fx.flash(0xfff0be, 200, 0.5);
      }
      this.feedback(robot, out, damage, shield, robot.x);
      await robot.squashTo(1, 1, 150);
      await robot.moveTo(this.X(1060), F, 1100, 'run');
      return;
    }
    if (id === 'pipe') {
      await robot.moveTo(this.X(1170), F, 1700, 'run');
      if (!out.ok) {
        for (const c of this.searchCones) this.scene.tweens.killTweensOf(c);
        this.searchCones[0]?.setX(robot.x);
        this.fx.flash(0xfff0be, 200, 0.5);
      }
      this.feedback(robot, out, damage, shield, robot.x);
      await robot.climb(F + 160, 700);
      await robot.fade(0, 200);
      return;
    }
    const p = robot.moveTo(this.X(1100), F, 1700, 'run');
    await this.fx.wait(800);
    if (!out.ok) {
      for (const c of this.searchCones) this.scene.tweens.killTweensOf(c);
      this.searchCones[0]?.setX(robot.x);
      this.fx.flash(0xfff0be, 200, 0.5);
    }
    this.feedback(robot, out, damage, shield, robot.x);
    await p;
  }

  destroy(): void {
    for (const o of this.objs) {
      this.scene.tweens.killTweensOf(o);
      o.destroy();
    }
    for (const o of this.blockers) o.destroy();
    this.objs = [];
    for (const k of this.texKeys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }
}
