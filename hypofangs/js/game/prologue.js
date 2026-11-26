// Prologue (Maboroshi Bridge): school bus, Akari's drop-off and school dialogue, camera follow, parallax, then (abduction.js)
// the biker and the truck; Gaku's phone call card, StrawHat on the bridge, the title card and the hand-off to the Neon District.
// Ported from HypoFangs.Prologue.
import { Component, Time, Mathf, Random, newNode } from "../engine/core.js";
import { registerScript, SpriteRenderer, Camera } from "../engine/scene.js";
import { Input } from "../engine/input.js";
import { Assets } from "../engine/assets.js";
import { Audio } from "../engine/audio.js";
import { G, GA, FX, Sfx, Music, Prefs, GameClock, SpriteAnim } from "./common.js";
import { SpriteSurfaces } from "./surfaces.js";
import { raycastAll, mask } from "../engine/physics.js";
import { CarDialoguePresenter, placeSpeech, protectSpeechActors } from "./speech.js";
import { stopWithScene } from "./abduction.js";

function reg(cls, name) { cls.typeName = name; registerScript(cls); }
const advancePressed = () => !G.paused && Input.hit("Enter", "NumpadEnter", "Space", "Tap");

// the bus engine sound follows the bus on screen
function busVolume(bus) {
  const cam = Camera.main;
  if (!cam) return 1;
  const w = cam.orthographicSize * cam.aspect;
  const d = Math.abs(bus.node.position.x - cam.node.position.x);
  return Mathf.clamp01(1 - Math.max(0, d - w * 0.5) / Math.max(1, w + 5));
}

export class LevelTwoSchoolBus extends Component {
  init(d) { Object.assign(this, d); this.Phase = "Approaching"; this.CurrentSpeed = 0; this.phaseTime = 0; this.voice = null; this.smokeFps = d.smokeFramesPerSecond || 10; }
  get Arrived() { return this.Phase === "Waiting" || this.Phase === "Departing" || this.Disappeared; }
  get Disappeared() { return this.Phase === "Gone"; }
  start() {
    this.artwork = this.node.getComponentsInChildren(SpriteRenderer);
    this.routeY = this.node.position.y;
    this.restartRoute();
  }
  restartRoute() {
    if (this.arrivalPassenger) this.arrivalPassenger.setActive(false);
    this.phaseTime = 0; this.Phase = "Approaching";
    this.CurrentSpeed = Math.max(0.1, this.speed);
    const d = Math.min(Math.max(0, this.startX - this.stopX), this.CurrentSpeed * Math.max(0.1, this.brakingSeconds) * 0.5);
    this.brakeStartX = this.stopX + d;
    this.brakeDuration = Math.max(0.0001, 2 * d / this.CurrentSpeed);
    this.node.setPosition(this.startX, this.routeY);
    this.started = false;
  }
  playEngine(clip) {
    if (this.voice) try { this.voice.src.stop(); } catch (e) { }
    this.voice = Audio.play(clip, this.busSoundVolume * busVolume(this));
  }
  update() {
    if (G.paused || G.menuOpen) return;
    if (!this.started) { this.started = true; this.playEngine(this.arrivalSound); }
    let dt = Time.deltaTime;
    if (dt <= 0 || this.Disappeared) return;
    const v = Math.max(0.1, this.speed);
    for (let i = 0; i < 6 && dt > 0; i++) {
      const x = this.node.position.x;
      if (this.Phase === "Approaching") {
        const left = Math.max(0, x - this.brakeStartX) / v, step = Math.min(dt, left);
        this.moveTo(x - v * step); this.CurrentSpeed = v; dt -= step;
        if (step >= left) { this.moveTo(this.brakeStartX); this.Phase = "Braking"; this.phaseTime = 0; }
      } else if (this.Phase === "Braking") {
        const step = Math.min(dt, Math.max(0, this.brakeDuration - this.phaseTime));
        this.phaseTime += step; dt -= step;
        const k = Mathf.clamp01(this.phaseTime / this.brakeDuration);
        this.CurrentSpeed = v * (1 - k);
        this.moveTo(this.stopX + (this.brakeStartX - this.stopX) * (1 - k) * (1 - k));
        if (this.phaseTime >= this.brakeDuration) {
          this.moveTo(this.stopX); this.CurrentSpeed = 0; this.Phase = "Waiting"; this.phaseTime = 0;
          this.playEngine(this.stoppedSound);
          Audio.play(this.dropOffBellSound, this.dropOffBellVolume);
          this.puffTires(false);
        }
      } else if (this.Phase === "Waiting") {
        const step = Math.min(dt, Math.max(0, this.stopSeconds - this.phaseTime));
        this.phaseTime += step; dt -= step;
        this.CurrentSpeed = 0;
        if (this.arrivalPassenger && !this.arrivalPassenger.activeSelf && this.phaseTime >= Mathf.clamp(this.passengerSpawnDelay, 0, this.stopSeconds)) this.arrivalPassenger.setActive(true);
        if (this.phaseTime >= this.stopSeconds) { this.Phase = "Departing"; this.phaseTime = 0; this.playEngine(this.departureSound); this.puffTires(true); }
      } else if (this.Phase === "Departing") {
        this.phaseTime += dt; dt = 0;
        const acc = Math.max(0.1, this.accelerationSeconds), t = Math.min(this.phaseTime, acc);
        const dist = 0.5 * v / acc * t * t + v * Math.max(0, this.phaseTime - acc);
        this.CurrentSpeed = v * Mathf.clamp01(this.phaseTime / acc);
        this.moveTo(this.stopX - dist);
        if (this.offscreenLeft()) { this.Phase = "Gone"; this.CurrentSpeed = 0; this.node.setActive(false); }
      }
    }
  }
  moveTo(x) {
    const d = this.node.position.x - x;
    this.node.setPosition(x, this.routeY);
    for (const w of this.wheels || []) if (w) w.lrot += d / Math.max(0.01, this.wheelRadius) * Mathf.DEG;
  }
  get tailX() {
    let m = -Infinity;
    for (const sr of this.artwork || []) if (sr.enabled && sr.sprite) m = Math.max(m, sr.bounds.maxX);
    return m === -Infinity ? this.node.position.x : m;
  }
  offscreenLeft() {
    const cam = Camera.main;
    const left = cam ? cam.node.position.x - cam.orthographicSize * cam.aspect : -20;
    return this.tailX < left - this.offscreenMargin;
  }
  puffTires(departing) {
    const frames = departing && this.departureTireSmoke && this.departureTireSmoke.length ? this.departureTireSmoke : this.tireSmoke;
    if (!frames || !frames.length || !this.wheels) return;
    this.wheels.forEach((w, i) => {
      const a = this.tireSmokeAnchors && this.tireSmokeAnchors[i];
      const p = a ? a.position : { x: w.position.x, y: w.position.y - this.wheelRadius };
      const k = (this.smokeScale || 1.35) * (departing ? 1.15 : 1) * (i === 0 ? this.frontDustScale : 1);
      const sr = FX.anim(frames, p.x, p.y, this.smokeFps, 22, 1, 0, true, { r: 1, g: 1, b: 1, a: 0.9 });
      if (sr) { sr.node.lsx = k; sr.node.lsy = k * 0.6; sr.layerRank = 2; }
    });
  }
}
reg(LevelTwoSchoolBus, "HypoFangs.Prologue.LevelTwoSchoolBus");

// Akari: bus drop-in (her Animator and walk live in abduction.js, GirlWalkToTruck)

export class GirlBusDropIn extends Component {
  init(d) { Object.assign(this, d); this.Phase = "None"; }
  awake() { this.spawn = this.node.position; }
  onEnable() { this.Phase = "Pending"; }
  lateUpdate() {
    if (G.paused || !this.girl || !this.bus) return;
    const g = this.girl;
    if (this.Phase === "Pending") {
      if (!this.bus.Arrived) return;
      this.GroundY = this.spawn.y;
      let best = Infinity;
      for (const h of raycastAll(this.spawn.x, this.spawn.y + this.dropHeight + 0.05, 0, -1, this.dropHeight + 2, mask("Ground"), { noTriggers: true }))
        if (h.distance < best) { best = h.distance; this.GroundY = h.point.y; }
      g.animatorEnabled = false;
      this.SpawnedAt = Time.time; this.Phase = "Dropping";
    }
    if (this.Phase === "WaitingForBus") {
      if (this.bus.Phase === "Departing" && this.bus.CurrentSpeed > 0.01) { this.Phase = "LandingRecovery"; this.RecoveryStartedAt = Time.time; this.recovery(); }
    } else if (this.Phase === "LandingRecovery") this.recovery();
    else if (this.Phase === "Dropping") {
      const t = Math.max(0, Time.time - this.SpawnedAt);
      this.node.setPosition(this.spawn.x, Math.max(this.GroundY, this.GroundY + this.dropHeight - 0.5 * this.gravity * t * t));
      if (this.dropFrames && this.dropFrames.length) g.artwork.sprite = this.dropFrames[Math.min(this.dropFrames.length - 1, Math.floor(t * this.framesPerSecond))];
      if (!(this.node.position.y > this.GroundY)) { this.Phase = "Landed"; g.animatorEnabled = true; g.t = 0; }
    }
  }
  recovery() {
    const f = this.landingRecoveryFrames || [];
    const i = Math.floor((Time.time - this.RecoveryStartedAt) * Math.max(1, this.landingRecoveryFramesPerSecond));
    if (i < f.length) { this.girl.artwork.sprite = f[i]; return; }
    this.Phase = "Landed"; this.girl.animatorEnabled = true;
  }
}
GirlBusDropIn.order = 20;
reg(GirlBusDropIn, "HypoFangs.Prologue.GirlBusDropIn");

// speech box state shared with the overlay renderer
export const Speech = { boxes: new Set() };

export class GirlSchoolDialogue extends Component {
  init(d) { Object.assign(this, d); this.reset(); }
  reset() { this.HasShown = false; this.presenting = false; this.clock = 0; this.RevealedLetters = 0; this.pages = []; this.pageIndex = 0; this.tailPassedAt = -1; this.sighPlayed = false; this.alpha = 0; }
  get CurrentMessage() { return this.pages.length ? this.pages[this.pageIndex] : ""; }
  get Visible() { return this.presenting && this.alpha > 0; }
  get Done() { return this.HasShown && !this.presenting; }
  get FullyRevealed() { return this.pages.length > 0 && this.pageIndex === this.pages.length - 1 && this.RevealedLetters >= this.CurrentMessage.length; }
  onEnable() { Speech.boxes.add(this); }
  onDisable() { Speech.boxes.delete(this); }
  busTailHasPassed() { return this.bus && this.girl && (this.bus.Phase === "Departing" || this.bus.Disappeared) && this.bus.tailX < this.girl.position.x; }
  show() {
    if (this.HasShown) return;
    this.pages = this.message.replace(/\r/g, "").split("\n").filter((s) => s.length);
    if (!this.pages.length) return;
    this.presenting = this.HasShown = true; this.alpha = 1;
    this.beginPage(0);
  }
  beginPage(i) { this.pageIndex = i; this.clock = 0; this.RevealedLetters = 0; }
  advance() {
    if (!this.presenting || !this.CurrentMessage.length) return;
    const dur = this.CurrentMessage.length / Math.max(1, this.lettersPerSecond);
    if (this.RevealedLetters < this.CurrentMessage.length) { this.clock = dur + 0.0001; this.RevealedLetters = this.CurrentMessage.length; return; }
    if (this.pageIndex < this.pages.length - 1) { this.beginPage(this.pageIndex + 1); return; }
    this.presenting = false; this.alpha = 0;
  }
  update() {
    if (G.paused || G.menuOpen) return;
    if (this.bus && !this.bus.Arrived) { if (this.HasShown || this.tailPassedAt >= 0) this.reset(); return; }
    if (!this.HasShown && this.bus && this.girl && this.girl.activeInHierarchy) {
      if (this.tailPassedAt < 0 && this.busTailHasPassed()) this.tailPassedAt = Time.time;
      if (this.tailPassedAt >= 0 && Time.time - this.tailPassedAt >= this.startDelaySeconds) this.show();
    }
    if (!this.presenting) return;
    Music.dialogue();
    if (advancePressed()) this.advance();
    if (!this.presenting) return;
    this.clock += Time.deltaTime;
    const lps = Math.max(1, this.lettersPerSecond);
    while (this.pageIndex < this.pages.length - 1) {
      const hold = this.pageIndex === 0 ? this.firstBoxHoldSeconds : this.secondBoxHoldSeconds;
      const end = this.CurrentMessage.length / lps + Math.max(0, hold);
      if (this.clock < end) break;
      const rest = this.clock - end;
      this.beginPage(this.pageIndex + 1);
      this.clock = rest;
    }
    const n = Math.min(this.CurrentMessage.length, Math.floor(this.clock * lps + 0.0001));
    if (n !== this.RevealedLetters) { DialogueAudio.printed(this.CurrentMessage, this.RevealedLetters, n); this.RevealedLetters = n; }
    if (!this.sighPlayed && this.RevealedLetters > 0 && this.CurrentMessage.trim() === "And where is he?") { this.sighPlayed = true; Audio.play(this.finalQuestionSigh, this.sighVolume); }
    if (this.pageIndex !== this.pages.length - 1) return;
    const fin = this.CurrentMessage.length / lps + this.finalBoxHoldSeconds;
    if (this.clock >= fin) {
      const k = Mathf.clamp01((this.clock - fin) / Math.max(0.05, this.fadeSeconds));
      this.alpha = 1 - k;
      if (k >= 1) this.presenting = false;
    }
  }
  letterColor(i) {
    if (this.pageIndex === 1) return this.schoolColor;
    if (this.pageIndex >= 2) return this.questionColor;
    const m = this.CurrentMessage, a = m.indexOf("Dad"), b = m.indexOf("after school");
    if (m[i] === "—") return this.schoolColor;
    if (a >= 0 && i >= a && i < a + 3) return this.brotherColor;
    if (b >= 0 && i >= b && i < b + 12) return this.schoolColor;
    return this.mainColor;
  }
  // speech box description for the overlay: text runs with colours, revealed count, speaker world point
  speech() {
    if (!this.Visible) return null;
    const p = this.girl.position;
    return placeSpeech({ text: this.CurrentMessage, revealed: this.RevealedLetters, color: (i) => this.letterColor(i), at: { x: p.x + this.speakerOffset.x, y: p.y + this.speakerOffset.y }, alpha: this.alpha, anchorY: 0.72 });
  }
}
reg(GirlSchoolDialogue, "HypoFangs.Prologue.GirlSchoolDialogue");

// DialogueAudio: a short tick for printed letters (DialogueTick clip)
export const DialogueAudio = {
  last: 0,
  printed(text, from, to) {
    for (let i = from; i < to; i++) {
      const ch = text[i];
      if (!ch || ch === " ") continue;
      if (Time.unscaledTime - this.last < 0.045) continue;
      this.last = Time.unscaledTime;
      if (GA.music) Audio.play(GA.music.dialogueBeep, 0.35, 0.95 + Math.random() * 0.1);
    }
  },
};

export class ParallaxBackground extends Component {
  init(d) { this.targetCamera = d.targetCamera; this.bottomOffset = d.bottomOffset; this.fixedHorizon = !!d.fixedHorizon; this.horizonY = d.horizonY; this.layers = d.layers || []; }
  lateUpdate() {
    if (G.paused) return;
    const cam = this.targetCamera || Camera.main;
    if (!cam) return;
    const upp = cam.orthographicSize * 2 / Math.max(1, G.viewH || 1080);
    const p = cam.node.position;
    const v = this.fixedHorizon ? this.horizonY : p.y - cam.orthographicSize + this.bottomOffset;
    this.node.setPosition(snap(p.x, upp), snap(v, upp));
    for (const l of this.layers) {
      const r = l.renderer;
      if (!r || !r.sprite) continue;
      const x = r.sprite.boundsW, sc = Math.abs(r.node.lossyScale.x);
      if (x <= 0 || sc <= 1e-6) continue;
      if (r.drawMode === 2 && r.size) {
        const w = 2 * cam.orthographicSize * cam.aspect;
        let n = Math.max(3, Math.ceil((w + 2 * upp) / (x * sc)) + 1);
        if (n % 2 === 0) n++;
        r.size.x = x * n;
      }
      const lx = -(Mathf.repeat(p.x * (1 - l.follow) / sc + x * 0.5, x) - x * 0.5);
      r.node.lx = snap(lx, upp / sc);
    }
  }
}
function snap(v, s) { return s > 0 ? Math.round(v / s) * s : v; }
ParallaxBackground.order = 100;
reg(ParallaxBackground, "HypoFangs.Prologue.ParallaxBackground");

export class CameraFollow2D extends Component {
  init(d) { Object.assign(this, d); this.vel = { x: 0, y: 0 }; this.look = 0; }
  awake() { this.cam = this.node.getComponent(Camera); this.exact = this.node.position; }
  start() { this.snapToTarget(); }
  setTarget(t) { this.target = t; this.snapToTarget(); }
  snapToTarget() { if (!this.target) return; this.anchorY = this.target.position.y; this.look = 0; this.vel = { x: 0, y: 0 }; this.exact = this.clamp(this.desired()); this.apply(); }
  desired() { const p = this.target.position; this.anchorY = p.y; return { x: p.x + this.offset.x + this.look, y: this.anchorY + this.offset.y }; }
  clamp(p) {
    const h = this.cam.orthographicSize, w = h * this.cam.aspect, b = this.bounds;
    return { x: b.width > 2 * w ? Mathf.clamp(p.x, b.x + w, b.x + b.width - w) : b.x + b.width / 2, y: b.height > 2 * h ? Mathf.clamp(p.y, b.y + h, b.y + b.height - h) : b.y + b.height / 2 };
  }
  lateUpdate() {
    if (G.paused || !this.target) return;
    const dt = Time.deltaTime;
    this.look = Mathf.lerp(this.look, 0, 1 - Math.exp(-2.5 * dt));
    const d = this.desired();
    if (dt > 0) { this.exact.x = Mathf.smoothDamp(this.exact.x, d.x, this.vel, "x", this.smoothTimeX, dt); this.exact.y = Mathf.smoothDamp(this.exact.y, d.y, this.vel, "y", this.smoothTimeY, dt); }
    this.exact = this.clamp(this.exact);
    this.apply();
  }
  apply() { this.node.setPosition(this.exact.x, this.exact.y); }
}
CameraFollow2D.order = 50;
reg(CameraFollow2D, "HypoFangs.Prologue.CameraFollow2D");

export class LevelTwoGirlCameraAnchor extends Component {
  init(d) { Object.assign(this, d); }
  awake() { this.position(); }
  lateUpdate() { if (!G.paused) this.position(); }
  position() {
    if (!this.girl || !this.anchor || !this.follow) return;
    this.anchor.setPosition(this.girl.position.x, this.groundY);
    if (this.follow.target !== this.anchor) this.follow.setTarget(this.anchor);
  }
}
LevelTwoGirlCameraAnchor.order = 30;
reg(LevelTwoGirlCameraAnchor, "HypoFangs.Prologue.LevelTwoGirlCameraAnchor");

// PrologueSequence: after the truck has left and the phone lies on the bridge, Gaku's phone call card, "A few hours later.",
// StrawHat (Zenji) finds Akari's phone on Maboroshi Bridge and runs off, then the title card and the Neon District.
const VOICE = { r: 224 / 255, g: 239 / 255, b: 1, a: 1 };
const CYAN = { r: 117 / 255, g: 231 / 255, b: 1, a: 1 };
const PINK = { r: 1, g: 143 / 255, b: 174 / 255, a: 1 };
const HIDE = (s) => s.split(" ").map((w) => (w ? `<color=#FFFFFF00>${w}</color>` : w)).join(" ");

// the original builds its ring / hang-up tones in code (MakePhoneTone); same waveform here
function phoneTone(seconds, disconnect) {
  const ctx = Audio.ctx;
  if (!ctx) return null;
  const rate = 22050, n = Math.ceil(seconds * rate), buf = ctx.createBuffer(1, n, rate), a = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / rate, c = t % 1.5;
    if (disconnect || c < 0.48 || (c >= 0.65 && c < 1.13)) {
      const env = Mathf.clamp01((disconnect ? Math.min(t, seconds - t) : Math.min(c % 0.65, 0.48 - (c % 0.65))) / 0.012);
      a[i] = env * 0.22 * (Math.sin(2 * Math.PI * (disconnect ? 480 : 440) * t) + Math.sin(2 * Math.PI * (disconnect ? 620 : 480) * t));
    }
  }
  return buf;
}

export class PrologueSequence extends Component {
  init(d) {
    Object.assign(this, d);
    this.Phase = "Bus arrival"; this.PhoneLineIndex = -1; this.card = null; this.leaving = false; this.inspecting = false; this.NarrativeFinished = false;
  }
  awake() {
    G.prologue = this;
    Music.playPeaceful();
    G.paused = G.frozen = G.previewing = false;
    G.inputLocked = true;
    Time.timeScale = 1;
    if (this.hero) this.hero.node.setActive(false);
    this.school = (G.sceneNodes || []).map((n) => n.getComponent(GirlSchoolDialogue)).find(Boolean);
    this.presenters = (G.sceneNodes || []).map((n) => n.getComponent(CarDialoguePresenter)).filter(Boolean);
    // LevelTwoDialogueClearance.protectedActors
    const actors = ["Akari - Prologue", "Takeru - Prologue Actor", "Dodge Ram Rebel TRX - Level 2", "School Bus - Level 2 Entrance"];
    protectSpeechActors((G.sceneNodes || []).filter((n) => actors.includes(n.name)).flatMap((n) => n.getComponentsInChildren(SpriteRenderer, true)));
  }
  onDestroy() {
    if (G.prologue === this) G.prologue = null;
    protectSpeechActors(null);
    this.stopTone();
  }
  start() { this.startCoroutine(this.run()); }
  *run() {
    while (!(this.departure && this.departure.Phase === "Gone" && this.phoneDrop && this.phoneDrop.Phase === "Resting")) yield;
    yield { seconds: 1 };
    this.card = { alpha: 1, text: "", size: 48 };
    yield* this.phoneCall();
    this.Phase = "A few hours later";
    const later = "A few hours later.";
    for (let t = 0; t < later.length / 20; t += Time.deltaTime) {
      const n = Math.min(later.length, Math.floor(t * 20));
      this.card.text = later.slice(0, n) + HIDE(later.slice(n));
      yield;
    }
    this.card.text = later;
    yield { seconds: 3 };
    const cam = Camera.main, hero = this.hero, anim = this.heroAnimation;
    hero.node.setPosition(cam.node.position.x - cam.orthographicSize * cam.aspect - 1.5, this.phoneDrop.GroundY + 0.04);
    hero.node.setActive(true);
    hero.flipX = false;
    anim.play(GA.playerRun, 12, true);
    for (let t = 0; t < 0.5; t += Time.deltaTime) { this.card.alpha = 1 - t / 0.5; yield; }
    this.card = null;
    this.Phase = "StrawHat approaches the phone";
    const walking = this.startCoroutine(this.walkTo(this.phoneDrop.phone.node.position.x - 0.55));
    yield* this.speak("Her signal stopped here… Maboroshi Bridge?");
    yield walking;
    this.Phase = "Phone discovery";
    yield* this.speak("Wait… that’s Akari’s phone.");
    this.inspecting = true;
    anim.enabled = false;
    const land = GA.playerLand || [];
    for (let j = land.length - 1; j >= 0; j--) { hero.sprite = land[j]; yield { seconds: 0.1 }; }
    yield* this.speak("These tire marks… they’re still fresh.");
    if (this.inspectionDust && this.inspectionDust.length) {
      const p = hero.node.position;
      const sr = FX.anim(this.inspectionDust, p.x, p.y, 12, 22, 1, 0, false, { r: 1, g: 1, b: 1, a: 0.65 });
      if (sr) { sr.layerRank = 2; sr.node.lsx = 0.8; sr.node.lsy = 0.4; }
    }
    for (let j = 0; j < land.length; j++) { hero.sprite = land[j]; yield { seconds: 0.1 }; }
    this.inspecting = false;
    anim.enabled = true;
    anim.play(GA.playerIdle, 8, true);
    yield* this.speak("AKARI!", PINK);
    yield* this.speak("Been a while since I had to get serious.");
    this.Phase = "StrawHat runs offscreen";
    if (this.follow) this.follow.enabled = false;
    hero.flipX = false;
    anim.play(GA.playerRun, 16, true);
    while (hero.bounds.minX <= cam.node.position.x + cam.orthographicSize * cam.aspect + 0.5) {
      const p = hero.node.position;
      hero.node.setPosition(p.x + this.exitRunSpeed * Time.deltaTime, p.y);
      yield;
    }
    yield { seconds: 0.25 };
    this.NarrativeFinished = true;
    this.Phase = "The hunt begins";
    this.card = { alpha: 1, text: "", size: 48 };
    yield { seconds: 0.5 };
    this.card.text = "HYPOFANGS\n\nTHE HUNT BEGINS";
    yield { seconds: 2.5 };
    this.beginGameplay();
  }
  playTone(seconds, disconnect) {
    this.stopTone();
    const ctx = Audio.ctx, buf = phoneTone(seconds, disconnect);
    if (!buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; g.gain.value = 0.4;
    src.connect(g); g.connect(Audio.sfxGain);
    src.start();
    const tone = (this.tone = { src, g });
    stopWithScene(() => { try { tone.src.stop(); } catch (e) { } });
  }
  stopTone() { if (this.tone) { try { this.tone.src.stop(); } catch (e) { } this.tone = null; } }
  *phoneCall() {
    this.card.size = 56;
    this.Phase = "Phone ringing";
    this.playTone(2.6, false);
    yield { seconds: 2.6 + 0.35 };
    this.Phase = "Gaku's phone call";
    for (let line = 0; line < this.phoneConversation.length; line++) {
      this.PhoneLineIndex = line; this.phoneAdvance = false;
      const e = this.phoneConversation[line];
      const col = e.speaker === "GAKU" ? "#FF8FAE" : "#75E7FF";
      const head = `<color=${col}>${e.speaker}</color>\n\n`;
      let prev = 0, instant = false;
      for (let t = 0; t < e.text.length / 32; t += Time.deltaTime) {
        if (this.phoneAdvance) { this.phoneAdvance = false; instant = true; break; }
        const n = Math.min(e.text.length, Math.floor(t * 32));
        DialogueAudio.printed(e.text, prev, n); prev = n;
        Music.dialogue();
        this.card.text = head + e.text.slice(0, n) + HIDE(e.text.slice(n));
        yield;
      }
      if (!instant) DialogueAudio.printed(e.text, prev, e.text.length);
      this.card.text = head + e.text;
      for (let t = 0; t < 2.8; t += Time.deltaTime) { if (this.phoneAdvance) break; Music.dialogue(); yield; }
      this.phoneAdvance = false;
    }
    this.PhoneLineIndex = -1;
    this.Phase = "Call disconnected";
    this.card.text = "";
    this.playTone(0.28, true);
    yield { seconds: 1.75 };
    this.card.size = 48;
  }
  *walkTo(x) {
    const hero = this.hero;
    while (hero.node.position.x < x) {
      const p = hero.node.position;
      hero.node.setPosition(Mathf.moveTowards(p.x, x, this.walkSpeed * Time.deltaTime), p.y);
      yield;
    }
    this.heroAnimation.play(GA.playerIdle, 8, true);
  }
  *speak(text, color = null) {
    const colors = Array.from({ length: text.length }, () => color || VOICE);
    for (const w of ["Rensei", "Akari", "Maboroshi Bridge", "phone", "tire marks", "still fresh"]) {
      const i = text.indexOf(w);
      if (i >= 0) for (let k = i; k < i + w.length; k++) colors[k] = CYAN;
    }
    const d = this.dialogue;
    d.showLine(text, this.hero.node, { x: 0, y: this.inspecting ? 0.8 : 1.6 }, { x: 0.5, y: 0.7 }, colors);
    d.revealFirstLetter();
    while (!(d.FullyRevealed && !d.Visible)) yield;
    yield;
  }
  lateUpdate() {
    if (!G.paused && this.hero && this.hero.node.activeInHierarchy && this.phoneDrop) SpriteSurfaces.ground(this.hero, this.phoneDrop.GroundY, 0.005);
  }
  update() {
    if (this.leaving || G.menuOpen) return;
    if (advancePressed() && this.PhoneLineIndex >= 0) this.phoneAdvance = true;
    if (!G.paused && Input.hit("Tab")) this.beginGameplay();
    else if (Input.hit("Escape", "KeyP")) this.togglePause();
  }
  // on-screen "next line" button (DialogueNavigation.AdvancePresenters)
  advanceDialogue() {
    if (G.paused) return;
    if (this.PhoneLineIndex >= 0) { this.phoneAdvance = true; return; }
    if (this.school && this.school.presenting) this.school.advance();
    for (const p of this.presenters) if (p.presenting) p.advance();
  }
  togglePause() { if (G.paused) { if (G.pauseMenu) G.pauseMenu.backOrResume(); else this.setPaused(false); } else this.setPaused(true); }
  setPaused(p) {
    if (G.paused === p) return;
    G.paused = p; Time.timeScale = p ? 0 : 1;
    if (Audio.ctx && this.tone) { if (p) this.tone.g.gain.value = 0; else this.tone.g.gain.value = 0.4; }
    if (G.pauseMenu) { if (p) G.pauseMenu.open(); else G.pauseMenu.hide(); }
  }
  restartPrologue() { this.setPaused(false); G.loadScene("level0"); }
  beginGameplay() {
    if (this.leaving || G.paused) return;
    this.leaving = true;
    this.stopTone();
    G.inputLocked = false;
    G.roomIndex = 0;
    Prefs.setInt("hypofangs_room", 0);
    Prefs.setInt("hypofangs_prologue_complete", 1);
    Time.timeScale = 1;
    G.loadScene("level1");
  }
  // test hook: a one-line summary of the scene state
  dbg() {
    const n = (name) => (G.sceneNodes || []).find((x) => x.name === name);
    const truck = n("Dodge Ram Rebel TRX - Level 2"), girl = n("Akari - Prologue"), biker = n("Takeru - Prologue Actor");
    const f = (v) => v.toFixed(2);
    const box = this.presenters.find((p) => p.Visible);
    return `truck ${truck ? f(truck.position.x) : "-"} girl ${girl ? f(girl.position.x) : "-"} biker ${biker ? f(biker.position.x) : "-"} t=${f(Time.time)}${box ? " | " + box.CurrentMessage.slice(0, 40) : ""}`;
  }
}
reg(PrologueSequence, "HypoFangs.Prologue.PrologueSequence");
