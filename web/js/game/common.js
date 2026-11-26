// Shared game services ported from GameAssets, FX, Sfx, CombatAudio, TimeFX, CameraRig, GameClock, Haptics, SpriteAnim, Debris, Afterimage.
import { Component, Runtime, Time, Mathf, Random, newNode } from "../engine/core.js";
import { Assets } from "../engine/assets.js";
import { Audio } from "../engine/audio.js";
import { SpriteRenderer, Camera, registerScript } from "../engine/scene.js";
import { raycast, mask } from "../engine/physics.js";

// global flags normally spread over static fields
export const G = {
  level: null, // LevelManager.I
  paused: false, frozen: false, inputLocked: false, previewing: false,
  roomIndex: 0,
  tutorialActive: false, // EncounterTutorial.Active
  prologue: null, // PrologueSequence.I
  akari: null, // AkariMemorySequence.I
  touch: false,
};

export const GameClock = {
  get UnscaledDt() { return !G.paused && !G.tutorialActive ? Time.unscaledDeltaTime : 0; },
};

export const GameplayInputGate = {
  get Locked() {
    if (G.inputLocked || G.frozen || G.paused || G.prologue || G.akari) return true;
    return G.level ? G.level.cinematicPlaying : false;
  },
};

// ---------------------------------------------------------------- GameAssets
export const GA = {};
export function initGameAssets(json) {
  const d = json.GameAssets.d;
  const conv = (v) => {
    if (Array.isArray(v)) return v.map(conv);
    if (typeof v === "string" && v.startsWith("S:")) return Assets.sprite(v);
    if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = conv(v[k]); return o; }
    return v;
  };
  Object.assign(GA, conv(d));
  GA.bank = json.CombatSoundBank.d;
  GA.music = json.MusicCatalog.d;
  GA.mapData = json.LevelMapData ? json.LevelMapData.d : null;
  GA.surface = new Map();
  if (json.SurfaceSpriteData) for (const e of json.SurfaceSpriteData.d.entries) if (e.sprite) GA.surface.set(e.sprite.slice(2), e.ink);
  GA.RandomBlood = () => {
    const bb = GA.bloodBursts;
    if (bb && bb.length) for (let i = 0; i < 4; i++) { const c = bb[Random.rangeInt(0, bb.length)]; if (c && c.frames && c.frames.length) return c.frames; }
    return GA.blood;
  };
  // preload short clips referenced by the game
  const clips = new Set();
  for (const k in d) if (typeof d[k] === "string" && d[k].startsWith("A:")) clips.add(d[k]);
  for (const e of GA.bank.entries) for (const c of e.clips) clips.add(c);
  for (const k of ["zenjiKatanaImpact", "otherActorImpact", "zenjiGakuKatanaSwing", "zenjiGakuKatanaImpact"]) clips.add(GA.bank[k]);
  clips.add(GA.music.dialogueBeep);
  for (const c of clips) Audio.load(c);
}

// ---------------------------------------------------------------- SpriteAnim
export class SpriteAnim extends Component {
  constructor() { super(); this.frames = null; this.fps = 12; this.loop = true; this.destroyOnEnd = false; this.unscaled = false; this.t = 0; this.Finished = false; this.Frame = 0; this.sr = null; }
  init(d) { this.frames = d.frames && d.frames.length ? d.frames.filter(Boolean) : null; this.fps = d.fps ?? 12; this.loop = !!d.loop; this.destroyOnEnd = !!d.destroyOnEnd; this.unscaled = !!d.unscaled; }
  awake() { this.sr = this.node.getComponent(SpriteRenderer); }
  get FrameProgress() { return this.Finished ? 1 : this.t - Math.floor(this.t); }
  play(f, fps, looping, restart = true) {
    if (f !== this.frames || restart || this.Finished) {
      const changed = f !== this.frames;
      this.frames = f; this.fps = fps; this.loop = looping;
      if (restart || changed || this.Finished) { this.t = 0; this.Finished = false; }
      this.apply();
    }
  }
  update() {
    if (G.tutorialActive || !this.frames || !this.frames.length || this.Finished) return;
    this.t += (this.unscaled ? GameClock.UnscaledDt : Time.deltaTime) * this.fps;
    this.apply();
  }
  apply() {
    if (!this.frames || !this.frames.length) return;
    let n = Math.floor(this.t);
    if (n >= this.frames.length) {
      if (this.loop) { this.t %= this.frames.length; n = Math.floor(this.t); }
      else {
        n = this.frames.length - 1; this.Finished = true;
        if (this.destroyOnEnd) { this.node.destroy(); return; }
      }
    }
    this.Frame = n;
    if (!this.sr) this.sr = this.node.getComponent(SpriteRenderer);
    if (this.sr) this.sr.sprite = this.frames[n];
  }
}
SpriteAnim.typeName = "HypoFangs.SpriteAnim";
registerScript(SpriteAnim);

// ---------------------------------------------------------------- FX
export const FX = {
  makeSprite(name, sprite, x, y, order, unlit, parent = null) {
    const n = newNode(name, parent);
    n.setPosition(x, y);
    const sr = new SpriteRenderer({ o: order, lit: unlit ? 0 : 1 });
    sr.sprite = sprite || null;
    n.addComponent(sr);
    return sr;
  },
  anim(frames, x, y, fps, order, scale = 1, angle = 0, flipX = false, tint = null, follow = null) {
    if (!frames || !frames.length) return null;
    const sr = FX.makeSprite("fx", frames[0], x, y, order, true);
    if (follow) { const p = sr.node.position; follow.addChild(sr.node); Runtime.roots.splice(Runtime.roots.indexOf(sr.node), 1); sr.node.setPosition(p.x, p.y); }
    sr.flipX = flipX;
    if (tint) sr.color = { ...tint };
    sr.node.setRotation(angle);
    sr.node.lsx = sr.node.lsy = scale;
    const a = new SpriteAnim();
    a.destroyOnEnd = true;
    sr.node.addComponent(a);
    a.play(frames, fps, false);
    return sr;
  },
  shards(x, y, dir, count, color, speed = 9, size = 0.12) {
    if (!GA.white) return;
    const dn = norm(dir.x, dir.y);
    for (let i = 0; i < count; i++) {
      const u = Random.insideUnitCircle();
      const sr = FX.makeSprite("shard", GA.white, x + u.x * 0.3, y + u.y * 0.3, 12, true);
      sr.color = { ...color };
      const s = Random.range(size * 0.6, size * 1.4) / 0.125;
      sr.node.lsx = sr.node.lsy = s;
      const d = new Debris();
      const r = Random.range(0.4, 1), w = Random.insideUnitCircle();
      d.velocity = { x: (dn.x * r + w.x * 0.7) * speed, y: (dn.y * r + w.y * 0.7) * speed + Random.range(1, 5) };
      sr.node.addComponent(d);
    }
  },
};

export function norm(x, y) { const l = Math.hypot(x, y); return l > 1e-5 ? { x: x / l, y: y / l } : { x: 0, y: 0 }; }
export const col = (r, g, b, a = 1) => ({ r, g, b, a });

const GROUND = mask("Ground", "OneWay");
export class Debris extends Component {
  constructor() { super(); this.velocity = { x: 0, y: 0 }; this.gravity = 30; this.life = 6; this.settled = false; this.spin = 0; }
  start() { this.spin = Random.range(-720, 720); }
  update() {
    const dt = Time.deltaTime;
    this.life -= dt;
    if (this.life <= 0) { this.node.destroy(); return; }
    if (this.settled) return;
    this.velocity.y -= this.gravity * dt;
    const vx = this.velocity.x * dt, vy = this.velocity.y * dt;
    const p = this.node.position;
    const l = Math.hypot(vx, vy);
    const h = l > 0 ? raycast(p.x, p.y, vx, vy, l + 0.02, GROUND, { noTriggers: true }) : null;
    if (h) {
      this.node.setPosition(h.point.x + h.normal.x * 0.03, h.point.y + h.normal.y * 0.03);
      if (h.normal.y > 0.5) this.settled = true;
      else {
        const d = this.velocity.x * h.normal.x + this.velocity.y * h.normal.y;
        this.velocity = { x: (this.velocity.x - 2 * d * h.normal.x) * 0.3, y: (this.velocity.y - 2 * d * h.normal.y) * 0.3 };
      }
    } else {
      this.node.setPosition(p.x + vx, p.y + vy);
      this.node.lrot += this.spin * dt;
    }
  }
}

export class Afterimage extends Component {
  static spawn(src, tint) {
    const p = src.node.position;
    const sr = FX.makeSprite("afterimage", src.sprite, p.x, p.y, src.sortingOrder - 1, true);
    sr.flipX = src.flipX;
    sr.node.setRotation(src.node.rotation);
    const ls = src.node.lossyScale; sr.node.lsx = ls.x; sr.node.lsy = ls.y;
    sr.color = { ...tint };
    const a = new Afterimage(); a.sr = sr; a.c = { ...tint }; a.t = 0; a.life = 0.22;
    sr.node.addComponent(a);
  }
  update() {
    this.t += Time.deltaTime;
    const k = 1 - this.t / this.life;
    if (k <= 0) this.node.destroy();
    else this.sr.color = { r: this.c.r, g: this.c.g, b: this.c.b, a: this.c.a * k };
  }
}

// ---------------------------------------------------------------- audio
export const Sfx = {
  onPlay: null,
  play(clip, volume = 1, pitchVar = 0.06) { Sfx.playAtPitch(clip, volume, 1 + Random.range(-pitchVar, pitchVar)); },
  playAtPitch(clip, volume = 1, pitch = 1) {
    if (!clip) return;
    volume = Mathf.clamp01(volume);
    Music.notifySfx(clip, volume, pitch);
    Audio.play(clip, volume, pitch);
  },
};

export const CombatSound = { BladeSwing: 0, DaggerSwing: 1, KnifeThrow: 2, ShurikenThrow: 3, FistSwing: 4, BladeImpact: 5, DaggerImpact: 6, BodyImpact: 7, MetalClash: 8, Gunshot: 9, Death: 10, Jump: 11, Land: 12, Roll: 13, Footstep: 14, Pickup: 15, ShieldBashSwing: 16 };
export const CombatRole = { Zenji: 0, Gaku: 1, Boss: 2, Npc: 3 };
let variant = 0;
export const CombatAudio = {
  gain(role) { return role === CombatRole.Boss ? 0.7 : role === CombatRole.Gaku ? 0.88 : role === CombatRole.Zenji ? 1 : 0.43; },
  role(actor) { if (!actor || !actor.IsBoss) return CombatRole.Npc; return actor.bossLevel < 5 ? CombatRole.Boss : CombatRole.Gaku; },
  get(sound, v) {
    for (const e of GA.bank.entries) if (e.sound === sound && e.clips && e.clips.length) return e.clips[Math.abs(v) % e.clips.length];
    return null;
  },
  play(sound, role, weight = 1) {
    if (sound === CombatSound.Death || !GA.bank) return;
    if (typeof role === "object" && role !== null) role = CombatAudio.role(role);
    if (role === null || role === undefined) role = CombatRole.Npc;
    const impact = sound === CombatSound.BladeImpact || sound === CombatSound.DaggerImpact || sound === CombatSound.BodyImpact;
    const zg = role === CombatRole.Zenji || role === CombatRole.Gaku;
    const b = GA.bank;
    let clip;
    switch (sound) {
      case CombatSound.BladeSwing: clip = b.zenjiGakuKatanaSwing; break;
      case CombatSound.BladeImpact: clip = zg ? b.zenjiGakuKatanaImpact : b.otherActorImpact; break;
      case CombatSound.BodyImpact: clip = role === CombatRole.Zenji ? b.zenjiKatanaImpact : b.otherActorImpact; break;
      default: clip = CombatAudio.get(sound, variant++);
    }
    if (!clip) return;
    let vol = CombatAudio.gain(role) * Mathf.clamp01(weight);
    if (sound === CombatSound.Footstep) vol *= 0.2;
    if (sound === CombatSound.Jump || sound === CombatSound.Roll || sound === CombatSound.Pickup) vol *= 0.55;
    const pitch = impact || role === CombatRole.Zenji ? 1 : role === CombatRole.Boss ? 1.055 : role === CombatRole.Gaku ? 1.025 : 1.1;
    Sfx.playAtPitch(clip, vol, pitch);
  },
};

// MusicPlayer: one background track with a 0.6 s crossfade, ducked to 80 % under effects
export const Music = {
  src: null, outgoing: null, background: null, blend: 1, duck: 1, duckUntil: 0, dialogueUntil: 0, tracks: {},
  track(name) {
    name = Audio.clipName(name);
    if (!this.tracks[name]) this.tracks[name] = Audio.track(name);
    return this.tracks[name];
  },
  gain(clip) { return GA.music && clip === Audio.clipName(GA.music.peaceful) ? 0.8 : 0.85; },
  get dialogueActive() { return Time.unscaledTime < this.dialogueUntil; },
  roomClip(i, fallback) { const r = GA.music && GA.music.rooms; return r && i >= 0 && i < r.length && r[i] ? r[i] : fallback; },
  playRoom(i, fallback) { this.play(this.roomClip(i, fallback)); },
  playPeaceful() { if (GA.music) this.play(GA.music.peaceful); },
  dialogue() { this.dialogueUntil = Time.unscaledTime + 1.2; if (!this.background && GA.music) this.background = Audio.clipName(GA.music.peaceful); this.refresh(); },
  play(clip) { if (!clip) return; this.background = Audio.clipName(clip); this.refresh(); },
  stop() { for (const t of Object.values(this.tracks)) t.stop(); this.src = this.outgoing = null; this.background = null; },
  notifySfx(clip, volume, pitch) {
    if (!this.src || volume < 0.2) return;
    this.duck = 0.8;
    this.duckUntil = Math.max(this.duckUntil, Time.unscaledTime + Math.min(Audio.length(clip) / Math.max(0.1, Math.abs(pitch)), 0.4) + 0.04);
    this.apply();
  },
  refresh() {
    const want = this.dialogueActive && GA.music ? Audio.clipName(GA.music.peaceful) : this.background;
    if (!want) return;
    if (this.src && this.src.name === want) { if (!this.src.playing) this.src.play(); return; }
    if (this.outgoing && this.outgoing.name === want && this.outgoing.playing) {
      [this.src, this.outgoing] = [this.outgoing, this.src]; this.blend = 1 - this.blend;
    } else {
      if (this.outgoing && this.outgoing !== this.src) this.outgoing.stop();
      this.outgoing = this.src;
      this.src = this.track(want);
      this.src.setVolume(0);
      this.src.restart();
      this.blend = 0;
    }
    this.apply();
  },
  tick() {
    if (G.paused) { this.dialogueUntil += Time.unscaledDeltaTime; return; }
    this.refresh();
    this.blend = Mathf.moveTowards(this.blend, 1, Time.unscaledDeltaTime / 0.6);
    if (this.blend >= 1 && this.outgoing && this.outgoing !== this.src && this.outgoing.playing) { this.outgoing.stop(); }
    const target = Time.unscaledTime < this.duckUntil ? 0.8 : 1;
    this.duck = Mathf.moveTowards(this.duck, target, Time.unscaledDeltaTime * 2.5);
    this.apply();
  },
  apply() {
    if (this.src) this.src.setVolume(this.gain(this.src.name) * this.blend * this.duck);
    if (this.outgoing && this.outgoing !== this.src) this.outgoing.setVolume(this.gain(this.outgoing.name) * (1 - this.blend) * this.duck);
  },
};

// ---------------------------------------------------------------- haptics (Telegram HapticFeedback or navigator.vibrate)
export const Haptics = {
  enabled: (() => { try { return localStorage.getItem("hypofangs_haptics") !== "0"; } catch (e) { return true; } })(),
  last: 0,
  setEnabled(v) { this.enabled = v; try { localStorage.setItem("hypofangs_haptics", v ? "1" : "0"); } catch (e) { } },
  pulse(low, high, seconds) {
    if (!this.enabled || G.paused) return;
    const now = performance.now();
    const strength = Math.max(low, high);
    if (strength < 0.15 || now - this.last < 60) return;
    this.last = now;
    const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback;
    if (tg && window.Telegram.WebApp.initData) {
      try { tg.impactOccurred(strength > 0.8 ? "heavy" : strength > 0.4 ? "medium" : "light"); } catch (e) { }
    } else if (G.touch && navigator.vibrate) navigator.vibrate(Math.round(seconds * 1000 * Math.min(1, strength + 0.2)));
  },
  fromShake(a, d) { if (a > 0) this.pulse(Mathf.clamp01(a * 1.8), Mathf.clamp01(a * 2.2 + 0.08), Mathf.clamp(d, 0.05, 0.45) + 0.03); },
  swing() { this.pulse(0.03, 0.2, 0.045); },
  roll() { this.pulse(0.12, 0.04, 0.07); },
  land(hard) { if (hard) this.pulse(0.32, 0.1, 0.09); },
  throw() { this.pulse(0.02, 0.16, 0.04); },
  heartbeat(s) { this.pulse(0.5 * s, 0.04, 0.1); },
  death() { this.pulse(1, 0.75, 0.5); },
};

// ---------------------------------------------------------------- TimeFX
export const TimeFX = {
  hitstop: 0, External: 1,
  hitStop(s) { this.hitstop = Math.max(this.hitstop, s); },
  tick() {
    let n = this.External;
    if (this.hitstop > 0) { this.hitstop -= GameClock.UnscaledDt; n *= 0.03; }
    if (G.frozen || G.paused) n = 0;
    Time.timeScale = n;
  },
  reset() { this.hitstop = 0; this.External = 1; Time.timeScale = 1; },
};

// ---------------------------------------------------------------- CameraRig
export class CameraRig extends Component {
  static I = null;
  constructor() { super(); this.target = null; this.overrideTarget = { x: 0, y: 0 }; this.useOverride = false; this.bounds = { x: 0, y: 0, width: 0, height: 0 }; this.smooth = 0.12; this.lean = 0; this.vel = { x: 0, y: 0 }; this.shakeAmt = 0; this.shakeTime = 0; this.pc = null; }
  init(d) { this.target = d.target; this.smooth = d.smooth ?? 0.12; this.useOverride = !!d.useOverride; this.bounds = d.bounds || this.bounds; }
  awake() { CameraRig.I = this; this.cam = this.node.getComponent(Camera); }
  static shake(amount, duration) {
    const I = CameraRig.I;
    if (!I) return;
    I.shakeAmt = Math.max(I.shakeAmt, amount);
    I.shakeTime = Math.max(I.shakeTime, duration);
    Haptics.fromShake(amount, duration);
  }
  snap() { const d = this.desired(); this.node.setPosition(d.x, d.y); this.vel = { x: 0, y: 0 }; }
  desired() {
    let v;
    if (this.useOverride) v = { ...this.overrideTarget };
    else if (this.target) { const p = this.target.position; v = { x: p.x, y: p.y + 0.9 }; }
    else v = this.node.position;
    if (!this.useOverride && this.target) {
      if (!this.pc || this.pc.node !== this.target) this.pc = this.target.getComponent("HypoFangs.PlayerController");
      if (this.pc) { this.lean = Mathf.moveTowards(this.lean, this.pc.Facing * 1.1, 4 * GameClock.UnscaledDt); }
      v.x += this.lean;
    }
    const h = this.cam.orthographicSize, w = h * this.cam.aspect, b = this.bounds;
    const x = b.width <= w * 2 ? b.x + b.width / 2 : Mathf.clamp(v.x, b.x + w, b.x + b.width - w);
    let y = b.height <= h * 2 ? b.y + b.height / 2 : Mathf.clamp(v.y, b.y + h, b.y + b.height - h);
    if (!this.useOverride && this.target && this.pc && !this.pc.IntroActive) y = Math.max(y, v.y);
    return { x, y };
  }
  lateUpdate() {
    if (!this.cam || G.tutorialActive) return;
    const d = this.desired();
    const p = this.node.position;
    const dt = GameClock.UnscaledDt;
    let x = p.x, y = p.y;
    if (dt > 0) { x = Mathf.smoothDamp(p.x, d.x, this.vel, "x", this.smooth, dt); y = Mathf.smoothDamp(p.y, d.y, this.vel, "y", this.smooth, dt); }
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const u = Random.insideUnitCircle();
      x += u.x * this.shakeAmt; y += u.y * this.shakeAmt;
      if (this.shakeTime <= 0) this.shakeAmt = 0;
    }
    this.node.setPosition(x, y);
  }
}
CameraRig.typeName = "HypoFangs.CameraRig";
CameraRig.order = 100;
registerScript(CameraRig);

// ---------------------------------------------------------------- storage (PlayerPrefs)
export const Prefs = {
  getInt(k, d = 0) { try { const v = localStorage.getItem(k); return v === null ? d : parseInt(v, 10) || 0; } catch (e) { return d; } },
  setInt(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { } },
  getFloat(k, d = 0) { try { const v = localStorage.getItem(k); return v === null ? d : parseFloat(v); } catch (e) { return d; } },
  setFloat(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { } },
  has(k) { try { return localStorage.getItem(k) !== null; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } },
};
