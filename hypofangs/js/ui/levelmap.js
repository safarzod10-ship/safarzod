// LevelMapUI: "HYPOFANGS.EXE - Level map" window (960x540 reference) with the 15-sector route and a live sector schematic.
import { Time } from "../engine/core.js";
import { Input } from "../engine/input.js";
import { G, GA } from "../game/common.js";
import { InputPrompts } from "../game/prompts.js";
import { UI } from "./draw.js";

const NAVY = "#000080", MAROON = "#800000", INK = "rgb(24,24,28)", MUTED = "rgb(64,64,70)";

function point(i) {
  const row = Math.floor(i / 5); let col = i % 5;
  if (row % 2 === 1) col = 4 - col;
  return { x: 82 + col * 112, y: 181 + row * 96 };
}

export const LevelMap = {
  open_: false, selected: 0, buttons: [],
  get IsOpen() { return this.open_; },
  open() { if (!G.level || !GA.mapData) return; this.selected = Math.min(G.roomIndex, GA.mapData.sectors.length - 1); this.open_ = true; },
  close() { this.open_ = false; },
  update() {
    if (!this.open_) return;
    if (!G.paused) { this.close(); return; }
    let d = 0;
    if (Input.hit("ArrowLeft", "KeyA")) d = -1;
    if (Input.hit("ArrowRight", "KeyD")) d = 1;
    if (Input.hit("ArrowUp", "KeyW")) d = -5;
    if (Input.hit("ArrowDown", "KeyS")) d = 5;
    if (d) {
      let row = Math.floor(this.selected / 5), col = this.selected % 5;
      if (row % 2 === 1) col = 4 - col;
      if (Math.abs(d) === 5) row = Math.max(0, Math.min(2, row + Math.sign(d))); else col = Math.max(0, Math.min(4, col + d));
      this.selected = row * 5 + (row % 2 === 1 ? 4 - col : col);
    }
  },
  // pointer in 640x360 space
  click(p) {
    if (!this.open_) return false;
    const k = 360 / 540, ox = (UI.W - 960 * k) / 2;
    const x = (p.x - ox) / k, y = p.y / k;
    for (let i = 0; i < 15; i++) { const q = point(i); if (Math.abs(x - q.x) < 22 && Math.abs(y - q.y) < 22) { this.selected = i; return true; } }
    if (x >= 850 && x <= 928 && y >= 490 && y <= 520) { G.pauseMenu.backOrResume(); return true; }
    return true;
  },
  draw() {
    if (!this.open_) return;
    const data = GA.mapData, lm = G.level;
    if (!data || !lm) return;
    const c = UI.ctx;
    UI.rect(0, 0, UI.W, UI.H, "rgba(20,23,31,0.98)");
    c.save();
    const k = 360 / 540;
    c.translate((UI.W - 960 * k) / 2, 0); c.scale(k, k);
    const T = (s, x, y, w, size, col, align = 0) => UI.textTop(s, align === 2 ? x + w : align === 1 ? x + w / 2 : x, y, size, col, align);
    UI.rect(16, 17, 936, 516, "rgba(0,0,0,0.5)");
    UI.slice("Window_Header", 12, 12, 936, 516);
    T("HYPOFANGS.EXE - Level map", 26, 16, 760, 13, "#fff");
    T("Neon District", 32, 65, 560, 20, INK);
    const room = G.roomIndex;
    T("Current level: " + String(room + 1).padStart(2, "0") + " / 15\n" + InputPrompts.DeviceName, 650, 65, 274, 12, INK, 2);
    const frame = (x, y, w, h) => { UI.rect(x, y, w, h, "rgb(236,236,232)"); UI.slice("Windows_Inner_Frame", x, y, w, h); };
    frame(24, 112, 610, 324); frame(652, 112, 284, 324);
    T("01 - 15  /  Pursuit route", 44, 124, 540, 14, INK);
    c.strokeStyle = "rgb(100,108,120)"; c.lineWidth = 2;
    for (let i = 0; i < data.sectors.length - 1; i++) { const a = point(i), b = point(i + 1); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    data.sectors.forEach((s, i) => {
      const p = point(i);
      UI.slice(i === this.selected ? "Windows_Button_Focus_Outlined" : "Windows_Button", p.x - 22, p.y - 22, 44, 44);
      UI.text(String(i + 1).padStart(2, "0"), p.x, p.y, 21, INK, 1);
      T(s.title.replace(/ /g, "\n"), p.x - 51, p.y + 25, 102, 11, i === room ? NAVY : i === this.selected ? INK : MUTED, 1);
      if (s.boss) T("!", p.x + 25, p.y - 13, 16, 12, MAROON);
    });
    const s = data.sectors[this.selected];
    T(String(this.selected + 1).padStart(2, "0") + "  /  " + s.title, 672, 126, 244, 16, INK);
    let shields = 0, guns = 0;
    for (const e of s.enemies) { if ((e.z | 0) === 3) shields++; if ((e.z | 0) === 1) guns++; }
    T((this.selected === room ? "YOU ARE HERE" : this.selected < room ? "PREVIOUS SECTOR" : "AHEAD ON THE ROUTE") + "\n" +
      (s.boss ? "BOSS  /  " + s.boss : shields + " SHIELDS  /  " + guns + " MACHINE GUNS") + "\n" + s.enemies.length + (s.enemies.length === 1 ? " ENEMY AT ENTRY" : " ENEMIES AT ENTRY"), 672, 186, 244, 11, INK);
    const dx = 672, dy = 252;
    UI.rect(dx, dy, 244, 142, "#fff"); UI.slice("Windows_Inner_Frame", dx, dy, 244, 142);
    const sc = Math.min(224 / Math.max(1, s.size.x), 122 / Math.max(1, s.size.y));
    const ox = (244 - s.size.x * sc) / 2, oy = (142 - s.size.y * sc) / 2;
    for (const r of s.surfaces) UI.rect(dx + ox + r.x * sc, dy + 142 - oy - (r.y + r.height) * sc, Math.max(1, r.width * sc), Math.max(2, Math.min(6, r.height * sc)), "rgb(70,74,86)");
    for (const e of s.enemies) UI.rect(dx + ox + e.x * sc - 2, dy + 142 - oy - e.y * sc - 4, 4, 4, (e.z | 0) === 3 ? "rgb(255,179,51)" : MAROON);
    if (this.selected === room && lm.player) {
      const pp = lm.player.node.position, b = lm.CurrentRoomBounds;
      UI.rect(dx + ox + (pp.x - b.x) * sc - 3, dy + 142 - oy - (pp.y - b.y) * sc - 5, 6, 6, NAVY);
    }
    T("Sector schematic", 672, 407, 244, 12, INK);
    UI.rect(44, 461, 8, 8, NAVY); T("Current level", 60, 455, 110, 14, INK);
    UI.rect(186, 461, 8, 8, MAROON); T("Boss", 202, 455, 90, 14, INK);
    T("Inspect the route. Return to the fight to advance.", 332, 455, 586, 14, INK, 2);
    UI.sprite("Windows_Divider_Line", 30, 483, 900, 2);
    T(G.touch && Input.lastDevice === "touch" ? "Tap a sector: inspect    [Back] Resume" : "Arrows / WASD: inspect    [Esc] Back    [M] Resume", 34, 497, 796, 14, INK);
    UI.slice("Windows_Button", 850, 490, 78, 30);
    UI.text("Back", 889, 505, 16, INK, 1);
    c.restore();
  },
};
