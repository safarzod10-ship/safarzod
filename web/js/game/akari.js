// AkariMemorySequence (scene CharacterStage, Amayoi Garden): after the first boss, Akari faces Gaku, remembers the school
// rooftop, and Gaku punishes Takeru. Then the Neon District continues at the next room.
import { Component, Time, Mathf, Random, newNode } from "../engine/core.js";
import { registerScript, SpriteRenderer, Camera } from "../engine/scene.js";
import { Input } from "../engine/input.js";
import { Audio } from "../engine/audio.js";
import { G, GA, FX, Music, Prefs, Haptics, CombatAudio, CombatSound, CombatRole } from "./common.js";
import { SpriteSurfaces } from "./surfaces.js";
import { SpeechPresenter } from "./speech.js";
import { DialogueAudio } from "./prologue.js";

const PENDING = "hypofangs_akari_pending_room";
const C = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });
const RED = { r: 1, g: 0, b: 0, a: 1 };

export function beginAkariStory(nextRoom) { Prefs.setInt(PENDING, nextRoom); G.inputLocked = true; G.loadScene("level2"); }
export function resumePendingStory() { if (!Prefs.has(PENDING)) return false; G.inputLocked = true; G.loadScene("level2"); return true; }

function colors(line) {
  const cs = Array.from({ length: line.text.length }, () => (line.speaker === "AKARI" ? C(236, 193, 255) : RED));
  const hl = (p, c) => { const low = line.text.toLowerCase(); let i = 0; while ((i = low.indexOf(p, i)) >= 0) { for (let k = i; k < i + p.length; k++) cs[k] = c; i += p.length; } };
  hl("father", C(117, 231, 255)); for (const p of ["boss", "good person", "single day", "month"]) hl(p, C(255, 222, 128));
  for (const p of ["bodies", "demon", "fat ass", "hell", "mouth shut"]) hl(p, C(255, 143, 174));
  return cs;
}

export class AkariMemorySequence extends Component {
  init(d) { Object.assign(this, d); }
  awake() {
    G.akari = this;
    G.paused = G.frozen = G.previewing = false; G.inputLocked = true; Time.timeScale = 1;
    this.cam = this.sceneCamera;
    this.arenaCam = this.cam.node.position; this.arenaSize = this.cam.orthographicSize; this.arenaBg = { ...this.cam.backgroundColor };
    this.akariStart = this.akari.position; this.bikerStart = this.biker.position; this.gakuStart = this.gaku.position;
    this.bullyStart = this.bully.position; this.friendStart = this.friend.position;
    this.dialogue = new SpeechPresenter({ lettersPerSecond: this.lettersPerSecond, holdSeconds: this.autoAdvanceHold, anchorY: 0.68 });
    this.black = 0; this.flash = 0; this.shake = 0; this.narration = ""; this.fx = newNode("Cutscene Impact Effects", this.node);
    this.Phase = "Ready";
  }
  onDestroy() { if (G.akari === this) G.akari = null; G.inputLocked = false; G.paused = false; Time.timeScale = 1; this.dialogue.reset(); }
  start() { this.restartSequence(); }
  update() {
    if (Input.hit("Escape", "KeyP")) this.setPaused(!G.paused);
    if (!G.paused && Input.hit("Space", "Enter", "NumpadEnter", "Tap")) this.advanceRequested = true;
  }
  advanceDialogue() { this.advanceRequested = true; }
  togglePause() { this.setPaused(!G.paused); }
  setPaused(p) { if (G.paused === p) return; G.paused = p; Time.timeScale = p ? 0 : 1; if (G.pauseMenu) { if (p) G.pauseMenu.open(); else G.pauseMenu.hide(); } }
  restartSequence() {
    if (this.co) this.co.dead = true;
    for (const c of [...this.fx.children]) c.destroy();
    Music.playPeaceful();
    if (G.paused) this.setPaused(false);
    this.cam.node.setPosition(this.arenaCam.x, this.arenaCam.y); this.cam.orthographicSize = this.arenaSize; this.cam.backgroundColor = { ...this.arenaBg };
    this.arenaEnvironment.setActive(true); this.schoolRoot.setActive(false);
    for (const n of [this.akari, this.biker, this.gaku]) n.setActive(true);
    this.akari.setPosition(this.akariStart.x, this.akariStart.y); this.biker.setPosition(this.bikerStart.x, this.bikerStart.y); this.gaku.setPosition(this.gakuStart.x, this.gakuStart.y);
    this.bully.setPosition(this.bullyStart.x, this.bullyStart.y); this.friend.setPosition(this.friendStart.x, this.friendStart.y);
    this.bloodPool.setActive(false); this.bikerBloodPool.setActive(false);
    this.black = 0; this.narration = ""; this.dialogue.reset();
    this.bikerArt = this.bikerAnimation.node.getComponent(SpriteRenderer); this.bikerArt.color = { r: 1, g: 1, b: 1, a: 1 };
    this.setClip(this.bikerAnimation, this.bikerSitDown.slice(0, 3), this.sittingAndGestureFps, false, true);
    this.setClip(this.gakuAnimation, this.gakuIdle, 8, true, true);
    this.co = this.startCoroutine(this.run());
  }
  setClip(a, frames, fps, loop, flip) { a.enabled = true; a.node.getComponent(SpriteRenderer).flipX = flip; a.play(frames, fps, loop); }
  *playOnce(a, frames, fps) { this.setClip(a, frames, fps, false, a.node.getComponent(SpriteRenderer).flipX); while (!a.Finished) yield; }
  *wait(s) { for (let t = 0; t < s; t += Time.deltaTime) yield; }
  *fadeBlack(target, s) { const from = this.black; for (let t = 0; t < s; t += Time.deltaTime) { this.black = Mathf.lerp(from, target, t / s); yield; } this.black = target; }
  *run() {
    const L = (a) => a;
    this.Phase = "Akari sits down";
    yield* this.playOnce(this.akariAnimation, this.jumpTail, this.sittingAndGestureFps);
    this.Phase = "Arena conversation";
    for (const l of this.openingConversation) yield* this.say(l, false);
    this.Phase = "Akari gets up";
    yield* this.playOnce(this.akariAnimation, this.jumpTail.slice().reverse(), this.sittingAndGestureFps);
    yield* this.playOnce(this.akariAnimation, this.openingDoor, this.sittingAndGestureFps);
    this.Phase = "Akari defies Gaku";
    for (const l of this.defiance) yield* this.say(l, false);
    this.Phase = "Biker gets up";
    yield* this.playOnce(this.bikerAnimation, [this.bikerSitDown[3], this.bikerSitDown[0]], this.sittingAndGestureFps);
    yield* this.bikerDoubleJump({ x: this.akari.position.x + 0.82, y: this.bikerStart.y });
    this.Phase = "Biker punch windup";
    this.setClip(this.bikerAnimation, this.bikerClips.attack, this.attackFps, false, true);
    while (this.bikerAnimation.Frame < 4) yield;
    this.Phase = "Biker punch impact";
    this.setClip(this.akariAnimation, this.hurt, 12, false, false);
    const ap = this.akari.position;
    this.impact({ x: ap.x - 0.22, y: ap.y + 1.35 }, 0.28, 0.65, true);
    while (!this.bikerAnimation.Finished || !this.akariAnimation.Finished) yield;
    this.setClip(this.bikerAnimation, this.bikerClips.idle, 10, true, true);
    yield* this.wait(0.55);
    yield* this.fadeBlack(1, 0.55);
    this.Phase = "Memory introduction";
    for (const l of this.memoryIntroduction) yield* this.say(l, true);
    this.Phase = "School rooftop — protection";
    this.arenaEnvironment.setActive(false);
    for (const n of [this.akari, this.biker, this.gaku]) n.setActive(false);
    this.schoolRoot.setActive(true);
    this.cam.node.setPosition(0, 0); this.cam.orthographicSize = 4.1666665; this.cam.backgroundColor = { r: 0.44, g: 0.7, b: 0.91 };
    this.setClip(this.schoolAkariAnimation, this.protection, 10, false, false);
    this.setClip(this.bullyAnimation, this.bullyIdle, 10, true, true);
    this.setClip(this.friendAnimation, this.friendIdle, 10, true, true);
    yield* this.fadeBlack(0, 0.65);
    while (!this.schoolAkariAnimation.Finished) yield;
    this.Phase = "School bully taunt";
    this.setClip(this.bullyAnimation, this.bullyDialogue, 10, true, true);
    yield* this.say(this.bullyTaunt, false);
    this.setClip(this.bullyAnimation, this.bullyWalk, 12, true, true);
    const kx = this.schoolAkari.position.x + 0.45;
    while (this.bully.position.x > kx + 0.001) { const b = this.bully.position; this.bully.setPosition(Mathf.moveTowards(b.x, kx, 1.6 * Time.deltaTime), b.y); yield; }
    this.setClip(this.bullyAnimation, this.bullyAttack, 12, false, true);
    while (this.bullyAnimation.Frame < 6) yield;
    this.Phase = "School kick impact";
    this.setClip(this.schoolAkariAnimation, this.hurt, 12, false, false);
    const sp = this.schoolAkari.position;
    this.impact({ x: sp.x - 0.22, y: sp.y + 1.35 }, 0.1, 0.3, false);
    while (!this.schoolAkariAnimation.Finished) yield;
    Haptics.pulse(0.35, 0.1, 0.15);
    yield* this.playOnce(this.schoolAkariAnimation, this.death, 10);
    SpriteSurfaces.ground(this.schoolAkariAnimation.node.getComponent(SpriteRenderer), this.schoolAkari.position.y);
    this.Phase = "School bully threat";
    for (const l of this.bullyThreat) {
      const g3 = l.speaker === "GIRL 3";
      this.setClip(this.bullyAnimation, g3 ? this.bullyIdle : this.bullyDialogue, 10, true, true);
      this.setClip(this.friendAnimation, g3 && this.friendDialogue && this.friendDialogue.length ? this.friendDialogue : this.friendIdle, 10, true, true);
      yield* this.say(l, false);
    }
    this.setClip(this.friendAnimation, this.friendWalk, 12, true, false);
    this.setClip(this.bullyAnimation, this.bullyWalk, 12, true, false);
    while (this.bully.position.x < 10) {
      const d = 2 * Time.deltaTime, f = this.friend.position, b = this.bully.position;
      this.friend.setPosition(f.x + d, f.y); this.bully.setPosition(b.x + d, b.y);
      yield;
    }
    yield* this.fadeBlack(1, 0.65);
    this.Phase = "Akari's reflection";
    for (const l of this.finalNarration) yield* this.say(l, true);
    this.Phase = "Return to arena";
    this.schoolRoot.setActive(false); this.arenaEnvironment.setActive(true);
    for (const n of [this.akari, this.biker, this.gaku]) n.setActive(true);
    this.cam.node.setPosition(this.arenaCam.x, this.arenaCam.y); this.cam.orthographicSize = this.arenaSize; this.cam.backgroundColor = { ...this.arenaBg };
    this.biker.setPosition(this.akari.position.x + 3.2, this.bikerStart.y);
    this.setClip(this.bikerAnimation, this.bikerClips.idle, 10, true, true);
    this.setClip(this.akariAnimation, [this.death[this.death.length - 1]], 6, false, false);
    this.groundActor(this.akariAnimation, this.akari);
    const ab = SpriteSurfaces.bounds(this.akariAnimation.node.getComponent(SpriteRenderer));
    const minX = Math.min(...this.bikerClips.death.map((f) => SpriteSurfaces.bounds(this.bikerArt, f, false).minX));
    const bp = this.biker.position;
    this.biker.setPosition(bp.x + Math.max(0, ab.maxX + 0.75 - minX), bp.y);
    this.bloodPool.setActive(true);
    this.groundPool(this.bloodPool, this.akari);
    yield* this.fadeBlack(0, 1);
    yield* this.aftermath();
    this.Completed = true;
    if (Prefs.has(PENDING)) {
      yield* this.wait(1.5);
      yield* this.fadeBlack(1, 0.6);
      G.roomIndex = Prefs.getInt(PENDING, 0);
      Prefs.setInt("hypofangs_room", G.roomIndex);
      Prefs.del(PENDING);
      G.loadScene("level1");
    }
  }
  *aftermath() {
    this.bikerArt.flipX = false;
    this.Phase = "Biker turns toward Gaku and kneels";
    yield* this.playOnce(this.bikerAnimation, this.bikerSitDown.slice(0, 3), this.sittingAndGestureFps);
    this.Phase = "Gaku reprimands the kneeling biker";
    for (const l of this.gakuReprimand) yield* this.say(l, false);
    this.Phase = "Biker's excuse";
    yield* this.say(this.bikerExcuse, false);
    this.Phase = "Gaku's silence";
    yield* this.say(this.gakuDisbelief, false);
    yield* this.wait(0.8);
    yield* this.say(this.gakuOrder, false);
    this.Phase = "Biker rises while Gaku walks toward Akari";
    this.gakuApproaching = true;
    this.startCoroutine(this.walkGaku());
    yield* this.playOnce(this.bikerAnimation, [this.bikerSitDown[3], this.bikerSitDown[0]], this.sittingAndGestureFps);
    this.setClip(this.bikerAnimation, this.bikerClips.idle, 10, true, false);
    while (this.gakuApproaching && this.gaku.position.x - (this.biker.position.x + 1.8) > 2) yield;
    this.Phase = "Biker pleads while Gaku approaches";
    yield* this.say(this.bikerPlea, false, 0.1);
    while (this.gakuApproaching) yield;
    this.Phase = "Gaku Throw windup";
    this.setClip(this.gakuAnimation, this.gakuThrow, this.gakuThrowFps, false, true);
    let swing = false;
    while (this.gakuAnimation.Frame < Mathf.clamp(this.gakuStrikeFrame, 0, this.gakuThrow.length - 1)) {
      if (!swing && this.gakuAnimation.Frame >= 2) { swing = true; CombatAudio.play(CombatSound.BladeSwing, CombatRole.Gaku); }
      yield;
    }
    this.Phase = "Gaku slashes the biker";
    this.setClip(this.bikerAnimation, this.bikerClips.hurt, 12, false, false);
    const vb = SpriteSurfaces.bounds(this.bikerArt);
    const center = { x: vb.cx, y: this.biker.position.y + 1.35 };
    this.impact(center, 0.3, 0.45, true);
    this.gakuAnimation.enabled = false; this.bikerAnimation.enabled = false;
    for (const a of [-20, 10]) FX.anim(GA.RandomBlood(), center.x, center.y, 28, 24, 0.75, a, true, null, this.fx);
    this.startCoroutine(this.bloodSpray(center));
    this.bikerArt.color = { r: 1, g: 0.28, b: 0.25, a: 1 };
    yield* this.wait(0.09);
    this.bikerArt.color = { r: 1, g: 1, b: 1, a: 1 };
    this.gakuAnimation.enabled = true; this.bikerAnimation.enabled = true;
    const rs = this.biker.position;
    const ab = SpriteSurfaces.bounds(this.akariAnimation.node.getComponent(SpriteRenderer));
    const minX = Math.min(...this.bikerClips.death.map((f) => SpriteSurfaces.bounds(this.bikerArt, f, false).minX));
    const recoil = Math.min(0.22, Math.max(0, minX - ab.maxX - 0.35));
    for (let t = 0; t < 0.12; t += Time.deltaTime) { this.biker.setPosition(rs.x - recoil * Mathf.clamp01(t / 0.12), rs.y); yield; }
    this.biker.setPosition(rs.x - recoil, rs.y);
    while (!this.bikerAnimation.Finished) yield;
    this.Phase = "Biker collapses";
    Haptics.pulse(0.6, 0.15, 0.22);
    this.setClip(this.bikerAnimation, this.bikerClips.death, 10, false, false);
    const bp = this.biker.position;
    this.bikerBloodPool.setPosition(bp.x + 0.2, bp.y + 0.025);
    this.bikerBloodPool.setActive(true);
    this.groundPool(this.bikerBloodPool, this.biker);
    while (!this.gakuAnimation.Finished || !this.bikerAnimation.Finished) yield;
    this.groundActor(this.bikerAnimation, this.biker);
    this.groundPool(this.bikerBloodPool, this.biker);
    this.Phase = "Gaku looks back at Akari";
    this.setClip(this.gakuAnimation, this.gakuIdle, 8, true, true);
    yield* this.say(this.gakuFinalWarning, false);
  }
  *bloodSpray(c) {
    const drops = [];
    for (let i = 0; i < 22; i++) {
      const sr = FX.makeSprite("Gaku impact blood", GA.white, c.x, c.y, 26, true, this.fx);
      sr.color = i % 3 === 0 ? { r: 0.9, g: 0.045, b: 0.09, a: 1 } : { r: 0.48, g: 0.015, b: 0.045, a: 1 };
      const w = Random.range(0.05, 0.13);
      sr.node.lsx = w / GA.white.boundsW; sr.node.lsy = 0.035 / GA.white.boundsH;
      drops.push({ sr, v: { x: -Random.range(2, 6), y: Random.range(-1, 3.5) } });
    }
    for (let t = 0; t < 0.45; t += Time.deltaTime) {
      for (const d of drops) {
        d.sr.node.setPosition(c.x + d.v.x * t, c.y + d.v.y * t - 9 * t * t);
        d.sr.node.setRotation(Math.atan2(d.v.y - 18 * t, d.v.x) * Mathf.DEG);
        d.sr.color.a = Mathf.clamp01((0.45 - t) / 0.15);
      }
      yield;
    }
    for (const d of drops) d.sr.node.destroy();
  }
  groundActor(a, actor) {
    const p = actor.position, h = SpriteSurfaces.floor(p.x, p.y + 0.3, 1);
    SpriteSurfaces.ground(a.node.getComponent(SpriteRenderer), h ? h.point.y : p.y);
  }
  groundPool(pool, actor) {
    const p = actor.position, h = SpriteSurfaces.floor(p.x, p.y + 1, 3);
    const y = h ? h.point.y : p.y;
    pool.getComponentsInChildren(SpriteRenderer, true).forEach((sr, i) => SpriteSurfaces.flattenBlood(sr, { x: p.x + (i - 1) * 0.28, y }, { x: 0, y: 1 }, 0.9, 0.065));
  }
  *walkGaku() {
    this.setClip(this.gakuAnimation, this.gakuWalk, 8, true, true);
    const tx = this.biker.position.x + 1.8;
    while (Math.abs(this.gaku.position.x - tx) > 0.001) { const g = this.gaku.position; this.gaku.setPosition(Mathf.moveTowards(g.x, tx, this.gakuApproachSpeed * Time.deltaTime), this.gakuStart.y); yield; }
    this.setClip(this.gakuAnimation, this.gakuIdle, 8, true, true);
    this.gakuApproaching = false;
  }
  *bikerDoubleJump(landing) {
    const from = this.biker.position;
    const boost = { x: from.x + (landing.x - from.x) * 0.45, y: from.y + (landing.y - from.y) * 0.45 + 0.55 };
    const s1 = Math.max(0.4, this.bikerDoubleJumpSeconds) * 0.4, s2 = Math.max(0.4, this.bikerDoubleJumpSeconds) * 0.6;
    const dj = this.bikerClips.doubleJump;
    Haptics.pulse(0.5, 0.18, 0.13);
    Audio.play(this.bikerTakeoffSound, 0.8);
    this.setClip(this.bikerAnimation, dj, dj.length / s1, false, true);
    for (let e = 0; e < s1; e += Time.deltaTime) { const k = Mathf.clamp01(e / s1); this.biker.setPosition(from.x + (boost.x - from.x) * k, from.y + (boost.y - from.y) * k + 4 * this.bikerFirstArcHeight * k * (1 - k)); yield; }
    this.biker.setPosition(boost.x, boost.y);
    Haptics.pulse(0.3, 0.25, 0.1);
    this.setClip(this.bikerAnimation, dj, dj.length / s2, false, true);
    for (let e = 0; e < s2; e += Time.deltaTime) { const k = Mathf.clamp01(e / s2); this.biker.setPosition(boost.x + (landing.x - boost.x) * k, boost.y + (landing.y - boost.y) * k + 4 * this.bikerSecondArcHeight * k * (1 - k)); yield; }
    this.biker.setPosition(landing.x, landing.y);
    Haptics.pulse(0.9, 0.35, 0.25);
    Audio.play(this.bikerLandingSound, 0.8);
    this.setClip(this.bikerAnimation, this.bikerClips.idle, 10, true, true);
    FX.anim(GA.dust, landing.x, landing.y + 0.08, 24, 9, 0.8, 0, false, null, this.fx);
    yield* this.wait(0.08);
  }
  *say(line, narration, hold = -1) {
    this.advanceRequested = false;
    this.CurrentSpeaker = line.speaker; this.CurrentText = line.text;
    if (narration) {
      this.dialogue.reset();
      const head = `<color=#ECC1FF>${line.speaker}</color>\n\n`;
      let clock = 0, rev = 0;
      while (rev < line.text.length) {
        if (this.advanceRequested) { this.advanceRequested = false; rev = line.text.length; }
        else {
          clock += Time.deltaTime;
          const n = Math.min(line.text.length, Math.floor(clock * this.narrationLettersPerSecond));
          DialogueAudio.printed(line.text, rev, n); rev = n;
        }
        Music.dialogue();
        this.narration = head + line.text.slice(0, rev);
        yield;
      }
      this.narration = head + line.text;
      let held = 0;
      while (!this.advanceRequested && (!this.autoAdvance || held < this.narrationHold)) { Music.dialogue(); held += Time.deltaTime; yield; }
      this.narration = "";
    } else {
      const sp = line.speaker, akari = sp === "AKARI", biker = sp === "TAKERU" || sp === "BIKER", g3 = sp === "GIRL 3";
      const src = akari ? (this.schoolRoot.activeSelf ? this.schoolAkari : this.akari) : biker ? this.biker : sp === "GIRL 2" ? this.bully : g3 ? this.friend : this.gaku;
      const y = akari ? (this.Phase === "Arena conversation" ? 1 : 1.5) : biker ? (this.Phase === "Biker's excuse" ? 1.15 : 1.8) : sp === "GIRL 2" || g3 ? 1.5 : 2;
      const d = this.dialogue;
      d.lettersPerSecond = this.lettersPerSecond;
      d.holdSeconds = hold >= 0 ? hold : this.autoAdvance ? this.autoAdvanceHold : 1e9;
      d.showLine(line.text, src, { x: 0, y }, colors(line));
      d.revealFirstLetter();
      while (!d.FullyRevealed || d.Visible) {
        if (this.advanceRequested) { this.advanceRequested = false; d.advance(); }
        d.tick();
        yield;
      }
    }
    this.advanceRequested = false;
    this.CurrentSpeaker = this.CurrentText = "";
    yield;
  }
  impact(p, strength, duration, blood) {
    this.shake = this.shakeDur = duration; this.shakeStrength = strength;
    Haptics.fromShake(strength, duration);
    this.flash = 0.12;
    const gk = this.Phase === "Gaku slashes the biker";
    CombatAudio.play(gk ? CombatSound.BladeImpact : CombatSound.BodyImpact, gk ? CombatRole.Gaku : CombatRole.Npc);
    if (blood) FX.anim(GA.RandomBlood(), p.x, p.y, 24, 24, 0.55, 0, true, null, this.fx);
  }
  lateUpdate() {
    if (G.paused) return;
    const base = this.schoolRoot.activeSelf ? { x: 0, y: 0 } : this.arenaCam;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - Time.deltaTime);
      const u = Random.insideUnitCircle(), k = this.shakeStrength * (this.shake / this.shakeDur);
      this.cam.node.setPosition(base.x + u.x * k, base.y + u.y * k);
    } else this.cam.node.setPosition(base.x, base.y);
    this.flash = Math.max(0, this.flash - Time.deltaTime);
  }
}
AkariMemorySequence.typeName = "HypoFangs.AkariMemorySequence";
registerScript(AkariMemorySequence);

// LevelOneBikerGuard: Takeru's sprite clips (used as data by the cutscenes)
export class LevelOneBikerGuard extends Component {
  init(d) { Object.assign(this, d); }
}
LevelOneBikerGuard.typeName = "HypoFangs.Prologue.LevelOneBikerGuard";
registerScript(LevelOneBikerGuard);
