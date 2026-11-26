// LevelManager (rooms, timer, preview tour, death/restart, exits) and LaserSwitchPreview, ported from the C# sources.
import { Component, Time, Mathf, Random, Runtime } from "../engine/core.js";
import { registerScript, Camera, Light2D } from "../engine/scene.js";
import { Input } from "../engine/input.js";
import { ignoreLayerCollision, LAYER } from "../engine/physics.js";
import { G, GA, FX, Sfx, TimeFX, CameraRig, GameClock, Music, Prefs, col } from "./common.js";
import { Enemies } from "./enemy.js";
import { Laser, LaserSwitch, spawnPickup } from "./world.js";
import { InputPrompts } from "./prompts.js";

export const SAVE_KEY = "hypofangs_room";
export const LevelStatics = { launched: false, totalTime: 0, deaths: 0, previewedRoom: -1, PreviewOverride: -1 };

export function anyHeld() {
  return Input.held("KeyR", "Space", "Enter", "NumpadEnter", "Mouse0", "Tap");
}

export class LevelManager extends Component {
  constructor() {
    super();
    this.levelName = "NEON DISTRICT"; this.rooms = []; this.previewEnemies = true; this.previewPerEnemy = 0.85; this.previewPerBoss = 1.8; this.previewZoom = 3.1;
    this.bossDropIn = true; this.fallenInBossArena = true; this.bossDropAbove = 0.5;
    this.dropIn = false; this.room = null; this.timeLeft = 0; this.notYetT = 0; this.roomStart = 0; this.mainBoss = null; this.ending = false;
    this.prevAny = false; this.anyEdge = false; this.extras = {};
  }
  init(d) {
    this.levelName = d.levelName; this.rooms = d.rooms; this.player = d.player; this.cam = d.cam; this.hudRef = d.hud; this.globalLight = d.globalLight;
    this.previewEnemies = !!d.previewEnemies; this.previewPerEnemy = d.previewPerEnemy; this.previewPerBoss = d.previewPerBoss; this.previewZoom = d.previewZoom;
    this.bossDropIn = !!d.bossDropIn; this.fallenInBossArena = !!d.fallenInBossArena; this.bossDropAbove = d.bossDropAbove;
  }
  get RoomTime() { return Time.time - this.roomStart; }
  get CurrentRoomOrigin() { return this.room ? this.room.bounds.x : 0; }
  get CurrentRoomBounds() { return this.room ? this.room.bounds : { x: 0, y: 0, width: 0, height: 0 }; }
  enemies() { return Enemies; }
  get EnemiesLeft() { let n = 0; for (const e of Enemies) if (!e.Dead && e.node.activeInHierarchy) n++; return n; }
  get RoomClear() { return this.EnemiesLeft === 0 && !this.cinematicPlaying; }
  get laserPreviewPlaying() { return this.laserPreview ? this.laserPreview.IsPlaying : false; }
  get tutorialPlaying() { return this.extras.tutorial ? this.extras.tutorial.IsPlaying : false; }
  get finalEndingPlaying() { return this.extras.ending ? this.extras.ending.IsPlaying : false; }
  get finalIntroPlaying() { return this.extras.finalIntro ? this.extras.finalIntro.IsPlaying : false; }
  get bossFarewellPlaying() { return this.extras.bossDeath ? this.extras.bossDeath.IsPlaying : false; }
  get cinematicPlaying() { return this.bossFarewellPlaying || this.laserPreviewPlaying || this.finalIntroPlaying || this.finalEndingPlaying || this.tutorialPlaying; }
  get HoldEnemies() { return this.player ? this.player.IntroActive : false; }
  get CanPause() {
    if (this.room && (!this.ending || this.finalEndingPlaying) && this.player && !this.player.Dead && !G.previewing) return G.frozen ? this.cinematicPlaying : true;
    return false;
  }
  onEnemyKilled(e) {
    if (G.onEnemyKilled) G.onEnemyKilled(e);
    if (!this.ending && e && e.IsBoss && e.bossLevel === 1 && this.room && this.room.index < this.rooms.length - 1 && !this.player.Dead) {
      this.ending = true; G.inputLocked = true;
      this.player.stopForDialogue();
      this.startCoroutine(this.firstBossStory());
      return;
    }
    if (!this.ending && e && e.IsBoss && e.bossLevel === 5 && this.isMainBossRoom(this.room) && !this.player.Dead) {
      this.ending = true; G.inputLocked = true;
      this.startCoroutine(this.exitRoutine());
      return;
    }
    if (e && e.IsBoss) { this.activateWaves(99); this.hud.flash(e.bossName + "  DOWN", 1.6); }
    if (this.EnemiesLeft === 0 && !this.player.Dead) {
      if (!e || !e.IsBoss) this.hud.flash("GO!", 1);
      Sfx.play(GA.sfxBlip, 0.8, 0);
    }
  }
  onBossDamaged(boss) {
    const k = boss.Hp / boss.MaxHp;
    if (k <= 0.5) this.activateWaves(1);
    if (k <= 0.25) this.activateWaves(2);
  }
  activateWaves(upTo) {
    if (!this.room || !this.room.waveObjects) return;
    this.room.waveObjects.forEach((go, i) => {
      if (!go || go.activeSelf || this.room.waveIds[i] > upTo) return;
      go.setActive(true);
      const p = go.position;
      FX.anim(GA.puff, p.x, p.y + 0.5, 18, 12, 1.2);
      const e = go.getComponent("HypoFangs.Enemy");
      if (e) e.alert(0.5);
    });
  }
  activeBoss() { for (const e of Enemies) if (e.IsBoss && e.node.activeInHierarchy) return e; return null; }
  togglePause() {
    if (G.paused) { if (this.pauseMenu) this.pauseMenu.backOrResume(); else this.setPaused(false); }
    else if (this.CanPause) this.setPaused(true);
  }
  setPaused(p) {
    if (G.paused === p || (p && !this.CanPause)) return;
    G.paused = p;
    if (this.pauseMenu) { if (p) this.pauseMenu.open(); else this.pauseMenu.hide(); }
    Time.timeScale = p || G.frozen ? 0 : TimeFX.External;
  }
  restartFromPause() {
    if (this.ending) return;
    this.setPaused(false);
    this.ending = true;
    this.startCoroutine(this.restart());
  }
  awake() {
    G.level = this;
    this.assets = GA;
    G.frozen = G.inputLocked = G.paused = G.previewing = false;
    ignoreLayerCollision(LAYER.Player, LAYER.Enemy); ignoreLayerCollision(LAYER.Enemy, LAYER.Enemy);
    ignoreLayerCollision(LAYER.Corpse, LAYER.Player); ignoreLayerCollision(LAYER.Corpse, LAYER.Enemy); ignoreLayerCollision(LAYER.Corpse, LAYER.Corpse);
    this.hud = G.hud;
    this.hud.build();
    this.pauseMenu = G.pauseMenu || null;
    this.laserPreview = new LaserSwitchPreview();
    this.node.addComponent(this.laserPreview);
    if (G.makeLevelExtras) G.makeLevelExtras(this);
  }
  onDestroy() { if (G.level === this) G.level = null; }
  start() {
    if (G.akariResume && G.akariResume()) return;
    if (!this.rooms || !this.rooms.length) { console.error("[HypoFangs] No rooms assigned."); return; }
    if (!LevelStatics.launched) { LevelStatics.launched = true; G.roomIndex = Prefs.getInt(SAVE_KEY, 0); }
    G.roomIndex = Mathf.clamp(G.roomIndex, 0, this.rooms.length - 1);
    this.beginRoom(G.roomIndex);
  }
  beginRoom(i) {
    if (this.laserPreview) this.laserPreview.cancel();
    this.room = this.rooms[i];
    for (const r of this.rooms) { r.node.setActive(r === this.room); if (r.backdrop) r.backdrop.setActive(false); }
    if (this.room.backdrop) this.room.backdrop.setActive(true);
    if (this.fallenInBossArena && this.isMainBossRoom(this.room) && G.stageFallen) G.stageFallen(this.room);
    const cam = this.cam.node.getComponent(Camera);
    if (cam) cam.backgroundColor = this.room.backdrop ? col(0.09, 0.05, 0.16) : col(0.04, 0.03, 0.07);
    if (this.globalLight) { this.globalLight.intensity = this.room.ambientIntensity; this.globalLight.color = { ...this.room.ambient }; }
    const sp = this.room.spawn.position;
    this.player.node.setPosition(sp.x, sp.y);
    this.player.rb.prevX = sp.x; this.player.rb.prevY = sp.y;
    this.dropIn = this.bossDropIn && this.isMainBossRoom(this.room);
    if (this.dropIn) {
      this.mainBoss = null;
      for (const e of this.room.node.getComponentsInChildren("HypoFangs.Enemy", true)) if (e.IsBoss && (!this.mainBoss || e.bossLevel > this.mainBoss.bossLevel)) this.mainBoss = e;
      if (this.mainBoss && this.mainBoss.art.calmIdle && this.mainBoss.art.calmIdle.length) this.mainBoss.anim.play(this.mainBoss.art.calmIdle, 8, true);
      const face = !(this.mainBoss && this.mainBoss.node.position.x < sp.x) ? 1 : -1;
      this.player.beginIntroDrop(sp.x, this.room.bounds.y + this.room.bounds.height + this.bossDropAbove, face);
    }
    this.cam.target = this.player.node;
    this.cam.bounds = this.room.bounds;
    this.cam.snap();
    this.timeLeft = this.room.timeLimit;
    this.roomStart = Time.time;
    this.hud.setRoom(this.levelName, this.room.displayName, i, this.rooms.length);
    let boss = null;
    if (this.room.isBossRoom) for (const e of this.room.node.getComponentsInChildren("HypoFangs.Enemy", true)) if (e.IsBoss && (!boss || e.bossLevel > boss.bossLevel)) boss = e;
    this.hud.setBossOverlay(boss ? boss.bossLevel : 0, this.player, boss);
    Prefs.setInt(SAVE_KEY, i);
    Music.playRoom(i, this.room.isBossRoom && GA.musicBoss ? GA.musicBoss : GA.music);
    this.hud.fadeIn(0.3);
    let preview;
    if (LevelStatics.PreviewOverride < 0) {
      if (!this.previewEnemies || LevelStatics.previewedRoom === i) preview = false;
      else preview = !this.dropIn;
    } else preview = LevelStatics.PreviewOverride === 1;
    if (G.onRoomStart) G.onRoomStart();
    if (preview && this.roomEnemies().length > 0) {
      LevelStatics.previewedRoom = i;
      this.startCoroutine(this.previewRoutine());
      return;
    }
    if (this.dropIn) this.startCoroutine(this.dropInRoutine());
    else this.startFlash();
  }
  isMainBossRoom(r) {
    if (!r || !r.isBossRoom || !this.rooms) return false;
    let best = null, lv = 0;
    for (const rr of this.rooms) {
      if (!rr || !rr.isBossRoom) continue;
      for (const e of rr.node.getComponentsInChildren("HypoFangs.Enemy", true)) if (e.IsBoss && e.bossLevel >= lv) { lv = e.bossLevel; best = rr; }
    }
    return best === r;
  }
  *dropInRoutine() {
    let t = 0;
    while (this.player && !this.player.Dead && this.player.IntroActive && t < 5) { t += Time.deltaTime; yield; }
    if (this.player && this.player.IntroActive) this.player.endIntro();
    if (this.player && !this.player.Dead && this.mainBoss && this.extras.finalIntro && this.extras.finalIntro.ShouldPlay) yield* this.extras.finalIntro.play(this, this.mainBoss);
    this.roomStart = Time.time;
    this.startFlash();
  }
  startFlash() {
    const b = this.activeBoss();
    if (b) this.hud.flash("VS  " + b.bossName, 1.6);
    else this.hud.flash("THIS SHOULD WORK.", 1.3);
  }
  roomEnemies() { return Enemies.filter((e) => !e.Dead && e.node.activeInHierarchy); }
  *previewRoutine() {
    G.previewing = true; G.frozen = true; G.inputLocked = true;
    const c = this.cam.node.getComponent(Camera);
    const base = c.orthographicSize;
    yield;
    const list = this.roomEnemies(), tour = [];
    let v = this.player.node.position;
    while (list.length) {
      let idx = 0, best = Infinity;
      list.forEach((e, j) => {
        const p = e.node.position;
        let d = (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
        if (e.IsBoss) d += 1000000;
        if (d < best) { best = d; idx = j; }
      });
      tour.push(list[idx]); v = list[idx].node.position; list.splice(idx, 1);
    }
    let skip = false, t = 0;
    this.hud.flash(tour.length + (tour.length === 1 ? " TARGET" : " TARGETS"), 0.9);
    while (t < 0.55) { if ((skip = this.anyEdge)) break; t += GameClock.UnscaledDt; yield; }
    for (let i = 0; i < tour.length && !skip; i++) {
      const e = tour[i];
      if (!e) continue;
      this.cam.useOverride = true;
      const ch = e.Chest;
      this.cam.overrideTarget = { x: ch.x, y: ch.y + 0.3 };
      const dur = e.IsBoss ? this.previewPerBoss : this.previewPerEnemy;
      this.hud.flash(e.IsBoss ? e.bossName + "   " + e.MaxHp + " HITS" : "TARGET " + (i + 1) + " / " + tour.length, dur);
      if (e.IsBoss) CameraRig.shake(0.08, 0.25); else Sfx.play(GA.sfxBlip, 0.35, 0.15);
      t = 0;
      while (t < dur) {
        const dt = GameClock.UnscaledDt;
        t += dt;
        const target = e.IsBoss ? this.previewZoom * 0.9 : this.previewZoom;
        c.orthographicSize = Mathf.lerp(c.orthographicSize, target, 1 - Math.exp(-8 * dt));
        if (this.anyEdge) { skip = true; break; }
        yield;
      }
    }
    this.cam.useOverride = false;
    t = 0;
    while (t < 0.4) { const dt = GameClock.UnscaledDt; t += dt; c.orthographicSize = Mathf.lerp(c.orthographicSize, base, 1 - Math.exp(-10 * dt)); yield; }
    c.orthographicSize = base;
    G.previewing = false; G.frozen = false; G.inputLocked = false;
    this.roomStart = Time.time;
    if (this.dropIn) yield* this.dropInRoutine();
    else this.startFlash();
  }
  update() {
    if (!this.room) return;
    const now = anyHeld();
    this.anyEdge = now && !this.prevAny;
    this.prevAny = now;
    if (Input.hit("Escape", "KeyP")) this.togglePause();
    if (G.paused) return;
    if (!this.ending && !this.player.Dead && !G.frozen) {
      if (!this.player.IntroActive && !this.finalIntroPlaying) this.timeLeft -= Time.deltaTime;
      LevelStatics.totalTime += Time.deltaTime;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.player.die({ x: 0, y: 1 }, "TOO SLOW"); }
      if (Input.hit("KeyR")) { this.ending = true; this.startCoroutine(this.restart()); }
    }
    this.hud.setTimer(this.room.timeLimit > 0 ? this.timeLeft / this.room.timeLimit : 1);
    this.hud.setHeld(this.player.Held);
    this.hud.setKnives(this.player.Knives, this.player.maxKnives);
    this.hud.setEnemies(Math.max(this.EnemiesLeft, this.bossFarewellPlaying ? 1 : 0));
    const b = this.activeBoss();
    if (b && !b.Dead) this.hud.setBoss(b.bossName, b.Hp, b.MaxHp); else this.hud.setBoss(null, 0, 1);
    if (this.cinematicPlaying) return;
    // debug room keys of the original (F1..F12, PageUp/PageDown)
    for (let i = 0; i < 12 && i < this.rooms.length; i++) if (Input.hit("F" + (i + 1))) { G.roomIndex = i; LevelManager.reload(); return; }
    if (Input.hit("PageDown")) { G.roomIndex = Math.min(this.rooms.length - 1, this.room.index + 1); LevelManager.reload(); }
    else if (Input.hit("PageUp")) { G.roomIndex = Math.max(0, this.room.index - 1); LevelManager.reload(); }
  }
  exitReached() {
    if (this.ending || this.player.Dead || this.cinematicPlaying) return;
    if (!this.RoomClear) {
      if (Time.unscaledTime > this.notYetT) {
        this.notYetT = Time.unscaledTime + 1.2;
        this.hud.flash("NOT YET.  " + this.EnemiesLeft + " LEFT", 1);
        Sfx.play(GA.sfxBlip, 0.5, 0);
      }
    } else {
      this.ending = true; G.inputLocked = true;
      Sfx.play(GA.sfxBlip, 1, 0);
      this.startCoroutine(this.exitRoutine());
    }
  }
  *firstBossStory() {
    yield* this.hud.fadeOut(0.5);
    if (G.beginAkariStory) G.beginAkariStory(this.room.index + 1);
    else { G.roomIndex = this.room.index + 1; LevelManager.reload(); }
  }
  *exitRoutine() {
    if (this.room.index >= this.rooms.length - 1) {
      const finale = this.extras.ending;
      if (finale) yield* finale.play(this);
      const m = Math.floor(LevelStatics.totalTime / 60), s = LevelStatics.totalTime - m * 60;
      const text = () => `TIME  ${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}      RETRIES  ${LevelStatics.deaths}\n\n${InputPrompts.key(InputPrompts.Accept)}  Play again`;
      if (finale) finale.showResults(this.levelName + "  CLEAR", text()); else this.hud.showCenter(this.levelName + "  CLEAR", text());
      yield { realtime: 0.8 };
      while (!this.anyEdge) { if (finale) finale.showResults(this.levelName + "  CLEAR", text()); yield; }
      yield* this.hud.fadeOut(0.3);
      G.roomIndex = 0; LevelStatics.totalTime = 0; LevelStatics.deaths = 0;
      Prefs.setInt(SAVE_KEY, 0);
      LevelManager.reload();
    } else {
      if (G.onRoomCleared) G.onRoomCleared();
      this.hud.flash("ROOM CLEAR", 0.6);
      yield { realtime: 0.25 };
      yield* this.hud.fadeOut(0.3);
      G.roomIndex = this.room.index + 1;
      LevelManager.reload();
    }
  }
  onPlayerDeath(cause) {
    if (this.ending) return;
    if (G.onPlayerDeath) G.onPlayerDeath(cause);
    this.ending = true;
    this.startCoroutine(this.deathRoutine(cause));
  }
  *deathRoutine(cause) {
    yield { realtime: 0.55 };
    const prefix = cause === "TOO SLOW" ? "OUT OF TIME.\n\n" : !cause ? "" : cause + "\n\n";
    this.hud.showCenter("NO... THAT WON'T WORK.", prefix + InputPrompts.Retry);
    while (!this.anyEdge) { this.hud.setCenterSubtitle(prefix + InputPrompts.Retry); yield; }
    yield* this.restart();
  }
  *restart() {
    LevelStatics.deaths++;
    G.inputLocked = true;
    this.hud.hideCenter();
    this.hud.glitch(0.2);
    yield* this.hud.fadeOut(0.18);
    LevelManager.reload();
  }
  static reload() {
    G.frozen = G.inputLocked = G.paused = G.previewing = false;
    Time.timeScale = 1;
    if (G.loadScene) G.loadScene(G.sceneName);
  }
}
LevelManager.typeName = "HypoFangs.LevelManager";
registerScript(LevelManager);
LevelManager.spawnPickup = spawnPickup;

// ---------------------------------------------------------------- LaserSwitchPreview
function smoothStep(a, b, t) { t = Mathf.clamp01(t); t = -2 * t * t * t + 3 * t * t; return b * t + a * (1 - t); }
const skipPressed = () => !G.paused && Input.hit("Space", "Enter", "NumpadEnter", "Tap");

export class LaserSwitchPreview extends Component {
  constructor() { super(); this.triggerDistance = 4.5; this.travelSeconds = 0.35; this.holdSeconds = 1.15; this.focusSize = 2.8; this.shown = new Set(); this.IsPlaying = false; this.Target = null; this.Barrier = null; this.co = null; this.cachedRoom = null; }
  get Instruction() { return "DISABLE THE LASERS\n" + InputPrompts.Knife + "  THROW A KNIFE"; }
  awake() { this.level = this.node.getComponent(LevelManager); }
  update() {
    const L = this.level;
    if (this.IsPlaying) {
      if (skipPressed()) this.skipRequested = true;
      if (!L || !this.player || this.player.Dead || !this.Target || this.Target.Used || !this.Barrier || this.Barrier.Disabled || !this.Target.node.activeInHierarchy || L.rooms[Mathf.clamp(G.roomIndex, 0, L.rooms.length - 1)] !== this.cachedRoom) this.cancel();
      return;
    }
    if (!L || !L.player || L.player.Dead || !L.rooms || !L.rooms.length || G.paused || G.frozen || G.previewing || G.inputLocked || L.bossFarewellPlaying) return;
    const room = L.rooms[Mathf.clamp(G.roomIndex, 0, L.rooms.length - 1)];
    if (room !== this.cachedRoom) { this.cachedRoom = room; this.lasers = room.node.getComponentsInChildren(Laser, true); this.switches = room.node.getComponentsInChildren(LaserSwitch, true); }
    let barrier = null, target = null, best = this.triggerDistance;
    const c = L.player.Center;
    for (const l of this.lasers) {
      if (!l || !l.isActiveAndEnabled || l.Disabled || l.mode !== 0 || l.sweep || this.shown.has(room.index + ":" + l.group)) continue;
      const p = l.node.position;
      const d = Math.hypot(c.x - p.x, c.y - Mathf.clamp(c.y, p.y - l.length, p.y));
      if (d >= best) continue;
      let sw = null, sd = Infinity;
      for (const s of this.switches) {
        if (!s || s.Used || !s.isActiveAndEnabled || s.group !== l.group) continue;
        const sp = s.node.position, q = (sp.x - c.x) ** 2 + (sp.y - c.y) ** 2;
        if (q < sd) { sw = s; sd = q; }
      }
      if (sw) { best = d; barrier = l; target = sw; }
    }
    if (target) this.begin(barrier, target, room);
  }
  begin(barrier, target, room) {
    const L = this.level;
    this.player = L.player; this.rig = L.cam; this.camera = this.rig.node.getComponent(Camera);
    this.oldFrozen = G.frozen; this.oldLocked = G.inputLocked; this.oldController = this.player.enabled; this.oldVelocity = { ...this.player.rb.velocity };
    this.oldOverride = this.rig.useOverride; this.oldTarget = { ...this.rig.overrideTarget }; this.oldCameraPosition = this.camera.node.position; this.oldSize = this.camera.orthographicSize; this.oldSmooth = this.rig.smooth;
    this.Barrier = barrier; this.Target = target; this.IsPlaying = this.ownsState = true; this.skipRequested = false;
    this.shown.add(room.index + ":" + barrier.group);
    G.frozen = G.inputLocked = true; Time.timeScale = 0;
    Runtime.setEnabled(this.player, false);
    this.rig.useOverride = true; this.rig.overrideTarget = { ...this.oldCameraPosition }; this.rig.smooth = 0.05;
    this.co = this.startCoroutine(this.preview());
  }
  *preview() {
    const tp = this.Target.node.position;
    yield* this.travel(this.oldCameraPosition, tp, this.oldSize, this.focusSize, true);
    if (!this.skipRequested) {
      let ins = this.Instruction;
      this.level.hud.flash(ins, this.holdSeconds + 0.15);
      for (let t = 0; t < this.holdSeconds; t += GameClock.UnscaledDt) {
        if (this.skipRequested) break;
        if (skipPressed()) { this.skipRequested = true; break; }
        if (ins !== this.Instruction) { ins = this.Instruction; this.level.hud.flash(ins, Math.max(0.3, this.holdSeconds - t + 0.15)); }
        yield;
      }
    }
    this.level.hud.clearFlash();
    yield* this.travel({ ...this.rig.overrideTarget }, this.oldCameraPosition, this.camera.orthographicSize, this.oldSize, false);
    this.restore();
  }
  *travel(from, to, fs, ts, allowSkip) {
    const dur = Math.max(0.05, this.travelSeconds);
    for (let t = 0; t < dur; t += GameClock.UnscaledDt) {
      if (allowSkip && (this.skipRequested || skipPressed())) { this.skipRequested = true; return; }
      const k = smoothStep(0, 1, t / dur);
      this.rig.overrideTarget = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      this.camera.orthographicSize = fs + (ts - fs) * k;
      yield;
    }
    this.rig.overrideTarget = { x: to.x, y: to.y };
    this.camera.orthographicSize = ts;
  }
  cancel() { if (this.IsPlaying) { if (this.co) this.co.dead = true; this.restore(); } }
  restore() {
    if (!this.ownsState) return;
    this.ownsState = false;
    if (this.player) {
      if (this.skipRequested) this.player.consumePreviewConfirm();
      Runtime.setEnabled(this.player, this.oldController);
      this.player.rb.velocity = { ...this.oldVelocity };
    }
    if (this.rig) {
      this.rig.useOverride = this.oldOverride; this.rig.overrideTarget = this.oldTarget; this.rig.smooth = this.oldSmooth;
      if (this.camera) this.camera.orthographicSize = this.oldSize;
      this.rig.snap();
    }
    if (this.level && this.level.hud) this.level.hud.clearFlash();
    G.frozen = this.oldFrozen; G.inputLocked = this.oldLocked;
    Time.timeScale = G.paused || this.oldFrozen ? 0 : TimeFX.External;
    this.IsPlaying = false; this.Target = null; this.Barrier = null;
  }
  onDisable() { this.cancel(); }
}
LaserSwitchPreview.order = -200;
