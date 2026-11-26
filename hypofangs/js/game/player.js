// PlayerController (StrawHat / Zenji) ported from PlayerController.cs.
import { Component, Time, Mathf, Random } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { registerScript, SpriteRenderer } from "../engine/scene.js";
import { Rigidbody2D, boxCast, boxCastAll, raycast, overlapCircleAll, mask, LAYER } from "../engine/physics.js";
import { G, GA, FX, Afterimage, CombatAudio, CombatSound, CombatRole, Haptics, TimeFX, CameraRig, GameplayInputGate, col } from "./common.js";
import { CorpseGrounding } from "./surfaces.js";
import { WallGlideSparkVfx } from "./wallglide.js";
import { DaggerReloadProgress } from "./progress.js";

const GROUND_MASK = mask("Ground", "OneWay");
const SOLID_MASK = mask("Ground");
const ONEWAY_MASK = mask("OneWay");

export const Keys = {
  left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  jump: ["Space", "KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"],
  roll: ["KeyC"], pick: ["KeyE", "Mouse2"], dagger: ["KeyF", "KeyK", "Mouse1"], knife: ["KeyQ", "KeyL"], katana: ["KeyJ", "Mouse0"],
};

export class PlayerController extends Component {
  constructor() {
    super();
    Object.assign(this, {
      runSpeed: 8.5, groundAccel: 120, groundDecel: 100, airAccel: 70, jumpHeight: 3.6, gravity: 48, fallGravityMul: 1.25, maxFall: 24, jumpCut: 0.45,
      coyoteTime: 0.1, jumpBuffer: 0.12, wallSlideSpeed: 3.5, wallKickX: 9.5, wallKickY: 15.5, wallClimbX: 3.2, wallClimbY: 15, rollSpeed: 12.5, rollTime: 0.3,
      rollCooldown: 0.3, slashCooldown: 0.34, slashReach: 0.95, slashRadius: 1.05, groundLunge: 9, airLunge: 11, throwSpeed: 32, maxKnives: 3, knifeRecharge: 3.5,
      knifeSpeed: 30, heroCrouchHold: 0.35, heroRiseFps: 10,
    });
    this.deathX = 0; this.parryPlantT = 0; this.daggerInSwing = false; this.daggerCyclePending = false; this.daggerCycleId = 0; this.daggerCycleClip = null;
    this.daggerCycleTarget = null; this.daggerChainTarget = null; this.pendingSwing = null; this.pendingSwingFrame = 0; this.swingSoundPending = false;
    this.bladeWindowPending = false; this.knifeReleasePending = false; this.pickupReleasePending = false; this.pendingThrowClip = null; this.pendingItem = null;
    this.slashActiveT = 0; this.curReach = 0.95; this.curRadius = 1.05; this.stabSide = 0; this.knifeT = 0; this.slashSeen = new Set();
    this.vel = { x: 0, y: 0 }; this.grounded = false; this.wasGrounded = false; this.jumpedThisAir = false; this.wallSliding = false; this.wallDir = 0;
    this.wallGlideFrames = null; this.wallGlideSource = null; this.wallGlideOpeningSource = null;
    this.jumpGrace = 0; this.coyoteT = 0; this.bufferT = 0; this.lockT = 0; this.rollT = 0; this.rollCdT = 0; this.slashCdT = 0; this.attackT = 0; this.throwT = 0;
    this.landT = 0; this.lungeT = 0; this.afterT = 0; this.stepT = 0; this.dropT = 0; this.airSlashUsed = false; this.groundCol = null; this.ignoredPlatform = null; this.fallPeak = 0;
    this.moveX = 0; this.jumpHeld = false; this.downHeld = false;
    this.qJump = this.qRoll = this.qSlash = this.qStab = this.qKnife = this.qThrow = this.qDown = false;
    this.pJump = this.pDown = this.pRoll = this.pSlash = this.pStab = this.pKnife = this.pThrow = false;
    this.heroLandT = 0; this.Facing = 1; this.Dead = false; this.Held = null; this.Knives = 3; this.SlashDir = { x: 1, y: 0 }; this.IntroDropping = false;
    this.ghost = false; this.wallGlideSparkVfx = null;
  }
  init(d) {
    for (const k in d) if (typeof d[k] === "number") this[k] = d[k];
    this.visual = d.visual; this.anim = d.anim; this.body = d.body;
  }
  get Grounded() { return this.grounded; }
  get Invulnerable() { return this.rollT > 0; }
  get SlashActive() { return this.slashActiveT > 0 && !this.Dead; }
  get KatanaDeflectActive() { return this.SlashActive && !this.daggerInSwing && !GameplayInputGate.Locked; }
  get SlashCenter() { const c = this.Center; return { x: c.x + this.SlashDir.x * this.curReach, y: c.y + this.SlashDir.y * this.curReach }; }
  get SlashRadius() { return this.curRadius; }
  get DaggerCyclePlaying() { return this.daggerCyclePending; }
  get KnifeReloadSeconds() { return DaggerReloadProgress.reloadSeconds(this.knifeRecharge); }
  get SlashReady() { return this.slashCdT <= 0 && this.rollT <= 0 && !this.Dead; }
  get RollReady() { return this.grounded && this.rollCdT <= 0 && this.rollT <= 0 && this.attackT <= 0.1 && !this.Dead; }
  get Rolling() { return this.rollT > 0; }
  get Busy() { return this.attackT > 0 || this.throwT > 0; }
  get Velocity() { return this.vel; }
  get Ghost() { return this.ghost; }
  set Ghost(v) { this.ghost = v; if (this.visual) this.visual.enabled = !v; }
  get IntroActive() { return this.IntroDropping || this.heroLandT > 0; }
  get HeroLandDuration() { const n = GA.playerLand ? GA.playerLand.length : 5; return this.heroCrouchHold + Math.max(1, n - 1) / Math.max(1, this.heroRiseFps); }
  get Center() { if (!this.body) { const p = this.node.position; return { x: p.x, y: p.y + 0.5 }; } const b = this.body.bounds; return { x: b.cx, y: b.cy }; }

  cancelDaggerChain() {
    if (this.daggerChainTarget) this.daggerChainTarget.resetChain();
    this.daggerCyclePending = false;
    this.daggerCycleTarget = this.daggerChainTarget = null;
  }
  finishDaggerCycle() {
    if (!this.daggerCyclePending) return;
    if (this.anim.frames !== this.daggerCycleClip) this.cancelDaggerChain();
    else if (this.anim.Finished) {
      this.daggerCyclePending = false;
      if (this.daggerCycleTarget) this.daggerCycleTarget.complete(this, this.daggerCycleId);
      else if (this.daggerChainTarget) { this.daggerChainTarget.resetChain(); this.daggerChainTarget = null; }
      this.daggerCycleTarget = null;
    }
  }
  awake() {
    this.rb = this.node.getComponent(Rigidbody2D);
    this.rb.gravityScale = 0;
    this.rb.interpolate = true;
    this.node._rb = this.rb;
  }
  readInput() {
    if (GameplayInputGate.Locked) { this.stopForDialogue(); return; }
    this.moveX = 0;
    const H = (k) => Input.held(...Keys[k]), P = (k) => Input.hit(...Keys[k]);
    if (H("left")) this.moveX -= 1;
    if (H("right")) this.moveX += 1;
    let f = H("jump"), f2 = H("down"), f3 = H("roll"), f4 = H("katana"), f5 = H("dagger"), f6 = H("knife"), f7 = H("pick");
    const bot = PlayerController.Bot;
    if (bot) { this.moveX = bot.moveX; f = bot.jump; f2 = bot.down; f3 = bot.roll; f4 = bot.slash; f5 = bot.stab; f6 = bot.knife; f7 = false; }
    this.moveX = Mathf.clamp(this.moveX, -1, 1);
    this.jumpHeld = f; this.downHeld = f2;
    const edge = (now, key) => { const r = now && !this[key]; this[key] = now; return r; };
    this.qJump ||= edge(f, "pJump") || P("jump");
    this.qDown ||= edge(f2, "pDown") || P("down");
    this.qRoll ||= edge(f3, "pRoll") || P("roll");
    this.qSlash ||= edge(f4, "pSlash") || P("katana");
    this.qThrow ||= edge(f7, "pThrow") || P("pick");
    this.qStab ||= edge(f5, "pStab") || P("dagger");
    this.qKnife ||= edge(f6, "pKnife") || P("knife");
  }
  teleport(x, y, face) {
    this.node.setPosition(x, y);
    this.vel = { x: 0, y: 0 }; this.rb.velocity = { x: 0, y: 0 };
    this.rb.prevX = x; this.rb.prevY = y;
    this.Facing = face >= 0 ? 1 : -1;
  }
  beginIntroDrop(x, y, face) {
    this.teleport(x, y, face);
    this.cancelDaggerChain();
    this.rollT = this.lungeT = this.attackT = this.throwT = this.landT = this.slashActiveT = 0;
    this.bufferT = 0; this.grounded = this.wasGrounded = false; this.fallPeak = 0; this.heroLandT = 0; this.IntroDropping = true;
    this.visual.flipX = this.Facing < 0;
    if (GA.playerJump && GA.playerJump.length) { this.anim.frames = null; this.visual.sprite = GA.playerJump[GA.playerJump.length - 1]; }
  }
  endIntro() { this.IntroDropping = false; this.heroLandT = 0; }
  heroLanding() {
    this.IntroDropping = false; this.heroLandT = this.HeroLandDuration; this.vel.x = 0;
    const p = this.node.position, y = p.y + 0.2;
    FX.anim(GA.dust, p.x, y, 22, 9);
    FX.anim(GA.dust, p.x - 0.45, y, 20, 9, 0.7);
    FX.anim(GA.dust, p.x + 0.45, y, 20, 9, 0.7);
    CameraRig.shake(0.22, 0.25);
  }
  consumePreviewConfirm() {
    this.qJump = false; this.bufferT = 0;
    this.pJump = Input.held(...Keys.jump);
  }
  stopForDialogue() {
    this.cancelDaggerChain();
    this.moveX = 0; this.jumpHeld = this.downHeld = false;
    this.qJump = this.qRoll = this.qSlash = this.qStab = this.qKnife = this.qThrow = this.qDown = false;
    this.bufferT = this.rollT = this.lungeT = this.slashActiveT = this.attackT = this.throwT = this.lockT = 0;
    this.swingSoundPending = this.bladeWindowPending = this.knifeReleasePending = this.pickupReleasePending = false;
    this.vel = { x: 0, y: 0 }; this.rb.velocity = { x: 0, y: 0 };
  }
  update() {
    if (this.Dead || G.paused) return;
    if (G.tutorialActive) { this.discardTutorialInput(); return; }
    if (this.parryPlantT > 0) { this.discardTutorialInput(); this.parryPlantT -= Time.deltaTime; this.animate(); return; }
    if (GameplayInputGate.Locked) { this.stopForDialogue(); return; }
    if (!G.inputLocked && !this.IntroActive) this.readInput();
    else { this.moveX = 0; this.jumpHeld = false; }
    if (this.qJump) this.bufferT = this.jumpBuffer;
    if (this.qSlash) this.trySlash(false);
    else if (this.qStab) this.trySlash(true);
    if (this.qKnife) this.tryKnife();
    if (this.qThrow) this.tryThrow();
    if (this.qRoll || (this.qDown && Math.abs(this.moveX) > 0.1)) this.tryRoll();
    if (this.qDown && Math.abs(this.moveX) < 0.1) this.tryDrop();
    this.qJump = this.qRoll = this.qSlash = this.qStab = this.qKnife = this.qThrow = this.qDown = false;
    if (this.Knives < this.maxKnives) {
      this.knifeT -= Time.deltaTime;
      if (this.knifeT <= 0) { this.Knives++; this.knifeT = this.KnifeReloadSeconds; }
    }
    const dt = Time.deltaTime;
    if (this.slashActiveT > 0) { this.slashActiveT -= dt; this.sweepSlash(); }
    this.bufferT -= dt; this.slashCdT -= dt; this.rollCdT -= dt; this.attackT -= dt; this.throwT -= dt; this.landT -= dt; this.afterT -= dt;
    if (this.heroLandT > 0) this.heroLandT -= dt;
    if (this.dropT > 0) {
      this.dropT -= dt;
      if (this.dropT <= 0 && this.ignoredPlatform) { this.rb.ignore(this.ignoredPlatform, false); this.ignoredPlatform = null; }
    }
    if ((this.rollT > 0 || this.lungeT > 0) && this.afterT <= 0) {
      this.afterT = 0.035;
      Afterimage.spawn(this.visual, this.rollT > 0 ? col(0.3, 0.9, 1, 0.55) : col(1, 0.3, 0.8, 0.55));
    }
    this.animate();
  }
  fixedUpdate() {
    const dt = Time.fixedDeltaTime;
    this.vel = { ...this.rb.velocity };
    this.probeGround();
    this.probeWall();
    if (this.Dead) {
      this.vel.y = Math.max(this.vel.y - this.gravity * dt, -this.maxFall);
      this.vel.x = 0;
      if (this.grounded) this.vel.y = Math.min(this.vel.y, 0);
      this.rb.velocity = { ...this.vel };
      return;
    }
    if (GameplayInputGate.Locked) { this.rb.velocity = { x: 0, y: 0 }; return; }
    if (this.parryPlantT > 0) {
      this.rb.velocity = { x: 0, y: this.grounded ? Math.min(this.vel.y, 0) : Math.max(this.vel.y - this.gravity * dt, -this.maxFall) };
      return;
    }
    if (this.grounded) { this.coyoteT = this.coyoteTime; this.airSlashUsed = false; this.jumpedThisAir = false; }
    else this.coyoteT -= dt;
    this.lockT -= dt; this.lungeT -= dt; this.jumpGrace -= dt;
    if (this.grounded && !this.wasGrounded) {
      const p = this.node.position;
      if (this.IntroDropping) this.heroLanding();
      else if (this.fallPeak < -10) {
        this.landT = 0.18;
        FX.anim(GA.dust, p.x, p.y + 0.2, 22, 9, 0.6);
        Haptics.land(true);
      }
      CombatAudio.play(CombatSound.Land, CombatRole.Zenji);
      this.fallPeak = 0;
    }
    if (!this.grounded) this.fallPeak = Math.min(this.fallPeak, this.vel.y);
    this.wasGrounded = this.grounded;
    if (this.rollT > 0) {
      this.rollT -= dt;
      const t = this.rollT / this.rollTime;
      this.vel.x = this.Facing * this.rollSpeed * Mathf.lerp(0.55, 1, t);
    } else if (!(this.lungeT > 0)) {
      if (this.lockT > 0) this.vel.x = Mathf.moveTowards(this.vel.x, this.moveX * this.runSpeed, this.airAccel * 0.35 * dt);
      else {
        const target = this.moveX * this.runSpeed;
        let acc = !this.grounded ? this.airAccel : Math.abs(target) > 0.01 ? this.groundAccel : this.groundDecel;
        if (Math.abs(this.vel.x) > this.runSpeed && Mathf.sign(this.vel.x) === Mathf.sign(target) && !this.grounded) acc *= 0.3;
        this.vel.x = Mathf.moveTowards(this.vel.x, target, acc * dt);
        if (Math.abs(this.moveX) > 0.1 && this.attackT <= 0) this.Facing = this.moveX > 0 ? 1 : -1;
      }
    }
    if (this.bufferT > 0 && this.rollT <= 0) {
      if (this.grounded || this.coyoteT > 0) {
        this.vel.y = Math.sqrt(2 * this.gravity * this.jumpHeight);
        this.bufferT = 0; this.coyoteT = 0; this.grounded = false; this.jumpedThisAir = true; this.jumpGrace = 0.08;
        CombatAudio.play(CombatSound.Jump, CombatRole.Zenji);
        const p = this.node.position;
        FX.anim(GA.dust, p.x, p.y + 0.2, 24, 9, 0.5);
      } else if (this.wallDir !== 0) {
        const climb = Math.abs(this.moveX) > 0.1 && Mathf.sign(this.moveX) === this.wallDir;
        this.vel = { x: -this.wallDir * (climb ? this.wallClimbX : this.wallKickX), y: climb ? this.wallClimbY : this.wallKickY };
        this.lockT = climb ? 0.07 : 0.16;
        this.Facing = -this.wallDir;
        this.bufferT = 0; this.airSlashUsed = false; this.jumpedThisAir = true;
        CombatAudio.play(CombatSound.Jump, CombatRole.Zenji);
        const c = this.Center;
        FX.anim(GA.dust, c.x + this.wallDir * 0.3, c.y - 0.2, 24, 9, 0.45, this.wallDir * 90);
      }
    }
    if (!this.jumpHeld && this.vel.y > 0 && this.jumpedThisAir && this.lungeT <= 0) { this.vel.y *= this.jumpCut; this.jumpedThisAir = false; }
    this.wallSliding = false;
    if (!this.grounded) {
      let g = this.gravity * (this.vel.y < 0 ? this.fallGravityMul : 1);
      if (this.lungeT > 0) g *= 0.35;
      this.vel.y = Math.max(this.vel.y - g * dt, -this.maxFall);
      if (this.wallDir !== 0 && Math.abs(this.moveX) > 0.1 && Mathf.sign(this.moveX) === this.wallDir && this.vel.y < -this.wallSlideSpeed) {
        this.vel.y = -this.wallSlideSpeed; this.wallSliding = true;
      }
    } else if (this.vel.y < 0) this.vel.y = -0.5;
    this.bumpProps();
    if (this.vel.y < 0) this.landOnOneWay(dt);
    this.keepInsideRoom(dt);
    this.rb.velocity = { ...this.vel };
  }
  keepInsideRoom(dt) {
    const lm = G.level;
    if (!lm || lm.player !== this || !this.body) return;
    const r = lm.CurrentRoomBounds;
    const b = this.body.bounds;
    if (r.width <= b.ex * 2) return;
    const p = this.node.position;
    const off = b.cx - p.x;
    const lo = r.x + b.ex - off + 0.02, hi = r.x + r.width - b.ex - off - 0.02;
    const x = Mathf.clamp(p.x, lo, hi);
    if (x !== p.x) this.node.setPosition(x, p.y);
    this.vel.x = Mathf.clamp(this.vel.x, (lo - x) / dt, (hi - x) / dt);
  }
  landOnOneWay(dt) {
    const b = this.body.bounds;
    const y = b.minY;
    const dist = -this.vel.y * dt + 0.04;
    const hits = boxCastAll(b.cx, y + 0.02, b.ex * 2 * 0.8, 0.02, 0, -1, dist, ONEWAY_MASK);
    for (const h of hits) {
      if (h.collider === this.ignoredPlatform) continue;
      const top = h.collider.bounds.maxY;
      if (!(y < top - 0.06)) {
        const p = this.node.position;
        this.node.setPosition(p.x, p.y + (top - y));
        this.vel.y = 0;
        break;
      }
    }
  }
  lateUpdate() {
    this.tickCombatFrames();
    if (G.paused) return;
    const arr = GA.wallGlideSparks;
    let ok = this.wallSliding && !this.grounded && !this.Dead && !this.ghost && !this.Busy && !this.Rolling && this.rb.velocity.y < -0.1 && this.wallDir !== 0 &&
      this.wallGlideFrames && this.anim.frames === this.wallGlideFrames && arr && arr.length;
    let hit = null;
    if (ok) {
      const n = Mathf.clamp(this.anim.Frame, 0, 4);
      const yy = n < 2 ? 33 / 64 : n === 3 ? 37 / 64 : n === 2 ? 31 / 64 : 17 / 32;
      const wp = this.visual.node.transformPoint(0, yy);
      const b = this.body.bounds;
      hit = raycast(b.cx, wp.y, this.wallDir, 0, b.ex + 0.15, SOLID_MASK, { noTriggers: true });
      ok = hit && Math.abs(hit.normal.x) > 0.8 && hit.normal.x * this.wallDir < 0 && !hit.collider.node.getComponent("HypoFangs.Door") && !hit.collider.node.getComponent("HypoFangs.Glass");
    }
    if (!ok) { if (this.wallGlideSparkVfx) this.wallGlideSparkVfx.stop(); return; }
    if (!this.wallGlideSparkVfx) {
      const n = FX.makeSprite("WallGlideSparks", null, 0, 0, 0, true, this.node).node;
      this.wallGlideSparkVfx = new WallGlideSparkVfx();
      n.addComponent(this.wallGlideSparkVfx);
      this.wallGlideSparkVfx.initialize(this.visual);
    }
    this.wallGlideSparkVfx.scrape(arr, hit.point, hit.normal);
  }
  onDisable() { if (this.wallGlideSparkVfx) this.wallGlideSparkVfx.stop(); }
  probeGround() {
    const b = this.body.bounds;
    const h = boxCast(b.cx, b.minY + 0.1, b.ex * 2 * 0.85, 0.05, 0, -1, 0.14, GROUND_MASK, { noTriggers: true, skip: (c) => c === this.ignoredPlatform });
    const oneWay = h && h.collider.layer === LAYER.OneWay && (h.distance <= 0 || b.minY < h.collider.bounds.maxY - 0.08);
    this.grounded = !!h && h.distance > 0.0001 && !oneWay && this.vel.y <= 1.5 && h.normal.y > 0.6 && h.collider !== this.ignoredPlatform && this.jumpGrace <= 0;
    this.groundCol = this.grounded ? h.collider : null;
  }
  probeWall() {
    this.wallDir = 0;
    if (this.grounded || PlayerController.NoWalls) return;
    const b = this.body.bounds;
    for (let i = -1; i <= 1; i += 2) {
      const h = boxCast(b.cx, b.cy, 0.05, b.ey * 2 * 0.5, i, 0, b.ex + 0.08, SOLID_MASK, { noTriggers: true });
      if (h && Math.abs(h.normal.x) > 0.8 && !h.collider.node.getComponent("HypoFangs.Door") && !h.collider.node.getComponent("HypoFangs.Glass")) { this.wallDir = i; break; }
    }
  }
  bumpProps() {
    const dir = Math.abs(this.vel.x) > 0.5 ? Mathf.sign(this.vel.x) : Math.abs(this.moveX) > 0.1 ? Mathf.sign(this.moveX) : 0;
    if (dir === 0) return;
    const b = this.body.bounds;
    const hits = boxCastAll(b.cx, b.cy, 0.05, b.ey * 2 * 0.8, dir, 0, b.ex + 0.15 + Math.abs(this.vel.x) * Time.fixedDeltaTime, SOLID_MASK, { noTriggers: true });
    for (const h of hits) {
      const door = h.collider.node.getComponentInParent("HypoFangs.Door");
      if (door && !door.Open) { door.kick(dir); continue; }
      const glass = h.collider.node.getComponentInParent("HypoFangs.Glass");
      if (glass && (this.rollT > 0 || Math.abs(this.vel.x) > this.runSpeed * 0.8)) glass.shatter({ x: dir, y: 0.1 });
    }
  }
  tryRoll() {
    if (GameplayInputGate.Locked || !this.grounded || this.rollCdT > 0 || this.rollT > 0 || this.attackT > 0.1) return;
    if (Math.abs(this.moveX) > 0.1) this.Facing = this.moveX > 0 ? 1 : -1;
    this.cancelDaggerChain();
    this.rollT = this.rollTime; this.rollCdT = this.rollTime + this.rollCooldown;
    CombatAudio.play(CombatSound.Roll, CombatRole.Zenji);
    Haptics.roll();
    const p = this.node.position;
    FX.anim(GA.puff, p.x - this.Facing * 0.4, p.y + 0.3, 24, 9, 0.5, 0, this.Facing < 0);
  }
  tryDrop() {
    if (GameplayInputGate.Locked || !this.grounded || !this.groundCol || this.groundCol.layer !== LAYER.OneWay) return;
    this.ignoredPlatform = this.groundCol;
    this.rb.ignore(this.groundCol, true);
    this.dropT = 0.3; this.grounded = false;
    this.vel = { ...this.rb.velocity }; this.vel.y = -2; this.rb.velocity = { ...this.vel };
  }
  trySlash(dagger) {
    if (GameplayInputGate.Locked) return;
    this.finishDaggerCycle();
    if (this.slashCdT > 0 || this.rollT > 0 || (dagger && (this.daggerCyclePending || this.attackT > 0))) return;
    if (!dagger) this.cancelDaggerChain();
    let arr = GA.playerAttack;
    if (dagger) {
      arr = this.stabSide === 0 ? GA.playerStab1 : GA.playerStab2;
      this.stabSide = 1 - this.stabSide;
      if (!arr || !arr.length) { arr = GA.playerAttack; dagger = false; }
    }
    const katana = !dagger;
    const fps = katana ? 32 : 26;
    this.slashCdT = katana ? this.slashCooldown : 0.2;
    this.attackT = arr.length / fps;
    this.curReach = katana ? this.slashReach : this.slashReach * 1.05;
    this.curRadius = katana ? this.slashRadius : this.slashRadius * 0.8;
    const v = { x: this.Facing, y: 0 };
    this.anim.play(arr, fps, false);
    if (dagger) { this.daggerCyclePending = true; this.daggerCycleClip = arr; this.daggerCycleId++; this.daggerCycleTarget = null; }
    const k = katana ? 1 : 0.6;
    let lv = { ...this.rb.velocity };
    if (this.grounded) lv = { x: v.x * this.groundLunge * k, y: 0 };
    else if (!this.airSlashUsed) { lv = { x: v.x * this.airLunge * k, y: v.y * this.airLunge * k }; this.airSlashUsed = true; }
    else lv = { x: lv.x + v.x * 2.5, y: lv.y + v.y * 2.5 };
    this.rb.velocity = { ...lv }; this.vel = { ...lv };
    this.lungeT = katana ? 0.12 : 0.08;
    this.SlashDir = v;
    this.slashSeen.clear();
    this.daggerInSwing = dagger;
    this.pendingSwing = arr; this.pendingSwingFrame = katana ? 1 : 0;
    this.swingSoundPending = this.bladeWindowPending = true;
    this.slashActiveT = 0;
    this.tickCombatFrames();
    CameraRig.shake(0.04, 0.05);
  }
  sweepSlash() {
    let hitAny = false;
    const c = this.SlashCenter;
    const cols = overlapCircleAll(c.x, c.y, this.curRadius);
    for (const cl of cols) {
      const h = hittableOf(cl.node);
      if (!h || this.slashSeen.has(h)) continue;
      this.slashSeen.add(h);
      const dbp = cl.node.getComponentInParent("DaggerBreakProgress");
      if (this.daggerInSwing && dbp) {
        if (this.daggerCycleTarget && this.daggerCycleTarget !== dbp) continue;
        if (this.daggerChainTarget !== dbp) { if (this.daggerChainTarget) this.daggerChainTarget.resetChain(); this.daggerChainTarget = dbp; }
        if (dbp.contact(this, this.daggerCycleId, this.SlashDir)) {
          this.daggerCycleTarget = dbp; hitAny = true;
          CombatAudio.play(CombatSound.DaggerImpact, CombatRole.Zenji);
        }
      } else {
        const isEnemy = h.constructor.typeName === "HypoFangs.Enemy";
        const hp = isEnemy ? h.Hp : -1;
        const r = h.onHit(this.SlashDir, false);
        hitAny = hitAny || r;
        if (r && isEnemy && h.Hp < hp) CombatAudio.play(this.daggerInSwing ? CombatSound.DaggerImpact : CombatSound.BladeImpact, CombatRole.Zenji);
      }
    }
    if (hitAny) { TimeFX.hitStop(0.06); CameraRig.shake(0.18, 0.12); Haptics.pulse(0.4, 0.65, 0.11); }
    return hitAny;
  }
  discardTutorialInput() {
    this.moveX = 0; this.jumpHeld = this.downHeld = false; this.bufferT = 0;
    this.qJump = this.qRoll = this.qSlash = this.qStab = this.qKnife = this.qThrow = this.qDown = false;
    this.pJump = Input.held(...Keys.jump); this.pDown = Input.held(...Keys.down); this.pRoll = Input.held(...Keys.roll);
    this.pSlash = Input.held(...Keys.katana); this.pStab = Input.held(...Keys.dagger); this.pKnife = Input.held(...Keys.knife); this.pThrow = Input.held(...Keys.pick);
  }
  plantAfterParry() {
    if (this.Dead) return;
    this.stopForDialogue();
    this.parryPlantT = 0.16;
    this.anim.play(GA.playerIdle, 8, true);
    this.consumePreviewConfirm();
  }
  knockback(v) {
    if (this.Dead) return;
    this.rollT = 0; this.lungeT = 0; this.slashActiveT = 0;
    this.vel = { ...v }; this.rb.velocity = { ...v };
    this.lockT = 0.25; this.grounded = false; this.jumpGrace = 0.06;
    this.Facing = !(v.x > 0) ? 1 : -1;
  }
  tryKnife() {
    if (GameplayInputGate.Locked || this.rollT > 0 || this.throwT > 0 || this.Knives <= 0) return;
    this.cancelDaggerChain();
    this.pendingThrowClip = GA.playerThrow;
    Haptics.throw();
    this.knifeReleasePending = true; this.pickupReleasePending = false;
    this.throwT = this.pendingThrowClip && this.pendingThrowClip.length ? this.pendingThrowClip.length / 26 : 0.22;
    this.anim.play(this.pendingThrowClip, 26, false);
  }
  tryThrow() {
    if (GameplayInputGate.Locked || this.rollT > 0 || this.throwT > 0) return;
    this.cancelDaggerChain();
    if (this.Held != null) {
      this.pendingThrowClip = GA.playerThrow; this.pendingItem = this.Held;
      this.pickupReleasePending = true; this.knifeReleasePending = false;
      this.throwT = this.pendingThrowClip.length / 24;
      this.anim.play(this.pendingThrowClip, 24, false);
      return;
    }
    let best = null, bd = 1.6;
    const c = this.Center;
    for (const p of PlayerController.Pickups()) {
      const pp = p.node.position;
      const d = Math.hypot(pp.x - c.x, pp.y - c.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      this.Held = best.item;
      if (best.claimReloadBonus()) {
        this.knifeT = Math.max(0, this.knifeT - 0.25);
        if (G.level) G.level.hud.flash("RELOAD " + this.KnifeReloadSeconds.toFixed(2) + "s", 1.4);
      }
      best.node.destroy();
      CombatAudio.play(CombatSound.Pickup, CombatRole.Zenji);
    } else this.tryKnife();
  }
  tickCombatFrames() {
    this.finishDaggerCycle();
    if (GameplayInputGate.Locked || this.Dead) return;
    if (this.swingSoundPending && this.anim.frames === this.pendingSwing && this.anim.Frame >= this.pendingSwingFrame) {
      this.swingSoundPending = false;
      Haptics.swing();
      if (!this.daggerInSwing) CombatAudio.play(CombatSound.BladeSwing, CombatRole.Zenji);
      let hit = false;
      if (this.bladeWindowPending) {
        this.bladeWindowPending = false;
        this.slashActiveT = this.daggerInSwing ? 0.08 : 0.11;
        hit = this.sweepSlash();
      }
      if (this.daggerInSwing && !hit) CombatAudio.play(CombatSound.DaggerSwing, CombatRole.Zenji);
    }
    if ((!this.knifeReleasePending && !this.pickupReleasePending) || this.anim.frames !== this.pendingThrowClip || this.anim.Frame < 1) return;
    const knife = this.knifeReleasePending;
    this.knifeReleasePending = this.pickupReleasePending = false;
    const v = { x: this.Facing, y: 0 };
    const c = this.Center;
    const sr = FX.makeSprite(knife ? "Throwing Knife" : "thrown_" + this.pendingItem, GA.kunai, c.x + v.x * 0.4, c.y, 11, true);
    sr.node.setRotation(this.Facing < 0 ? 180 : 0);
    sr.color = col(0.85, 1, 1);
    const t = new PlayerController.ThrownClass();
    t.velocity = { x: v.x * (knife ? this.knifeSpeed : this.throwSpeed), y: 0 };
    t.item = knife ? "knife" : this.pendingItem;
    t.dropOnEnd = !knife;
    sr.node.addComponent(t);
    if (knife) {
      if (this.Knives === this.maxKnives) this.knifeT = this.KnifeReloadSeconds;
      this.Knives--;
    } else this.Held = null;
    CombatAudio.play(CombatSound.KnifeThrow, CombatRole.Zenji);
  }
  die(dir, cause) {
    if (PlayerController.God && !this.Dead) { PlayerController.GodSaves++; PlayerController.LastSave = cause; }
    if (this.Dead || PlayerController.God) return;
    this.Dead = true;
    this.cancelDaggerChain();
    this.rollT = 0; this.lungeT = 0;
    this.deathX = this.node.position.x;
    this.rb.velocity = { x: 0, y: Math.min(this.rb.velocity.y, 0) };
    this.vel = { ...this.rb.velocity };
    const pose = GA.playerDeathPose;
    if (this.anim) this.anim.frames = null;
    if (this.visual) {
      if (GA.playerJump && GA.playerJump.length) this.visual.sprite = GA.playerJump[GA.playerJump.length - 1];
      this.visual.flipX = this.Facing < 0;
      let rot = pose ? pose.rot : -85;
      if (this.Facing < 0) rot = -rot;
      const lp = pose ? { x: pose.pos[0], y: pose.pos[1] } : { x: 0, y: 0.28 };
      lp.x *= this.Facing; lp.y -= 0.25;
      this.visual.node.lrot = rot; this.visual.node.lx = lp.x; this.visual.node.ly = lp.y;
      if (pose) { this.visual.node.lsx = pose.scale[0]; this.visual.node.lsy = pose.scale[1]; }
    }
    let cg = this.node.getComponent(CorpseGrounding);
    if (!cg) { cg = new CorpseGrounding(); this.node.addComponent(cg); }
    cg.depth = 0.25;
    cg.configure(this.visual, this.anim, this.rb, this.body);
    const c = this.Center;
    FX.shards(c.x, c.y, { x: dir.x, y: dir.y + 0.3 }, 28, col(0.75, 0.02, 0.08), 10, 0.09);
    TimeFX.hitStop(0.15);
    CameraRig.shake(0.45, 0.3);
    Haptics.death();
    if (G.level) G.level.onPlayerDeath(cause);
  }
  animate() {
    if (!this.anim || !GA.playerIdle) return;
    this.visual.flipX = this.Facing < 0;
    if (this.attackT > 0 || this.throwT > 0 || this.daggerCyclePending) return;
    if (this.heroLandT > 0 && GA.playerLand && GA.playerLand.length) {
      const t = this.HeroLandDuration - this.heroLandT;
      const v = !(t < this.heroCrouchHold) ? 1 + Math.floor((t - this.heroCrouchHold) * this.heroRiseFps) : 0;
      this.anim.frames = null;
      this.visual.sprite = GA.playerLand[Mathf.clamp(v, 0, GA.playerLand.length - 1)];
    } else if (this.rollT > 0) {
      this.anim.frames = null;
      this.visual.sprite = GA.playerLand[1];
    } else if (!this.grounded) {
      if (this.wallSliding && GA.playerStab1 && GA.playerStab1.length >= 2 && GA.playerStab2 && GA.playerStab2.length >= 3) {
        if (this.wallGlideSource !== GA.playerStab2 || this.wallGlideOpeningSource !== GA.playerStab1) {
          this.wallGlideSource = GA.playerStab2; this.wallGlideOpeningSource = GA.playerStab1;
          const n = this.wallGlideSource.length - 1;
          this.wallGlideFrames = [GA.playerStab1[0], GA.playerStab1[1], GA.playerStab2[n], GA.playerStab2[n - 1], GA.playerStab2[n - 2]];
        }
        if (this.anim.frames !== this.wallGlideFrames) this.anim.play(this.wallGlideFrames, 12, false);
        if (this.anim.Finished) this.visual.sprite = this.wallGlideFrames[this.wallGlideFrames.length - 1];
        this.visual.flipX = this.wallDir < 0;
      } else {
        const J = GA.playerJump;
        const vy = this.vel.y;
        const v = this.wallSliding ? 4 : vy > 6 ? 1 : vy > 1.5 ? 2 : !(vy > -3) ? (vy > -10 ? 4 : 5) : 3;
        this.anim.frames = null;
        this.visual.sprite = J[Mathf.clamp(v, 0, J.length - 1)];
        if (this.wallSliding) this.visual.flipX = this.wallDir > 0;
      }
    } else if (this.landT > 0) this.anim.play(GA.playerLand, 25, false, false);
    else if (Math.abs(this.vel.x) > 0.6) {
      this.anim.play(GA.playerRun, 15, true, false);
      this.stepT -= Time.deltaTime;
      if (this.stepT <= 0) { this.stepT = 0.27; CombatAudio.play(CombatSound.Footstep, CombatRole.Zenji); }
    } else if (this.Facing < 0 && GA.playerIdleLeft && GA.playerIdleLeft.length) {
      this.visual.flipX = false;
      this.anim.play(GA.playerIdleLeft, 10, true, false);
    } else this.anim.play(GA.playerIdle, 10, true, false);
  }
}
PlayerController.typeName = "HypoFangs.PlayerController";
PlayerController.Bot = null;
PlayerController.God = false;
PlayerController.GodSaves = 0;
PlayerController.NoWalls = false;
PlayerController.Pickups = () => [];
PlayerController.ThrownClass = null;
registerScript(PlayerController);

// IHittable lookup: Enemy, Door, Glass, LaserSwitch (GetComponentInParent<IHittable>)
export function hittableOf(node) {
  for (let n = node; n; n = n.parent) for (const c of n.comps) if (c && c.onHit && c.isHittable) return c;
  return null;
}
