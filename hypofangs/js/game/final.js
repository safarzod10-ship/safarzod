// Final arena: FinalArenaFallen (Akari and Takeru where the memory cutscene left them), FinalBossIntro (dialogue, rage edges)
// and FinalBossEnding (reunion, Zenji's lines, end credits, results).
import { Component, Time, Mathf, Random, newNode, Runtime } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { Assets } from "../engine/assets.js";
import { SpriteRenderer } from "../engine/scene.js";
import { G, GA, CameraRig, CombatAudio, CombatSound, CombatRole, GameClock, Haptics, Music } from "./common.js";
import { SpriteSurfaces } from "./surfaces.js";
import { SpeechPresenter, COL, fill } from "./speech.js";
import { InputPrompts } from "./prompts.js";
import { UI } from "../ui/draw.js";

const advance = () => !G.paused && Input.hit("Space", "Enter", "NumpadEnter", "Tap");
const last = (a) => (a && a.length ? a[a.length - 1] : null);

export function stageFallen(room) {
  if (!room || room.node.find("Fallen - Akari")) return;
  const boss = room.node.getComponentsInChildren("HypoFangs.Enemy", true).find((e) => e.IsBoss);
  const lit = boss ? boss.visual.lit : true;
  const a = last(GA.akariDeath), t = last(GA.takeruDeath);
  if (!a && !t) return;
  const y = room.spawn ? room.spawn.position.y : room.bounds.y + 2;
  const body = (name, s, x, scale, order) => {
    const n = newNode(name, room.node); n.setPosition(x, y); n.lsx = n.lsy = scale;
    const sr = new SpriteRenderer({ o: order, lit: lit ? 1 : 0 }); sr.sprite = s; n.addComponent(sr); return sr;
  };
  const ground = (sr) => { const p = sr.node.position, h = SpriteSurfaces.floor(p.x, p.y + 0.3, 1); SpriteSurfaces.ground(sr, h ? h.point.y : p.y); };
  const pool = (name, actor) => {
    const st = GA.fallenBloodStains;
    if (!st || !st.length) return;
    const n = newNode(name, room.node), p = actor.node.position, h = SpriteSurfaces.floor(p.x, p.y + 1, 3), py = h ? h.point.y : p.y;
    st.forEach((s, i) => {
      const c = newNode("Blood stain " + (i + 1), n); const sr = new SpriteRenderer({ o: 6, lit: lit ? 1 : 0, col: [0.68, 0.12, 0.15, 0.9] }); sr.sprite = s; c.addComponent(sr);
      SpriteSurfaces.flattenBlood(sr, { x: p.x + (i - 1) * 0.28, y: py }, { x: 0, y: 1 }, 0.9, 0.065);
    });
  };
  let ak = null;
  if (a) { ak = body("Fallen - Akari", a, room.bounds.x + 6.381, 1, 7); ground(ak); pool("Akari - Blood Pool", ak); }
  if (t) {
    const tk = body("Fallen - Takeru", t, (ak ? ak.node.position.x : room.bounds.x + 6.381) + 3.2, 1.5, 8);
    const left = () => Math.min(...GA.takeruDeath.map((f) => SpriteSurfaces.bounds(tk, f, false).minX));
    if (ak) {
      const mx = SpriteSurfaces.bounds(ak).maxX;
      let p = tk.node.position; tk.node.setPosition(p.x + Math.max(0, mx + 0.75 - left()), p.y);
      const r = Math.min(0.22, Math.max(0, left() - mx - 0.35));
      p = tk.node.position; tk.node.setPosition(p.x - r, p.y);
    }
    ground(tk); pool("Takeru - Blood Pool", tk);
  }
}

// ---------------------------------------------------------------- rage blood edges (screen overlay)
const SPOTS = [[0, 0, 230, 0], [0, 1, 220, -90], [1, 1, 230, 180], [1, 0, 220, 90], [0, 0.5, 170, -45], [1, 0.5, 170, 135], [0.5, 1, 170, -135], [0.5, 0, 170, 45], [0.25, 1, 150, -110], [0.75, 0, 150, 70]];
class BloodEdges {
  constructor() { this.alpha = 0; this.target = 0; this.fade = 0.3; this.beat = 0; this.showT = 0; this.thumpT = 0; this.lastBeat = -1; this.showing = false; this.splat = SPOTS.map(() => 0); }
  show() { this.showing = true; this.target = 1; this.fade = 0.25; this.showT = 0; this.thumpT = 1; }
  thump() { this.thumpT = 1; CameraRig.shake(0.04, 0.2); }
  hide(s) { this.target = 0; this.fade = Math.max(0.05, s); this.showing = false; }
  tick() {
    const dt = GameClock.UnscaledDt;
    this.alpha = Mathf.moveTowards(this.alpha, this.target, dt / this.fade);
    if (this.alpha <= 0 && !this.showing) { this.showT = 0; return; }
    this.showT += dt;
    this.thumpT = Math.max(0, this.thumpT - dt * 2.5);
    this.beat += dt * 1.6 * Math.PI * 2;
    const b = Math.floor((this.beat - Math.PI / 2) / (Math.PI * 2));
    if (this.showing && b !== this.lastBeat) { this.lastBeat = b; Haptics.heartbeat(0.8); }
    this.pulse = Math.pow(Math.max(0, Math.sin(this.beat)), 6) + this.thumpT * 0.8;
    this.splat = this.splat.map((a, i) => (this.showT >= (i % 4) * 0.06 + Math.floor(i / 4) * 0.1 ? Mathf.moveTowards(a, 0.95, dt * 12) : 0));
  }
  draw() {
    if (this.alpha <= 0) return;
    if (!BloodEdges.tex) {
      const cv = document.createElement("canvas"); cv.width = 160; cv.height = 90;
      const c = cv.getContext("2d"), img = c.createImageData(160, 90);
      const ss = (a, b, v) => { const t = Mathf.clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
      for (let i = 0; i < 90; i++) for (let j = 0; j < 160; j++) {
        const x = (j + 0.5) / 160 * 2 - 1, y = (i + 0.5) / 90 * 2 - 1;
        let a = ss(0.62, 1.25, Math.sqrt(x * x * 0.85 + y * y));
        a = Math.max(a, ss(0.86, 1, Math.max(Math.abs(x), Math.abs(y))) * 0.9);
        const o = (i * 160 + j) * 4; img.data[o] = 110 + 50 * a; img.data[o + 1] = 0; img.data[o + 2] = 8 + 6 * a; img.data[o + 3] = 235 * a;
      }
      c.putImageData(img, 0, 0); BloodEdges.tex = cv;
    }
    const c = UI.ctx, k = 1 + 0.02 * (this.pulse || 0);
    c.save(); c.globalAlpha = this.alpha * Mathf.clamp01(0.75 + 0.25 * (this.pulse || 0)); c.imageSmoothingEnabled = true;
    c.drawImage(BloodEdges.tex, UI.W * (1 - k) / 2, UI.H * (1 - k) / 2, UI.W * k, UI.H * k);
    c.imageSmoothingEnabled = false; c.restore();
    const sprites = GA.bloodEdges && GA.bloodEdges.length ? GA.bloodEdges : GA.blood;
    if (!sprites) return;
    SPOTS.forEach(([ax, ay, size, rot], i) => {
      const s = sprites[i % sprites.length];
      if (!s) return;
      const h = size * s.h / s.w;
      const x = ax * UI.W + (ax < 0.01 ? size * 0.3 : ax > 0.99 ? -size * 0.3 : 0), y = UI.H - (ay * UI.H + (ay < 0.01 ? size * 0.25 : ay > 0.99 ? -size * 0.25 : 0));
      c.save(); c.globalAlpha = this.alpha * this.splat[i];
      c.translate(x, y); c.rotate(-rot * Math.PI / 180);
      c.filter = "brightness(0.85)";
      c.drawImage(s.pageObj.img, s.x, s.y, s.w, s.h, -size / 2, -h / 2, size, h);
      c.restore();
    });
  }
}

const ARRIVAL = [["ZENJI", "Akari—!"], ["ZENJI", "What did you do to her?!"], ["GAKU", "Not me. Takeru got carried away. I told that mutt to keep her breathing."], ["GAKU", "He's been dealt with."]];
const PULSE = [["ZENJI", "…There's a pulse."], ["ZENJI", "Hold on, Akari. Just a little longer."]];
const CONFRONT = [
  ["GAKU", "Touching. Now listen. There's only one way this ends: you come back to work for me."],
  ["GAKU", "Isamu. Shin. Ritsu. Ruten. Every one of them was mine. You owe me for every body you stepped over to get here."],
  ["ZENJI", "I'm done working for you. That life took my wife. Tonight it nearly took my daughter."],
  ["ZENJI", "I'm carrying her out of here to a hospital, right after I put you in the ground."],
  ["GAKU", "You ungrateful bastard. Fine. You first, then the girl. Same as your wife."],
  ["ZENJI", "…Kohana?"],
  ["GAKU", "Don't look at me like that. You were the best I ever had, and she was making you soft. I thought cutting her loose would bring you back to the work."],
  ["GAKU", "She bled out before the ambulance came. Lived just long enough to have the kid."],
  ["GAKU", "If I'd known what that girl would turn you into, I'd have finished them both, you piece of shit."],
];
const RAGE = [["ZENJI", "…"], ["ZENJI", "You wanted the old Zenji back."], ["ZENJI", "…Careful what you wish for."]];

export class FinalBossIntro extends Component {
  constructor() { super(); this.IsPlaying = false; this.dialogue = new SpeechPresenter({ unscaled: true, lettersPerSecond: 36, holdSeconds: 2.6 }); this.blood = new BloodEdges(); this.kneeling = false; this.anchor = { position: { x: 0, y: 0 } }; }
  get ShouldPlay() { return !FinalBossIntro.played; }
  *play(owner, boss) {
    this.level = owner; this.player = owner.player; this.gaku = boss;
    if (!this.player || !this.gaku) return;
    this.IsPlaying = true;
    this.setup();
    yield* this.run();
    FinalBossIntro.played = true;
    this.cleanup();
  }
  setup() {
    const room = this.gaku.node.getComponentInParent("HypoFangs.Room");
    const a = room ? room.node.find("Fallen - Akari") : null;
    this.akari = a ? a.getComponent(SpriteRenderer) : null;
    this.cam = this.level.cam.cam; this.baseSize = this.cam.orthographicSize;
    this.dialogue.reset();
    this.gaku.face(!(this.player.node.position.x < this.gaku.node.position.x) ? 1 : -1);
    const art = this.gaku.art;
    this.gaku.anim.play(art.calmIdle && art.calmIdle.length ? art.calmIdle : art.idle, 8, true, false);
  }
  *run() {
    const lc = this.level.cam, p = this.player;
    lc.useOverride = true;
    const l = this.akari ? SpriteSurfaces.bounds(this.akari).minX - 0.8 : p.node.position.x;
    const r = SpriteSurfaces.bounds(this.gaku.visual).maxX + 0.8;
    lc.overrideTarget = { x: (l + r) * 0.5, y: p.node.position.y + 1.6 };
    const want = Math.max(this.baseSize, (r - l) * 0.5 / Math.max(0.5, this.cam.aspect));
    const x = this.akari ? SpriteSurfaces.bounds(this.akari).maxX + 0.45 : p.node.position.x + 4;
    const shout = this.startCoroutine(this.say(ARRIVAL[0]));
    yield* this.runTo(x, want);
    p.anim.play(GA.playerIdle, 10, true);
    while (!shout.dead) yield;
    for (let i = 1; i < ARRIVAL.length; i++) yield* this.say(ARRIVAL[i]);
    this.face(!(this.akari && SpriteSurfaces.bounds(this.akari).cx < p.node.position.x) ? 1 : -1);
    if (GA.playerLand) { p.anim.play(GA.playerLand.slice().reverse(), 10, false); while (!p.anim.Finished) yield; }
    this.kneeling = true;
    for (const ln of PULSE) yield* this.say(ln);
    this.kneeling = false;
    if (GA.playerLand) { p.anim.play(GA.playerLand, 10, false); while (!p.anim.Finished) yield; }
    this.face(!(this.gaku.node.position.x < p.node.position.x) ? 1 : -1);
    p.anim.play(GA.playerIdle, 10, true);
    for (let t = 0; t < 0.25; t += GameClock.UnscaledDt) yield;
    for (const ln of CONFRONT) yield* this.say(ln);
    this.blood.show();
    CameraRig.shake(0.06, 0.35);
    for (let i = 0; i < RAGE.length; i++) { if (i > 0) this.blood.thump(); yield* this.say(RAGE[i]); }
    this.blood.hide(0.45);
    for (let t = 0; t < 0.4; t += GameClock.UnscaledDt) { this.cam.orthographicSize = Mathf.lerp(this.cam.orthographicSize, this.baseSize, 1 - Math.exp(-10 * GameClock.UnscaledDt)); yield; }
  }
  *runTo(x, want) {
    const p = this.player;
    this.face(x >= p.node.position.x ? 1 : -1);
    p.anim.play(GA.playerRun, 15, true);
    let step = 0;
    while (Math.abs(p.node.position.x - x) > 0.02) {
      const dt = GameClock.UnscaledDt, pp = p.node.position;
      p.teleport(Mathf.moveTowards(pp.x, x, 7 * dt), pp.y, p.Facing);
      this.cam.orthographicSize = Mathf.lerp(this.cam.orthographicSize, want, 1 - Math.exp(-6 * dt));
      step -= dt;
      if (step <= 0 && dt > 0) { step = 0.2; CombatAudio.play(CombatSound.Footstep, CombatRole.Zenji); }
      yield;
    }
    this.cam.orthographicSize = want;
  }
  face(d) { const p = this.player, pp = p.node.position; p.teleport(pp.x, pp.y, d); p.visual.flipX = p.Facing < 0; }
  *say([who, text]) {
    const z = who === "ZENJI";
    if (!z) { const b = SpriteSurfaces.bounds(this.gaku.visual); this.anchor.position = { x: b.cx, y: b.maxY }; }
    const d = this.dialogue;
    d.showLine(text, z ? this.player.node : this.anchor, { x: 0, y: z ? (this.kneeling ? 0.75 : 1.35) : 0.15 }, fill(text, z ? COL.zenji : COL.pink));
    d.revealFirstLetter();
    while (!d.FullyRevealed || d.Visible) { if (advance()) d.advance(); yield; }
  }
  update() { this.dialogue.tick(); this.blood.tick(); }
  cleanup() {
    this.dialogue.reset(); this.blood.hide(0.45);
    if (this.level && this.level.cam) this.level.cam.useOverride = false;
    if (this.cam) this.cam.orthographicSize = this.baseSize;
    if (this.player) { this.kneeling = false; this.player.anim.play(GA.playerIdle, 10, true); this.player.consumePreviewConfirm(); }
    this.IsPlaying = false;
  }
  drawUnderHud() { this.blood.draw(); }
  draw() { }
}
FinalBossIntro.played = false;

// ---------------------------------------------------------------- ending
// the ending reuses the boss farewell presenter with the label at 112 (twice the usual 56)
class BigSpeech extends SpeechPresenter {
  speech() { const s = super.speech(); if (s) s.size = 112 / 3; return s; }
}
const LINES = ["Daddy’s here, baby girl.", "Daddy’s right here.", "You’re going to be okay, sweetheart.", "Let’s get you to a hospital.", "Then we can go home."];

export class FinalBossEnding extends Component {
  constructor() { super(); this.IsPlaying = false; this.Complete = false; this.CreditsPlaying = false; this.black = false; this.dialogue = new BigSpeech({ unscaled: true, lettersPerSecond: 32, holdSeconds: 2.8 }); this.speaker = ""; this.words = ""; }
  *play(owner) {
    if (this.IsPlaying || this.Complete) return;
    this.IsPlaying = true;
    Music.playPeaceful();
    G.frozen = G.inputLocked = true;
    this.level = owner; const p = this.player = owner.player;
    p.stopForDialogue();
    this.oldController = p.enabled; this.oldUnscaled = p.anim.unscaled; this.owns = true;
    Runtime.setEnabled(p, false); p.anim.unscaled = true;
    yield* this.reunite();
    this.black = true;
    for (let t = 0; t < 1; t += GameClock.UnscaledDt) yield;
    for (let i = 0; i < LINES.length; i++) {
      const d = this.dialogue;
      d.showLine(LINES[i], p.node, { x: 0, y: 0.75 }, fill(LINES[i], COL.zenji));
      d.revealFirstLetter();
      while (!d.FullyRevealed || d.Visible) { if (advance()) d.advance(); yield; }
      yield;
    }
    yield* this.credits();
    // the web build goes back to the start menu after the results, so a new run plays Gaku's intro again
    FinalBossIntro.played = false;
    this.Complete = true;
    this.IsPlaying = false;
  }
  *credits() {
    const doc = await_(Assets.loadJSON("data/credits.json"));
    while (!doc.v) yield;
    const pages = doc.v.pages;
    this.dialogue.reset();
    this.CreditsPlaying = true;
    for (let i = 0; i < pages.length; i++) {
      this.creditAdvance = false;
      this.speaker = pages[i].heading; this.words = pages[i].body;
      for (let t = 0; t < Math.max(3, pages[i].seconds); t += GameClock.UnscaledDt) {
        if (this.creditAdvance || advance()) break;
        this.footer = `${i + 1} / ${pages.length}    ${InputPrompts.key(InputPrompts.Accept)} Next credit`;
        yield;
      }
      yield;
    }
    this.CreditsPlaying = false; this.speaker = this.words = this.footer = "";
  }
  advanceDialogue() { if (this.CreditsPlaying) this.creditAdvance = true; else this.dialogue.advance(); }
  *reunite() {
    const lm = this.level, p = this.player;
    const n = lm.rooms[G.roomIndex].node.find("Fallen - Akari");
    const ak = n ? n.getComponent(SpriteRenderer) : null;
    if (!ak) return;
    const ink = SpriteSurfaces.bounds(ak);
    this.floorY = ink.minY;
    const h = SpriteSurfaces.floor(ink.cx, ink.minY + 0.3, 1); if (h) this.floorY = h.point.y;
    const target = ink.maxX + 0.4, cam = lm.cam.cam;
    lm.cam.useOverride = true;
    this.Phase = "Zenji runs to Akari";
    p.anim.play(GA.playerRun, 15, true);
    this.face(target >= p.node.position.x ? 1 : -1);
    let foot = 0;
    while (Math.abs(p.node.position.x - target) > 0.015 || Math.abs(p.body.bounds.minY - this.floorY) > 0.02) {
      const dt = GameClock.UnscaledDt, pp = p.node.position, by = p.body.bounds.minY;
      p.teleport(Mathf.moveTowards(pp.x, target, 7 * dt), pp.y + Mathf.moveTowards(by, this.floorY + 0.01, 12 * dt) - by, p.Facing);
      SpriteSurfaces.ground(p.visual, p.body.bounds.minY, 0.005);
      const np = p.node.position;
      lm.cam.overrideTarget = { x: (np.x + ink.cx) * 0.5, y: this.floorY + 1.6 };
      const b = Math.max(3.2, Math.abs(np.x - ink.cx) * 0.5 / Math.max(0.5, cam.aspect) + 1);
      cam.orthographicSize = Mathf.lerp(cam.orthographicSize, b, 1 - Math.exp(-6 * dt));
      foot -= dt;
      if (foot <= 0 && dt > 0) { foot = 0.2; CombatAudio.play(CombatSound.Footstep, CombatRole.Zenji); }
      yield;
    }
    this.face(-1);
    this.Phase = "Zenji sits beside Akari";
    p.anim.play(GA.playerLand.slice().reverse(), 10, false);
    while (!p.anim.Finished) yield;
    for (let t = 0; t < 0.8; t += GameClock.UnscaledDt) yield;
  }
  face(d) { const p = this.player, pp = p.node.position; p.teleport(pp.x, pp.y, d); p.visual.flipX = p.Facing < 0; }
  update() { this.dialogue.tick(); }
  lateUpdate() { if (this.owns && this.player && this.Phase !== "Zenji runs to Akari" && this.floorY !== undefined) SpriteSurfaces.ground(this.player.visual, this.floorY, 0.005); }
  showResults(title, sub) { this.Phase = "Results"; this.dialogue.reset(); this.black = true; this.results = [title, sub]; }
  draw() {
    if (!this.black) return;
    UI.rect(0, 0, UI.W, UI.H, "#000");
    if (this.CreditsPlaying) {
      UI.text(this.speaker, UI.W / 2, UI.H / 2 - 136, 20, "rgb(117,231,255)", 1, "BoldPixels");
      UI.text(UI.wrap(this.words, 570, 14, "BoldPixels").join("\n"), UI.W / 2, UI.H / 2 + 4, 14, "#fff", 1, "BoldPixels", 1, null, 1.25);
      UI.text(this.footer || "", UI.W / 2, UI.H / 2 + 144, 9, "#fff", 1, "BoldPixels");
    } else if (this.results) {
      UI.text(this.results[0], UI.W / 2, UI.H / 2 - 38, 18, "rgb(117,231,255)", 1);
      UI.text(this.results[1], UI.W / 2, UI.H / 2 + 10, 16, "#fff", 1);
    }
  }
}

function await_(promise) { const box = { v: null }; promise.then((v) => (box.v = v)); return box; }
