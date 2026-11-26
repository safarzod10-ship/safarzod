// Level objects: Room, Door, Glass, Pickup, ExitZone, Hint, Laser, LaserSwitch, Bullet, Thrown, NeonFlicker (+ sign mounts),
// Parallax, SteamVent, RoomFX, EnemyPointers, ObjectivePointers.
import { Component, Time, Mathf, Random, newNode, Runtime } from "../engine/core.js";
import { registerScript, SpriteRenderer, Camera } from "../engine/scene.js";
import { raycast, raycastAll, overlapBox, mask, Collider2D, Physics } from "../engine/physics.js";
import { G, GA, FX, Sfx, CombatAudio, CombatSound, CombatRole, TimeFX, CameraRig, GameClock, Haptics, col, norm } from "./common.js";
import { DaggerBreakProgress, DaggerReloadProgress } from "./progress.js";
import { PlayerController, hittableOf } from "./player.js";
import { SpriteSurfaces } from "./surfaces.js";
import { InputPrompts } from "./prompts.js";

const GROUND = mask("Ground", "OneWay");
const SOLID = mask("Ground");

function reg(cls, name) { cls.typeName = name; registerScript(cls); }

// ---------------------------------------------------------------- Room
export class Room extends Component {
  init(d) {
    this.index = d.index; this.displayName = d.displayName; this.timeLimit = d.timeLimit; this.bounds = d.bounds; this.spawn = d.spawn; this.backdrop = d.backdrop;
    this.ambient = d.ambient; this.ambientIntensity = d.ambientIntensity; this.isBossRoom = !!d.isBossRoom; this.waveObjects = d.waveObjects || []; this.waveIds = d.waveIds || [];
  }
}
reg(Room, "HypoFangs.Room");

// ---------------------------------------------------------------- Door
export class Door extends Component {
  constructor() { super(); this.isHittable = true; this.openT = 0; this.openDir = 1; this.Open = false; }
  init(d) { this.sr = d.sr; this.col = d.col; this.height = d.height ?? 3; }
  awake() {
    this.DaggerProgress = this.node.getComponent(DaggerBreakProgress);
    if (!this.DaggerProgress) { this.DaggerProgress = new DaggerBreakProgress(); this.node.addComponent(this.DaggerProgress); }
  }
  start() { if (this.sr) { this.basePos = { x: this.sr.node.lx, y: this.sr.node.ly }; this.baseScale = { x: this.sr.node.lsx, y: this.sr.node.lsy }; } }
  onHit() { this.DaggerProgress.resetChain(); return false; }
  kick(dir) {
    if (this.Open || !this.DaggerProgress || !this.DaggerProgress.ReadyToBreak) return;
    this.Open = true; this.openDir = dir;
    if (this.col) Runtime.setEnabled(this.col, false);
    Sfx.play(GA.sfxDoor); Sfx.play(GA.sfxHit, 0.5);
    CameraRig.shake(0.25, 0.2); TimeFX.hitStop(0.05);
    const p = this.node.position;
    FX.shards(p.x, p.y + this.height * 0.5, { x: dir, y: 0.2 }, 10, col(0.25, 0.2, 0.35), 10, 0.1);
    FX.anim(GA.puff, p.x + dir * 0.6, p.y + 0.6, 18, 12, 1, 0, dir < 0);
  }
  update() {
    if (!this.Open || this.openT >= 1) return;
    this.openT = Math.min(1, this.openT + Time.deltaTime * 9);
    const t = 1 - Math.pow(1 - this.openT, 3);
    const n = this.sr.node;
    n.lsx = this.baseScale.x * Mathf.lerp(1, 3.2, t) * this.openDir; n.lsy = this.baseScale.y;
    n.lx = this.basePos.x + this.openDir * Mathf.lerp(0, 0.55, t); n.ly = this.basePos.y;
    const c = 1 - t;
    this.sr.color = { r: 1 * c + 0.55 * t, g: 1 * c + 0.5 * t, b: 1 * c + 0.65 * t, a: 1 };
  }
}
reg(Door, "HypoFangs.Door");

// ---------------------------------------------------------------- Glass
export class Glass extends Component {
  constructor() { super(); this.isHittable = true; this.broken = false; }
  init(d) { this.sr = d.sr; this.col = d.col; this.height = d.height ?? 3; }
  get Broken() { return this.broken; }
  awake() {
    this.DaggerProgress = this.node.getComponent(DaggerBreakProgress);
    if (!this.DaggerProgress) { this.DaggerProgress = new DaggerBreakProgress(); this.node.addComponent(this.DaggerProgress); }
  }
  onHit() { this.DaggerProgress.resetChain(); return false; }
  shatter(dir) {
    if (this.broken || !this.DaggerProgress || !this.DaggerProgress.ReadyToBreak) return;
    this.broken = true;
    if (this.col) Runtime.setEnabled(this.col, false);
    if (this.sr) this.sr.enabled = false;
    Sfx.play(GA.sfxGlass);
    CameraRig.shake(0.2, 0.15); TimeFX.hitStop(0.04);
    const p = this.node.position;
    for (let i = 0; i < 3; i++) FX.shards(p.x, p.y + this.height * (i + 0.5) / 3, dir, 7, col(0.65, 0.9, 1, 0.9), 11, 0.1);
  }
}
reg(Glass, "HypoFangs.Glass");

// ---------------------------------------------------------------- Pickup
export const Pickups = [];
export class Pickup extends Component {
  constructor() { super(); this.item = "kunai"; this.grantsReloadBonus = true; this.t = 0; this.falling = false; this.vy = 0; this.reloadBonusId = null; }
  init(d) { this.item = d.item; this.grantsReloadBonus = !!d.grantsReloadBonus; this.sr = d.sr; this.glow = d.glow; }
  get ReloadBonusId() {
    if (this.reloadBonusId) return this.reloadBonusId;
    const room = this.node.getComponentInParent(Room);
    const p = this.node.position, rp = room ? room.node.position : { x: 0, y: 0 };
    const scene = G.sceneName === "level2" ? "Assets/Scenes/CharacterStage.unity" : "Assets/Scenes/NeonDistrict.unity";
    return (this.reloadBonusId = scene + ":" + (room ? room.index : "story") + ":" + this.item + ":" + Mathf.roundToInt((p.x - rp.x) * 100) + ":" + Mathf.roundToInt((p.y - rp.y) * 100));
  }
  claimReloadBonus() {
    if (this.grantsReloadBonus && (this.item === "kunai" || this.item === "knife" || this.item === "dagger")) return DaggerReloadProgress.collect(this.ReloadBonusId);
    return false;
  }
  onEnable() { Pickups.push(this); }
  onDisable() { const i = Pickups.indexOf(this); if (i >= 0) Pickups.splice(i, 1); }
  start() {
    void this.ReloadBonusId;
    const p = this.node.position;
    this.falling = !raycast(p.x, p.y, 0, -1, 0.3, GROUND, { noTriggers: true });
  }
  update() {
    const dt = Time.deltaTime;
    if (this.falling) {
      this.vy -= 30 * dt;
      const d = this.vy * dt, p = this.node.position;
      const h = raycast(p.x, p.y, 0, -1, -d + 0.25, GROUND, { noTriggers: true });
      if (h && this.vy < 0) { this.node.setPosition(p.x, h.point.y + 0.2); this.falling = false; }
      else this.node.setPosition(p.x, p.y + d);
    } else {
      this.t += dt;
      if (this.sr) { this.sr.node.lx = 0; this.sr.node.ly = Math.sin(this.t * 4) * 0.06; }
      if (this.glow) this.glow.color = { r: 1, g: 1, b: 1, a: 0.25 + 0.1 * Math.sin(this.t * 6) };
    }
  }
}
reg(Pickup, "HypoFangs.Pickup");
PlayerController.Pickups = () => Pickups.slice();

export function spawnPickup(item, at) {
  const room = G.level && G.level.room;
  const n = newNode("Pickup_" + item, room ? room.node : null);
  n.setPosition(at.x, at.y);
  const p = new Pickup();
  p.item = item; p.grantsReloadBonus = false;
  p.glow = FX.makeSprite("glow", GA.glow, at.x, at.y, 7, true, n);
  p.glow.node.lsx = p.glow.node.lsy = 0.6;
  p.sr = FX.makeSprite("icon", GA.kunai, at.x, at.y, 8, true, n);
  p.sr.node.lrot = 35; p.sr.node.lsx = p.sr.node.lsy = 1.3;
  n.addComponent(p);
  return p;
}

// ---------------------------------------------------------------- ExitZone
export class ExitZone extends Component {
  constructor() { super(); this.t = 0; }
  init(d) { this.arrow = d.arrow; this.visuals = d.visuals; }
  update() {
    this.t += GameClock.UnscaledDt;
    const clear = !G.level || G.level.RoomClear;
    if (this.visuals && this.visuals.activeSelf !== clear) this.visuals.setActive(clear);
    if (this.arrow) { this.arrow.lx = Math.sin(this.t * 6) * 0.15; this.arrow.ly = 2.4; }
  }
  onTriggerStay(other) {
    const p = other.node.getComponentInParent(PlayerController);
    if (p && !p.Dead && G.level) G.level.exitReached();
  }
}
reg(ExitZone, "HypoFangs.ExitZone");

// ---------------------------------------------------------------- Hint
export const Hints = [];
export class Hint extends Component {
  constructor() { super(); this.t = 0; this.original = null; this.signature = null; }
  init(d) { this.text = d.text; }
  onEnable() { Hints.push(this); }
  onDisable() { const i = Hints.indexOf(this); if (i >= 0) Hints.splice(i, 1); }
  update() {
    this.t += GameClock.UnscaledDt;
    if (this.text) {
      if (this.original === null) this.original = this.text.text;
      if (this.signature !== InputPrompts.signature) { this.signature = InputPrompts.signature; this.text.text = InputPrompts.worldHint(this.original); }
      this.text.color = { r: 1, g: 1, b: 1, a: 0.7 + 0.2 * Math.sin(this.t * 3) };
    }
  }
}
reg(Hint, "HypoFangs.Hint");

// ---------------------------------------------------------------- Laser
export const Lasers = [];
const HOT = col(1, 0.15, 0.3, 1), WARN = col(1, 0.3, 0.45, 0.35);
export class Laser extends Component {
  constructor() { super(); this.active = false; this.clock = 0; this.Disabled = false; }
  init(d) {
    Object.assign(this, { mode: d.mode, length: d.length, onTime: d.onTime, offTime: d.offTime, phase: d.phase, group: d.group, sweep: !!d.sweep, sweepX0: d.sweepX0, sweepX1: d.sweepX1, sweepSpeed: d.sweepSpeed });
    this.beam = d.beam; this.beamGlow = d.beamGlow; this.emitter = d.emitter; this.glowLight = d.glowLight;
  }
  onEnable() { Lasers.push(this); }
  onDisable() { const i = Lasers.indexOf(this); if (i >= 0) Lasers.splice(i, 1); }
  covers(x, r, y0, y1) {
    if (this.Disabled) return false;
    const p = this.node.position;
    const top = p.y, bot = top - this.length;
    if (y1 < bot || y0 > top) return false;
    const a = this.sweep ? Math.min(this.sweepX0, this.sweepX1) : p.x, b = this.sweep ? Math.max(this.sweepX0, this.sweepX1) : p.x;
    return x + r > a - 0.1 && x - r < b + 0.1;
  }
  start() { this.clock = this.phase; this.layout(); }
  layout() {
    if (this.beam) { this.beam.node.lx = 0; this.beam.node.ly = -this.length * 0.5; this.beam.node.lsx = 1.2; this.beam.node.lsy = this.length / 0.125; }
    if (this.beamGlow) { this.beamGlow.node.lx = 0; this.beamGlow.node.ly = -this.length * 0.5; this.beamGlow.node.lsx = 0.225; this.beamGlow.node.lsy = this.length / 2; }
  }
  shutdown() {
    if (this.Disabled) return;
    this.Disabled = true;
    if (this.beam) this.beam.enabled = false;
    if (this.beamGlow) this.beamGlow.enabled = false;
    if (this.emitter) this.emitter.color = col(0.4, 1, 0.6);
    if (this.glowLight) this.glowLight.enabled = false;
    const p = this.node.position;
    FX.shards(p.x, p.y - 0.2, { x: 0, y: -1 }, 6, HOT, 4, 0.08);
  }
  update() {
    if (G.paused || G.frozen || (G.level && G.level.cinematicPlaying) || this.Disabled) return;
    this.clock += Time.deltaTime;
    if (this.sweep) {
      const len = Math.max(0.01, this.sweepX1 - this.sweepX0);
      const p = this.node.position;
      this.node.setPosition(this.sweepX0 + Mathf.pingPong(this.clock * this.sweepSpeed, len), p.y);
    }
    let warn = false;
    if (this.mode === 0) this.active = true;
    else {
      const per = this.onTime + this.offTime, t = Mathf.repeat(this.clock, per);
      this.active = t < this.onTime;
      warn = !this.active && t > per - 0.3;
    }
    const k = 0.85 + 0.15 * Math.sin(Time.time * 60);
    if (this.beam) {
      this.beam.enabled = this.active || warn;
      this.beam.color = this.active ? { r: HOT.r * k, g: HOT.g * k, b: HOT.b * k, a: HOT.a * k } : { ...WARN };
      this.beam.node.lsx = this.active ? 1.2 : 0.5; this.beam.node.lsy = this.length / 0.125;
    }
    if (this.beamGlow) { this.beamGlow.enabled = false; }
    if (this.emitter) this.emitter.color = this.active ? col(1, 1, 1) : col(0.6, 0.6, 0.7);
    if (this.glowLight) this.glowLight.enabled = false;
    if (!this.active) return;
    const p = this.node.position;
    const cx = p.x, cy = p.y - this.length * 0.5;
    const pc = overlapBox(cx, cy, 0.14, this.length, mask("Player"));
    if (pc) {
      const pl = pc.node.getComponentInParent(PlayerController);
      if (pl && !pl.Invulnerable && !pl.Dead) { Sfx.play(GA.sfxLaser, 0.9); pl.die({ x: -pl.Facing, y: 0.3 }, "LASERED"); }
    }
    const ec = overlapBox(cx, cy, 0.14, this.length, mask("Enemy"));
    if (ec) {
      const e = ec.node.getComponentInParent("HypoFangs.Enemy");
      if (e && !e.Dead) { Sfx.play(GA.sfxLaser, 0.8); e.damage({ x: -e.Facing, y: 0.3 }, "laser"); }
    }
  }
}
reg(Laser, "HypoFangs.Laser");

// ---------------------------------------------------------------- LaserSwitch
export class LaserSwitch extends Component {
  constructor() { super(); this.isHittable = true; this.used = false; }
  init(d) { this.group = d.group; this.sr = d.sr; }
  get Used() { return this.used; }
  onHit(dir) {
    if (this.used) return false;
    this.used = true;
    if (this.sr) this.sr.sprite = GA.switchOff;
    Sfx.play(GA.sfxBlip, 1, 0); Sfx.play(GA.sfxMetal, 0.6);
    const room = this.node.getComponentInParent(Room);
    if (room) for (const l of room.node.getComponentsInChildren(Laser, true)) if (l.group === this.group) l.shutdown();
    const p = this.node.position;
    FX.shards(p.x, p.y, dir, 8, col(0.4, 1, 0.7), 6, 0.08);
    CameraRig.shake(0.15, 0.15);
    return true;
  }
}
reg(LaserSwitch, "HypoFangs.LaserSwitch");

// ---------------------------------------------------------------- Bullet
export const Bullets = [];
const BULLET_MASK = mask("Ground", "Player", "Enemy");
export class Bullet extends Component {
  constructor() { super(); this.velocity = { x: 0, y: 0 }; this.reflected = false; this.spin = false; this.owner = null; this.life = 3; }
  static fire(from, dir, speed, owner, shuriken = false, sprite = null, spinSprite = false) {
    if (sprite) shuriken = spinSprite;
    const sr = FX.makeSprite(shuriken ? "Shuriken" : "Bullet", sprite || (shuriken ? GA.shuriken : GA.tracer), from.x, from.y, 13, true);
    const b = new Bullet();
    b.sr = sr; b.owner = owner; b.spin = shuriken;
    const d = norm(dir.x, dir.y);
    b.velocity = { x: d.x * speed, y: d.y * speed };
    if (!shuriken) sr.node.setRotation(Math.atan2(d.y, d.x) * Mathf.DEG);
    b.glow = FX.makeSprite("glow", GA.glow, from.x, from.y, 12, true, sr.node);
    b.glow.node.lsx = b.glow.node.lsy = shuriken ? 0.35 : 0.3;
    b.glow.color = shuriken ? col(0.75, 0.5, 1, 0.5) : col(1, 0.75, 0.3, 0.55);
    if (owner && owner.art && owner.art.id === "jotem") b.glow.color = col(0.75, 1, 0.2, 0.5);
    sr.node.addComponent(b);
    return b;
  }
  onEnable() { Bullets.push(this); }
  onDisable() { const i = Bullets.indexOf(this); if (i >= 0) Bullets.splice(i, 1); }
  reflect(aim) {
    const p = G.level ? G.level.player : null;
    if (this.reflected || !p || !p.KatanaDeflectActive) return;
    this.reflected = true;
    const sp = Math.max(Math.hypot(this.velocity.x, this.velocity.y) * 1.35, 26);
    const a = norm(aim.x, aim.y);
    this.velocity = { x: a.x * sp, y: a.y * sp };
    this.life = 2;
    this.sr.color = col(0.55, 1, 1);
    if (this.glow) this.glow.color = col(0.3, 0.95, 1, 0.6);
    if (!this.spin) this.node.setRotation(Math.atan2(a.y, a.x) * Mathf.DEG);
    const pos = this.node.position;
    FX.anim(GA.spark, pos.x, pos.y, 30, 14, 1, Random.range(0, 360));
    CombatAudio.play(CombatSound.MetalClash, CombatRole.Zenji);
    TimeFX.hitStop(0.07); CameraRig.shake(0.12, 0.1);
  }
  impactSound() { return this.owner && this.owner.art && this.owner.art.id === "jotem" ? CombatSound.BladeImpact : this.spin ? CombatSound.DaggerImpact : CombatSound.BodyImpact; }
  update() {
    if (G.paused || G.frozen || (G.level && G.level.cinematicPlaying)) return;
    const dt = Time.deltaTime;
    this.life -= dt;
    if (this.life <= 0) { this.node.destroy(); return; }
    if (this.spin) this.node.lrot += -1080 * dt;
    else if (this.velocity.x ** 2 + this.velocity.y ** 2 > 0.001) this.node.setRotation(Math.atan2(this.velocity.y, this.velocity.x) * Mathf.DEG);
    const pl = G.level ? G.level.player : null;
    const pos = this.node.position;
    if (!this.reflected && pl && pl.KatanaDeflectActive) {
      const sc = pl.SlashCenter;
      if (Math.hypot(sc.x - pos.x, sc.y - pos.y) < pl.SlashRadius) { this.reflect(pl.SlashDir); return; }
    }
    const vx = this.velocity.x * dt, vy = this.velocity.y * dt, len = Math.hypot(vx, vy);
    const hits = len > 0 ? raycastAll(pos.x, pos.y, vx, vy, len, BULLET_MASK) : [];
    for (const h of hits) {
      const pc = h.collider.node.getComponentInParent(PlayerController);
      if (pc) {
        if (!this.reflected && !pc.Dead && !pc.Invulnerable) {
          CombatAudio.play(this.impactSound(), CombatAudio.role(this.owner));
          const id = this.owner && this.owner.art ? this.owner.art.id : "";
          pc.die(norm(this.velocity.x, this.velocity.y), id === "ronin" || id === "jotem" ? "SWORD WAVE" : this.spin ? "SHURIKEN" : "SHOT");
          this.node.destroy();
          return;
        }
        continue;
      }
      const e = h.collider.node.getComponentInParent("HypoFangs.Enemy");
      if (e) {
        if (this.reflected && !e.Dead) {
          if (e.blocksFrom({ x: -this.velocity.x, y: -this.velocity.y })) { this.ricochet(h.point, h.normal); return; }
          if (e.damage(norm(this.velocity.x, this.velocity.y), "deflect")) {
            CombatAudio.play(this.impactSound(), CombatRole.Zenji);
            this.node.destroy();
            return;
          }
        }
        continue;
      }
      const g = h.collider.node.getComponentInParent(Glass);
      if (g) {
        g.shatter(norm(this.velocity.x, this.velocity.y));
        if (!g.Broken) { this.ricochet(h.point, h.normal); return; }
      } else if (!h.collider.isTrigger) { this.ricochet(h.point, h.normal); return; }
    }
    this.node.setPosition(pos.x + vx, pos.y + vy);
  }
  ricochet(at, n) {
    FX.shards(at.x, at.y, n, 4, col(1, 0.85, 0.4), 5, 0.05);
    FX.anim(GA.spark, at.x, at.y, 32, 14, 0.6, Random.range(0, 360));
    CombatAudio.play(CombatSound.MetalClash, !this.reflected ? CombatAudio.role(this.owner) : CombatRole.Zenji, 0.3);
    this.node.destroy();
  }
}

// ---------------------------------------------------------------- Thrown (kunai / thrown item)
export const ThrownList = [];
const THROWN_MASK = ~mask("Player", "OneWay", "IgnoreRaycast");
export class Thrown extends Component {
  constructor() { super(); this.velocity = { x: 0, y: 0 }; this.item = "kunai"; this.dropOnEnd = true; this.life = 2.5; }
  onEnable() { ThrownList.push(this); }
  onDisable() { const i = ThrownList.indexOf(this); if (i >= 0) ThrownList.splice(i, 1); }
  update() {
    if (G.tutorialActive || G.paused) return;
    const dt = Time.deltaTime;
    this.life -= dt;
    const vx = this.velocity.x * dt, vy = this.velocity.y * dt, len = Math.hypot(vx, vy);
    const pos = this.node.position;
    const dn = norm(vx, vy);
    const hits = len > 0 ? raycastAll(pos.x, pos.y, vx, vy, len, THROWN_MASK) : [];
    for (const h of hits) {
      const hit = hittableOf(h.collider.node);
      if (h.collider.isTrigger && !hit) continue;
      if (hit && hit.constructor.typeName === "HypoFangs.Enemy" && (hit.Dead || hit.Dodging)) continue;
      if (hit) {
        const solid = !h.collider.isTrigger;
        hit.onHit(norm(this.velocity.x, this.velocity.y), true);
        CameraRig.shake(0.12, 0.1);
        Haptics.pulse(0.25, 0.5, 0.09);
        if (solid && h.collider.enabled) { this.drop({ x: h.point.x - dn.x * 0.3, y: h.point.y - dn.y * 0.3 }); return; }
        if (h.collider.node.getComponentInParent(LaserSwitch)) { this.drop({ x: h.point.x - dn.x * 0.3, y: h.point.y - dn.y * 0.3 }); return; }
      } else if (!h.collider.isTrigger) {
        Sfx.play(GA.sfxMetal, 0.7);
        FX.shards(h.point.x, h.point.y, h.normal, 5, col(1, 0.9, 0.6), 5, 0.06);
        this.drop({ x: h.point.x + h.normal.x * 0.3, y: h.point.y + h.normal.y * 0.3 });
        return;
      }
    }
    this.node.setPosition(pos.x + vx, pos.y + vy);
    if (this.life <= 0) this.drop(this.node.position);
  }
  drop(at) {
    if (!this.dropOnEnd) FX.anim(GA.spark, at.x, at.y, 30, 14, 0.5, Random.range(0, 360));
    else spawnPickup(this.item, at);
    this.node.destroy();
  }
}
PlayerController.ThrownClass = Thrown;

// ---------------------------------------------------------------- NeonFlicker and sign mounting hardware
export class NeonFlicker extends Component {
  constructor() { super(); this.t = 0; this.offUntil = 0; this.seed = 0; }
  init(d) { this.sign = d.sign; this.glow = d.glow; this.color = d.color || col(1, 0, 1); }
  start() { this.seed = Random.value() * 10; SignMounts.ensure(this); }
  update() {
    this.t += Time.deltaTime;
    if (this.t > this.offUntil && Random.value() < 0.004) this.offUntil = this.t + Random.range(0.05, 0.25);
    const on = this.t > this.offUntil;
    const k = 0.85 + 0.15 * Math.sin((this.t + this.seed) * 3);
    const c = this.color;
    if (this.sign) this.sign.color = on ? { r: c.r * k + 0.3, g: c.g * k + 0.3, b: c.b * k + 0.3, a: c.a * k } : { r: c.r * 0.25, g: c.g * 0.25, b: c.b * 0.25, a: c.a * 0.25 };
    if (this.glow) this.glow.color = { r: c.r, g: c.g, b: c.b, a: on ? 0.35 * k : 0.05 };
  }
}
reg(NeonFlicker, "HypoFangs.NeonFlicker");

export const SignMounts = {
  ensure(neon) {
    if (!neon || !neon.sign || !neon.sign.sprite || !GA.white) return false;
    if (neon.glow && neon.glow !== neon.sign) neon.glow.sortingOrder = Math.min(neon.glow.sortingOrder, neon.sign.sortingOrder - 4);
    if (neon.sign.node.find("Sign mounting hardware")) return false;
    const sign = neon.sign;
    const b = SpriteSurfaces.bounds(sign);
    const hw = newNode("Sign mounting hardware", sign.node);
    hw.setPosition(b.cx, b.cy);
    const order = sign.sortingOrder - 2;
    const metal = col(0.23, 0.25, 0.32, 1);
    const size = (sr, w, h) => {
      const ls = sr.node.parent.lossyScale, s = sr.sprite;
      sr.node.lsx = w / Math.max(0.001, s.boundsW * Math.abs(ls.x));
      sr.node.lsy = h / Math.max(0.001, s.boundsH * Math.abs(ls.y));
    };
    const back = FX.makeSprite("Backboard", GA.white, b.cx, b.cy, order, true, hw);
    back.color = col(0.055, 0.065, 0.09, 0.95);
    size(back, b.sx + 0.22, b.sy + 0.22);
    const bar = (from, to, w) => {
      const s = FX.makeSprite("bar", GA.white, (from.x + to.x) / 2, (from.y + to.y) / 2, order - 1, true, hw);
      s.color = { ...metal };
      s.node.setRotation(Math.atan2(to.y - from.y, to.x - from.x) * Mathf.DEG);
      size(s, Math.hypot(to.x - from.x, to.y - from.y), w);
    };
    const c = { x: b.cx, y: b.cy };
    const l = raycast(c.x, c.y, -1, 0, 4, SOLID, { noTriggers: true }), r = raycast(c.x, c.y, 1, 0, 4, SOLID, { noTriggers: true });
    const h = l && l.distance > 0.1 && (!r || l.distance < r.distance) ? l : r;
    if (h && h.distance > 0.1 && Math.abs(h.normal.x) > 0.5) {
      bar(c, h.point, 0.09);
      bar({ x: c.x, y: c.y - (b.sy / 2) * 0.6 }, { x: h.point.x, y: h.point.y - 0.35 }, 0.07);
    } else {
      const up = raycast(c.x, b.maxY + 0.15, 0, 1, 14, SOLID, { noTriggers: true });
      for (let i = -1; i <= 1; i += 2) {
        const x = c.x + i * Math.max(0.1, (b.sx / 2) * 0.65);
        if (up) bar({ x, y: b.maxY }, { x, y: up.point.y }, 0.055);
        else {
          const f = SpriteSurfaces.floor(x, b.minY + 0.08, 20);
          if (f) bar({ x, y: b.minY }, { x, y: f.point.y }, 0.09);
        }
      }
    }
    return true;
  },
};

// ---------------------------------------------------------------- Parallax
export class Parallax extends Component {
  init(d) { this.factor = d.factor ?? 0.5; this.yOffset = d.yOffset || 0; }
  lateUpdate() {
    const cam = Camera.main;
    if (!cam) return;
    const p = cam.node.position;
    this.node.setPosition(p.x * this.factor, p.y + this.yOffset);
  }
}
Parallax.order = 200;
reg(Parallax, "HypoFangs.Parallax");

// ---------------------------------------------------------------- SteamVent
export class SteamVent extends Component {
  constructor() { super(); this.t = 0; this.puffs = []; }
  init(d) { this.interval = d.interval ?? 0.28; this.tint = d.tint || col(0.85, 0.85, 1, 0.42); }
  update() {
    if (!GA.puff || !GA.puff.length) return;
    const dt = Time.deltaTime;
    this.t -= dt;
    const p = this.node.position;
    if (this.t <= 0) {
      this.t = this.interval * Random.range(0.7, 1.3);
      const sr = FX.makeSprite("steam", GA.puff[0], p.x, p.y, -1, true, this.node);
      this.puffs.push({ sr, age: 0, life: Random.range(1.1, 1.6), drift: Random.range(-0.3, 0.5) });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { f.sr.node.destroy(); this.puffs.splice(i, 1); continue; }
      f.sr.sprite = GA.puff[Math.min(GA.puff.length - 1, Math.floor(k * GA.puff.length))];
      f.sr.node.setPosition(p.x + f.drift * k, p.y + 0.2 + k * 1.6);
      f.sr.node.lsx = f.sr.node.lsy = 0.35 + k * 0.7;
      f.sr.color = { r: this.tint.r, g: this.tint.g, b: this.tint.b, a: this.tint.a * Math.sin(k * Math.PI) };
    }
  }
}
reg(SteamVent, "HypoFangs.SteamVent");

// ---------------------------------------------------------------- RoomFX (rain, fog, dust)
export class RoomFX extends Component {
  constructor() { super(); this.drops = []; this.fogBanks = []; this.motes = []; this.moteVel = []; this.splashPool = []; }
  init(d) { this.rain = !!d.rain; this.fog = !!d.fog; this.dust = !!d.dust; this.rainColor = d.rainColor || col(0.65, 0.8, 1, 0.32); this.fogColor = d.fogColor || col(0.55, 0.3, 0.85, 0.1); }
  start() {
    this.cam = Camera.main;
    if (this.rain) this.dust = false;
    this.root = newNode("RoomFX", this.node);
    if (!GA.white || !this.cam) return;
    if (this.rain) for (let j = 0; j < 220; j++) {
      const front = j % 3 !== 0;
      const sr = FX.makeSprite("rain", GA.white, 0, 0, front ? 16 : -60, true, this.root);
      const rc = this.rainColor;
      sr.color = front ? { ...rc } : { r: rc.r, g: rc.g, b: rc.b, a: rc.a * 0.55 };
      const len = front ? Random.range(0.45, 0.75) : Random.range(0.25, 0.4);
      sr.node.lsx = front ? 0.28 : 0.2; sr.node.lsy = len / 0.125;
      sr.node.lrot = Math.atan(-0.18) * Mathf.DEG;
      const d = { sr, speed: front ? Random.range(22, 28) : Random.range(14, 18), front };
      this.respawn(d, true);
      this.drops.push(d);
    }
    if (this.fog) for (let k = 0; k < 4; k++) {
      const sr = FX.makeSprite("fog", GA.glow, 0, 0, k % 2 === 0 ? 14 : -40, true, this.root);
      sr.color = { ...this.fogColor };
      sr.node.lsx = Random.range(7, 11); sr.node.lsy = Random.range(1.6, 2.4);
      this.fogBanks.push(sr.node);
    }
    if (this.dust) for (let l = 0; l < 45; l++) {
      const p = this.randomInView(0);
      const sr = FX.makeSprite("dust", GA.white, p.x, p.y, 13, true, this.root);
      sr.color = col(1, 0.9, 0.8, Random.range(0.12, 0.3));
      sr.node.lsx = sr.node.lsy = Random.range(0.35, 0.6);
      this.motes.push(sr.node);
      this.moteVel.push({ x: Random.range(-0.25, 0.25), y: Random.range(-0.1, 0.2) });
    }
  }
  randomInView(m) {
    const h = this.cam.orthographicSize, w = h * this.cam.aspect, p = this.cam.node.position;
    return { x: p.x + Random.range(-w - m, w + m), y: p.y + Random.range(-h, h) };
  }
  respawn(d, anywhere) {
    const h = this.cam.orthographicSize, w = h * this.cam.aspect, p = this.cam.node.position;
    const y = anywhere ? Random.range(-h, h + 1) : h + Random.range(0.5, 3);
    d.sr.node.setPosition(p.x + Random.range(-w - 2, w + 4), p.y + y);
  }
  update() {
    if (!this.cam) return;
    const dt = Time.deltaTime;
    const h = this.cam.orthographicSize, w = h * this.cam.aspect, c = this.cam.node.position;
    for (const d of this.drops) {
      const step = d.speed * dt;
      const p = d.sr.node.position;
      if (d.front && step > 0) {
        const hit = raycast(p.x, p.y, -0.18, -1, step + 0.3, GROUND, { noTriggers: true });
        if (hit) { this.splash(hit.point); this.respawn(d, false); continue; }
      }
      const nx = p.x - 0.18 * step, ny = p.y - step;
      if (ny < c.y - h - 1 || nx < c.x - w - 3 || nx > c.x + w + 5) this.respawn(d, false);
      else d.sr.node.setPosition(nx, ny);
    }
    for (let i = 0; i < this.fogBanks.length; i++) {
      const t = Time.time;
      const v = Math.sin(t * 0.07 + i * 1.7) * 4 + t * 0.35 * (i % 2 === 0 ? 1 : -1);
      const x = c.x + Mathf.repeat(v + i * 9, w * 2 + 12) - w - 6;
      this.fogBanks[i].setPosition(x, c.y - h * 0.55 + i * 0.6);
    }
    for (let j = 0; j < this.motes.length; j++) {
      const n = this.motes[j], p = n.position, v = this.moteVel[j];
      let x = p.x + (v.x + Math.sin(Time.time + j) * 0.1) * dt, y = p.y + v.y * dt;
      if (Math.abs(x - c.x) > w + 1 || Math.abs(y - c.y) > h + 1) { const r = this.randomInView(0); x = r.x; y = r.y; }
      n.setPosition(x, y);
    }
  }
  splash(at) {
    if (Random.value() > 0.5) return;
    let sr = this.splashPool.pop();
    if (!sr) {
      sr = FX.makeSprite("splash", GA.white, at.x, at.y, 16, true, this.root);
      const f = new SplashFade(); f.pool = this.splashPool; sr.node.addComponent(f);
    }
    sr.node.setActive(true);
    sr.node.setPosition(at.x, at.y + 0.03);
    sr.node.getComponent(SplashFade).begin(this.rainColor);
  }
}
reg(RoomFX, "HypoFangs.RoomFX");

class SplashFade extends Component {
  begin(c) { this.sr = this.node.getComponent(SpriteRenderer); this.c = { r: c.r, g: c.g, b: c.b, a: 0.6 }; this.t = 0; this.node.lsx = 0.9; this.node.lsy = 0.25; }
  update() {
    this.t += Time.deltaTime;
    const k = this.t / 0.18;
    if (k >= 1) { this.node.setActive(false); if (this.pool) this.pool.push(this.sr); }
    else { this.node.lsx = 0.9 + k * 1.6; this.node.lsy = 0.25; this.sr.color = { r: this.c.r, g: this.c.g, b: this.c.b, a: this.c.a * (1 - k) }; }
  }
}

// ---------------------------------------------------------------- off-screen enemy pointers and yellow target arrows
const RED = col(1, 0.2, 0.32, 1);
export class EnemyPointers extends Component {
  constructor() { super(); this.pool = []; }
  awake() { this.cam = this.node.getComponent(Camera); }
  get(i) {
    while (this.pool.length <= i) { const s = FX.makeSprite("Enemy Pointer", GA.arrow, 0, 0, 40, true, this.node); s.color = { ...RED }; this.pool.push(s); }
    return this.pool[i];
  }
  lateUpdate() {
    if (!this.cam || !GA.arrow) return;
    const lm = G.level;
    let n = 0;
    if (lm && lm.player && !lm.player.Dead) {
      const h = this.cam.orthographicSize, w = h * this.cam.aspect, c = this.cam.node.position;
      const a = 0.65 + 0.35 * Math.sin(Time.unscaledTime * 7);
      for (const e of lm.enemies()) {
        if (e.Dead || !e.node.activeInHierarchy) continue;
        const p = e.node.position;
        const vx = p.x - c.x, vy = p.y + 0.6 - c.y;
        if (Math.abs(vx) < w - 0.2 && Math.abs(vy) < h - 0.2) continue;
        const k = Math.min(Math.abs(vx) > 0.001 ? (w - 0.45) / Math.abs(vx) : Infinity, Math.abs(vy) > 0.001 ? (h - 0.75) / Math.abs(vy) : Infinity);
        const s = this.get(n++);
        s.enabled = true;
        s.node.setPosition(c.x + vx * Math.min(1, k), c.y + vy * Math.min(1, k));
        s.node.setRotation(Math.atan2(vy, vx) * Mathf.DEG);
        s.node.lsx = s.node.lsy = Mathf.lerp(1.1, 0.7, Mathf.inverseLerp(6, 25, Math.hypot(vx, vy)));
        s.color = { r: RED.r, g: RED.g, b: RED.b, a };
      }
    }
    for (let j = n; j < this.pool.length; j++) this.pool[j].enabled = false;
  }
}
EnemyPointers.order = 110;
reg(EnemyPointers, "HypoFangs.EnemyPointers");

export class ObjectivePointers extends Component {
  constructor() { super(); this.arrows = []; this.targets = []; this.room = null; this.VisibleCount = 0; }
  awake() { this.cam = this.node.getComponent(Camera); }
  intact(t) {
    if (!t || !t.node.activeInHierarchy) return false;
    if (t instanceof LaserSwitch) return !t.Used;
    if (t instanceof Door) return !t.Open;
    if (t instanceof Glass) return t.col ? t.col.enabled : false;
    return false;
  }
  lateUpdate() {
    let n = 0;
    const lm = G.level;
    if (this.cam && lm && lm.player && !lm.player.Dead && !G.previewing && !G.paused && GA.arrow) {
      const room = lm.rooms[Mathf.clamp(G.roomIndex, 0, lm.rooms.length - 1)];
      if (this.room !== room) {
        this.room = room;
        this.targets = [...room.node.getComponentsInChildren(LaserSwitch, true), ...room.node.getComponentsInChildren(Door, true), ...room.node.getComponentsInChildren(Glass, true)];
      }
      const h = this.cam.orthographicSize, w = h * this.cam.aspect, c = this.cam.node.position;
      for (const t of this.targets) {
        if (!this.intact(t)) continue;
        if (lm.laserPreviewPlaying && t !== lm.laserPreview.Target) continue;
        const cl = t.node.getComponent(Collider2D);
        const b = cl ? cl.bounds : null;
        const tp = b ? { x: b.cx, y: b.cy } : t.node.position;
        const vx = tp.x - c.x, vy = tp.y - c.y;
        const inView = Math.abs(vx) < w - 0.4 && Math.abs(vy) < h - 0.7;
        while (this.arrows.length <= n) this.arrows.push(FX.makeSprite("Yellow destroy-target arrow", GA.arrow, 0, 0, 45, true, this.node));
        const s = this.arrows[n++];
        s.enabled = true;
        let px, py, z;
        if (inView) {
          px = tp.x; py = tp.y + (b ? b.ey : 0.4) + 0.45;
          py = Math.min(py, c.y + h - 0.85); z = -90;
        } else {
          const k = Math.min((w - 0.45) / Math.max(0.001, Math.abs(vx)), (h - 0.8) / Math.max(0.001, Math.abs(vy)));
          px = c.x + vx * k; py = c.y + vy * k; z = Math.atan2(vy, vx) * Mathf.DEG;
        }
        s.node.setPosition(px, py); s.node.lz = -1;
        s.node.setRotation(z);
        s.node.lsx = s.node.lsy = 0.85;
        s.color = col(1, 0.84, 0.08, 0.8 + 0.2 * Math.sin(Time.unscaledTime * 6));
      }
    }
    this.VisibleCount = n;
    for (let j = n; j < this.arrows.length; j++) this.arrows[j].enabled = false;
  }
}
ObjectivePointers.order = 112;
reg(ObjectivePointers, "HypoFangs.ObjectivePointers");
