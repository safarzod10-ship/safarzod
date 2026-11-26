// Enemy (all kinds, bosses and duelists) ported from Enemy.cs, with BossAttackMotion / BossAttackVfx.
import { Component, Time, Mathf, Random, newNode } from "../engine/core.js";
import { registerScript, SpriteRenderer, Camera } from "../engine/scene.js";
import { Rigidbody2D, raycast, overlapBox, mask, Collider2D, Physics, TilemapCollider, LAYER } from "../engine/physics.js";
import { G, GA, FX, Sfx, CombatAudio, CombatSound, CombatRole, TimeFX, CameraRig, Haptics, col, norm } from "./common.js";
import { Bullet, Lasers, ThrownList } from "./world.js";
import { CorpseGrounding, SpriteSurfaces } from "./surfaces.js";
import { QuadRenderer } from "../engine/scene.js";

export const Kind = { Gunner: 0, Burst: 1, Marksman: 2, Shield: 3, Brawler: 4, Blade: 5, Warrior: 6, Duelist: 7 };
const A = { None: 0, React: 1, Aim: 2, Fire: 3, Melee: 4, Recover: 5, Throw: 6, Roll: 7, Charge: 8, Parry: 9, Stagger: 10, Jump: 11, Guard: 12, Crouch: 13, Crawl: 14, Leap: 15, Heal: 16, Rest: 17, Taunt: 18 };
const S = { Slash: 0, Rising: 1, Thrust: 2, Spin: 3, CloseCut: 4, Heavy: 5, Lunge: 6 };
const GROUND = mask("Ground", "OneWay"), LOS = mask("Ground"), PLAYER = mask("Player");
const BOSS_NAMES = { fighter: "ISAMU", shinobi: "SHIN", samurai: "RITSU", warrior: "RUTEN", jotem: "GAKU" };
export const Enemies = [];
const has = (a) => !!(a && a.length);
const or = (a, b) => (has(a) ? a : b);

class Motion {
  constructor(name, straight, hit, slash, poses) { this.name = name; this.straight = straight; this.hitFrame = hit; this.slash = slash; this.poses = poses; this.hitEndFrame = -1; this.secondHitFrame = -1; this.secondHitEndFrame = -1; }
  contactSweep(f) { if (f >= this.hitFrame && f <= this.hitEndFrame) return 0; if (this.secondHitFrame >= 0 && f >= this.secondHitFrame && f <= this.secondHitEndFrame) return 1; return -1; }
}
const P = (frame, x, y, angle, width, height, fxFrame = 0) => ({ frame, x, y, angle, width, height, fxFrame });
const Line = (n, hit, ...poses) => new Motion(n, true, hit, 0, poses);
const Arc = (n, hit, slash, ...poses) => new Motion(n, false, hit, slash, poses);

export class Enemy extends Component {
  constructor() {
    super();
    this.isHittable = true;
    Object.assign(this, {
      kind: 0, art: null, visual: null, anim: null, alertIcon: null, body: null, slashFx: [], slashFx2: [], slashFx3: [], throwsShuriken: false, projectile: null, projectileSpin: false,
      projectileScale: 1, patrol: false, patrolMin: 0, patrolMax: 0, startFacing: 1, difficulty: 0, bossLevel: 0, maxHp: 1, bossName: "", NoParry: false,
    });
    this.facing = 1; this.hp = 1; this.alerted = false; this.grounded = false; this.act = A.None; this.actT = 0; this.cooldown = 0; this.throwCd = 0; this.rollCd = 0; this.jumpCd = 0;
    this.guardCd = 0; this.chargeCd = 0; this.turnT = 0; this.alertPop = 0; this.idleWait = 0; this.iframes = 0; this.flashT = 0; this.dashDur = 0; this.dashSpeed = 0; this.burstLeft = 0;
    this.pattern = 0; this.burstT = 0; this.meleeDone = false; this.rollEvasive = false; this.lastSeen = { x: 0, y: 0 }; this.moveX = 0; this.parryPlantT = 0;
    this.hapticGrounded = true; this.hapticAirTime = 0; this.cachedMotionClip = null; this.cachedMotion = null; this.strikeClip = null; this.strikeType = 0; this.strikeHitAt = 0;
    this.strikeDone = false; this.comboLeft = 0; this.comboTotal = 0; this.comboIdx = 0; this.strikeSweep = -1; this.leapCd = 0; this.healCd = 0; this.restCd = 0; this.guardStanceCd = 0;
    this.lungeCd = 0; this.healsLeft = -1; this.tauntDone = false; this.leapWind = false; this.restAfter = false; this.judgedKnives = new Set(); this.tauntWalkT = 0;
    this.pursuitLedges = []; this.pursuitHops = null; this.pursuitRefresh = 0; this.pursuitLandX = 0; this.pursuitAirTime = 0; this.pursuitAirborne = false; this.pursuitIgnored = null;
    this.pursuitIgnoreTime = 0; this.firePending = false; this.fanPending = false; this.firingClip = null; this.recoilSource = null; this.recoilClip = null; this.firingFrame = 0;
    this.Dead = false; this.PursuitJumps = 0; this.PursuitDrops = 0; this.attackMotionVfx = null;
  }
  init(d) {
    for (const k of ["kind", "startFacing", "difficulty", "bossLevel", "maxHp", "bossName", "projectileScale", "patrolMin", "patrolMax"]) if (d[k] !== undefined) this[k] = d[k];
    for (const k of ["throwsShuriken", "projectileSpin", "patrol", "NoParry"]) this[k] = !!d[k];
    this.art = d.art; this.visual = d.visual; this.anim = d.anim; this.alertIcon = d.alertIcon; this.body = d.body;
    this.slashFx = (d.slashFx || []).filter(Boolean); this.slashFx2 = (d.slashFx2 || []).filter(Boolean); this.slashFx3 = (d.slashFx3 || []).filter(Boolean);
    this.projectile = d.projectile || null;
    for (const k in this.art) if (Array.isArray(this.art[k])) this.art[k] = this.art[k].filter(Boolean);
  }
  get Facing() { return this.facing; }
  get IsBoss() { return this.bossLevel > 0; }
  get Telegraphing() { return this.kind === Kind.Duelist ? this.DuelTelegraphing : false; }
  get Hp() { return this.hp; }
  get MaxHp() { return Math.max(1, this.maxHp); }
  get Alerted() { return this.alerted; }
  get Winding() { return (this.act === A.Melee && !this.meleeDone) || this.act === A.Charge || (this.act === A.Throw && !this.meleeDone); }
  get WillParry() {
    if (this.kind === Kind.Blade && this.alerted && this.guardCd <= 0 && this.iframes <= 0) {
      if (this.act !== A.None && this.act !== A.React) return !this.IsBoss ? this.act === A.Recover : false;
      return true;
    }
    return false;
  }
  get Staggered() { return this.act === A.Stagger; }
  get AttackReach() { return this.Reach; }
  get Height() { return this.H; }
  get Rage() { return !this.IsBoss ? 1 : 1 + 0.55 * (1 - this.hp / this.MaxHp); }
  get Sc() { return Math.abs(this.node.lsy); }
  get H() { return this.art.height * this.Sc; }
  get SightRange() { return !this.IsBoss ? (this.kind === Kind.Marksman ? 16 : 12.5) + 2 * this.difficulty : 40; }
  get RunSpeed() {
    if (this.kind === Kind.Duelist) return this.DuelWalk;
    const k = this.kind;
    return (k === Kind.Blade ? 6.5 : k === Kind.Brawler ? 5.2 : k === Kind.Warrior ? 3.2 : k === Kind.Shield ? 1.7 : 3.8) * this.Dm(0.95, 1.12) * (this.IsBoss ? 1.1 * this.Rage : 1);
  }
  get Reach() {
    if (this.kind === Kind.Duelist) return this.DuelReach;
    const id = this.art.id;
    return (this.kind === Kind.Warrior ? 1.35 : this.kind !== Kind.Blade ? 0.95 : id === "samurai" || id === "ronin" || id === "shogun" ? 1.5 : 1.2) * Math.max(1, this.Sc * 0.85);
  }
  get Chest() { const p = this.node.position; return { x: p.x, y: p.y + this.H * 0.62 }; }
  get Muzzle() { const p = this.node.position, m = this.art.muzzle; return { x: p.x + m.x * this.facing * this.Sc, y: p.y + m.y * this.Sc }; }
  get MovementHeld() { return G.frozen || G.inputLocked || (G.level ? G.level.cinematicPlaying || G.level.HoldEnemies : false); }
  get BulletSpeed() { return (this.kind === Kind.Marksman ? 30 : this.kind === Kind.Burst ? 20 : 17) * this.Dm(0.9, 1.2); }
  get Lv01() { return Mathf.clamp01((this.bossLevel - 1) / 4); }
  get IsFinal() { return this.bossLevel >= 5; }
  get HasEmbeddedSlash() { return this.art && this.art.id === "jotem"; }
  get DuelWalk() { return Mathf.lerp(1.6, 2.45, this.Lv01) * Math.sqrt(this.Rage); }
  get DuelReach() { const id = this.art.id; return (id === "jotem" ? 1.6 : id === "ronin" ? 1.55 : id === "samurai" ? 1.45 : id === "warrior" ? 1.35 : 1.2) * Math.max(1, this.Sc * 0.85); }
  get Windup() { return Mathf.lerp(0.5, 0.24, this.Lv01) / Math.sqrt(this.Rage); }
  get GuardChance() {
    if (this.IsFinal) return 0.8;
    const a = 0.5 + 0.1 * Mathf.clamp(this.bossLevel - 1, 0, 3);
    const t = this.MaxHp > 1 ? Mathf.clamp01((this.MaxHp - this.hp) / (this.MaxHp - 1)) : 0;
    return Mathf.lerp(a, a + 0.1, t);
  }
  get DodgeChance() { return Mathf.clamp01(Mathf.lerp(0.35, 0.9, this.Lv01) + 0.25 * (this.Rage - 1)); }
  get DuelVolley() { return 1 + (this.bossLevel >= 2 ? 1 : 0) + (this.bossLevel >= 4 ? 1 : 0) + (this.Rage > 1.3 ? 2 : 0); }
  get ComboLength() { return 1 + (this.bossLevel >= 2 ? 1 : 0) + (this.bossLevel >= 4 ? 1 : 0) + (this.Rage > 1.3 ? 1 : 0); }
  get DuelTelegraphing() { return (this.act === A.Melee && !this.strikeDone && this.actT > this.strikeHitAt) || (this.act === A.Leap && this.leapWind); }
  get Dodging() { return this.kind === Kind.Duelist && !this.Dead && this.act === A.Roll && this.rollEvasive; }
  get OwnSlashSet() { return has(this.slashFx2); }
  get FxFps() { return this.OwnSlashSet ? 24 : 34; }
  get FxAlpha() { return this.OwnSlashSet ? 0.95 : 0.75; }
  get GunReleaseFrame() {
    const id = this.art.id;
    return Math.min(has(this.art.shoot) ? Math.max(0, this.art.shoot.length - 1) : 0, id === "gangster_pistol" ? 8 : id === "samurai_archer" ? 10 : id === "gangster_tommy" || id === "swat_smg" ? 1 : 2);
  }
  get ThrowReleaseFrame() { const id = this.art.id; return Math.min(has(this.art.throwing) ? Math.max(0, this.art.throwing.length - 1) : 0, id === "jotem" || id === "ninja_monk" ? 3 : 4); }
  forceFinisher() { this.hp = 1; this.NoParry = true; this.iframes = 0; this.guardCd = 99; if (this.act === A.Guard || this.act === A.Heal || this.act === A.Rest) this.act = A.None; }
  face(dir) { this.facing = dir >= 0 ? 1 : -1; if (this.visual) this.visual.flipX = this.facing < 0; }
  Dm(e, h) { return Mathf.lerp(e, h, Mathf.clamp01(this.difficulty)); }
  get rbv() { return this.rb.velocity; }
  awake() {
    if (this.IsBoss && this.art) this.bossName = BOSS_NAMES[this.art.id] || this.bossName;
    this.rb = this.node.getComponent(Rigidbody2D);
    this.node._rb = this.rb;
    this.rb.interpolate = true;
    this.facing = this.startFacing >= 0 ? 1 : -1;
    this.hp = this.MaxHp;
  }
  onEnable() { Enemies.push(this); }
  onDisable() { this.restorePursuitCollision(); const i = Enemies.indexOf(this); if (i >= 0) Enemies.splice(i, 1); }
  holdMovement() { this.moveX = 0; this.rb.velocity.x = 0; }
  update() {
    if (this.Dead || G.paused) return;
    if (this.MovementHeld) { this.holdMovement(); return; }
    const dt = Time.deltaTime;
    this.actT -= dt; this.cooldown -= dt; this.throwCd -= dt; this.rollCd -= dt; this.jumpCd -= dt; this.guardCd -= dt; this.chargeCd -= dt; this.turnT -= dt; this.idleWait -= dt; this.iframes -= dt;
    this.updateAlertIcon(dt);
    this.updateTint(dt);
    const p = G.level ? G.level.player : null;
    const alive = p && !p.Dead;
    if (G.level && G.level.RoomTime < (this.IsBoss ? 2.2 : 1.3)) {
      this.moveX = 0;
      if (this.kind === Kind.Duelist) this.duelIntro();
      this.animate();
      return;
    }
    const sees = alive && this.canSee(p);
    if (sees) this.lastSeen = p.Center;
    if ((sees || this.IsBoss) && !this.alerted && alive) this.alert(Random.range(0.32, 0.48) * this.Dm(1.15, 0.7));
    this.moveX = 0;
    if (!this.alerted || !alive) { this.calm(); this.animate(); return; }
    const pc = p.Center, ch = this.Chest;
    const dx = pc.x - ch.x, dy = pc.y - ch.y;
    const ady = Math.abs(p.node.position.y - this.node.position.y);
    const dist = Math.hypot(dx, dy);
    if (this.kind === Kind.Duelist) { this.duelUpdate(p, sees, dx, ady, dist, dt); this.animate(); return; }
    switch (this.act) {
      case A.React: if (this.actT <= 0) this.act = A.None; break;
      case A.Aim: if (this.actT <= 0) this.beginFire(p); break;
      case A.Fire: this.tickFireSequence(p, dt); break;
      case A.Melee:
        if (!this.meleeDone && this.actT <= 0.12) { this.meleeDone = true; this.meleeStrike(); }
        if (this.actT <= 0) { this.act = A.Recover; this.actT = (this.kind === Kind.Warrior ? 0.55 : 0.32) / (this.IsBoss ? this.Rage : 1); }
        break;
      case A.Recover:
        if (this.actT <= 0) { this.act = A.None; this.cooldown = (this.kind === Kind.Brawler ? 0.45 : 0.55) * this.Dm(1.1, 0.8) / this.Rage; }
        break;
      case A.Throw: if (this.actT <= 0) this.act = A.None; break;
      case A.Roll:
        this.moveX = this.facing * (this.IsBoss ? 10 : 9);
        if (this.actT <= 0) {
          this.act = A.None; this.cooldown = this.rollEvasive ? 0 : 0.15;
          if (this.rollEvasive) this.facing = -this.facing;
          this.rollEvasive = false;
        }
        break;
      case A.Charge:
        if (this.actT > this.dashDur) this.moveX = 0;
        else { this.moveX = this.facing * this.dashSpeed; this.touchKill(0.9 * this.Sc, this.H * 0.8, this.kind === Kind.Warrior ? "IMPALED" : "DASH-CUT"); }
        if (this.actT <= 0) {
          this.act = A.Recover; this.actT = this.IsBoss ? 0.65 / Math.sqrt(this.Rage) : 0.75;
          this.chargeCd = this.IsBoss ? 2.2 / this.Rage : 2.4;
        }
        break;
      case A.Parry: if (this.actT <= 0) this.startMelee(this.IsBoss ? 0.3 / this.Rage : 0.36); break;
      case A.Stagger: if (this.actT <= 0) { this.act = A.None; if (this.IsBoss) this.cooldown = 0; } break;
      case A.Jump: this.moveX = this.rbv.x; if (this.actT <= 0 && this.grounded) this.act = A.None; break;
      case A.None: this.think(p, sees, dx, ady, dist); break;
    }
    this.animate();
  }
  bossAirHaptics() {
    if (this.grounded === this.hapticGrounded) { if (!this.grounded) this.hapticAirTime += Time.fixedDeltaTime; return; }
    const k = this.bossLevel >= 5 ? 1 : 0.65;
    if (!this.grounded && this.rbv.y > 1) Haptics.pulse(0.45 * k, 0.12 * k, 0.1);
    else if (this.grounded && this.hapticAirTime > 0.15) Haptics.pulse(0.85 * k, 0.3 * k, 0.2);
    this.hapticGrounded = this.grounded;
    if (this.grounded) this.hapticAirTime = 0;
  }
  fixedUpdate() {
    if (!this.Dead && (this.MovementHeld || G.paused)) { this.holdMovement(); return; }
    this.maintainPursuitCollision();
    if (this.Dead) { this.rb.velocity.x = 0; return; }
    const b = this.body.bounds;
    const gh = raycast(b.cx, b.minY + 0.06, 0, -1, 0.14, GROUND, { noTriggers: true, skip: (c) => this.rb.ignored.has(c) });
    this.grounded = !!gh && gh.collider !== this.pursuitIgnored && gh.normal.y > 0.5 && this.rbv.y <= 0.5;
    if (this.IsBoss) this.bossAirHaptics();
    if (this.parryPlantT > 0) { this.parryPlantT -= Time.fixedDeltaTime; this.moveX = 0; this.rb.velocity.x = 0; return; }
    let mx = this.moveX;
    const air = this.act === A.Jump || this.act === A.Leap;
    if (!air && Math.abs(mx) > 0.01) {
      const d = mx > 0 ? 1 : -1;
      const ledge = raycast(b.cx + d * (b.ex + 0.25), b.minY + 0.1, 0, -1, 0.75, GROUND, { noTriggers: true });
      const wall = raycast(b.cx, b.minY + 0.35, d, 0, b.ex + 0.15, LOS, { noTriggers: true });
      if ((this.grounded && !ledge) || wall) mx = 0;
      else {
        const x = b.cx + d * 0.35;
        for (const l of Lasers) if (l.covers(x, b.ex, b.minY, b.maxY) && !l.covers(b.cx, b.ex * 0.5, b.minY, b.maxY)) { mx = 0; break; }
      }
    }
    const v = this.rb.velocity;
    if (air) v.x = Mathf.moveTowards(v.x, this.moveX, 20 * Time.fixedDeltaTime);
    else v.x = this.grounded ? mx : Mathf.moveTowards(v.x, mx, 25 * Time.fixedDeltaTime);
  }
  think(p, sees, dx, ady, dist) {
    const num = dx >= 0 ? 1 : -1;
    const gun = this.kind === Kind.Gunner || this.kind === Kind.Burst || this.kind === Kind.Marksman || this.kind === Kind.Shield;
    if (this.IsBoss && gun && this.grounded && this.rollCd <= 0 && Math.abs(dx) < 2.6 && ady < 1.2 && has(this.art.roll)) {
      this.facing = -num; this.rollEvasive = true; this.act = A.Roll; this.actT = 0.4; this.rollCd = Random.range(1.4, 2.2) / this.Rage;
      this.anim.play(this.art.roll, this.art.roll.length / 0.4, false);
      CombatAudio.play(CombatSound.Roll, this);
      return;
    }
    if (num !== this.facing && Math.abs(dx) > 0.25) {
      if (this.turnT <= 0) { this.facing = num; this.turnT = this.IsBoss ? 0.08 : 0.18 * this.Dm(1.1, 0.7); }
      return;
    }
    if (gun) {
      let range = this.kind === Kind.Marksman ? 15 : this.kind === Kind.Shield ? 9 : 11;
      if (this.IsBoss) range = 30;
      if (sees && dist < range && this.cooldown <= 0 && Math.abs(p.Center.y - this.Muzzle.y) <= Math.max(0.65, this.Sc * 0.5)) {
        this.act = A.Aim;
        const t = this.kind === Kind.Marksman ? 0.7 : this.kind === Kind.Burst ? 0.5 : this.kind === Kind.Shield ? 0.6 : 0.42;
        this.actT = t * this.Dm(1.15, 0.75) / (this.IsBoss ? this.Rage : 1);
        return;
      }
      const keep = this.kind === Kind.Shield ? 1.2 : this.kind === Kind.Marksman ? 8 : 5.5;
      const x = this.node.position.x;
      if (!sees) this.moveX = Math.abs(this.lastSeen.x - x) > 0.6 ? Mathf.sign(this.lastSeen.x - x) * this.RunSpeed : 0;
      else if (Math.abs(dx) > keep) this.moveX = num * this.RunSpeed;
      return;
    }
    const pp = p.node.position, me = this.node.position;
    const up = pp.y - me.y;
    if (Math.abs(dx) < this.Reach && ady < 1.1 * Math.max(1, this.Sc) && this.cooldown <= 0) {
      const w = this.kind === Kind.Warrior ? 0.42 : this.kind === Kind.Brawler ? 0.3 : this.Reach >= 1.5 ? 0.34 : 0.26;
      this.startMelee(w * this.Dm(1.1, 0.85) / (this.IsBoss ? Math.sqrt(this.Rage) : 1));
    } else if (this.IsBoss && this.kind === Kind.Blade && sees && this.chargeCd <= 0 && this.grounded && Math.abs(dx) > 2.2 && Math.abs(dx) < 10 && ady < 1.3) {
      this.dashDur = 0.36; this.dashSpeed = 12.5 + this.bossLevel * 0.6; this.act = A.Charge; this.actT = 0.5 / this.Rage + this.dashDur;
    } else if (this.kind === Kind.Blade && this.throwsShuriken && sees && this.throwCd <= 0 && Math.abs(dx) > 3.2 && dist < (this.IsBoss ? 20 : 11)) {
      this.act = A.Throw; this.actT = 0.45; this.meleeDone = false;
      this.throwCd = Random.range(1.8, 2.6) * this.Dm(1.2, 0.75) / this.Rage;
      const c = or(this.art.throwing, this.art.attack);
      this.anim.play(c, c.length / 0.45, false);
    } else if (this.kind === Kind.Blade && this.grounded && this.jumpCd <= 0 && up > 1.3 && up < 5.5 && Math.abs(dx) < (this.IsBoss ? 6 : 4)) {
      const h = up + 0.9;
      const v = this.rb.velocity;
      v.y = Math.sqrt(19.62 * this.rb.gravityScale * h);
      v.x = Mathf.clamp(dx * 1.6, -6, 6);
      this.moveX = v.x; this.act = A.Jump; this.actT = 0.25; this.jumpCd = this.IsBoss ? 0.9 : 1.4;
      CombatAudio.play(CombatSound.Jump, this);
    } else if (this.kind === Kind.Warrior && sees && this.chargeCd <= 0 && Math.abs(dx) > 2.2 && Math.abs(dx) < 7 && ady < 1) {
      this.dashDur = 0.5; this.dashSpeed = 10.5; this.act = A.Charge; this.actT = 0.45 + this.dashDur;
    } else if ((this.kind === Kind.Brawler || this.kind === Kind.Blade) && this.grounded && this.rollCd <= 0 && Math.abs(dx) > 4.5 && ady < 1 && has(this.art.roll)) {
      this.act = A.Roll; this.actT = 0.42; this.rollCd = Random.range(2.2, 3.5) * this.Dm(1.2, 0.8);
      this.anim.play(this.art.roll, this.art.roll.length / 0.42, false);
      CombatAudio.play(CombatSound.Roll, this);
    } else {
      const f = (sees ? pp.x : this.lastSeen.x) - me.x;
      if (Math.abs(f) > this.Reach * 0.7) this.moveX = Mathf.sign(f) * this.RunSpeed;
    }
  }
  calm() {
    if (this.act !== A.None && this.act !== A.React) this.act = A.None;
    if (this.patrol && !this.alerted && !(this.idleWait > 0)) {
      const x = this.node.position.x;
      if (this.facing > 0 && x >= this.patrolMax) { this.facing = -1; this.idleWait = 1.2; }
      else if (this.facing < 0 && x <= this.patrolMin) { this.facing = 1; this.idleWait = 1.2; }
      else this.moveX = this.facing * 1.4;
    }
  }
  static onScreen(at) {
    const cam = Camera.main;
    if (!cam) return true;
    const h = cam.orthographicSize, w = h * 16 / 9, c = cam.node.position;
    return Math.abs(at.x - c.x) < w - 0.4 && Math.abs(at.y - c.y) < h - 0.4;
  }
  canSee(p) {
    const me = this.node.position;
    const eye = { x: me.x, y: me.y + this.H * 0.85 };
    const pc = p.Center;
    const vx = pc.x - eye.x, vy = pc.y - eye.y;
    if (p.Ghost) return false;
    if (!Enemy.onScreen(eye)) return false;
    if (Math.abs(vx) > this.SightRange || Math.abs(vy) > (this.IsBoss ? 12 : 5.5)) return false;
    const front = Mathf.sign(vx) === this.facing || Math.abs(vx) < 1.8;
    if (!this.alerted && !front) return false;
    const len = Math.hypot(vx, vy);
    return !raycast(eye.x, eye.y, vx, vy, len, LOS, { noTriggers: true });
  }
  alert(reaction) {
    if (this.alerted || this.Dead) return;
    this.alerted = true; this.act = A.React; this.actT = reaction;
    this.rollCd = Math.max(this.rollCd, Random.range(1.2, 2));
    this.throwCd = Math.max(this.throwCd, Random.range(0.8, 1.4));
    this.chargeCd = Math.max(this.chargeCd, this.IsBoss ? 1.5 : 1.2);
    this.jumpCd = Math.max(this.jumpCd, 0.8);
    if (this.IsBoss) { this.throwCd = Math.max(this.throwCd, 1.4); this.cooldown = Math.max(this.cooldown, 0.8); }
    this.alertPop = 0.75;
    const p = G.level ? G.level.player : null;
    if (p) { this.lastSeen = p.Center; this.facing = p.Center.x >= this.node.position.x ? 1 : -1; }
  }
  static alertNear(pos, radius, except = null) {
    for (const e of Enemies.slice()) {
      if (e === except || e.Dead || e.alerted) continue;
      const p = e.node.position;
      if (Math.hypot(p.x - pos.x, p.y - pos.y) < radius) e.alert(Random.range(0.4, 0.7));
    }
  }
  updateAlertIcon(dt) {
    if (!this.alertIcon) return;
    this.alertPop -= dt;
    this.alertIcon.enabled = this.alertPop > 0;
    if (this.alertPop > 0) {
      const k = Mathf.clamp01((0.75 - this.alertPop) / 0.12);
      const s = Mathf.lerp(0.2, 1, k) * (1 + 0.15 * Math.sin(this.alertPop * 30) * (1 - k)) / this.Sc;
      this.alertIcon.node.lsx = this.alertIcon.node.lsy = s;
    }
  }
  updateTint(dt) {
    this.flashT -= dt;
    let c = col(1, 1, 1);
    if (this.flashT > 0) c = col(1, 0.35, 0.35);
    else if (this.act === A.Charge && this.actT > this.dashDur && this.IsBoss) c = Mathf.repeat(Time.time * 12, 1) > 0.5 ? col(1, 0.55, 0.55) : col(1, 1, 1);
    else if (this.kind === Kind.Duelist && this.DuelTelegraphing) c = Mathf.repeat(Time.time * 14, 1) > 0.5 ? col(1, 0.45, 0.45) : col(1, 1, 1);
    else if (this.kind === Kind.Duelist && (this.act === A.Rest || this.act === A.Heal)) c = col(0.75, 1, 0.8);
    else if (this.iframes > 0) c = col(1, 1, 1, 0.6);
    this.visual.color = c;
  }
  beginFire(p) {
    this.act = A.Fire;
    const fps = 16;
    const c = or(this.art.shoot, this.art.idle);
    this.actT = Math.max(0.25, c.length / fps);
    this.anim.play(c, fps, false);
    this.queueFireSequence(c);
  }
  aimDir() { return { x: this.facing, y: 0 }; }
  shootOnce(p, spread) {
    if (!p) return;
    const m = this.Muzzle, d = this.aimDir();
    const ang = Math.atan2(d.y, d.x) * Mathf.DEG + Random.range(-spread, spread);
    this.shot(m, ang, this.BulletSpeed);
    CombatAudio.play(this.art.id === "samurai_archer" ? CombatSound.KnifeThrow : CombatSound.Gunshot, this);
    CameraRig.shake(0.05, 0.05);
    Enemy.alertNear(this.node.position, 9, this);
  }
  fan(p, n, spread) {
    const m = this.Muzzle, d = this.aimDir();
    const a0 = Math.atan2(d.y, d.x) * Mathf.DEG;
    for (let i = 0; i < n; i++) { const k = n === 1 ? 0 : i / (n - 1) - 0.5; this.shot(m, a0 + k * spread, this.BulletSpeed * 0.85); }
    CombatAudio.play(this.art.id === "samurai_archer" ? CombatSound.KnifeThrow : CombatSound.Gunshot, this);
    CameraRig.shake(0.12, 0.08);
  }
  shot(from, ang, speed) {
    const r = ang * Mathf.RAD;
    const b = Bullet.fire(from, { x: Math.cos(r), y: Math.sin(r) }, speed, this, false, this.projectile, this.projectileSpin);
    if (this.projectileScale !== 1) b.node.lsx = b.node.lsy = this.projectileScale;
    FX.anim(GA.spark, from.x, from.y, 40, 14, 0.45, ang);
  }
  throwVolley(p) {
    const me = this.node.position;
    const from = { x: me.x + 0.35 * this.facing, y: me.y + this.H * 0.72 };
    const pc = p.Center;
    let n = 1;
    if (this.IsBoss) n = (this.art.id === "ronin" ? 1 : 3) + (this.Rage > 1.25 ? 2 : 0);
    if (this.kind === Kind.Duelist) n = this.DuelVolley;
    const a0 = Math.atan2(pc.y - from.y, pc.x - from.x) * Mathf.DEG;
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5;
      const a = (a0 + k * 34) * Mathf.RAD;
      const shuriken = !this.projectile || this.projectileSpin;
      const b = Bullet.fire(from, { x: Math.cos(a), y: Math.sin(a) }, (this.IsBoss ? 14 : 15) * this.Dm(0.9, 1.15), this, shuriken, this.projectile, this.projectileSpin);
      if (this.projectileScale !== 1) b.node.lsx = b.node.lsy = this.projectileScale;
    }
    CombatAudio.play(CombatSound.ShurikenThrow, this);
  }
  startMelee(windup) {
    this.act = A.Melee; this.meleeDone = false; this.actT = windup + 0.12;
    let c = or(this.art.attack, this.art.idle);
    if ((this.kind === Kind.Warrior || this.IsBoss) && has(this.art.special) && Random.value() < 0.35) c = this.art.special;
    this.anim.play(c, c.length / (windup + 0.2), false);
  }
  meleeStrike() {
    const me = this.node.position;
    const v = { x: me.x + this.facing * this.Reach * 0.6, y: me.y + this.H * 0.55 };
    if (!this.HasEmbeddedSlash && has(this.slashFx)) FX.anim(this.slashFx, v.x + this.facing * 0.15, v.y, 34, 8, 0.55 * Math.max(1, this.Sc * 0.8), 0, this.facing < 0, col(1, 1, 1, 0.75));
    const hit = this.touchKill(this.Reach * 1.25, this.H * 0.9, this.kind === Kind.Brawler ? "KNOCKED OUT" : "CUT DOWN", this.Reach * 0.6);
    if (this.kind !== Kind.Brawler || !hit) CombatAudio.play(this.kind === Kind.Brawler ? CombatSound.FistSwing : CombatSound.BladeSwing, this);
  }
  touchKill(w, h, cause, fwd = 0.3) {
    const me = this.node.position;
    const c = overlapBox(me.x + this.facing * fwd, me.y + this.H * 0.5, w, h, PLAYER);
    if (!c) return false;
    const pl = c.node.getComponentInParent("HypoFangs.PlayerController");
    if (!pl || pl.Dead || pl.Invulnerable) return false;
    const id = this.art.id;
    CombatAudio.play(this.kind === Kind.Brawler || id === "fighter" ? CombatSound.BodyImpact : id === "shinobi" || id === "kunoichi" || id === "ninja_monk" ? CombatSound.DaggerImpact : CombatSound.BladeImpact, this);
    pl.die({ x: this.facing, y: 0.35 }, cause);
    return true;
  }
  blocksFrom(from) {
    if (this.Dead) return false;
    if (!(Math.abs(from.x) > 0.05) || (from.x > 0 ? 1 : -1) !== this.facing) return false;
    switch (this.kind) {
      case Kind.Shield: return this.act !== A.Stagger;
      case Kind.Warrior:
        if (this.act !== A.None && this.act !== A.React) return this.act === A.Charge ? this.actT > this.dashDur : false;
        return true;
      case Kind.Duelist: return this.act === A.Guard ? !this.NoParry : false;
      default: return false;
    }
  }
  onHit(dir, thrown) {
    if (this.Dead) return false;
    const p = G.level ? G.level.player : null;
    let from;
    if (p) { const pc = p.Center, ch = this.Chest; from = { x: pc.x - ch.x, y: pc.y - ch.y }; } else from = { x: -dir.x, y: -dir.y };
    if (thrown) from = { x: -dir.x, y: -dir.y };
    if (this.blocksFrom(from)) {
      this.block(dir, thrown);
      if (this.kind === Kind.Duelist) this.duelRiposte();
      return true;
    }
    if (this.kind === Kind.Duelist && this.duelTryParry(from, dir, thrown)) return true;
    const front = (from.x > 0 ? 1 : -1) === this.facing;
    const calmish = this.act === A.None || this.act === A.React || (!this.IsBoss && this.act === A.Recover);
    if (!thrown && this.kind === Kind.Blade && this.alerted && front && this.guardCd <= 0 && calmish && this.iframes <= 0) {
      this.guardCd = this.IsBoss ? Mathf.lerp(1.8, 1, (this.bossLevel - 1) / 4) / this.Rage : this.Dm(2.6, 1.5);
      this.act = A.Parry; this.actT = 0.22;
      this.anim.play(or(this.art.guard, this.art.idle), 18, false);
      this.clash(dir);
      return true;
    }
    return this.damage(dir, thrown ? "kunai" : "katana");
  }
  damage(dir, how) {
    if (this.Dead) return false;
    if (this.IsBoss && (this.iframes > 0 || (this.act === A.Roll && this.rollEvasive))) return false;
    if (this.hp > 1) {
      this.hp--;
      if (this.kind === Kind.Duelist) this.duelHurt();
      this.iframes = 0.5; this.flashT = 0.12; this.act = A.Stagger; this.actT = 0.28 / this.Rage;
      if (!this.alerted) this.alert(0.1);
      const v = this.rb.velocity;
      v.x = Mathf.sign(dir.x === 0 ? -this.facing : dir.x) * 6; v.y = 3;
      this.anim.play(or(this.art.hurt, this.art.idle), 12, false);
      const c = this.Chest;
      FX.shards(c.x, c.y, { x: dir.x, y: dir.y + 0.3 }, 8, col(0.72, 0.02, 0.1), 7, 0.06);
      TimeFX.hitStop(0.09); CameraRig.shake(0.25, 0.15);
      if (G.level) G.level.onBossDamaged(this);
      return true;
    }
    this.kill(dir, how);
    return true;
  }
  block(dir, thrown) {
    if (thrown && this.kind === Kind.Shield) { this.act = A.Stagger; this.actT = 1.1; this.anim.play(or(this.art.hurt, this.art.idle), 8, false); }
    if (this.kind === Kind.Warrior || this.kind === Kind.Duelist) this.anim.play(or(this.art.guard, this.art.idle), 10, false);
    if (!this.alerted) this.alert(0.25);
    this.clash(dir);
  }
  clash(dir) {
    const ch = this.Chest;
    const v = { x: ch.x + this.facing * 0.35, y: ch.y };
    FX.anim(GA.spark, v.x, v.y, 30, 14, 0.7, Random.range(0, 360));
    FX.shards(v.x, v.y, { x: -this.facing, y: 0.5 }, 6, col(1, 0.9, 0.5), 6, 0.05);
    CombatAudio.play(CombatSound.MetalClash, this);
    TimeFX.hitStop(0.06); CameraRig.shake(0.15, 0.12);
    const p = G.level ? G.level.player : null;
    if (p && !p.Dead && Math.hypot(p.Center.x - ch.x, p.Center.y - ch.y) < 3) p.plantAfterParry();
    this.moveX = 0; this.parryPlantT = 0.16;
    this.rb.velocity = { x: 0, y: Math.min(this.rbv.y, 0) };
  }
  kill(dir, how) {
    if (this.Dead) return;
    if (G.bossDeath && G.bossDeath.tryStart(this)) return;
    this.restorePursuitCollision();
    this.Dead = true; this.hp = 0; this.act = A.None; this.moveX = 0;
    this.visual.color = col(1, 1, 1);
    if (this.alertIcon) this.alertIcon.enabled = false;
    const ch = this.Chest;
    if (Math.abs(dir.x) > 0.1) this.facing = !(dir.x > 0) ? 1 : -1;
    this.visual.flipX = this.facing < 0;
    this.anim.play(or(this.art.dead, this.art.hurt), 11, false);
    this.visual.sortingOrder = 8;
    this.node.layer = LAYER.Corpse;
    this.body.size = { x: 0.5, y: 0.3 }; this.body.offset = { x: 0, y: 0.15 };
    this.rb.velocity = { x: 0, y: Math.min(this.rbv.y, 0) };
    let cg = this.node.getComponent(CorpseGrounding);
    if (!cg) { cg = new CorpseGrounding(); this.node.addComponent(cg); }
    cg.configure(this.visual, this.anim, this.rb, this.body);
    const dn = norm(dir.x, dir.y);
    FX.anim(GA.RandomBlood(), ch.x + dir.x * 0.35, ch.y + dir.y * 0.35, 24, 8, this.IsBoss ? 1.1 : 0.7, Math.atan2(dir.y, dir.x) * Mathf.DEG, dir.x < 0);
    FX.shards(ch.x, ch.y, { x: dir.x, y: dir.y + 0.4 }, this.IsBoss ? 40 : 14, col(0.72, 0.02, 0.1), 9, 0.06);
    this.splatter(ch, dir);
    TimeFX.hitStop(this.IsBoss ? 0.35 : how === "deflect" ? 0.1 : 0.075);
    CameraRig.shake(this.IsBoss ? 0.5 : 0.22, this.IsBoss ? 0.4 : 0.14);
    Enemy.alertNear(this.node.position, 5.5);
    if (G.level) G.level.onEnemyKilled(this);
  }
  splatter(c, dir) {
    if (!GA.blood || GA.blood.length < 3) return;
    for (let j = 0; j < 3; j++) {
      const dn = norm(dir.x, dir.y), u = Random.insideUnitCircle();
      const d = norm(dn.x + u.x * 0.6, dn.y + u.y * 0.6 + (j === 2 ? -1.5 : 0));
      const h = raycast(c.x, c.y, d.x, d.y, 4.5, GROUND, { noTriggers: true });
      if (!h) continue;
      const sr = FX.makeSprite("Blood", GA.blood[Math.min(GA.blood.length - 1, 3 + j)], h.point.x + h.normal.x * 0.02, h.point.y + h.normal.y * 0.02, 2, false, this.node.parent);
      sr.color = col(0.55, 0.02, 0.06, 0.9);
      SpriteSurfaces.flattenBlood(sr, h.point, h.normal, Random.range(0.65, 1.2), 0.08);
    }
  }
  animate() {
    this.visual.flipX = this.facing < 0;
    if (this.kind === Kind.Duelist && this.duelAnimate()) return;
    switch (this.act) {
      case A.Fire: case A.Melee: case A.Throw: case A.Roll: case A.Parry: case A.Stagger: break;
      case A.Aim: { this.anim.frames = null; this.visual.sprite = or(this.art.shoot, this.art.idle)[0]; break; }
      case A.Charge:
        if (this.actT > this.dashDur) this.anim.play(or(this.art.guard, this.art.idle), 8, true, false);
        else this.anim.play(or(this.art.charge, this.art.run), 14, true, false);
        break;
      case A.Recover: this.anim.play(this.art.idle, 8, true, false); break;
      case A.Jump:
        if (has(this.art.jump)) {
          this.anim.frames = null;
          const y = this.rbv.y, n = this.art.jump.length;
          this.visual.sprite = this.art.jump[Mathf.clamp(y > 3 ? Math.floor(n / 4) : y > -1 ? Math.floor(n / 2) : Math.floor(n * 3 / 4), 0, n - 1)];
        }
        break;
      default: {
        const s = Math.abs(this.rbv.x);
        if (s > 2.6) this.anim.play(or(this.art.run, this.art.walk), 13, true, false);
        else if (s > 0.3) this.anim.play(or(this.art.walk, this.art.run), 10, true, false);
        else this.anim.play(this.art.idle, 8, true, false);
      }
    }
  }
  // ---------------------------------------------------------------- boss attack motions
  tryAttackMotion(clip) {
    const art = this.art;
    if (this.IsBoss && art && art.id === "jotem" && clip && clip === art.attack) {
      const m = Line("Gaku embedded double sweep", 3);
      m.hitEndFrame = 4; m.secondHitFrame = 7; m.secondHitEndFrame = 8;
      return m;
    }
    if (!this.IsBoss || this.IsFinal || !art || !clip) return null;
    if (clip === this.cachedMotionClip) return this.cachedMotion;
    let m = null;
    if (art.id === "fighter") {
      if (clip === art.attack) m = Line("Straight punch", 2, P(2, 79, 52, 0, 0.46, 0.09), P(3, 82, 52, 0, 0.28, 0.055));
      else if (clip === art.attack2) m = Line("Straight cross", 1, P(1, 78, 52, 0, 0.48, 0.09), P(2, 80, 52, 0, 0.25, 0.05));
      else if (clip === art.attack3) m = Arc("Rising kick", 2, 2, P(2, 78, 70, -35, 0.28, 0.27, 3), P(3, 81, 64, -25, 0.27, 0.24, 6));
    } else if (art.id === "shinobi") {
      if (clip === art.attack) m = Arc("Forward knife sweep", 3, 0, P(3, 78, 69, 0, 0.33, 0.17, 3));
      else if (clip === art.attack2) m = Arc("Backhand knife sweep", 1, 0, P(1, 77, 68, 0, 0.34, -0.17, 4));
      else if (clip === art.attack3) m = Arc("Rising knife cut", 2, 2, P(2, 79, 67, -35, 0.25, 0.32, 4));
    } else if (art.id === "samurai") {
      if (clip === art.attack) m = Arc("Horizontal sword cut", 4, 0, P(4, 96, 74, 0, 0.42, 0.18, 3));
      else if (clip === art.attack2) m = Arc("Return sword cut", 2, 0, P(2, 94, 68, 0, 0.39, -0.14, 4));
      else if (clip === art.attack3) m = Line("Straight sword thrust", 1, P(1, 125, 70, 0, 0.62, 0.055), P(2, 126, 70, 0, 0.3, 0.03));
    } else if (art.id === "warrior") {
      if (clip === art.attack) m = Arc("Quick horizontal cut", 2, 0, P(2, 96, 61, 0, 0.39, 0.16, 3));
      else if (clip === art.attack2) m = Arc("Overhead sword cut", 2, 2, P(2, 89, 60, -35, 0.29, 0.37, 4));
      else if (clip === art.charge) m = Arc("Running sword cut", 5, 0, P(5, 98, 58, 0, 0.37, 0.17, 3));
    }
    this.cachedMotionClip = clip; this.cachedMotion = m;
    return m;
  }
  beginAttackMotion(clip, motion) {
    if (!this.attackMotionVfx) { this.attackMotionVfx = new BossAttackVfx(); this.node.addComponent(this.attackMotionVfx); }
    this.attackMotionVfx.begin(this, clip, motion);
  }
  lateUpdate() {
    this.tickProjectileFrames();
    if (G.paused || this.MovementHeld || this.Dead || this.act !== A.Melee || !this.anim || this.anim.frames !== this.strikeClip) return;
    const m = this.tryAttackMotion(this.strikeClip);
    if (!m) return;
    if (this.HasEmbeddedSlash) {
      const s = m.contactSweep(this.anim.Frame);
      if (s >= 0) {
        if (this.strikeSweep !== s) { this.strikeSweep = s; this.strikeDone = true; this.doStrike(); }
        else this.strikeContact();
      }
    } else if (!this.strikeDone && this.anim.Frame >= m.hitFrame) { this.strikeDone = true; this.doStrike(); }
  }
  chance(perSecond) { return Random.value() < perSecond * Time.deltaTime; }
  duelIntro() {
    const art = this.art;
    if (this.healsLeft < 0) this.healsLeft = has(art.heal) ? (!this.IsFinal ? 1 : 2) : 0;
    if (!this.tauntDone) {
      this.tauntDone = true; this.act = A.Taunt; this.actT = 2.2;
      this.tauntWalkT = has(art.calmWalk) ? 1 : 0;
      if (this.tauntWalkT <= 0) {
        if (has(art.take)) this.anim.play(art.take, art.take.length / 1.1, false);
        else if (has(art.guard)) this.anim.play(art.guard, 5, false);
      }
    }
    if (this.act === A.Taunt && !(this.tauntWalkT <= 0)) {
      this.tauntWalkT -= Time.deltaTime;
      if (this.tauntWalkT > 0) { this.moveX = this.facing * 1.1; this.anim.play(art.calmWalk, 8, true, false); return; }
      this.moveX = 0; this.rb.velocity.x = 0;
      const c = has(art.take) ? art.take : or(art.guard, art.idle);
      this.anim.play(c, c.length / 1.1, false);
    }
  }
  duelUpdate(p, sees, dx, ady, dist, dt) {
    const art = this.art;
    this.leapCd -= dt; this.healCd -= dt; this.restCd -= dt; this.guardStanceCd -= dt; this.lungeCd -= dt;
    if (this.healsLeft < 0) this.healsLeft = has(art.heal) ? (!this.IsFinal ? 1 : 2) : 0;
    const toward = dx >= 0 ? 1 : -1;
    const adx = Math.abs(dx);
    switch (this.act) {
      case A.React: case A.Taunt: if (this.actT <= 0) this.act = A.None; return;
      case A.Stagger: if (this.actT <= 0) { this.act = A.None; this.cooldown = Math.min(this.cooldown, 0.2); } return;
      case A.Melee: this.strikeTick(p, toward); return;
      case A.Recover: if (this.actT <= 0) { this.act = A.None; this.cooldown = Mathf.lerp(0.5, 0.18, this.Lv01) / this.Rage; this.maybeRest(); } return;
      case A.Guard: if (this.actT <= 0) { this.act = A.None; if (adx < this.Reach + 0.5 && ady < 1.2) this.startCombo(true); } return;
      case A.Crouch: case A.Crawl: this.act = A.None; return;
      case A.Roll:
        this.moveX = this.facing * 9;
        if (this.actT <= 0) { this.act = A.None; if (this.rollEvasive) this.facing = toward; this.rollEvasive = false; this.cooldown = Math.min(this.cooldown, 0.1); }
        return;
      case A.Throw: if (this.actT <= 0) this.act = A.None; return;
      case A.Jump: this.pursuitFlight(dt); if (this.actT <= 0 && this.grounded) this.act = A.None; return;
      case A.Leap: this.leapTick(dx); return;
      case A.Heal:
        if (this.actT <= 0) {
          this.hp = Math.min(this.MaxHp, this.hp + 1); this.healsLeft--; this.healCd = 7; this.act = A.None;
          const c = this.Chest;
          FX.shards(c.x, c.y, { x: 0, y: 1 }, 14, col(0.4, 1, 0.55), 4, 0.05);
          Sfx.play(GA.sfxBlip, 0.8, 0);
          if (G.level && G.level.hud) G.level.hud.flash(this.bossName + " DRINKS AN ELIXIR", 1.1);
        }
        return;
      case A.Rest: if (this.actT <= 0) this.act = A.None; return;
    }
    if (this.scanKnives() || this.pursuePlatforms(p)) return;
    if (toward !== this.facing && adx > 0.25) {
      if (this.turnT <= 0) { this.facing = toward; this.turnT = Mathf.lerp(0.2, 0.05, this.Lv01); }
      return;
    }
    const level = ady < 1.2 * Math.max(1, this.Sc);
    if (this.healsLeft > 0 && this.healCd <= 0 && this.hp <= Math.floor(this.MaxHp / 2) && adx > 4.5 && this.grounded) {
      this.act = A.Heal; this.actT = Mathf.lerp(1.4, 1, this.Lv01);
      this.anim.play(art.heal, art.heal.length / this.actT, false);
      return;
    }
    if (adx < this.Reach + 0.15 && level && this.cooldown <= 0) { this.startCombo(false); return; }
    if (adx < this.Reach + 1.3 && level && this.guardStanceCd <= 0 && has(art.guard) && this.chance(this.GuardChance * 2.5)) {
      this.act = A.Guard; this.actT = Mathf.lerp(0.45, 0.75, this.Lv01); this.guardStanceCd = Mathf.lerp(2.6, 1.1, this.Lv01);
      this.anim.play(art.guard, art.guard.length / 0.15, false);
      return;
    }
    if (has(art.charge) && this.lungeCd <= 0 && adx > this.Reach + 0.3 && adx < 3.6 && level && this.grounded && this.cooldown <= 0 && this.chance(1.2 + this.Lv01)) {
      this.lungeCd = Mathf.lerp(3.5, 1.8, this.Lv01) / this.Rage;
      this.startCombo(false, S.Lunge);
      return;
    }
    if (sees && this.grounded && level) {
      if (this.leapCd <= 0 && adx > 2.8 && adx < 8 && has(or(art.jump, art.platJump)) && this.chance(0.5 + 0.9 * this.Lv01)) { this.startLeap(); return; }
      if (this.throwsShuriken && has(art.throwing) && this.throwCd <= 0 && adx > 3.2 && dist < 16) {
        this.act = A.Throw; this.actT = 0.5; this.meleeDone = false;
        this.throwCd = Random.range(2.2, 3.2) * Mathf.lerp(1.2, 0.65, this.Lv01) / this.Rage;
        this.anim.play(art.throwing, art.throwing.length / 0.5, false);
        return;
      }
      if (this.rollCd <= 0 && adx > 6 && has(art.roll) && this.chance(0.5)) {
        this.act = A.Roll; this.actT = 0.42; this.rollEvasive = false; this.rollCd = Random.range(3, 4.5);
        this.anim.play(art.roll, art.roll.length / 0.42, false);
        CombatAudio.play(CombatSound.Roll, this);
        return;
      }
    }
    const f = (this.IsBoss || sees ? p.node.position.x : this.lastSeen.x) - this.node.position.x;
    if (Math.abs(f) > this.Reach * 0.8) this.moveX = Mathf.sign(f) * this.DuelWalk;
  }
  startCombo(riposte, first = S.Slash) {
    this.comboTotal = this.comboLeft = riposte ? Math.max(1, this.ComboLength - 1) : this.ComboLength;
    this.comboIdx = 0;
    this.nextStrike(riposte ? 0.6 : 1, first);
  }
  nextStrike(windMul, first = S.Slash) {
    const art = this.art;
    const p = G.level ? G.level.player : null;
    const f = p ? p.Center.x - this.node.position.x : this.facing;
    const behind = p && Mathf.sign(f) !== this.facing && Math.abs(f) > 0.2;
    const close = Math.abs(f) < 0.7;
    let c = art.attack, st = S.Slash;
    if (this.comboIdx === 0 && first === S.Rising) { c = or(art.attack3, art.attack); st = S.Rising; }
    else if (this.comboIdx === 0 && first === S.Lunge && has(art.charge)) { c = art.charge; st = S.Lunge; }
    else if (art.id === "warrior" && (has(art.kick) || has(art.thrust))) {
      if ((behind || close) && has(art.kick)) { c = art.kick; st = S.Spin; }
      else {
        const v = Random.value();
        if (v < 0.25 && has(art.thrust)) { c = art.thrust; st = S.Thrust; }
        else if (v < 0.42 && has(art.special)) { c = art.special; st = S.CloseCut; }
        else if (v < 0.55 && has(art.kick)) { c = art.kick; st = S.Spin; }
        else c = this.comboIdx % 2 === 0 ? art.attack : or(art.attack2, art.attack);
      }
    } else if (art.id === "ronin") {
      if (Random.value() < 0.25 + 0.35 * (this.Rage - 1) / 0.55) {
        const r = Random.rangeInt(0, 3);
        c = r === 1 ? art.special2 : r === 0 ? art.special : art.special3;
        if (!has(c)) c = art.attack;
        st = S.Heavy;
      } else c = this.comboIdx % 3 === 0 ? art.attack : this.comboIdx % 3 === 1 ? or(art.attack2, art.attack) : or(art.attack3, art.attack);
    } else c = this.comboIdx % 3 === 0 ? art.attack : this.comboIdx % 3 === 1 ? or(art.attack2, art.attack) : or(art.attack3, art.attack);
    if (!has(c)) c = or(art.attack, art.idle);
    const w = this.Windup * windMul * (this.comboIdx > 0 ? 0.75 : 1) * (st === S.Heavy || st === S.Spin || st === S.Thrust || st === S.Lunge ? 1.3 : 1);
    this.strikeClip = c; this.strikeType = st; this.strikeDone = false; this.strikeSweep = -1; this.strikeHitAt = 0.18;
    this.act = A.Melee; this.actT = w + 0.18;
    this.anim.play(c, c.length / (w + 0.18 + 0.1), false);
    const m = this.tryAttackMotion(c);
    if (m) {
      this.actT = c.length / this.anim.fps;
      this.strikeHitAt = this.actT - m.hitFrame / this.anim.fps;
      if (!this.HasEmbeddedSlash) this.beginAttackMotion(c, m);
    }
    this.comboLeft--; this.comboIdx++;
  }
  strikeTick(p, toward) {
    this.moveX = 0;
    const m = this.tryAttackMotion(this.strikeClip);
    if (!m && !this.strikeDone && this.actT <= this.strikeHitAt) { this.strikeDone = true; this.doStrike(); }
    if (m ? !this.anim.Finished : this.actT > 0) return;
    if (m && !this.strikeDone && !this.HasEmbeddedSlash) { this.strikeDone = true; this.doStrike(); }
    if (this.comboLeft > 0 && p && !p.Dead) {
      if (this.bossLevel >= 3 || toward === this.facing) this.facing = toward;
      this.rb.velocity.x = this.facing * 2.5;
      this.nextStrike(1);
    } else {
      this.act = A.Recover; this.actT = Mathf.lerp(0.8, 0.4, this.Lv01) / Math.sqrt(this.Rage);
      this.restAfter = this.comboTotal >= 3;
      this.anim.play(this.art.idle, 8, true);
    }
  }
  strikeShape() {
    const r = this.Reach, H = this.H;
    let s = { w: r * 1.25, h: H * 0.9, fwd: r * 0.6, lunge: 2.5 + 1.5 * this.Lv01, cause: "CUT DOWN" };
    switch (this.strikeType) {
      case S.Rising: s.w = r * 1.2; s.h = H * 1.35; s.fwd = r * 0.55; break;
      case S.Thrust: s.w = r * 1.8; s.h = H * 0.5; s.fwd = r * 0.9; s.lunge = 6; s.cause = "SKEWERED"; break;
      case S.Spin: s.w = r * 2.4; s.h = H * 0.9; s.fwd = 0; s.lunge = 0; break;
      case S.CloseCut: s.w = r * 1.1; s.h = H * 0.95; s.fwd = r * 0.5; s.lunge = 5; break;
      case S.Heavy: s.w = r * 1.6; s.h = H * 1.15; s.fwd = r * 0.75; s.lunge = 3.5; break;
      case S.Lunge: s.w = r * 2.3; s.h = H * 0.9; s.fwd = r * 1.15; s.lunge = 11; break;
    }
    return s;
  }
  strikeContact() { const s = this.strikeShape(); this.touchKill(s.w, s.h, s.cause, s.fwd); }
  doStrike() {
    const s = this.strikeShape();
    const r = this.Reach;
    if (s.lunge > 0) this.rb.velocity.x = this.facing * s.lunge;
    const me = this.node.position;
    const v = { x: me.x + this.facing * s.fwd, y: me.y + this.H * 0.55 };
    const fx = this.strikeFx(this.strikeType === S.Heavy || this.strikeType === S.Lunge ? 2 : this.comboIdx - 1);
    if (!this.tryAttackMotion(this.strikeClip) && has(fx)) {
      const sc = 0.6 * Math.max(1, this.Sc * 0.8) * (this.strikeType === S.Heavy ? 1.3 : 1);
      FX.anim(fx, v.x + this.facing * 0.15, v.y, this.FxFps, 8, sc, 0, this.facing < 0, col(1, 1, 1, this.FxAlpha));
      if (this.strikeType === S.Spin) FX.anim(fx, me.x - this.facing * r * 0.6, me.y + this.H * 0.55, 34, 8, sc, 0, this.facing > 0, col(1, 1, 1, 0.75));
    }
    if (this.strikeType === S.Heavy || this.strikeType === S.CloseCut) CameraRig.shake(0.12, 0.1);
    const hit = this.touchKill(s.w, s.h, s.cause, s.fwd);
    if (this.strikeType === S.CloseCut || this.art.id !== "fighter" || !hit)
      CombatAudio.play(this.strikeType !== S.CloseCut ? (this.art.id === "fighter" ? CombatSound.FistSwing : CombatSound.BladeSwing) : CombatSound.BladeSwing, this);
    if (this.strikeType === S.Heavy && this.strikeClip === this.art.special2) this.swordWave();
  }
  strikeFx(hit) {
    if (this.HasEmbeddedSlash) return null;
    if (!has(this.slashFx2)) return this.slashFx;
    switch (((hit % 3) + 3) % 3) {
      case 1: return this.slashFx2;
      case 0: return this.slashFx;
      default: return has(this.slashFx3) ? this.slashFx3 : this.slashFx;
    }
  }
  swordWave() {
    const me = this.node.position;
    const from = { x: me.x + this.facing * 0.7, y: me.y + this.H * 0.45 };
    this.shot(from, this.facing > 0 ? 0 : 180, Mathf.lerp(11, 14, this.Lv01) * Math.sqrt(this.Rage));
    if (this.Rage > 1.3) { this.shot(from, this.facing > 0 ? 12 : 168, 12); this.shot(from, this.facing > 0 ? -8 : 188, 12); }
    CombatAudio.play(CombatSound.ShurikenThrow, this);
  }
  maybeRest() {
    if (!this.restAfter || !has(this.art.rest) || this.restCd > 0) { this.restAfter = false; return; }
    this.restAfter = false;
    if (Random.value() < Mathf.lerp(0.6, 0.3, this.Lv01)) {
      this.act = A.Rest; this.actT = Mathf.lerp(1.2, 0.7, this.Lv01); this.restCd = 5;
      this.anim.play(this.art.rest, this.art.rest.length / this.actT, false);
    }
  }
  duelTryParry(from, dir, thrown) {
    const front = Math.abs(from.x) > 0.05 && (from.x > 0 ? 1 : -1) === this.facing;
    if (this.NoParry || !front || !this.alerted || this.iframes > 0 || this.guardCd > 0) return false;
    if (this.act !== A.None && this.act !== A.React && this.act !== A.Guard && (!this.IsFinal || this.act !== A.Recover)) return false;
    if (Random.value() >= this.GuardChance) { this.guardCd = 0.35; return false; }
    this.guardCd = Mathf.lerp(1.5, 0.6, this.Lv01) / this.Rage;
    this.anim.play(or(this.art.guard, this.art.idle), 14, false);
    this.clash(dir);
    this.duelRiposte();
    return true;
  }
  duelRiposte() {
    const p = G.level ? G.level.player : null;
    if (!p || p.Dead) { this.act = A.None; return; }
    const x = this.node.position.x;
    if (Math.abs(p.Center.x - x) < this.Reach + 1.2) { this.facing = p.Center.x >= x ? 1 : -1; this.startCombo(true); }
    else { this.act = A.Guard; this.actT = 0.25; }
  }
  duelHurt() { this.leapWind = false; this.comboLeft = 0; if (this.act === A.Heal) this.healCd = 5; }
  scanKnives() {
    const me = this.node.position;
    for (const k of ThrownList) {
      if (this.judgedKnives.has(k)) continue;
      const kp = k.node.position, v = k.velocity;
      const dx = me.x - kp.x;
      if (Math.abs(v.x) < 1 || Mathf.sign(v.x) !== Mathf.sign(dx) || Math.abs(dx) > 5) continue;
      this.judgedKnives.add(k);
      const t = Math.abs(dx) / Math.abs(v.x);
      const y = kp.y + v.y * t;
      if (y < me.y - 0.2 || y > me.y + this.H + 0.2 || Random.value() > this.DodgeChance) continue;
      if ((dx < 0 ? 1 : -1) === this.facing && has(this.art.guard) && Random.value() < 0.5) {
        this.act = A.Guard; this.actT = 0.35; this.anim.play(this.art.guard, this.art.guard.length / 0.12, false);
        return true;
      }
      if (has(this.art.roll) && this.rollCd <= 0) {
        this.facing = dx >= 0 ? 1 : -1; this.rollEvasive = true; this.act = A.Roll; this.actT = 0.42; this.rollCd = Mathf.lerp(2.5, 1.2, this.Lv01);
        this.anim.play(this.art.roll, this.art.roll.length / 0.42, false);
        CombatAudio.play(CombatSound.Roll, this);
        return true;
      }
      if (this.grounded && this.jumpCd <= 0) {
        this.rb.velocity.y = Math.sqrt(19.62 * this.rb.gravityScale * 1.4);
        this.act = A.Jump; this.actT = 0.2; this.jumpCd = 1;
        return true;
      }
    }
    return false;
  }
  startLeap() {
    this.act = A.Leap; this.leapWind = true; this.actT = Mathf.lerp(0.5, 0.28, this.Lv01); this.leapCd = Mathf.lerp(5.5, 2.4, this.Lv01) / this.Rage;
    this.anim.play(or(this.art.guard, this.art.idle), 14, false);
  }
  leapTick(dx) {
    if (this.leapWind) {
      this.moveX = 0;
      if (!(this.actT > 0)) {
        this.leapWind = false;
        const g = 9.81 * this.rb.gravityScale, h = 2.3;
        const vy = Math.sqrt(2 * g * h), t = 2 * vy / g;
        const vx = Mathf.clamp(dx / t, -8.5, 8.5);
        this.rb.velocity = { x: vx, y: vy };
        this.moveX = vx; this.actT = 0.2;
        CombatAudio.play(CombatSound.Jump, this);
      }
      return;
    }
    this.moveX = this.rbv.x;
    if (!(this.actT <= 0) || !this.grounded) return;
    const me = this.node.position;
    FX.anim(GA.dust, me.x, me.y + 0.2, 24, 9, 1.1);
    if (this.IsBoss && !this.IsFinal) BossAttackVfx.groundImpact(this);
    else {
      const fx = this.strikeFx(2);
      if (has(fx)) FX.anim(fx, me.x + this.facing * 0.5, me.y + this.H * 0.4, this.FxFps, 8, 0.8, 0, this.facing < 0, col(1, 1, 1, 0.85));
    }
    CombatAudio.play(CombatSound.BladeSwing, this);
    CameraRig.shake(0.18, 0.15);
    this.touchKill(this.Reach * 2.2, this.H * 0.8, "CUT DOWN", 0);
    this.act = A.Recover; this.actT = Mathf.lerp(0.85, 0.45, this.Lv01);
    this.anim.play(this.art.idle, 8, true);
  }
  duelAnimate() {
    switch (this.act) {
      case A.Melee: case A.Throw: case A.Roll: case A.Parry: case A.Stagger: case A.Guard: case A.Heal: case A.Rest: case A.Taunt: return true;
      case A.Recover: this.anim.play(this.art.idle, 8, true, false); return true;
      case A.Leap: if (this.leapWind) return true; this.jumpPose(); return true;
      case A.Jump: this.jumpPose(); return true;
      default: {
        const s = Math.abs(this.rbv.x);
        if (s > 0.3) { this.anim.play(or(this.art.walk, this.art.idle), 9, true, false); this.anim.fps = 6 + s * 2.2; }
        else this.anim.play(this.art.idle, 8, true, false);
        return true;
      }
    }
  }
  jumpPose() {
    const c = or(this.art.platJump, this.art.jump);
    if (!has(c)) return;
    this.anim.frames = null;
    const y = this.rbv.y, n = c.length;
    this.visual.sprite = c[Mathf.clamp(y > 3 ? Math.floor(n / 4) : y > -1 ? Math.floor(n / 2) : Math.floor(n * 3 / 4), 0, n - 1)];
  }
  prepareFarewell() {
    this.restorePursuitCollision();
    this.Dead = true; this.hp = 0; this.act = A.None; this.moveX = 0;
    this.visual.color = col(1, 1, 1);
    if (this.alertIcon) this.alertIcon.enabled = false;
    this.rb.velocity = { x: 0, y: 0 };
  }
  farewellBlood() {
    const c = this.Chest, f = GA.RandomBlood();
    const sr = FX.makeSprite("Boss farewell blood burst", f[0], c.x, c.y, 10, true);
    sr.node.lsx = sr.node.lsy = 0.7;
    const a = new (this.anim.constructor)();
    a.unscaled = true; a.destroyOnEnd = true;
    sr.node.addComponent(a);
    a.play(f, 24, false);
  }
  finishFarewell() {
    this.visual.sortingOrder = 8;
    this.node.layer = LAYER.Corpse;
    this.body.size = { x: 0.5, y: 0.3 }; this.body.offset = { x: 0, y: 0.15 };
    this.rb.velocity = { x: 0, y: 0 };
    let cg = this.node.getComponent(CorpseGrounding);
    if (!cg) { cg = new CorpseGrounding(); this.node.addComponent(cg); }
    cg.configure(this.visual, this.anim, this.rb, this.body);
  }
  restorePursuitCollision() {
    if (this.pursuitIgnored && this.rb) this.rb.ignore(this.pursuitIgnored, false);
    this.pursuitIgnored = null;
  }
  maintainPursuitCollision() {
    if (!this.pursuitIgnored) return;
    this.pursuitIgnoreTime -= Time.fixedDeltaTime;
    if (this.Dead || this.pursuitIgnoreTime <= 0 || this.body.bounds.maxY < this.pursuitIgnored.bounds.maxY - 0.08) this.restorePursuitCollision();
  }
  // ---------------------------------------------------------------- platform pursuit (duelists)
  buildPursuitGraph() {
    this.pursuitLedges = [];
    const room = this.node.getComponentInParent("HypoFangs.Room");
    const me = this.node.position;
    const r = room ? room.bounds : { x: me.x - 18, y: me.y - 8, width: 36, height: 22 };
    const bw = this.body.bounds.ex * 2;
    for (const c of Physics.colliders) {
      if (!(c instanceof TilemapCollider) || !Physics.live(c) || c.node.layer !== LAYER.Ground) continue;
      const y0 = Math.floor(r.y - 2), y1 = Math.floor(r.y + r.height + 1), x0 = Math.floor(r.x), x1 = Math.floor(r.x + r.width);
      for (let j = y0; j <= y1; j++) {
        let start = null;
        for (let k = x0; k <= x1 + 1; k++) {
          const top = k <= x1 && c.hasCell(k, j) && !c.hasCell(k, j + 1);
          if (top && start === null) start = k;
          if (!top && start !== null) {
            if (k - start >= bw + 0.1) this.pursuitLedges.push({ left: start, right: k, y: j + 1, collider: c, oneWay: false });
            start = null;
          }
        }
      }
    }
    for (const c of Physics.colliders) {
      if (!(c instanceof Collider2D) || !Physics.live(c) || c.isTrigger || c.kind !== "box") continue;
      const ow = c.node.layer === LAYER.OneWay;
      if (!ow && c.node.layer !== LAYER.Ground) continue;
      const b = c.bounds;
      if (b.maxX <= r.x || b.minX >= r.x + r.width || b.maxY > r.y + r.height || b.maxY < r.y - 1 || b.ex * 2 < bw + 0.1) continue;
      this.pursuitLedges.push({ left: b.minX, right: b.maxX, y: b.maxY, collider: c, oneWay: ow });
    }
    const n = this.pursuitLedges.length;
    this.pursuitHops = [];
    for (let i = 0; i < n; i++) { this.pursuitHops.push([]); for (let j = 0; j < n; j++) this.pursuitHops[i].push(i !== j ? this.planHop(this.pursuitLedges[i], this.pursuitLedges[j]) : { valid: false }); }
    this.pursuitRefresh = Time.time + 2;
  }
  safeLeft(l) { return l.left + this.body.bounds.ex + 0.13; }
  safeRight(l) { return l.right - this.body.bounds.ex - 0.13; }
  planHop(a, b) {
    const dy = b.y - a.y, g = Math.abs(Physics.gravity * this.rb.gravityScale);
    if (dy > 5.5 || dy < -14 || g < 1) return { valid: false };
    const lo = Math.max(this.safeLeft(a), this.safeLeft(b)), hi = Math.min(this.safeRight(a), this.safeRight(b));
    if (a.oneWay && dy < -0.25 && lo <= hi) {
      const m = (lo + hi) * 0.5;
      return { valid: true, drop: true, launch: m, land: m, vx: 0, vy: -1.5, seconds: Math.sqrt(-2 * dy / g) };
    }
    let best = { valid: false }, bt = Infinity;
    const bb = this.body.bounds;
    const sz = { x: bb.ex * 2 - 0.06, y: bb.ey * 2 - 0.06 };
    for (const land of [(this.safeLeft(b) + this.safeRight(b)) * 0.5, this.safeLeft(b), this.safeRight(b), Mathf.clamp((a.left + a.right) * 0.5, this.safeLeft(b), this.safeRight(b))]) {
      let launch = Mathf.clamp(land, this.safeLeft(a), this.safeRight(a));
      if (dy < -0.25 && land > a.left && land < a.right) launch = Math.abs(land - a.left) < Math.abs(land - a.right) ? this.safeLeft(a) : this.safeRight(a);
      for (const extra of [0.8, 1.5, 2.3]) {
        const apex = Math.max(extra, dy + extra);
        if (apex > 6.5) continue;
        const vy = Math.sqrt(2 * g * apex);
        const t = (vy + Math.sqrt(vy * vy - 2 * g * dy)) / g;
        const vx = (land - launch) / t;
        if (Math.abs(vx) > 7) continue;
        let ok = true;
        for (let k = 1; k < 25; k++) {
          const tt = t * k / 25;
          if (overlapBox(launch + vx * tt, a.y + vy * tt - g * tt * tt * 0.5 + bb.ey + 0.045, sz.x, sz.y, LOS, { noTriggers: true })) { ok = false; break; }
        }
        const cost = t + Math.abs(launch - (a.left + a.right) * 0.5) / this.DuelWalk;
        if (ok && cost < bt) { bt = cost; best = { valid: true, drop: false, launch, land, vx, vy, seconds: t }; }
      }
    }
    return best;
  }
  supportAt(x, feet, airborne) {
    let r = -1, best = Infinity;
    this.pursuitLedges.forEach((l, i) => {
      if (x < l.left || x > l.right || l.y > feet + 0.25) return;
      const d = feet - l.y;
      if ((airborne || !(d > 0.4)) && !(d >= best)) { best = d; r = i; }
    });
    return r;
  }
  pursuePlatforms(player) {
    if (!this.IsBoss || !this.grounded || this.pursuitIgnored) return false;
    if (!this.pursuitHops || Time.time >= this.pursuitRefresh) this.buildPursuitGraph();
    const pb = player.body.bounds, mb = this.body.bounds;
    const from = this.supportAt(mb.cx, mb.minY, false), to = this.supportAt(pb.cx, pb.minY, true);
    if (from < 0 || to < 0 || from === to) return false;
    const n = this.pursuitLedges.length;
    const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    dist[from] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let k = 0; k < n; k++) if (!done[k] && (u < 0 || dist[k] < dist[u])) u = k;
      if (u < 0 || dist[u] === Infinity || u === to) break;
      done[u] = true;
      for (let v = 0; v < n; v++) {
        const h = this.pursuitHops[u][v];
        if (!h.valid) continue;
        const base = u === from ? this.node.position.x : (this.pursuitLedges[u].left + this.pursuitLedges[u].right) * 0.5;
        const c = dist[u] + h.seconds + Math.abs(h.launch - base) / this.DuelWalk;
        if (c < dist[v]) { dist[v] = c; prev[v] = u; }
      }
    }
    if (prev[to] < 0) return false;
    let step = to;
    while (prev[step] !== from) step = prev[step];
    const hop = this.pursuitHops[from][step];
    const d = hop.launch - mb.cx;
    if (Math.abs(d) > 0.12) {
      this.facing = d > 0 ? 1 : -1;
      this.moveX = this.facing * Math.min(this.DuelWalk, Math.abs(d) / Math.max(Time.deltaTime, 0.01));
      return true;
    }
    if (this.jumpCd > 0) return true;
    if (hop.drop) {
      this.pursuitIgnored = this.pursuitLedges[from].collider; this.pursuitIgnoreTime = 1.5;
      this.rb.ignore(this.pursuitIgnored, true);
      this.PursuitDrops++;
    } else { this.PursuitJumps++; CombatAudio.play(CombatSound.Jump, this); }
    this.pursuitLandX = hop.land; this.pursuitAirTime = hop.seconds; this.pursuitAirborne = true;
    this.moveX = hop.vx;
    this.rb.velocity = { x: hop.vx, y: hop.vy };
    if (Math.abs(hop.vx) > 0.1) this.facing = hop.vx > 0 ? 1 : -1;
    this.act = A.Jump; this.actT = 0.18; this.grounded = false; this.jumpCd = 0.35;
    return true;
  }
  pursuitFlight(dt) {
    if (!this.pursuitAirborne) { this.moveX = this.rbv.x; return; }
    this.pursuitAirTime -= dt;
    this.moveX = Mathf.clamp((this.pursuitLandX - this.body.bounds.cx) / Math.max(0.07, this.pursuitAirTime), -7, 7);
    if (this.actT <= 0 && this.grounded) { this.pursuitAirborne = false; this.moveX = 0; }
  }
  queueFireSequence(shoot) {
    this.fanPending = false;
    if (this.IsBoss) { this.pattern = (this.pattern + 1) % 3; this.fanPending = this.pattern === 0; }
    this.burstLeft = this.fanPending ? 1 : this.IsBoss ? 4 + Math.floor(this.bossLevel / 2) : this.kind !== Kind.Burst ? 1 : this.difficulty > 0.6 ? 4 : 3;
    this.firingClip = shoot; this.firingFrame = this.GunReleaseFrame; this.firePending = true; this.burstT = 0;
    this.actT = Math.max(this.actT, this.firingFrame / 16 + this.burstLeft * 0.1 + 0.15);
  }
  tickFireSequence(p, dt) {
    if (!this.firePending && this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        const c = or(this.art.shoot, this.art.idle);
        if (this.recoilSource !== c) { this.recoilSource = c; const k = Mathf.clamp(this.GunReleaseFrame, 0, c.length - 1); this.recoilClip = c.slice(k); }
        this.firingClip = this.recoilClip; this.firingFrame = 0; this.firePending = true;
        this.anim.play(this.firingClip, 16, false);
      }
    }
    if (this.actT <= 0 && this.burstLeft <= 0 && !this.firePending) {
      this.act = A.None;
      const k = this.kind;
      const c = k === Kind.Marksman ? 1.5 : k === Kind.Burst ? 1.3 : k === Kind.Shield ? 1.4 : 0.95;
      this.cooldown = c * this.Dm(1.2, 0.7) / this.Rage * (this.IsBoss ? 0.9 : 1);
    }
  }
  tickProjectileFrames() {
    if (this.Dead || G.paused || G.frozen || (G.level && G.level.cinematicPlaying)) return;
    const p = G.level ? G.level.player : null;
    if (!p || p.Dead) return;
    if (this.act === A.Throw && !this.meleeDone && this.anim.frames === this.art.throwing && this.anim.Frame >= this.ThrowReleaseFrame) {
      this.meleeDone = true;
      if (this.kind === Kind.Duelist && (this.art.id === "ronin" || this.art.id === "jotem")) this.swordWave();
      else this.throwVolley(p);
    }
    if (this.act === A.Fire && this.firePending && this.anim.frames === this.firingClip && this.anim.Frame >= this.firingFrame) {
      this.firePending = false; this.burstLeft--;
      if (this.fanPending) { this.fanPending = false; this.fan(p, 3 + Math.floor(this.bossLevel / 2) + (this.Rage > 1.25 ? 2 : 0), 46); }
      else this.shootOnce(p, this.kind === Kind.Marksman ? 0 : this.kind === Kind.Burst ? 4 : 1.5);
      this.burstT = this.IsBoss ? 0.09 : 0.1;
    }
  }
}
Enemy.typeName = "HypoFangs.Enemy";
registerScript(Enemy);

// ---------------------------------------------------------------- BossAttackVfx
const PALETTE = { 1: col(1, 45 / 255, 38 / 255), 2: col(115 / 255, 35 / 255, 1), 3: col(1, 112 / 255, 32 / 255) };
export function bossPalette(e) { return PALETTE[e.bossLevel] || col(40 / 255, 160 / 255, 1); }

export class BossAttackVfx extends Component {
  constructor() { super(); this.Visible = false; this.SourceFrame = -1; }
  begin(actor, frames, motion) {
    this.owner = actor; this.source = frames; this.motion = motion;
    if (!this.arc) {
      const p = this.node.position;
      this.arc = FX.makeSprite("Attack motion - arc", null, p.x, p.y, 10, true, this.node);
      this.outer = this.line(10); this.core = this.line(11);
    }
    this.hide();
  }
  line(order) {
    const n = newNode("Attack motion - line", this.node);
    const q = new QuadRenderer(); q.sortingOrder = order; q.lit = this.owner.visual.lit; q.enabled = false;
    n.addComponent(q);
    return q;
  }
  lateUpdate() {
    if (G.paused) return;
    const o = this.owner;
    if (!o || o.Dead || !o.isActiveAndEnabled || o.anim.frames !== this.source || o.anim.Finished) { this.hide(); return; }
    this.SourceFrame = o.anim.Frame;
    const pose = this.motion.poses.find((p) => p.frame === this.SourceFrame);
    if (!pose) { this.hide(); return; }
    const s = this.source[this.SourceFrame];
    let lx = (pose.x - s.px * s.w) / s.ppu, ly = (s.h - pose.y - s.py * s.h) / s.ppu;
    const f = o.Facing;
    lx *= f;
    const pt = o.visual.node.transformPoint(lx, ly);
    const sc = Math.abs(o.node.lossyScale.x);
    const alpha = 0.95 * Mathf.lerp(1, 0.45, o.anim.FrameProgress);
    if (this.motion.straight) {
      this.arc.enabled = false;
      const a = pose.angle * f * Mathf.RAD;
      const dir = { x: Math.cos(a) * f, y: Math.sin(a) * f };
      this.drawLine(this.outer, pt, dir, pose.width * sc, pose.height * sc, bossPalette(o), alpha);
      this.drawLine(this.core, pt, dir, pose.width * sc * 0.85, pose.height * sc * 0.28, col(1, 1, 1), alpha * 0.9);
    } else {
      this.outer.enabled = this.core.enabled = false;
      const arr = this.motion.slash === 0 ? o.slashFx : this.motion.slash === 1 ? o.slashFx2 : o.slashFx3;
      if (!has(arr)) { this.hide(); return; }
      const i = Math.min(arr.length - 1, pose.fxFrame + Math.floor(o.anim.FrameProgress * 2));
      this.arc.sprite = arr[i];
      this.arc.flipX = f < 0; this.arc.flipY = pose.height < 0;
      this.arc.node.setPosition(pt.x, pt.y);
      this.arc.node.setRotation(pose.angle * f);
      this.arc.node.lsx = pose.width; this.arc.node.lsy = Math.abs(pose.height);
      this.arc.color = col(1, 1, 1, alpha);
      this.arc.enabled = true;
    }
    this.Visible = true;
  }
  drawLine(q, p, d, len, width, c, alpha) {
    const a = { x: p.x - d.x * len * 0.55, y: p.y - d.y * len * 0.55 }, b = { x: p.x + d.x * len * 0.45, y: p.y + d.y * len * 0.45 };
    const nx = -d.y * width / 2, ny = d.x * width / 2;
    q.pts = [a.x, a.y, p.x + nx, p.y + ny, p.x - nx, p.y - ny, b.x, b.y];
    q.color = { r: c.r, g: c.g, b: c.b, a: alpha };
    q.enabled = true;
  }
  hide() { if (this.arc) this.arc.enabled = false; if (this.outer) this.outer.enabled = false; if (this.core) this.core.enabled = false; this.Visible = false; }
  onDisable() { this.hide(); }
  static groundImpact(actor) {
    const p = actor.node.position;
    const n = newNode("Boss landing impact", null, p.x, p.y + 0.08);
    const q = new QuadRenderer(); q.sortingOrder = 10;
    const r = actor.AttackReach, w = 0.05;
    q.pts = [p.x - r, p.y + 0.08, p.x, p.y + 0.08 + w, p.x, p.y + 0.08 - w, p.x + r, p.y + 0.08];
    q.color = bossPalette(actor);
    n.addComponent(q);
    q.life = 0.16;
  }
}
BossAttackVfx.order = 200;
