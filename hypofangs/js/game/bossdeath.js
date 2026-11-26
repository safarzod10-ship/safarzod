// BossDeathSequence: bosses 1-4 do not just drop; the room cuts to black, the boss collapses and says final words.
import { Component, Mathf, Runtime } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { Camera } from "../engine/scene.js";
import { overlapBox, mask } from "../engine/physics.js";
import { G, GA, FX, GameClock } from "./common.js";
import { SpriteSurfaces } from "./surfaces.js";
import { SpeechPresenter, COL, fill } from "./speech.js";

const or = (a, b) => (a && a.length ? a : b);
const advanced = () => !G.paused && Input.hit("Space", "Enter", "NumpadEnter", "Tap");

export class BossDeathSequence extends Component {
  constructor() { super(); this.IsPlaying = false; this.blackout = 0; this.dialogue = new SpeechPresenter({ unscaled: true, lettersPerSecond: 36, holdSeconds: 2.4 }); this.Kneeling = false; }
  static tryStart(boss) {
    const lm = G.level;
    if (!lm || !lm.player || lm.player.Dead || !boss.IsBoss || boss.bossLevel < 1 || boss.bossLevel > 4) return false;
    let s = lm.extras.bossDeath;
    if (!s) { s = lm.extras.bossDeath = new BossDeathSequence(); lm.node.addComponent(s); }
    return s.begin(boss);
  }
  begin(boss) {
    if (this.IsPlaying || !this.isActiveAndEnabled) return false;
    const lm = this.level = G.level, p = this.player = lm.player;
    this.Victim = boss;
    this.anchor = { position: { x: 0, y: 0 } };
    this.oldFrozen = G.frozen; this.oldLocked = G.inputLocked; this.oldController = p.enabled;
    this.oldPU = p.anim.unscaled; this.oldBU = boss.anim.unscaled;
    this.oldOverride = lm.cam.useOverride; this.oldTarget = { ...lm.cam.overrideTarget }; this.oldSize = lm.cam.cam.orthographicSize;
    const v = p.visual.node; this.art = [v.lx, v.ly, v.lrot, v.lsx, v.lsy];
    this.owns = this.IsPlaying = true; this.Kneeling = false;
    G.inputLocked = G.frozen = true;
    p.stopForDialogue();
    Runtime.setEnabled(p, false);
    p.rb.velocity = { x: 0, y: 0 };
    boss.prepareFarewell();
    p.anim.unscaled = boss.anim.unscaled = true;
    this.blackout = 1;
    this.co = this.startCoroutine(this.play());
    return true;
  }
  *play() {
    this.stageActors();
    let e = 0;
    while (e + 0.0001 < 1) { e += GameClock.UnscaledDt; yield; }
    for (let t = 0; t < 0.2; t += GameClock.UnscaledDt) { this.blackout = 1 - t / 0.2; yield; }
    this.blackout = 0;
    const V = this.Victim, art = V.art;
    V.anim.play(or(art.hurt, art.idle), 10, false);
    while (!V.anim.Finished) yield;
    V.anim.play(or(art.dead, art.hurt), 8, false);
    V.farewellBlood();
    while (!V.anim.Finished) yield;
    SpriteSurfaces.ground(V.visual, this.floorY);
    this.fitCorpse();
    this.placePlayer();
    const b = SpriteSurfaces.bounds(V.visual);
    this.anchor.position = { x: b.cx, y: b.cy };
    this.makePool();
    switch (V.bossLevel) {
      case 1: yield* this.say("ISAMU", "Gaku… will bury you.", false); yield* this.say("ZENJI", "He’ll have to come out first.", true); break;
      case 2: yield* this.say("SHIN", "You’re… still a monster.", false); yield* this.say("ZENJI", "You knew that. You stood in my way anyway.", true); break;
      case 3: yield* this.say("RITSU", "Tell Ruten… I’m sorry.", false); yield* this.say("ZENJI", "You should’ve told him yourself.", true); break;
      case 4:
        yield* this.say("RUTEN", "You always… did hit hard.", false);
        yield* this.kneel();
        yield* this.say("ZENJI", "Save your breath.", true);
        yield* this.say("RUTEN", "Go get her. Don’t let this… be for nothing.", false);
        yield* this.say("ZENJI", "I’m sorry, old friend.", true);
        yield* this.stand();
        break;
    }
    V.finishFarewell();
    this.cleanup();
    if (this.level && V) this.level.onEnemyKilled(V);
  }
  sameFloor(x) { const h = SpriteSurfaces.floor(x, this.floorY + 0.2, 0.4); return h && Math.abs(h.point.y - this.floorY) < 0.05; }
  hasFloor(x, y) { const h = SpriteSurfaces.floor(x, y + 0.15, 0.3); return h && Math.abs(h.point.y - y) < 0.04; }
  stageActors() {
    const lm = this.level, V = this.Victim, p = this.player, r = lm.CurrentRoomBounds;
    const vx = Mathf.clamp(V.node.position.x, r.x + 2, r.x + r.width - 2);
    let found = false, best = Infinity, bx = vx;
    this.floorY = r.y;
    const vb = V.body.bounds;
    for (const y of [Math.min(vb.minY + 0.3, r.y + r.height - 2.5), r.y + r.height - 2.5]) {
      for (let o = -8; o <= 8.01; o += 0.25) {
        const x = Mathf.clamp(vx + o, r.x + 1, r.x + r.width - 1);
        const h = SpriteSurfaces.floor(x, y, r.height + 1);
        if (!h) continue;
        const fy = h.point.y;
        if (h.distance <= 0.0001 || fy < r.y || fy > r.y + r.height - 2.5 || !this.hasFloor(x - 2.2, fy) || !this.hasFloor(x + 2.2, fy) || overlapBox(x, fy + 1.2, 4.3, 2.2, mask("Ground"), { noTriggers: true })) continue;
        const cost = Math.abs(x - vx) + Math.abs(fy - vb.minY) * 0.5;
        if (cost < best) { best = cost; found = true; bx = x; this.floorY = fy; }
      }
    }
    if (!found) { const h = SpriteSurfaces.floor(vx, r.y + r.height - 2.5, r.height + 1); if (h) this.floorY = h.point.y; }
    V.anim.play(V.art.idle, 8, true);
    const side = !(p.node.position.x <= bx) ? 1 : -1;
    const px = bx + side * 1.25;
    const vp = V.node.position;
    V.node.setPosition(bx, vp.y + this.floorY + 0.01 - V.body.bounds.minY);
    p.anim.play(GA.playerIdle, 8, true);
    p.teleport(px, this.floorY + 0.01, -side);
    const pp = p.node.position;
    p.teleport(pp.x, pp.y + this.floorY + 0.01 - p.body.bounds.minY, -side);
    p.visual.flipX = p.Facing < 0;
    V.face(side);
    SpriteSurfaces.ground(p.visual, this.floorY, 0.005);
    SpriteSurfaces.ground(V.visual, this.floorY, 0.005);
    lm.cam.useOverride = true;
    lm.cam.overrideTarget = { x: (px + bx) * 0.5, y: this.floorY + 1.6 };
    lm.cam.cam.orthographicSize = Math.max(3, Math.min(this.oldSize, 4));
    lm.cam.snap();
  }
  fitCorpse() {
    const V = this.Victim, b = SpriteSurfaces.bounds(V.visual);
    let l = V.node.position.x, r = l;
    for (let i = 0; i < 150 && this.sameFloor(l - 0.04); i++) l -= 0.04;
    for (let i = 0; i < 150 && this.sameFloor(r + 0.04); i++) r += 0.04;
    if (r - l >= b.sx + 0.04) {
      const s = Math.max(0, l + 0.02 - b.minX) - Math.max(0, b.maxX - r + 0.02);
      const p = V.node.position; V.node.setPosition(p.x + s, p.y);
    }
  }
  placePlayer() {
    const p = this.player, b = SpriteSurfaces.bounds(this.Victim.visual);
    const side = !(p.node.position.x <= b.cx) ? 1 : -1;
    const x = side < 0 ? b.minX - 0.3 : b.maxX + 0.3;
    if (!this.sameFloor(x)) return;
    p.teleport(x, this.floorY + 0.01, -side);
    const pp = p.node.position;
    p.teleport(pp.x, pp.y + this.floorY + 0.01 - p.body.bounds.minY, -side);
    p.visual.flipX = p.Facing < 0;
    SpriteSurfaces.ground(p.visual, this.floorY, 0.005);
    this.level.cam.overrideTarget = { x: (x + b.cx) * 0.5, y: this.floorY + 1.6 };
  }
  *kneel() {
    const p = this.player, b = SpriteSurfaces.bounds(this.Victim.visual);
    const side = !(p.node.position.x < b.cx) ? 1 : -1;
    let target = side < 0 ? b.minX - 0.35 : b.maxX + 0.35;
    if (!this.sameFloor(target)) target = p.node.position.x;
    p.teleport(p.node.position.x, p.node.position.y, -side);
    p.visual.flipX = p.Facing < 0;
    p.anim.play(GA.playerRun, 8, true);
    while (Math.abs(p.node.position.x - target) > 0.015) {
      const pp = p.node.position;
      p.teleport(Mathf.moveTowards(pp.x, target, 2.2 * GameClock.UnscaledDt), pp.y, -side);
      yield;
    }
    if (GA.playerLand && GA.playerLand.length) { p.anim.play(GA.playerLand.slice().reverse(), 10, false); while (!p.anim.Finished) yield; }
    this.Kneeling = true;
  }
  *stand() {
    const p = this.player;
    if (GA.playerLand && GA.playerLand.length) { p.anim.play(GA.playerLand, 10, false); while (!p.anim.Finished) yield; }
    this.Kneeling = false;
    p.anim.play(GA.playerIdle, 8, true);
  }
  *say(who, text, zenji) {
    this.CurrentSpeaker = who; this.CurrentText = text;
    const d = this.dialogue;
    d.showLine(text, zenji ? this.player.node : this.anchor, zenji ? { x: 0, y: this.Kneeling ? 0.75 : 1.35 } : { x: 0, y: 0.1 }, fill(text, zenji ? COL.zenji : COL.pink));
    d.revealFirstLetter();
    while (!d.FullyRevealed || d.Visible) { if (advanced()) d.advance(); d.tick(); yield; }
    this.CurrentSpeaker = this.CurrentText = "";
  }
  makePool() {
    if (!GA.blood || !GA.blood.length) return;
    const b = SpriteSurfaces.bounds(this.Victim.visual);
    for (let i = 0; i < 3; i++) {
      const sr = FX.makeSprite("Boss farewell blood stain", GA.blood[Math.min(3 + i, GA.blood.length - 1)], b.cx, b.cy, 2, false, this.Victim.node.parent);
      sr.color = { r: 0.5, g: 0.015, b: 0.04, a: 0.9 };
      SpriteSurfaces.flattenBlood(sr, { x: b.cx + (i - 1) * 0.25, y: this.floorY }, { x: 0, y: 1 }, 0.75, 0.065);
    }
  }
  cleanup() {
    if (!this.owns) return;
    this.owns = false;
    this.dialogue.reset(); this.blackout = 0;
    const p = this.player, lm = this.level;
    if (p) {
      const v = p.visual.node; [v.lx, v.ly, v.lrot, v.lsx, v.lsy] = this.art;
      p.anim.unscaled = this.oldPU;
      p.anim.play(GA.playerIdle, 8, true);
      p.stopForDialogue();
      Runtime.setEnabled(p, this.oldController);
    }
    if (this.Victim) this.Victim.anim.unscaled = this.oldBU;
    if (lm && lm.cam) { lm.cam.useOverride = this.oldOverride; lm.cam.overrideTarget = this.oldTarget; lm.cam.cam.orthographicSize = this.oldSize; lm.cam.snap(); }
    G.frozen = this.oldFrozen; G.inputLocked = this.oldLocked;
    this.IsPlaying = false; this.Kneeling = false;
  }
  lateUpdate() {
    if (this.IsPlaying && !G.paused && this.player) {
      SpriteSurfaces.ground(this.player.visual, this.floorY, 0.005);
      if (this.Victim) SpriteSurfaces.ground(this.Victim.visual, this.floorY, 0.005);
    }
  }
  onDisable() { if (this.co) this.co.dead = true; this.cleanup(); }
}
