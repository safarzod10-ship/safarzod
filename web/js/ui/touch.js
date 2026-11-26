// On-screen buttons for phones (shown after the first touch, only during gameplay). Each button presses the same key code
// as the keyboard binding, so the game code reads them like keys. Multi-touch: one pointer per button, sliding allowed.
import { Input } from "../engine/input.js";
import { G } from "../game/common.js";
import { UI } from "./draw.js";

const BTN = [
  { id: "left", code: "ArrowLeft", label: "<", x: 12, y: -104, w: 58, h: 58 },
  { id: "right", code: "ArrowRight", label: ">", x: 78, y: -104, w: 58, h: 58 },
  { id: "down", code: "ArrowDown", label: "DOWN", x: 45, y: -158, w: 58, h: 44 },
  { id: "jump", code: "Space", label: "JUMP", x: -78, y: -106, w: 66, h: 66, right: true },
  { id: "katana", code: "KeyJ", label: "KATANA", x: -150, y: -96, w: 64, h: 50, right: true },
  { id: "roll", code: "KeyC", label: "ROLL", x: -150, y: -154, w: 64, h: 50, right: true },
  { id: "dagger", code: "KeyF", label: "DAGGER", x: -78, y: -162, w: 66, h: 48, right: true },
  { id: "knife", code: "KeyQ", label: "KNIFE", x: -222, y: -96, w: 64, h: 50, right: true },
  { id: "grab", code: "KeyE", label: "GRAB", x: -222, y: -154, w: 64, h: 50, right: true },
];

export const Touch = {
  active: new Map(), // pointerId -> button
  init() { },
  layout() { },
  get visible() { return G.touch && G.level && !G.paused && G.level.player && !G.level.player.Dead; },
  rect(b) { return { x: b.right ? UI.W + b.x : b.x, y: UI.H + b.y, w: b.w, h: b.h }; },
  at(p) {
    for (const b of BTN) {
      const r = this.rect(b);
      if (p.x >= r.x - 4 && p.x <= r.x + r.w + 4 && p.y >= r.y - 4 && p.y <= r.y + r.h + 4) return b;
    }
    return null;
  },
  handleDown(e, p) {
    if (!this.visible) return false;
    const b = this.at(p);
    if (!b) return false;
    this.active.set(e.pointerId, b);
    Input.press(b.code);
    e.preventDefault();
    return true;
  },
  handleMove(e, p) {
    const cur = this.active.get(e.pointerId);
    if (!cur) return;
    const b = this.at(p);
    if (b && b !== cur && (b.id === "left" || b.id === "right") && (cur.id === "left" || cur.id === "right")) {
      Input.release(cur.code); Input.press(b.code); this.active.set(e.pointerId, b);
    }
  },
  handleUp(e) {
    const b = this.active.get(e.pointerId);
    if (!b) return;
    this.active.delete(e.pointerId);
    if (![...this.active.values()].includes(b)) Input.release(b.code);
  },
  update() {
    if (!this.visible && this.active.size) { for (const b of this.active.values()) Input.release(b.code); this.active.clear(); }
  },
  draw() {
    if (!this.visible) return;
    const held = new Set(this.active.values());
    for (const b of BTN) {
      const r = this.rect(b);
      UI.slice(held.has(b) ? "Windows_Button_Pressed" : "Windows_Button", r.x, r.y, r.w, r.h, held.has(b) ? 0.75 : 0.45);
      UI.text(b.label, r.x + r.w / 2, r.y + r.h / 2 + 1, b.label.length > 1 ? 9 : 16, "rgba(24,24,28,0.85)", 1);
    }
  },
};
