// EncounterTutorial: freezes time the first time a technique is needed and shows a "NEURAL LINK // NEW TECHNIQUE" card.
// The trigger logic is rebuilt from the IL of EncounterTutorial.Update (the decompiler could not print it).
import { Component, Time, Mathf } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { Camera } from "../engine/scene.js";
import { raycast, mask, Collider2D, LAYER } from "../engine/physics.js";
import { G, TimeFX, Prefs } from "./common.js";
import { Bullets, Lasers, Pickups, LaserSwitch, ExitZone } from "./world.js";
import { Enemies, Kind } from "./enemy.js";
import { DaggerBreakProgress } from "./progress.js";
import { InputPrompts } from "./prompts.js";
import { UI } from "../ui/draw.js";

const L = { Move: 0, Jump: 1, Katana: 2, Deflect: 3, Roll: 4, Dagger: 5, Knives: 6, Pickup: 7, Wall: 8, Drop: 9, Laser: 10, LaserSwitch: 11, Shield: 12, Boss: 13, Exit: 14 };
const NAMES = Object.keys(L);
const PREFIX = "hypofangs_tutorial_v1_";
const CYAN = "rgb(65,243,255)", PINK = "rgb(255,56,156)";

export class EncounterTutorial extends Component {
  constructor() { super(); this.IsPlaying = false; this.seen = new Set(); this.gap = 0; this.room = null; this.openAge = 0; this.CompletedCount = 0; }
  awake() {
    EncounterTutorial.I = this;
    this.level = G.level;
    NAMES.forEach((n, i) => { if (Prefs.getInt(PREFIX + n, 0) !== 0) this.seen.add(i); });
  }
  onDestroy() { this.cancel(); if (EncounterTutorial.I === this) EncounterTutorial.I = null; }
  onDisable() { this.cancel(); }
  currentRoom() { const l = this.level; return l && l.rooms && l.rooms.length ? l.rooms[Mathf.clamp(G.roomIndex, 0, l.rooms.length - 1)] : null; }
  try(lesson, cond, focus) { if (!cond || this.seen.has(lesson)) return false; this.begin(lesson, focus); return true; }
  begin(lesson, focus) {
    this.player = this.level.player; this.room = this.currentRoom();
    this.Current = lesson; this.target = focus;
    this.oldFrozen = G.frozen; this.oldLocked = G.inputLocked;
    this.savedVelocity = { ...this.player.rb.velocity };
    this.IsPlaying = true; G.tutorialActive = true; this.resumeRequested = false; this.openAge = 0;
    G.frozen = G.inputLocked = true; Time.timeScale = 0;
    this.player.discardTutorialInput();
  }
  requestContinue() { if (this.IsPlaying && !G.paused && !(this.openAge < 0.3)) this.resumeRequested = true; }
  complete() {
    this.seen.add(this.Current);
    Prefs.setInt(PREFIX + NAMES[this.Current], 1);
    this.CompletedCount++;
    this.cancel();
    this.gap = 1.1;
  }
  cancel() {
    if (!this.IsPlaying) return;
    this.IsPlaying = false; G.tutorialActive = false;
    G.frozen = this.oldFrozen; G.inputLocked = this.oldLocked;
    if (this.player) { this.player.discardTutorialInput(); this.player.rb.velocity = { ...this.savedVelocity }; }
    Time.timeScale = G.paused || this.oldFrozen ? 0 : TimeFX.External;
  }
  update() {
    const lv = this.level;
    if (this.IsPlaying) {
      if (!this.player || this.player.Dead || !lv || this.currentRoom() !== this.room) { this.cancel(); return; }
      if (G.paused) return;
      this.openAge += Time.unscaledDeltaTime;
      if (this.openAge > 0.3 && Input.hit("Enter", "NumpadEnter", "Space", "Tap")) this.requestContinue();
      if (this.resumeRequested && !Input.held("Enter", "NumpadEnter", "Space", "Mouse0", "Tap")) this.complete();
      return;
    }
    if (!lv || !lv.player || lv.player.Dead || lv.player.IntroActive || G.paused || G.frozen || G.inputLocked || G.previewing || lv.cinematicPlaying) return;
    const p = this.player = lv.player;
    const room = this.currentRoom();
    if (!room) return;
    if (room !== this.room) {
      this.room = room; this.spawn = p.node.position; this.gap = 0.35;
      this.breakables = room.node.getComponentsInChildren(DaggerBreakProgress, true);
      this.switches = room.node.getComponentsInChildren(LaserSwitch, true);
      this.platforms = room.node.getComponentsInChildren(Collider2D, true);
      this.exit = room.node.getComponentsInChildren(ExitZone, true)[0] || null;
    }
    const c = p.Center;
    if (!this.seen.has(L.Deflect)) for (const b of Bullets) {
      if (b.reflected || !b.isActiveAndEnabled) continue;
      const bp = b.node.position, dx = c.x - bp.x, dy = c.y - bp.y;
      const v2 = b.velocity.x ** 2 + b.velocity.y ** 2;
      const t = v2 > 0.01 ? (dx * b.velocity.x + dy * b.velocity.y) / v2 : -1;
      if (t > 0 && t < 0.32 && Math.hypot(dx - b.velocity.x * t, dy - b.velocity.y * t) < 0.85) { this.begin(L.Deflect, b.node); return; }
    }
    this.gap -= Time.deltaTime;
    if (this.gap > 0) return;
    if (this.try(L.Move, true, null)) return;
    let enemy = null, ed = 100;
    for (const e of Enemies) {
      if (e.Dead || !e.isActiveAndEnabled) continue;
      const ch = e.Chest, d = Math.hypot(c.x - ch.x, c.y - ch.y);
      if (d < ed) { enemy = e; ed = d; }
    }
    if (enemy) {
      if (this.try(L.Katana, ed < 6.5, enemy.node)) return;
      if (this.try(L.Shield, ed < 5 && (enemy.kind === Kind.Shield || enemy.kind === Kind.Warrior), enemy.node)) return;
      if (this.try(L.Boss, enemy.IsBoss && ed < 8, enemy.node)) return;
      if (this.try(L.Roll, enemy.Winding && ed < 4.5, enemy.node)) return;
    }
    for (const l of Lasers) {
      if (l.Disabled || !l.isActiveAndEnabled) continue;
      const lp = l.node.position;
      if (Math.hypot(c.x - lp.x, c.y - Mathf.clamp(c.y, lp.y - l.length, lp.y)) > 5.2) continue;
      const sw = this.switches.find((s) => s.isActiveAndEnabled && !s.Used && s.group === l.group) || null;
      if (this.try(L.LaserSwitch, !!sw, l.node)) return;
      if (this.try(L.Laser, !sw, l.node)) return;
    }
    for (const b of this.breakables) {
      if (!b.isActiveAndEnabled || b.ReadyToBreak) continue;
      const bp = b.node.position;
      if (this.try(L.Dagger, Math.hypot(c.x - bp.x, c.y - bp.y) < 4, b.node)) return;
    }
    for (const k of Pickups) {
      if (!k.isActiveAndEnabled) continue;
      const kp = k.node.position;
      if (this.try(L.Pickup, Math.hypot(c.x - kp.x, c.y - kp.y) < 2.8, k.node)) return;
    }
    const wall = raycast(c.x, c.y, p.Facing, 0, 1.3, mask("Ground"), { noTriggers: true });
    if (this.try(L.Wall, !p.Grounded && !!wall, wall ? wall.collider.node : null)) return;
    const pb = p.body.bounds, pp = p.node.position;
    for (const col of this.platforms) {
      if (!col.enabled || !col.node.activeInHierarchy || col.node.layer !== LAYER.OneWay) continue;
      const b = col.bounds;
      if (this.try(L.Drop, p.Grounded && c.x > b.minX && c.x < b.maxX && Math.abs(pb.minY - b.maxY) < 0.2, col.node)) return;
      if (this.try(L.Jump, b.maxY > pp.y + 0.5 && b.maxY < pp.y + 3.8 && Math.abs(c.x - b.cx) < b.ex + 2.5, col.node)) return;
    }
    if (this.try(L.Jump, p.Grounded && (!!wall || Math.hypot(this.spawn.x - pp.x, this.spawn.y - pp.y) > 3.5), wall ? wall.collider.node : null)) return;
    if (enemy && this.try(L.Knives, this.seen.has(L.Katana) && ed > 3 && ed < 8, enemy.node)) return;
    if (this.exit) { const xp = this.exit.node.position; this.try(L.Exit, lv.EnemiesLeft === 0 && Math.hypot(c.x - xp.x, c.y - xp.y) < 7, this.exit.node); }
  }
  texts() {
    const P = InputPrompts;
    switch (this.Current) {
      case L.Move: return ["TAKE CONTROL", P.Move, "Move through the district. One hit can kill you.\nClear the enemies, then reach the exit."];
      case L.Jump: return ["KEEP MOVING", P.Jump, "Jump over obstacles and onto platforms.\nRelease the button early for a shorter jump."];
      case L.Katana: return ["DRAW YOUR KATANA", P.Katana, "Slash the enemy in front of you.\nZenji lunges in the direction he is facing."];
      case L.Deflect: return ["SEND IT BACK", P.Katana, "An incoming projectile is frozen. Time a KATANA slash\nas it reaches your blade to send it back. Daggers cannot deflect."];
      case L.Roll: return ["SLIP THE ATTACK", P.Roll, "Roll through danger with brief invulnerability.\nAn enemy's wind-up is your cue to move."];
      case L.Dagger: return ["BREAK THROUGH", P.Dagger, "Land FIVE consecutive dagger hits on this door or glass.\nLet each animation finish. A miss or interruption resets the chain."];
      case L.Knives: return ["STRIKE FROM RANGE", P.Knife, "Throw a knife straight ahead. You carry three;\none recharges every " + this.player.KnifeReloadSeconds.toFixed(2) + " seconds. Face your target first."];
      case L.Pickup: return ["TURN IT INTO A WEAPON", P.PickUp, "Pick up an object; press again to throw it.\nEach new dagger permanently cuts reload by 0.25s."];
      case L.Wall: return ["OWN THE WALL", P.MoveShort + " + " + P.Jump, "Hold toward the wall to glide with your dagger.\nJump while touching it to climb or kick away."];
      case L.Drop: return ["DROP THROUGH", P.Down, "Stand still on a thin platform, then press DOWN to drop.\nWhile moving, DOWN rolls instead."];
      case L.Laser: return ["CROSS THE BEAM", P.Roll, "Lasers kill on contact. Roll through with invulnerability\nor wait for a timed beam to switch off. Watch sweeping beams."];
      case L.LaserSwitch: return ["CUT THE POWER", P.Knife, "Hit the matching switch with a throwing knife to disable this barrier.\nFollow the yellow indicator. A short preview will show the switch."];
      case L.Shield: return ["BREAK THEIR GUARD", P.PickUp + " / " + P.Roll, "A frontal shield blocks your attacks. Throw an object\nto stagger its owner, or roll behind and cut from the rear."];
      case L.Boss: return ["READ. EVADE. PUNISH.", P.Roll + "  >  " + P.Katana, "Bosses can block and parry. Bait an attack, evade,\nthen strike during recovery. They will pursue you onto platforms."];
      default: return ["AREA CLEAR", P.MoveShort, "All targets are down. Follow the GO sign\nand move into the exit to reach the next district."];
    }
  }
  // card in the 640x360 overlay (scale 0.78 around the top-centre pivot)
  draw() {
    if (!this.IsPlaying || G.paused) return null;
    UI.rect(0, 0, UI.W, UI.H, "rgba(4,3,14,0.42)");
    const [head, bind, body] = this.texts();
    const c = UI.ctx;
    c.save();
    c.translate(UI.W / 2, 36); c.scale(0.78, 0.78); c.translate(-238, 0);
    UI.rect(0, 0, 476, 184, "rgba(9,11,28,0.976)");
    UI.rect(0, 0, 3, 184, CYAN); UI.rect(384, 0, 92, 3, PINK); UI.rect(18, 26, 440, 1, "rgba(65,243,255,0.4)");
    const F = "Pixels";
    UI.text("NEURAL LINK  //  NEW TECHNIQUE", 18, 18, 10, CYAN, 0, F);
    UI.text("TIME FROZEN", 376, 17, 9, PINK, 0, F);
    UI.text(head, 18, 49, 20, "#fff", 0, F);
    let bs = 12; while (bs > 10 && Math.max(...body.split("\n").map((l) => UI.measure(l, bs, F))) > 440) bs -= 0.5;
    UI.textTop(body, 18, 70, bs, "rgb(217,230,247)", 0, F);
    let ks = 16; const kb = "[ " + bind + " ]"; while (ks > 10 && UI.measure(kb, ks, F) > 440) ks -= 0.5;
    UI.text(kb, 18, 127, ks, "rgb(255,225,87)", 0, F);
    UI.text(InputPrompts.DeviceName.toUpperCase(), 18, 158, 8, CYAN, 0, F);
    UI.text(InputPrompts.Accept + "  CONTINUE   //   " + InputPrompts.Pause + "  PAUSE", 18, 173, 8, "rgb(186,198,218)", 0, F);
    UI.rect(476 - 18 - 116, 184 - 28 - 23, 116, 23, "rgb(21,58,72)");
    UI.text("CONTINUE >", 476 - 18 - 58, 184 - 28 - 11.5, 10, CYAN, 1, F);
    c.restore();
    // focus frame around the target
    if (this.target && Camera.main) {
      const cam = Camera.main, cp = cam.node.position, h = cam.orthographicSize, w = h * cam.aspect, tp = this.target.position;
      const sx = (tp.x - (cp.x - w)) / (2 * w) * UI.W, sy = UI.H - (tp.y + 0.65 - (cp.y - h)) / (2 * h) * UI.H;
      if (sx > 20 * UI.W / G.cssW && sx < UI.W - 20 && sy > UI.H * 0.57 && sy < UI.H - 25) {
        UI.rect(sx - 20, sy - 20, 40, 40, "rgba(65,243,255,0.06)");
        c.strokeStyle = CYAN; c.lineWidth = 1; c.strokeRect(sx - 20 + 1, sy - 20 + 1, 40, 40);
      }
    }
    return { x: UI.W / 2 + (476 - 18 - 116 - 238) * 0.78, y: 36 + (184 - 51) * 0.78, w: 116 * 0.78, h: 23 * 0.78 };
  }
}
EncounterTutorial.order = -500;
EncounterTutorial.I = null;
