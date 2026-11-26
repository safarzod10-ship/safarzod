// Maboroshi Bridge abduction scene: the biker walks to Akari, the conversation, her book counter-attack, the truck pulls up,
// the phone drop, the biker's jump into the truck bed and the drift departure. Ported from HypoFangs.Prologue
// (GirlWalkToTruck, GirlDialogueAnimation, GirlBikerConversation, BikerWalkToGirl, GirlBookCounterattack, LevelTwoTruckReverse,
// CarPhoneDrop, BikerTruckBedJump, TruckDriftDeparture, LevelTwoJumpDust, LevelTwoTruckEngineAudio, LevelTwoTruckWheelSpin).
import { Component, Time, Mathf, newNode } from "../engine/core.js";
import { registerScript, SpriteRenderer, Camera } from "../engine/scene.js";
import { Assets } from "../engine/assets.js";
import { Audio } from "../engine/audio.js";
import { raycastAll, mask, Collider2D } from "../engine/physics.js";
import { G, FX, Haptics, Music } from "./common.js";
import { lineColors } from "./speech.js";

function reg(cls, name) { cls.typeName = name; registerScript(cls); }
const live = () => !G.paused && !G.menuOpen;
const GROUND = () => mask("Ground");
const RED = { r: 1, g: 0, b: 0, a: 1 };
const DEG = 180 / Math.PI;

// nearest non-trigger ground hit straight down
function groundBelow(x, y, dist, fallback) {
  let best = Infinity, gy = fallback;
  for (const h of raycastAll(x, y, 0, -1, dist, GROUND(), { noTriggers: true })) if (h.distance < best) { best = h.distance; gy = h.point.y; }
  return gy;
}

// ActionFxBurst: one-shot frame animation on the "Level" sorting layer
function burst(frames, x, y, fps, order, flip, opacity, sx = 1, sy = 1, follow = null) {
  const sr = FX.anim(frames, x, y, fps, order, 1, 0, flip, { r: 1, g: 1, b: 1, a: opacity }, follow);
  if (!sr) return null;
  sr.layerRank = 2;
  sr.node.lsx = sx; sr.node.lsy = sy;
  if (follow) sr.node.setPosition(x, y);
  return sr;
}

// ---------------------------------------------------------------- Akari's Animator (Idle / Walk / Dialogue / Attack / Protection)
const seq = (prefix, n, from = 0) => Array.from({ length: n }, (_, i) => prefix + String(from + i).padStart(2, "0"));
const GIRL_STATES = {
  Idle: { frames: seq("Girl1_Idle_", 9), fps: 8, loop: true },
  Walk: { frames: seq("Girl1_Walk_", 12), fps: 12, loop: true },
  Dialogue: { frames: seq("Girl1_Dialogue_", 6), fps: 10, loop: true },
  Attack: { frames: seq("Girl1_Attack_", 8), fps: 10, loop: false },
  Protection: { frames: seq("Girl1_Protection_", 4), fps: 8, loop: true },
};
class GirlAnimator {
  constructor(artwork) {
    this.artwork = artwork; this.enabled = true; this.speed = 1; this.t = 0; this.state = "Idle";
    this.clips = {};
    for (const [k, v] of Object.entries(GIRL_STATES)) this.clips[k] = { ...v, sprites: v.frames.map((f) => Assets.sprite(f)).filter(Boolean) };
  }
  clip(name = this.state) { return this.clips[name]; }
  length(name) { const c = this.clip(name); return c.sprites.length / c.fps; }
  frameRate(name) { return this.clip(name).fps; }
  isName(name) { return this.state === name; }
  play(name) { this.state = name; this.t = 0; }
  update(dt) {
    if (!this.enabled) return;
    this.t += dt * this.speed;
    const c = this.clip(), n = c.sprites.length;
    if (!n || !this.artwork) return;
    let i = Math.floor(this.t * c.fps);
    i = c.loop ? i % n : Math.min(n - 1, i);
    this.artwork.sprite = c.sprites[i];
  }
}

export class GirlWalkToTruck extends Component {
  init(d) {
    this.carDialogue = d.carDialogue; this.artwork = d.artwork; this.destinationX = d.destinationX ?? 25.32; this.walkSpeed = d.walkSpeed ?? 2;
    this.IsWalking = false; this.HasArrived = false; this.initialized = false;
  }
  awake() {
    this.animator = new GirlAnimator(this.artwork);
    this.startingPosition = this.node.position; this.startingFlip = !!(this.artwork && this.artwork.flipX);
    this.initialized = true;
  }
  // GirlBusDropIn drives the sprite while she drops off the bus
  get animatorEnabled() { return this.animator.enabled; }
  set animatorEnabled(v) { this.animator.enabled = v; }
  get t() { return this.animator.t; }
  set t(v) { this.animator.t = v; }
  get position() { return this.node.position; }
  onEnable() { if (this.initialized) { this.resetWalk(); this.animator.play("Idle"); } }
  onDisable() { if (this.initialized) this.resetWalk(); }
  resetWalk() {
    this.node.setPosition(this.startingPosition.x, this.startingPosition.y);
    this.IsWalking = this.HasArrived = false;
    if (this.artwork) this.artwork.flipX = this.startingFlip;
  }
  update() {
    if (!live() || this.HasArrived || !this.carDialogue) return;
    if (!this.IsWalking) {
      const c = this.carDialogue;
      if (!c.HasShown || !c.FullyRevealed || c.Visible) return;
      this.IsWalking = true;
      if (this.artwork) this.artwork.flipX = this.destinationX < this.node.position.x;
      this.animator.play("Walk");
    }
    const p = this.node.position;
    const x = Mathf.moveTowards(p.x, this.destinationX, Math.max(0.01, this.walkSpeed) * Time.deltaTime);
    this.node.setPosition(x, p.y);
    if (x === this.destinationX) { this.IsWalking = false; this.HasArrived = true; this.animator.play("Dialogue"); }
  }
  // the Animator evaluates after Update and before the LateUpdate scripts
  lateUpdate() { if (live()) this.animator.update(Time.deltaTime); }
}
GirlWalkToTruck.order = -40;
reg(GirlWalkToTruck, "HypoFangs.Prologue.GirlWalkToTruck");

export class GirlDialogueAnimation extends Component {
  init(d) { Object.assign(this, d); this.wasSpeaking = false; this.listeningTime = 0; this.IsSpeaking = false; this.ListeningFrame = -1; }
  stop() { this.IsSpeaking = this.wasSpeaking = false; this.ListeningFrame = -1; this.listeningTime = 0; }
  lateUpdate() {
    if (!live()) return;
    const g = this.girl, a = g && g.animator;
    if (!g || !a || !a.enabled || !g.artwork || !g.artwork.enabled || g.IsWalking || (this.dropIn && this.dropIn.Phase !== "Landed")
      || (this.counterattack && this.counterattack.IsAttacking) || (this.pickup && this.pickup.ProtectionStarted)) { this.stop(); return; }
    if (!g.HasArrived) {
      if (!a.isName("Idle")) { a.play("Idle"); a.update(0); }
      this.stop(); return;
    }
    this.IsSpeaking = (this.schoolDialogue && this.schoolDialogue.Visible) || (this.conversationView && this.conversationView.Visible && this.conversationView.speaker === g.node);
    if (this.IsSpeaking) {
      if (!this.wasSpeaking) { a.play("Dialogue"); a.update(0); }
      this.wasSpeaking = true; this.listeningTime = 0; this.ListeningFrame = -1;
      return;
    }
    if (this.wasSpeaking) this.listeningTime = 0;
    this.wasSpeaking = false;
    const f = this.listeningFrames;
    if (f && f.length) {
      this.ListeningFrame = Math.floor(this.listeningTime * Math.max(1, this.framesPerSecond)) % f.length;
      g.artwork.sprite = f[this.ListeningFrame];
      this.listeningTime += Time.deltaTime;
    }
  }
}
GirlDialogueAnimation.order = 200;
reg(GirlDialogueAnimation, "HypoFangs.Prologue.GirlDialogueAnimation");

// ---------------------------------------------------------------- biker
export class LevelOneBikerGuard extends Component {
  init(d) { Object.assign(this, d); }
}
reg(LevelOneBikerGuard, "HypoFangs.Prologue.LevelOneBikerGuard");

export class GirlBikerConversation extends Component {
  init(d) { Object.assign(this, d); this.CurrentLine = 0; this.Completed = false; }
  update() {
    if (!live() || !this.girl || !this.biker || !this.view) return;
    if (!this.girl.HasArrived) {
      if (this.CurrentLine !== 0 || this.Completed) { this.view.resetPresentation(); this.CurrentLine = 0; this.Completed = false; }
      return;
    }
    if (this.Completed) return;
    if (this.CurrentLine === 0) this.present(1);
    else if (this.view.HasShown && this.view.FullyRevealed && !this.view.Visible) {
      if (this.CurrentLine < 4) this.present(this.CurrentLine + 1); else this.Completed = true;
    }
  }
  present(line) {
    this.CurrentLine = line;
    const biker = line === 2 || line === 4;
    const text = line === 3 ? this.girlReply : line === 2 ? this.bikerReply : line === 1 ? this.girlQuestion : this.bikerDemand;
    const hl = line === 1 ? [["want", this.gold]] : line === 3 ? [["not a kid", this.gold], ["you", this.cyan], ["weed", this.pink]] : [];
    const colors = lineColors(text, biker ? RED : this.girlColor, hl);
    this.view.showLine(text, biker ? this.biker : this.girl.node, biker ? { x: 0, y: 2.2 } : { x: 0, y: 1.5 }, biker ? { x: 0.84, y: 0.68 } : { x: 0.66, y: 0.68 }, colors);
  }
}
reg(GirlBikerConversation, "HypoFangs.Prologue.GirlBikerConversation");

export class BikerWalkToGirl extends Component {
  init(d) { Object.assign(this, d); this.IsWalking = this.HasArrived = this.ExternalVisualControl = false; this.animationTime = 0; }
  awake() {
    this.startingPosition = this.node.position;
    if (this.artwork) { this.startingSprite = this.artwork.sprite; this.startingFlip = this.artwork.flipX; }
  }
  get position() { return this.node.position; }
  update() {
    if (!live() || !this.conversation || !this.conversation.girl) return;
    const src = this.spriteSource;
    if (!this.conversation.girl.HasArrived) {
      if (this.IsWalking || this.HasArrived) {
        this.node.setPosition(this.startingPosition.x, this.startingPosition.y);
        this.IsWalking = this.HasArrived = false; this.animationTime = 0;
        if (this.artwork) { this.artwork.sprite = this.startingSprite; this.artwork.flipX = this.startingFlip; }
      }
      this.paint(src && src.idle); return;
    }
    if (!this.conversation.Completed) { this.paint(src && src.idle); return; }
    if (!this.IsWalking && !this.HasArrived) {
      this.IsWalking = true; this.animationTime = 0;
      if (this.artwork) this.artwork.flipX = this.destinationX < this.node.position.x;
    }
    if (this.IsWalking) {
      const p = this.node.position;
      const x = Mathf.moveTowards(p.x, this.destinationX, Math.max(0.01, this.walkSpeed) * Time.deltaTime);
      this.node.setPosition(x, p.y);
      if (x === this.destinationX) { this.IsWalking = false; this.HasArrived = true; this.animationTime = 0; }
    }
    this.paint(this.IsWalking ? this.walkFrames : src && src.idle);
  }
  paint(frames) {
    if (this.ExternalVisualControl) return;
    if (this.artwork && frames && frames.length) {
      this.artwork.sprite = frames[Math.floor(this.animationTime * Math.max(1, this.framesPerSecond)) % frames.length];
      this.artwork.flipX = this.conversation.girl.node.position.x < this.node.position.x;
    }
    this.animationTime += Time.deltaTime;
  }
}
reg(BikerWalkToGirl, "HypoFangs.Prologue.BikerWalkToGirl");

// ---------------------------------------------------------------- the book
export class GirlBookCounterattack extends Component {
  init(d) {
    Object.assign(this, d);
    this.BookPhase = "None"; this.Triggered = this.IsAttacking = this.BookReleased = false;
    this.book = null; this.BookHitCount = 0; this.AttackStartedAt = 0;
  }
  get BookLanded() { return this.BookPhase === "Resting"; }
  get attackLength() { return this.girl.animator.length("Attack"); }
  lateUpdate() {
    if (!live() || !this.biker || !this.girl || !this.conversation) return;
    if (!this.Triggered) {
      if (!this.biker.IsWalking && !this.biker.HasArrived) return;
      this.beginAttack();
    }
    const t = Time.time - this.AttackStartedAt, sp = Math.max(0.01, this.girl.animator.speed);
    const rate = Math.max(1, this.girl.animator.frameRate("Attack"));
    if (!this.BookReleased && t >= this.bookReleaseFrame / rate / sp) this.releaseBook();
    if (this.IsAttacking && t >= this.attackLength / sp) { this.IsAttacking = false; this.girl.animator.play("Dialogue"); }
    this.updateBook();
  }
  beginAttack() {
    this.Triggered = this.IsAttacking = true;
    this.AttackStartedAt = Time.time;
    const g = this.girl;
    g.artwork.flipX = this.biker.node.position.x < g.node.position.x;
    g.animator.play("Attack"); g.animator.update(0);
    const c = this.conversation;
    const colors = lineColors(this.reply, c.girlColor, [["Back off", c.gold], ["creep", c.pink]]);
    c.view.showLine(this.reply, g.node, { x: 0, y: 1.5 }, { x: 0.66, y: 0.68 }, colors);
  }
  releaseBook() {
    this.BookReleased = true;
    if (!this.bookFrames || !this.bookFrames.length) return;
    const dir = this.girl.artwork.flipX ? -1 : 1, gp = this.girl.node.position;
    this.book = newNode("Girl 1 - Thrown Book");
    this.book.setPosition(gp.x + this.releaseOffset.x * dir, gp.y + this.releaseOffset.y);
    const art = newNode("Book Sprite", this.book);
    this.bookArt = new SpriteRenderer({ o: Math.max(this.girl.artwork.sortingOrder, this.biker.artwork.sortingOrder) + 2, l: 2, lit: 1 });
    art.addComponent(this.bookArt);
    this.bookFacing = dir;
    this.refreshTarget();
    this.flightTime = 0; this.BookPhase = "Flying";
    this.paintBook(0);
  }
  refreshTarget() {
    const bp = this.biker.node.position, dir = this.bookFacing;
    let cx = bp.x - dir * Math.abs(this.targetOffset.x), cy = bp.y + this.targetOffset.y;
    const col = this.biker.node.getComponent(Collider2D);
    if (col) { const b = col.bounds; cx = Mathf.clamp(cx, b.minX + 0.05, b.maxX - 0.05); cy = Mathf.clamp(cy, b.minY + 0.05, b.maxY - 0.05); }
    this.ContactPoint = { x: cx, y: cy };
    const i = Mathf.clamp(this.impactPoseFrame, 0, this.bookFrames.length - 1);
    const hx = this.bookFrameHalfSizes && this.bookFrameHalfSizes[i] ? this.bookFrameHalfSizes[i].x : 0.1354167;
    this.bookTarget = { x: cx - dir * hx, y: cy };
  }
  updateBook() {
    if (!this.book || this.BookLanded) return;
    const dt = Time.deltaTime;
    if (this.BookPhase === "Flying") {
      this.refreshTarget();
      this.flightTime += dt;
      const p = this.book.position, tx = this.bookTarget.x, ty = this.bookTarget.y;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = Math.max(0.1, this.bookSpeed) * dt;
      if (d <= step || d < 1e-6) this.book.setPosition(tx, ty); else this.book.setPosition(p.x + dx / d * step, p.y + dy / d * step);
      const n = Math.max(1, this.bookFrames.length - 1);
      this.paintBook(Math.floor(this.flightTime * Math.max(1, this.bookFramesPerSecond)) % n);
      const q = this.book.position;
      if ((q.x - tx) ** 2 + (q.y - ty) ** 2 < 0.0001) { this.book.setPosition(tx, ty); this.beginFall(); }
    } else if (this.BookPhase === "Falling") {
      this.fallTime += dt;
      const ri = Mathf.clamp(this.restingBookFrame, 0, this.bookFrames.length - 1);
      const hy = this.bookFrameHalfSizes && this.bookFrameHalfSizes[ri] ? this.bookFrameHalfSizes[ri].y : 0.0625;
      const g = Math.max(0.1, this.fallGravity), s = this.fallStart;
      const dur = Math.sqrt(Math.max(0, 2 * (s.y - this.groundY - hy) / g));
      this.book.setPosition(s.x, Math.max(this.groundY + hy, s.y - 0.5 * g * this.fallTime * this.fallTime));
      if (this.fallTime >= dur) {
        this.BookPhase = "Resting";
        Haptics.pulse(0.08, 0.12, 0.05);
        this.book.setPosition(s.x, this.groundY + hy);
        this.paintBook(ri);
        // in the original the book is not seen again once it has dropped (frame captures of the Windows build)
        this.bookArt.enabled = false;
      } else {
        const h = Math.max(0.001, s.y - this.groundY - hy);
        const f = 0.5 * g * this.fallTime * this.fallTime / h < this.fallPoseSwitchFraction ? this.impactPoseFrame : this.fallingPoseFrame;
        this.paintBook(Mathf.clamp(f, 0, this.bookFrames.length - 1));
      }
    }
  }
  beginFall() {
    this.BookHitCount++;
    this.BookPhase = "Falling";
    Haptics.pulse(0.5, 0.7, 0.16);
    if (this.impactSound) Audio.play(this.impactSound, this.impactVolume);
    this.fallStart = this.book.position; this.fallTime = 0;
    this.paintBook(Mathf.clamp(this.impactPoseFrame, 0, this.bookFrames.length - 1));
    this.groundY = groundBelow(this.fallStart.x, this.fallStart.y + 0.05, 20, this.girl.node.position.y);
    if (this.impactDust && this.impactDust.length) {
      const k = this.dustScale;
      burst(this.impactDust, this.ContactPoint.x, this.ContactPoint.y, this.dustFramesPerSecond, this.bookArt.sortingOrder - 1, false, 1, k, k);
    }
  }
  // bookFrameCenters are the drawn centres inside the original 64x64 frames; the atlas holds the frames trimmed to
  // their drawing and centred on it, so the sprite already sits where the original offset puts it.
  paintBook(i) { this.bookArt.sprite = this.bookFrames[i]; }
}
reg(GirlBookCounterattack, "HypoFangs.Prologue.GirlBookCounterattack");

// ---------------------------------------------------------------- the truck pulls up, Akari is taken, the phone drops
export class LevelTwoTruckReverse extends Component {
  init(d) {
    Object.assign(this, d);
    this.beat = "None"; this.Started = this.IsReversing = this.Arrived = this.Completed = false;
    this.ProtectionStarted = this.GirlJumpStarted = this.GirlHidden = this.PhoneDropRequested = this.PickupDialogueStarted = false;
  }
  awake() { this.startPosition = this.node.position; }
  get StartPosition() { return this.startPosition; }
  update() {
    if (!live() || !this.counterattack || !this.bus) return;
    if (!this.bus.Arrived) return;
    const view = this.counterattack.conversation.view;
    if (!this.Started) {
      const ca = this.counterattack;
      if (!ca.BookLanded || ca.IsAttacking || !view || !view.HasShown || !view.FullyRevealed || view.Visible || view.CurrentMessage !== ca.reply) return;
      this.Started = this.IsReversing = true;
      this.elapsed = 0;
      this.spawnTireDust();
    }
    if (!this.IsReversing) { this.updatePickupDialogue(); return; }
    this.elapsed += Time.deltaTime;
    const k = Mathf.clamp01(this.elapsed / Math.max(0.1, this.reverseSeconds));
    const s = k * k * (3 - 2 * k);
    this.node.setPosition(Mathf.lerp(this.startPosition.x, this.destinationX, s), this.startPosition.y);
    if (k >= 1) {
      this.IsReversing = false; this.Arrived = true;
      this.node.setPosition(this.destinationX, this.startPosition.y);
      view.showLine(this.carDemand, this.node, { x: 0.6, y: 1.5 }, { x: 0.84, y: 0.68 }, null);
      this.PickupDialogueStarted = true;
      this.beat = "CarDemand";
    }
  }
  updatePickupDialogue() {
    if (!this.Arrived || !this.PickupDialogueStarted || this.Completed) return;
    const girl = this.counterattack.girl, view = this.counterattack.conversation.view;
    if (!girl || !girl.artwork || !view) return;
    if (this.ProtectionStarted && !this.GirlHidden) {
      if ((Time.time - this.ProtectionStartedAt) / Math.max(0.01, this.protectionCycleSeconds) >= 1 && !this.GirlJumpStarted) {
        this.GirlJumpStarted = true; this.GirlJumpStartedAt = Time.time;
        this.girlJumpBase = girl.node.position;
        this.girlAnimatorWasEnabled = girl.animator.enabled;
        girl.animator.enabled = false;
      }
      if (this.GirlJumpStarted) {
        const t = Time.time - this.GirlJumpStartedAt, f = this.girlVanishJumpFrames || [], n = f.length;
        const dur = Math.max(1, n) / Math.max(1, this.girlVanishJumpFramesPerSecond), k = Mathf.clamp01(t / dur);
        girl.node.setPosition(this.girlJumpBase.x, this.girlJumpBase.y + this.girlVanishJumpHeight * Math.sin(k * Math.PI * 0.5));
        if (n) girl.artwork.sprite = f[Math.min(n - 1, Math.floor(t * this.girlVanishJumpFramesPerSecond))];
        if (k >= 1) {
          girl.artwork.enabled = false; this.GirlHidden = true;
          girl.node.setPosition(this.girlJumpBase.x, this.girlJumpBase.y);
          girl.animator.enabled = this.girlAnimatorWasEnabled;
        }
      }
    }
    if (!view.HasShown || !view.FullyRevealed || view.Visible) return;
    const conv = this.counterattack.conversation;
    switch (this.beat) {
      case "CarDemand":
        if (view.CurrentMessage === this.carDemand && view.FinishedFrame >= 0 && Time.frameCount > view.FinishedFrame) {
          girl.animator.play("Protection"); girl.animator.update(0);
          this.protectionCycleSeconds = girl.animator.length("Protection") / Math.max(0.01, Math.abs(girl.animator.speed));
          this.ProtectionStarted = true; this.ProtectionStartedAt = Time.time;
          this.showGirlLine(conv, this.girlProtest, "Let go!", "Get your hands off me!");
          view.revealFirstLetter();
          this.beat = "GirlProtest";
        }
        break;
      case "GirlProtest":
        if (view.CurrentMessage === this.girlProtest) {
          this.PhoneDropRequested = true;
          this.showGirlLine(conv, this.girlPhoneLine, "phone", "—!");
          this.beat = "GirlPhone";
        }
        break;
      case "GirlPhone":
        if (view.CurrentMessage === this.girlPhoneLine) {
          view.showLine(this.bikerPhoneLine, this.counterattack.biker.node, { x: 0, y: 2.2 }, { x: 0.84, y: 0.68 }, null);
          this.beat = "BikerPhoneReply";
        }
        break;
      case "BikerPhoneReply":
        if (view.message === this.bikerPhoneLine) { this.Completed = true; this.beat = "Complete"; }
        break;
    }
  }
  showGirlLine(conv, text, gold, pink) {
    const colors = lineColors(text, conv.girlColor, [[gold, conv.gold], [pink, conv.pink]]);
    conv.view.showLine(text, this.counterattack.girl.node, { x: 0, y: 1.5 }, { x: 0.66, y: 0.68 }, colors);
  }
  spawnTireDust() {
    if (!this.tireDust || !this.tireDust.length || !this.tireDustAnchors) return;
    for (const a of this.tireDustAnchors) {
      if (!a) continue;
      const p = a.position;
      burst(this.tireDust, p.x, p.y, this.dustFramesPerSecond, 22, false, 0.9, this.dustScale, this.dustScale * 0.6, a);
    }
  }
}
reg(LevelTwoTruckReverse, "HypoFangs.Prologue.LevelTwoTruckReverse");

export class CarPhoneDrop extends Component {
  init(d) { Object.assign(this, d); this.resetPhone(); }
  resetPhone() {
    if (this.phone) { this.phone.enabled = false; this.phone.node.setRotation(0); }
    this.Phase = "None"; this.fallTime = 0; this.GroundY = 0;
  }
  lateUpdate() {
    if (!live() || !this.pickup || !this.phone || !this.dropOrigin) return;
    if (!this.pickup.PhoneDropRequested) { if (this.Phase !== "None") this.resetPhone(); return; }
    const ph = this.phone, n = ph.node;
    if (this.Phase === "None") {
      this.Phase = "Falling"; this.fallTime = 0;
      this.DropPosition = this.dropOrigin.position;
      n.setPosition(this.DropPosition.x, this.DropPosition.y);
      n.setRotation(this.dropAngle);
      ph.enabled = true;
      this.GroundY = groundBelow(this.DropPosition.x, this.DropPosition.y + 0.05, 20, this.pickup.node.position.y);
    }
    if (this.Phase !== "Falling") return;
    this.fallTime += Time.deltaTime;
    const sp = ph.sprite, ext = sp ? (sp.maxY - sp.minY) / 2 * Math.abs(n.lossyScale.y) : 0.05;
    const rest = this.GroundY + ext, D = this.DropPosition;
    const dur = Math.sqrt(Math.max(0, 2 * (D.y - rest) / Math.max(0.1, this.gravity)));
    const k = Mathf.clamp01(this.fallTime / Math.max(0.001, dur));
    n.setRotation(this.dropAngle * (1 - k));
    const b = ph.bounds, bext = (b.maxY - b.minY) / 2;
    n.setPosition(D.x, Math.max(this.GroundY + bext, D.y - 0.5 * this.gravity * this.fallTime * this.fallTime));
    if (this.fallTime >= dur) {
      n.setRotation(0);
      n.setPosition(D.x, this.GroundY + ext);
      this.Phase = "Resting";
    }
  }
}
CarPhoneDrop.order = 200;
reg(CarPhoneDrop, "HypoFangs.Prologue.CarPhoneDrop");

// ---------------------------------------------------------------- jump into the truck bed, rocking, camera shake
export class BikerTruckBedJump extends Component {
  init(d) {
    Object.assign(this, d);
    this.Phase = "None"; this.Started = this.InTruckBed = this.FrontTireGrounded = this.IsShaking = false;
    this.CurrentTilt = 0; this.shake = { x: 0, y: 0 };
  }
  lateUpdate() {
    if (!live() || !this.pickup || !this.biker || !this.bedLanding || !this.rearTirePivot) return;
    if (!this.pickup.Completed) return;
    const b = this.biker, src = b.spriteSource;
    if (!this.Started) {
      this.Started = true; this.Phase = "Jumping"; this.JumpStartedAt = Time.time; this.jumpTime = 0;
      this.jumpStart = b.node.position;
      this.restingCar = this.pickup.node.position; this.restingRot = this.pickup.node.lrot;
      b.ExternalVisualControl = true;
    }
    if (this.Phase === "Jumping") {
      this.jumpTime += Time.deltaTime;
      const k = Mathf.clamp01(this.jumpTime / Math.max(0.1, this.jumpSeconds));
      const end = this.bedLanding.position, s = this.jumpStart;
      b.node.setPosition(s.x + (end.x - s.x) * k, s.y + (end.y - s.y) * k + 4 * this.jumpArcHeight * k * (1 - k));
      b.artwork.flipX = end.x < s.x;
      if (end.y - s.y + 4 * this.jumpArcHeight * (1 - 2 * k) < 0 && src.fall && src.fall.length)
        this.paint(src.fall, Math.floor(this.jumpTime * Math.max(1, src.fallFramesPerSecond)) % Math.min(2, src.fall.length));
      else this.paint(src.jump, Math.floor(this.jumpTime * Math.max(1, src.jumpFramesPerSecond)));
      if (k < 1) return;
      this.InTruckBed = true; this.Phase = "Rocking"; this.BikerLandedAt = Time.time; this.rockingTime = 0;
      this.pivot = this.rearTirePivot.position;
    }
    if (this.Phase === "Rocking") {
      this.rockingTime += Time.deltaTime;
      const lift = Math.max(0.05, this.liftSeconds), settle = Math.max(0.05, this.settleSeconds);
      let ang;
      if (this.rockingTime < lift) { const t = this.rockingTime / lift; ang = this.tiltDegrees * t * t * (3 - 2 * t); }
      else { const t = Mathf.clamp01((this.rockingTime - lift) / settle); ang = this.tiltDegrees * (1 - t * t); }
      this.applyTilt(ang);
      if (this.rockingTime >= lift + settle) {
        this.applyTilt(0); this.FrontTireGrounded = true; this.Phase = "Settled";
        Haptics.pulse(0.4, 0.1, 0.12);
      }
    }
    if (this.InTruckBed) {
      const p = this.bedLanding.position;
      b.node.setPosition(p.x, p.y);
      b.artwork.flipX = false;
      b.node.lrot = this.pickup.node.lrot - this.restingRot;
      const idle = src.idle;
      if (idle && idle.length) this.paint(idle, Math.floor((Time.time - this.BikerLandedAt) * Math.max(1, src.framesPerSecond)) % idle.length);
    }
    this.applyCameraShake();
  }
  paint(sprites, frame) { if (sprites && sprites.length) this.biker.artwork.sprite = sprites[Mathf.clamp(frame, 0, sprites.length - 1)]; }
  applyTilt(angle) {
    this.CurrentTilt = angle;
    const r = angle * Mathf.RAD, c = Math.cos(r), s = Math.sin(r);
    const dx = this.restingCar.x - this.pivot.x, dy = this.restingCar.y - this.pivot.y;
    this.pickup.node.lrot = this.restingRot + angle;
    this.pickup.node.setPosition(this.pivot.x + c * dx - s * dy, this.pivot.y + s * dx + c * dy);
  }
  // CameraFollow2D (order 50) has already placed the camera this frame, so the offset is added on top
  applyCameraShake() {
    const cam = this.sceneCamera;
    if (!cam) return;
    this.IsShaking = this.Phase === "Rocking";
    if (!this.IsShaking) return;
    const n = cam.node, p = n.position;
    const t = Mathf.clamp01(this.rockingTime / Math.max(0.1, this.liftSeconds + this.settleSeconds));
    const amt = this.shakeAmount * Mathf.lerp(1, 0.4, t), f = Math.floor(this.rockingTime * this.shakeFrequency);
    const upp = cam.orthographicSize * 2 / Math.max(1, G.viewH || 720);
    let x = Math.sin(f * 2.399 + 0.4) * amt, y = Math.sin(f * 4.317 + 1.2) * amt;
    if (upp > 0) { x = Math.round(x / upp) * upp; y = Math.round(y / upp) * upp; }
    n.setPosition(p.x + x, p.y + y);
  }
}
BikerTruckBedJump.order = 100;
reg(BikerTruckBedJump, "HypoFangs.Prologue.BikerTruckBedJump");

export class TruckDriftDeparture extends Component {
  init(d) { Object.assign(this, d); this.Phase = "None"; this.DepartureDialogueLine = 0; this.DepartureDialogueCompleted = false; this.CurrentSpeed = 0; }
  lateUpdate() {
    if (!live() || !this.pickup || !this.bedJump) return;
    if (!this.pickup.Completed) return;
    if (this.Phase === "None") {
      if (!this.bedJump.FrontTireGrounded || !this.updateDialogue()) return;
      const p = this.node.position;
      this.start = p; this.routeY = p.y;
      this.clock = 0; this.Phase = "Drifting";
      this.emitDust(); this.dustClock = 0;
    }
    if (this.Phase === "Gone") return;
    const dt = Time.deltaTime;
    if (this.Phase === "Drifting") {
      this.clock += dt;
      const k = Mathf.clamp01(this.clock / this.driftSeconds);
      this.node.setPosition(this.start.x - this.skidBackDistance * Math.sin(k * Math.PI * 0.5), this.routeY);
      if (k >= 1) { this.Phase = "Accelerating"; this.CurrentSpeed = 0; }
    } else {
      const v0 = this.CurrentSpeed;
      this.CurrentSpeed = Math.min(this.maximumSpeed, this.CurrentSpeed + this.acceleration * dt);
      this.node.setPosition(this.node.position.x + (v0 + this.CurrentSpeed) * 0.5 * dt, this.routeY);
    }
    this.dustClock += dt;
    if (this.dustClock >= this.dustInterval) { this.dustClock %= this.dustInterval; this.emitDust(); }
    if (this.Phase === "Accelerating" && this.fullyOffscreen()) {
      this.Phase = "Gone"; this.CurrentSpeed = 0;
      this.car.enabled = false; this.biker.enabled = false;
    }
  }
  updateDialogue() {
    if (this.DepartureDialogueCompleted) return true;
    const conv = this.pickup.counterattack && this.pickup.counterattack.conversation, v = conv && conv.view;
    if (!v) return false;
    if (this.DepartureDialogueLine === 0) {
      v.showLine(this.girlWarning, this.node, { x: 0.1, y: 1.7 }, { x: 0.66, y: 0.68 }, lineColors(this.girlWarning, conv.girlColor, [["father", conv.gold]]));
      this.DepartureDialogueLine = 1;
      return false;
    }
    if (!v.HasShown || !v.FullyRevealed || v.Visible || v.FinishedFrame < 0 || Time.frameCount <= v.FinishedFrame) return false;
    if (this.DepartureDialogueLine === 1) {
      if (v.CurrentMessage !== this.girlWarning) return false;
      v.showLine(this.bossReply, this.node, { x: 0.6, y: 1.5 }, { x: 0.84, y: 0.68 }, null);
      this.DepartureDialogueLine = 2;
      return false;
    }
    if (v.CurrentMessage !== this.bossReply) return false;
    this.DepartureDialogueCompleted = true;
    return true;
  }
  fullyOffscreen() {
    const cam = this.view;
    if (!cam) return this.node.position.x > 60;
    const right = cam.node.position.x + cam.orthographicSize * cam.aspect + 0.75;
    return this.car.bounds.minX > right && this.biker.bounds.minX > right;
  }
  emitDust() {
    if (!this.dustFrames || !this.dustFrames.length || !this.tireAnchors) return;
    this.tireAnchors.forEach((a, i) => {
      if (!a) return;
      const k = this.dustScale * (i === 1 ? 0.6 : 1);
      burst(this.dustFrames, a.position.x, this.routeY + 0.015, this.dustFramesPerSecond, 22, true, 0.95, k, k * 0.65);
    });
  }
}
TruckDriftDeparture.order = 90;
reg(TruckDriftDeparture, "HypoFangs.Prologue.TruckDriftDeparture");

// ---------------------------------------------------------------- dust, engine sound, wheels
export class LevelTwoJumpDust extends Component {
  init(d) { Object.assign(this, d); this.GirlLandingCount = this.BikerTakeoffCount = this.BikerLandingCount = 0; }
  lateUpdate() {
    if (!live() || !this.bus || !this.girlDrop || !this.bikerJump) return;
    if (!this.bus.Arrived) return;
    const gd = this.girlDrop;
    if (gd.Phase === "Landed" && this.GirlLandingCount === 0 && gd.GroundY !== undefined) {
      this.spawn(this.girlLandingFrames, gd.node.position.x, gd.GroundY + 0.015, this.girlScale, 0.5, this.girlOpacity, false);
      this.GirlLandingCount++;
      Haptics.pulse(0.2, 0.05, 0.08);
    }
    const bj = this.bikerJump;
    if (bj.Started && this.BikerTakeoffCount === 0) {
      const p = bj.jumpStart || bj.biker.node.position;
      const gy = groundBelow(p.x, p.y + 1, 10, 0);
      this.pair(this.takeoffFrames, p.x, gy + 0.015, null);
      this.BikerTakeoffCount++;
      Haptics.pulse(0.55, 0.2, 0.14);
    }
    if (bj.InTruckBed && this.BikerLandingCount === 0) {
      const p = bj.bedLanding.position;
      this.pair(this.landingFrames, p.x, p.y + 0.015, bj.bedLanding);
      this.BikerLandingCount++;
      Haptics.pulse(1, 0.45, 0.3);
    }
  }
  pair(frames, x, y, follow) {
    this.spawn(frames, x - 0.18, y, this.bikerScale, 0.7, this.bikerOpacity, true, follow);
    this.spawn(frames, x + 0.18, y, this.bikerScale, 0.7, this.bikerOpacity, false, follow);
  }
  spawn(frames, x, y, size, height, alpha, flip, follow = null) {
    if (!frames || !frames.length) return;
    burst(frames, x, y, this.framesPerSecond, 22, flip, alpha, size, size * height, follow);
  }
}
LevelTwoJumpDust.order = 150;
reg(LevelTwoJumpDust, "HypoFangs.Prologue.LevelTwoJumpDust");

// sounds that must not outlive the prologue scene (scene changes do not call OnDestroy here)
const watched = new Set();
let watchTimer = 0;
export function stopWithScene(stop) {
  const e = { owner: G.prologue, stop };
  watched.add(e);
  if (!watchTimer) watchTimer = setInterval(() => {
    for (const w of watched) if (G.prologue !== w.owner || (w.owner && w.owner.leaving)) { watched.delete(w); try { w.stop(); } catch (err) { } }
  }, 150);
  return () => watched.delete(e);
}

// engine loop: idle/reverse voice (pitch stopped < reversing) cross-fading into the departure voice (leaving pitch)
const ENGINE_CLIP = "derrickmckinnon-muscle-truck-241621";
function engineVoice(loop) {
  const t = Audio.track(ENGINE_CLIP);
  t.el.loop = loop;
  t.el.preservesPitch = false; t.el.mozPreservesPitch = false; t.el.webkitPreservesPitch = false;
  t.pitch = (p) => { try { t.el.playbackRate = Mathf.clamp(p, 0.25, 4); } catch (e) { } };
  stopWithScene(() => { t.setVolume(0); t.stop(); });
  return t;
}
export class LevelTwoTruckEngineAudio extends Component {
  init(d) { Object.assign(this, d); this.Phase = "Silent"; }
  onEnable() { this.resetPlayback(); }
  onDisable() { this.stopSources(); }
  onDestroy() { this.stopSources(); }
  resetPlayback() {
    this.stopSources();
    this.engaged = this.leaving = this.fading = false;
    this.transitionTime = this.fadeTime = this.startupTime = 0;
    this.Phase = "Silent";
  }
  stopSources() {
    for (const v of [this.idle, this.depart]) if (v) { v.setVolume(0); v.stop(); }
  }
  lateUpdate() {
    const paused = G.paused || G.menuOpen || Time.timeScale <= 0;
    if (paused !== !!this.paused) {
      this.paused = paused;
      for (const v of [this.idle, this.depart]) if (v) { if (paused) v.el.pause(); else if (v.playing) v.play(); }
    }
    if (paused || !this.pickup || !this.departure) return;
    const dt = Time.unscaledDeltaTime;
    if (!this.engaged && this.pickup.IsReversing) {
      this.engaged = true; this.startupTime = 0;
      if (!this.idle) this.idle = engineVoice(true);
      this.idlePitch = this.reversingPitch; this.idle.pitch(this.idlePitch); this.idle.setVolume(0); this.idle.restart();
    }
    if (!this.engaged && this.departure.Phase === "None") { this.Phase = "Silent"; return; }
    this.startupTime += dt;
    if (!this.leaving && (this.departure.Phase === "Drifting" || this.departure.Phase === "Accelerating")) {
      this.leaving = true; this.transitionTime = 0;
      if (!this.depart) this.depart = engineVoice(false);
      this.depart.pitch(this.leavingPitch); this.depart.setVolume(0); this.depart.restart();
    }
    if (this.leaving) this.transitionTime += dt;
    if (this.leaving && this.departure.Phase === "Gone") { this.fading = true; this.fadeTime += dt; }
    const cross = this.leaving ? Mathf.clamp01(this.transitionTime / this.crossfadeSeconds) : 0;
    let near = 1;
    const cam = Camera.main;
    if (!this.leaving && cam) {
      const w = cam.orthographicSize * cam.aspect, d = Math.abs(this.node.position.x - cam.node.position.x);
      near = Mathf.clamp01(1 - Math.max(0, d - w * 0.5) / Math.max(1, w + 5));
    }
    const start = Mathf.clamp01(this.startupTime / 0.12), fade = this.fading ? 1 - Mathf.clamp01(this.fadeTime / this.offscreenFadeSeconds) : 1;
    if (this.idle) {
      const target = this.pickup.IsReversing ? this.reversingPitch : this.stoppedPitch;
      this.idlePitch = Mathf.moveTowards(this.idlePitch, target, Math.abs(this.reversingPitch - this.stoppedPitch) * dt / this.pitchTransitionSeconds);
      this.idle.pitch(this.idlePitch);
      this.idle.setVolume(this.idleVolume * near * start * (1 - cross));
      if (this.leaving && cross >= 1 && this.idle.playing) this.idle.stop();
    }
    if (this.depart) this.depart.setVolume(this.departureVolume * cross * fade);
    this.Phase = this.leaving ? (this.fading ? "FadingOut" : "Departing") : this.pickup.IsReversing ? "Reversing" : "Idle";
    if (this.fading && fade <= 0) { this.stopSources(); this.Phase = "Silent"; }
  }
}
LevelTwoTruckEngineAudio.order = 160;
reg(LevelTwoTruckEngineAudio, "HypoFangs.Prologue.LevelTwoTruckEngineAudio");

export class LevelTwoTruckWheelSpin extends Component {
  init(d) { Object.assign(this, d); this.RotationDegrees = 0; this.Phase = "Idle"; }
  awake() { this.lastX = this.node.position.x; this.rearRest = this.rearWheel.node.lrot; this.frontRest = this.frontWheel.node.lrot; }
  lateUpdate() {
    if (!live() || !this.pickup || !this.departure) return;
    const x = this.node.position.x, dx = x - this.lastX;
    this.lastX = x;
    if (!this.pickup.Started) { this.RotationDegrees = 0; this.Phase = "Idle"; this.apply(); this.sync(); return; }
    if (Time.deltaTime <= 0) { this.sync(); return; }
    let d = 0;
    this.Phase = "Idle";
    if (this.pickup.IsReversing) { this.Phase = "Reversing"; d = -dx / Math.max(0.01, this.wheelRadius) * DEG * this.reverseSpinMultiplier; }
    else if (this.departure.Phase === "Drifting") { this.Phase = "Burnout"; d = -this.burnoutDegreesPerSecond * Time.deltaTime; }
    else if (this.departure.Phase === "Accelerating") { this.Phase = "Leaving"; d = -Math.max(0, dx) / Math.max(0.01, this.wheelRadius) * DEG * this.departureSpinMultiplier; }
    else if (this.departure.Phase === "Gone") this.Phase = "Gone";
    this.RotationDegrees += d;
    this.apply(); this.sync();
  }
  apply() { this.rearWheel.node.lrot = this.rearRest + this.RotationDegrees; this.frontWheel.node.lrot = this.frontRest + this.RotationDegrees; }
  sync() { const on = !!(this.body && this.body.enabled); this.rearWheel.enabled = this.frontWheel.enabled = on; }
}
LevelTwoTruckWheelSpin.order = 170;
reg(LevelTwoTruckWheelSpin, "HypoFangs.Prologue.LevelTwoTruckWheelSpin");
