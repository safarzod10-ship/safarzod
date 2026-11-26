// Screen flow and overlay UI: start window (RetroPauseMenu look) with balance / Stars / stake, pause window,
// prologue presentation (chapter label, speech boxes, time card, story buttons), run results.
import { Time, Mathf } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { Assets } from "../engine/assets.js";
import { Camera } from "../engine/scene.js";
import { G, Prefs, Sfx, GA, Music } from "../game/common.js";
import { LevelStatics, SAVE_KEY } from "../game/levelmanager.js";
import { InputPrompts } from "../game/prompts.js";
import { Speech } from "../game/prologue.js";
import { UI } from "./draw.js";
import { buildTree, layout, drawTree, hitButton, buttonsOf } from "./uitree.js";
import { Api, Run } from "../net/api.js";
import { Touch } from "./touch.js";
import { LevelMap } from "./levelmap.js";

let template = null;
const pointer = { x: -1, y: -1, down: null };
const WHITE = "#fff";

function refPoint(e) {
  const r = document.getElementById("stage").getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * UI.W, y: (e.clientY - r.top) / r.height * UI.H };
}

// ---------------------------------------------------------------- windows built from the RetroPauseMenu prefab
class RetroWindow {
  constructor() {
    this.tree = template.clone();
    this.overlay = this.tree.find("PauseOverlay");
    this.win = this.overlay.find("PauseWindow");
    this.main = this.win.find("MainPage"); this.controls = this.win.find("ControlsPage"); this.confirm = this.win.find("ConfirmPage");
    this.pauseButton = this.tree.find("PauseButton");
    this.selected = null;
    this.win.find("ControlsTab").onClick = () => this.page("controls");
    this.win.find("MissionTab").onClick = () => this.page("main");
    this.win.find("CloseButton").onClick = () => this.back();
    this.confirm.find("CancelButton").onClick = () => this.page("main");
    this.controls.find("BackButton").active = false;
  }
  page(p) {
    this.main.active = p === "main"; this.controls.active = p === "controls"; this.confirm.active = p === "confirm";
    if (this.extra) for (const [k, n] of Object.entries(this.extra)) n.active = p === k;
    this.win.find("ControlsTab").toggled = p === "controls";
    this.win.find("MissionTab").toggled = p === "main";
    this.current = p;
    this.selected = null;
    if (p === "controls") this.fillControls();
  }
  fillControls() {
    this.controls.find("Heading").text.text = G.touch && Input.lastDevice === "touch" ? "Touch controls" : "Keyboard + mouse";
    const rows = InputPrompts.controlsTable(!!G.level);
    this.controls.find("ControlsFrame/KeyboardControls").text.text = rows.map(([a, b]) => `${a}<pos=118>${b}`).join("\n");
    this.controls.find("GamepadControls").text.text = InputPrompts.DeviceName + " active\nWe recommend playing with a controller.";
  }
  confirmAsk(msg, yes) {
    this.confirm.find("Message").text.text = msg;
    this.confirm.find("ConfirmButton").onClick = yes;
    this.page("confirm");
  }
  layout() { layout(this.tree, 0, 0, UI.W, UI.H, UI.H); }
  draw(showWindow) {
    this.overlay.active = showWindow;
    this.layout();
    drawTree(this.tree, { hover: this.hover, pressed: pointer.down && pointer.down.win === this ? pointer.down.btn : null, selected: this.selected });
  }
  navigate() {
    if (!this.overlay.active) return;
    const list = buttonsOf(this.win).filter((b) => b.interactable !== false && b.name !== "CloseButton");
    if (!list.length) return;
    if (Input.hit("ArrowDown", "KeyS", "ArrowRight", "KeyD")) this.selected = list[(list.indexOf(this.selected) + 1) % list.length];
    if (Input.hit("ArrowUp", "KeyW", "ArrowLeft", "KeyA")) this.selected = list[(list.indexOf(this.selected) - 1 + list.length) % list.length];
    if (this.selected && Input.hit("Enter", "NumpadEnter", "Space")) this.click(this.selected);
  }
  click(b) { if (b && b.onClick && b.interactable !== false) { Sfx.play(GA.sfxBlip, 0.5, 0); b.onClick(); } }
}

function makeButton(proto, name, label, x, y, w, h, onClick) {
  const b = proto.clone();
  b.name = name; b.rt.pos = [x, y]; b.rt.size = [w, h];
  b.children[0].rt.size = [w - 8, h - 4];
  b.setLabel(label); b.onClick = onClick; b.active = true;
  return b;
}

// ---------------------------------------------------------------- start window
class StartMenu extends RetroWindow {
  constructor() {
    super();
    this.win.find("Title").text.text = "HYPOFANGS.EXE";
    const m = this.main;
    m.find("Heading").text.text = "HYPOFANGS";
    this.info = m.find("RoomInfoFrame/RoomInfo");
    const proto = m.find("ResumeButton");
    proto.setLabel("New game");
    proto.onClick = () => Overlays.newGame();
    m.find("RestartButton").onClick = () => Overlays.continueGame();
    m.find("QuitButton").setLabel("Stars");
    m.find("QuitButton").onClick = () => { this.page("stars"); Api.refresh(); };
    // Stars page: balance, top-up packs, stake per run
    const page = this.confirm.clone();
    page.name = "StarsPage"; page.children = [];
    const heading = this.confirm.find("Heading").clone(); heading.text.text = "Stars"; page.add(heading);
    const frame = m.find("RoomInfoFrame").clone(); frame.rt.pos = [0, -28]; page.add(frame);
    this.starsInfo = frame.find("RoomInfo");
    const lab1 = this.confirm.find("Heading").clone(); lab1.text.text = "Top up"; lab1.text.size = 12; lab1.rt.pos = [0, -78]; lab1.rt.size = [316, 16]; page.add(lab1);
    const lab2 = lab1.clone(); lab2.text.text = "Stake per run"; lab2.rt.pos = [0, -126]; page.add(lab2);
    this.packButtons = []; this.stakeButtons = [];
    for (let i = 0; i < 4; i++) {
      const pb = makeButton(proto, "Pack" + i, "", -118.5 + i * 79, -96, 75, 26, () => this.buy(i));
      page.add(pb); this.packButtons.push(pb);
      const sb = makeButton(proto, "Stake" + i, "", -118.5 + i * 79, -144, 75, 26, () => this.setStake(i));
      page.add(sb); this.stakeButtons.push(sb);
    }
    page.add(makeButton(proto, "Back", "Back", 0, -178, 316, 24, () => this.page("main")));
    this.win.add(page);
    this.extra = { stars: page };
    this.page("main");
  }
  buy(i) {
    const p = Api.profile;
    if (!p) return;
    const amount = p.packs[i];
    this.notice = "...";
    Api.topUp(amount).then((st) => { this.notice = st === "paid" ? "+" + amount + " ★" : st; return Api.refresh(); }).catch((e) => (this.notice = e.message));
  }
  setStake(i) {
    const p = Api.profile;
    const s = p ? p.stakes[i] : 0;
    if (p && s > p.balance) return;
    Run.stake = s; Prefs.setInt("hypofangs_stake", s);
  }
  back() { if (this.current !== "main") this.page("main"); }
  refresh() {
    const p = Api.profile;
    const m = this.main;
    const saved = Prefs.has(SAVE_KEY) && Prefs.getInt("hypofangs_prologue_complete", 0) === 1;
    const room = Prefs.getInt(SAVE_KEY, 0);
    const cont = m.find("RestartButton");
    cont.setLabel(saved ? "Continue  -  room " + String(room + 1).padStart(2, "0") : "Continue");
    cont.interactable = saved;
    this.info.text.text = p ? `BALANCE  ${p.balance} ★     BEST  ${p.best}\nSTAKE  ${Run.stake} ★` : Api.loading ? "..." : Api.error || "";
    m.find("Subtitle").text.text = "NEON DISTRICT";
    this.starsInfo.text.text = p ? `BALANCE  ${p.balance} ★     BEST  ${p.best}` + (this.notice ? "\n" + this.notice : "") : Api.error || "...";
    this.packButtons.forEach((b, i) => { b.active = !!p; if (p) b.setLabel("+" + p.packs[i] + " ★"); });
    this.stakeButtons.forEach((b, i) => {
      const s = p ? p.stakes[i] : [0, 10, 25, 50][i];
      b.setLabel(s ? s + " ★" : "0");
      b.toggled = Run.stake === s;
      b.interactable = !!p && (s === 0 || s <= p.balance);
    });
    this.win.find("Status").text.text = InputPrompts.MenuHelp;
  }
}

// ---------------------------------------------------------------- pause window
class PauseWindow extends RetroWindow {
  constructor() {
    super();
    this.open_ = false;
    const m = this.main;
    m.find("ResumeButton").onClick = () => this.resume();
    m.find("RestartButton").onClick = () => this.confirmAsk(this.restartText(), () => this.restart());
    m.find("QuitButton").onClick = () => this.confirmAsk(this.quitText(), () => this.quit());
    this.pauseButton.onClick = () => this.toggle();
    this.mapButton = makeButton(m.find("ResumeButton"), "LevelMapButton", "Level map", 81, -153, 154, 28, () => this.openMap());
    m.add(this.mapButton);
    this.page("main");
  }
  openMap() { if (!G.level) return; if (!G.paused) G.level.setPaused(true); LevelMap.open(); }
  restartText() { return G.prologue ? "Restart the prologue?\n\nThe story will play again\nfrom the school bus arrival." : "Restart this room?\n\nThe current attempt will be lost.\nYou will return to the room entrance."; }
  quitText() { return G.prologue ? "Quit HypoFangs?\n\nThe prologue will restart\nwhen you launch the game again." : "Quit HypoFangs?\n\nYour current room is saved.\nYou can continue next time."; }
  toggle() { if (G.level) G.level.togglePause(); else if (G.prologue) G.prologue.togglePause(); }
  open() { this.open_ = true; this.page("main"); this.refresh(); }
  hide() { this.open_ = false; }
  backOrResume() { if (LevelMap.IsOpen) { LevelMap.close(); this.page("main"); } else if (this.current !== "main") this.page("main"); else this.resume(); }
  back() { this.backOrResume(); }
  resume() { LevelMap.close(); if (G.level) G.level.setPaused(false); else if (G.prologue) G.prologue.setPaused(false); this.open_ = false; }
  restart() { this.open_ = false; if (G.level) G.level.restartFromPause(); else if (G.prologue) G.prologue.restartPrologue(); }
  quit() { this.open_ = false; G.paused = false; Time.timeScale = 1; Overlays.toMenu(); }
  refresh() {
    const lm = G.level;
    this.win.find("Title").text.text = "HYPOFANGS.EXE  -  Paused";
    const rb = this.main.find("RestartButton");
    rb.setLabel(G.prologue ? "Restart prologue" : "Restart room");
    rb.rt.pos = [lm ? -81 : 0, -153]; rb.rt.size = [lm ? 154 : 316, 28]; rb.children[0].rt.size = [lm ? 146 : 308, 24];
    this.mapButton.active = !!lm;
    const room = lm && lm.room;
    this.main.find("RoomInfoFrame/RoomInfo").text.text = room ? `ROOM ${String(G.roomIndex + 1).padStart(2, "0")}  /  ${room.displayName}\n${lm.EnemiesLeft} targets remaining` : G.prologue ? "MABOROSHI BRIDGE\nStory suspended" : "Session suspended";
    this.win.find("Status").text.text = G.paused && this.current === "main" ? `${InputPrompts.key(InputPrompts.Pause)} Resume  |  ${G.prologue ? "Story suspended" : "Timer suspended"}` : InputPrompts.MenuHelp;
    this.pauseButton.setLabel(InputPrompts.key(InputPrompts.Pause) + "  Pause");
  }
}

// ---------------------------------------------------------------- flow
export const Overlays = {
  menu: null, pause: null, mode: "loading", result: null,
  async boot(start) {
    const res = await Assets.loadJSON("data/resources.json");
    template = buildTree(res, "RetroPauseMenu");
    this.pause = new PauseWindow();
    G.pauseMenu = this.pause;
    this.menu = new StartMenu();
    Run.stake = Prefs.getInt("hypofangs_stake", 0);
    const stage = document.getElementById("stage");
    stage.addEventListener("pointerdown", (e) => this.pointerDown(e));
    stage.addEventListener("pointermove", (e) => { const p = refPoint(e); pointer.x = p.x; pointer.y = p.y; Touch.handleMove(e, p); });
    window.addEventListener("pointerup", (e) => this.pointerUp(e));
    window.addEventListener("pointercancel", (e) => this.pointerUp(e));
    G.onEnemyKilled = () => Run.kill();
    G.onRoomCleared = () => Run.roomCleared();
    G.onRoomStart = () => Run.begin();
    G.onPlayerDeath = () => Run.end().then((r) => (this.result = r));
    Api.refresh().then(() => { if (Api.profile && Run.stake > Api.profile.balance) Run.stake = 0; });
    const params = new URLSearchParams(location.search);
    if (params.has("room")) { LevelStatics.launched = true; this.mode = "game"; G.menuOpen = false; G.loadScene("level1"); return; }
    if (start) { this.mode = "game"; G.menuOpen = false; G.loadScene(start); return; }
    this.toMenu();
  },
  toMenu() {
    if (Run.active) Run.end();
    this.mode = "menu"; G.menuOpen = true; this.result = null;
    this.menu.page("main");
    G.loadScene("level0");
    Api.refresh();
  },
  newGame() {
    this.mode = "game"; G.menuOpen = false;
    if (G.sceneName !== "level0" || !G.prologue) G.loadScene("level0");
  },
  continueGame() {
    this.mode = "game"; G.menuOpen = false;
    LevelStatics.launched = false;
    G.loadScene("level1");
  },
  pointerDown(e) {
    const p = refPoint(e);
    pointer.x = p.x; pointer.y = p.y;
    if (e.pointerType === "touch") { G.touch = true; Input.lastDevice = "touch"; }
    if (LevelMap.IsOpen) { LevelMap.click(p); return; }
    const win = this.activeWindow();
    let btn = null;
    if (win) btn = hitButton(win.overlay.active ? win.win : win.tree, p.x, p.y);
    if (!btn && this.mode === "game") btn = this.storyButtonAt(p);
    if (btn) { pointer.down = { win, btn }; e.preventDefault(); return; }
    if (this.mode === "game" && !G.paused && Touch.handleDown(e, p)) return;
    if (e.pointerType === "touch") { Input.press("Tap"); Input.release("Tap"); }
  },
  pointerUp(e) {
    Touch.handleUp(e);
    const d = pointer.down;
    pointer.down = null;
    if (!d) return;
    const p = refPoint(e);
    const r = d.btn.rect;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) (d.win || this.pause).click(d.btn);
  },
  activeWindow() {
    if (this.mode === "menu") return this.menu;
    if (G.paused && this.pause.open_) return this.pause;
    return null;
  },
  storyButtonAt(p) {
    if (G.paused) return null;
    const list = [this.pause.pauseButton];
    if (G.prologue) list.push(...this.storyButtons());
    for (const b of list) { const r = b.rect; if (b.active && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return b; }
    return null;
  },
  storyButtons() {
    if (!this.next) {
      const proto = this.pause.main.find("ResumeButton");
      this.next = makeButton(proto, "NextDialogueLine", "", -8, 8, 180, 22, () => G.prologue && G.prologue.advanceDialogue());
      this.skip = makeButton(proto, "SkipEntirePrologue", "", -8, 36, 180, 22, () => G.prologue && G.prologue.beginGameplay());
      for (const b of [this.next, this.skip]) { b.rt.amin = [1, 0]; b.rt.amax = [1, 0]; b.rt.pivot = [1, 0]; }
    }
    return [this.next, this.skip];
  },
  update() {
    if (!template) return;
    if (G.level && this.mode === "game" && Input.hit("KeyM", "Tab") && G.level.CanPause !== false) {
      if (LevelMap.IsOpen) { LevelMap.close(); this.pause.resume(); } else if (G.paused || G.level.CanPause) this.pause.openMap();
    }
    LevelMap.update();
    if (LevelMap.IsOpen) return;
    const win = this.activeWindow();
    if (win) {
      win.hover = hitButton(win.win, pointer.x, pointer.y);
      win.navigate();
      if (this.mode === "menu" && Input.hit("Escape")) this.menu.back();
      if (this.mode === "menu") this.menu.refresh(); else this.pause.refresh();
    }
  },
  draw() {
    if (!template) return;
    if (G.level && G.level.extras.tutorial) G.level.extras.tutorial.draw();
    if (G.prologue && this.mode === "game") this.drawPrologue();
    if (this.mode === "menu") { this.menu.pauseButton.active = false; this.menu.draw(true); return; }
    this.pause.refresh();
    this.pause.pauseButton.active = !G.paused;
    this.pause.draw(G.paused && this.pause.open_);
    LevelMap.draw();
    if (this.result && G.level && G.level.player && G.level.player.Dead) this.drawResult();
  },
  drawResult() {
    const r = this.result;
    let line = `SCORE  ${r.score}`;
    if (r.stake) line += r.payout != null ? `     x${r.mult}   +${r.payout} ★` : r.error ? `     ${r.error}` : "";
    UI.text(line, UI.W / 2, UI.H / 2 + 74, 12, WHITE, 1);
  },
  drawPrologue() {
    const P = G.prologue;
    UI.text("MABOROSHI BRIDGE", 10, 17, 9, WHITE, 0);
    for (const b of Speech.boxes) { const s = b.speech && b.speech(); if (s) drawSpeech(s); }
    if (P.card) {
      UI.rect(0, 0, UI.W, UI.H, `rgba(0,0,0,${P.card.alpha})`);
      if (P.card.text) {
        const size = P.card.size / 3;
        const lines = UI.wrap(P.card.text, UI.W - 128 / 3, size, "Pixels");
        UI.text(lines.join("\n"), UI.W / 2, UI.H / 2, size, WHITE, 1, "Pixels", 1, null, 1.25);
      }
    }
    const [next, skip] = this.storyButtons();
    next.setLabel(InputPrompts.key(InputPrompts.Accept) + " Next line");
    skip.setLabel(InputPrompts.key(InputPrompts.SkipStory) + " Skip prologue");
    for (const b of [next, skip]) {
      layout(b, 0, 0, UI.W, UI.H, UI.H);
      if (!G.paused) drawTree(b, { pressed: pointer.down && pointer.down.btn === b ? b : null });
    }
  },
};

// speech box: black panel with coloured, letter-by-letter text and a tail toward the speaker
function drawSpeech(s) {
  const cam = Camera.main;
  if (!cam) return;
  const cp = cam.node.position, h = cam.orthographicSize, w = h * cam.aspect;
  const sx = (s.at.x - (cp.x - w)) / (2 * w) * UI.W, sy = UI.H - (s.at.y - (cp.y - h)) / (2 * h) * UI.H;
  const size = 56 / 3, padX = 6, padY = 4;
  const lines = UI.wrap(s.text, UI.W * 0.68 - padX * 2, size, "Pixels");
  UI.font(size, "Pixels");
  const c = UI.ctx;
  const tw = Math.max(...lines.map((l) => c.measureText(l).width));
  const bw = Math.ceil(tw + padX * 2), bh = Math.ceil(lines.length * size * 1.05 + padY * 2);
  const bx = Mathf.clamp(sx - bw / 2, 6, UI.W - bw - 6);
  const by = Mathf.clamp(sy - bh - 14, 30, UI.H - bh - 40);
  c.globalAlpha = s.alpha;
  c.fillStyle = "#000";
  c.fillRect(bx, by, bw, bh);
  const tx = Mathf.clamp(sx, bx + 8, bx + bw - 8);
  c.beginPath(); c.moveTo(tx - 5, by + bh); c.lineTo(tx + 5, by + bh); c.lineTo(tx, Math.min(sy - 2, by + bh + 9)); c.closePath(); c.fill();
  c.textBaseline = "middle";
  let i = 0;
  lines.forEach((line, li) => {
    const lw = c.measureText(line).width;
    let x = bx + (bw - lw) / 2;
    const y = by + padY + size * 1.05 * (li + 0.5);
    for (const ch of line) {
      const idx = s.text.indexOf(ch, i);
      const k = idx >= 0 ? idx : i;
      if (k < s.revealed) { const col = s.color(k); c.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`; c.fillText(ch, x, y); }
      x += c.measureText(ch).width;
      i = k + 1;
    }
  });
  c.globalAlpha = 1;
}
