// CarDialoguePresenter: a speech box over a speaker that types its pages letter by letter, holds, then fades.
// Drawn by the overlay (drawSpeech) through Speech.boxes.
import { Component, Time, Mathf } from "../engine/core.js";
import { registerScript, Camera } from "../engine/scene.js";
import { UI } from "../ui/draw.js";
import { Input } from "../engine/input.js";
import { G, GameClock, Music } from "./common.js";
import { Speech, DialogueAudio } from "./prologue.js";

const RED = { r: 1, g: 0, b: 0, a: 1 };

export class SpeechPresenter {
  constructor(opts = {}) {
    this.lettersPerSecond = opts.lettersPerSecond ?? 36; this.holdSeconds = opts.holdSeconds ?? 3; this.fadeSeconds = opts.fadeSeconds ?? 0.4;
    this.unscaled = !!opts.unscaled; this.anchorY = opts.anchorY ?? 0.68;
    this.reset();
  }
  reset() { this.colors = null; this.HasShown = false; this.presenting = false; this.clock = 0; this.RevealedLetters = 0; this.pages = []; this.pageIndex = 0; this.alpha = 0; Speech.boxes.delete(this); }
  get CurrentMessage() { return this.pages.length ? this.pages[this.pageIndex] : ""; }
  get FullyRevealed() { return this.pages.length > 0 && this.pageIndex === this.pages.length - 1 && this.RevealedLetters >= this.CurrentMessage.length; }
  get Visible() { return this.presenting && this.alpha > 0; }
  showLine(text, source, offset, colors) {
    this.reset();
    this.message = text; this.speaker = source; this.offset = offset || { x: 0, y: 1.5 }; this.colors = colors || null;
    this.show();
  }
  show(message) {
    if (message) this.message = message;
    this.pages = this.message.replace(/\r/g, "").split("\n").filter((s) => s.length);
    if (!this.pages.length) return;
    this.clock = 0; this.RevealedLetters = 0; this.HasShown = this.presenting = true; this.alpha = 1; this.pageIndex = 0;
    Speech.boxes.add(this);
  }
  revealFirstLetter() {
    if (!this.presenting || !this.CurrentMessage.length) return;
    this.clock = Math.max(this.clock, 1 / Math.max(1, this.lettersPerSecond) + 0.0001);
    DialogueAudio.printed(this.CurrentMessage, this.RevealedLetters, Math.max(1, this.RevealedLetters));
    this.RevealedLetters = Math.max(1, this.RevealedLetters);
  }
  advance() {
    if (!this.presenting || !this.CurrentMessage.length || this.lastAdvance === Time.frameCount) return;
    this.lastAdvance = Time.frameCount;
    const dur = this.CurrentMessage.length / Math.max(1, this.lettersPerSecond);
    if (this.RevealedLetters < this.CurrentMessage.length) { this.clock = Math.max(this.clock, dur + 0.0001); this.RevealedLetters = this.CurrentMessage.length; return; }
    if (this.pageIndex < this.pages.length - 1) { this.pageIndex++; this.clock = 0; this.RevealedLetters = 0; return; }
    this.presenting = false; this.alpha = 0; Speech.boxes.delete(this);
  }
  tick() {
    if (G.paused || !this.presenting) return;
    Music.dialogue();
    this.clock += this.unscaled ? GameClock.UnscaledDt : Time.deltaTime;
    const lps = Math.max(1, this.lettersPerSecond);
    while (this.pageIndex < this.pages.length - 1) {
      const end = this.CurrentMessage.length / lps + this.holdSeconds;
      if (this.clock < end) break;
      const rest = this.clock - end; this.pageIndex++; this.RevealedLetters = 0; this.clock = rest;
    }
    const n = Math.min(this.CurrentMessage.length, Math.floor(this.clock * lps));
    if (n !== this.RevealedLetters) { DialogueAudio.printed(this.CurrentMessage, this.RevealedLetters, n); this.RevealedLetters = n; }
    if (this.pageIndex !== this.pages.length - 1) return;
    const fin = this.CurrentMessage.length / lps + this.holdSeconds;
    if (this.clock >= fin) {
      const k = Mathf.clamp01((this.clock - fin) / Math.max(0.05, this.fadeSeconds));
      this.alpha = 1 - k;
      if (k >= 1) { this.presenting = false; Speech.boxes.delete(this); }
    }
  }
  speech() {
    if (!this.Visible || !this.speaker) return null;
    const p = this.speaker.position || this.speaker;
    const cols = this.colors;
    return { text: this.CurrentMessage, revealed: this.RevealedLetters, color: (i) => (cols && cols[i]) || RED, at: { x: p.x + this.offset.x, y: p.y + this.offset.y }, alpha: this.alpha };
  }
}

export const COL = {
  zenji: { r: 117 / 255, g: 231 / 255, b: 1, a: 1 },
  pink: { r: 1, g: 143 / 255, b: 174 / 255, a: 1 },
  voice: { r: 224 / 255, g: 239 / 255, b: 1, a: 1 },
};
export const fill = (text, c) => Array.from({ length: text.length }, () => c);

// CarDialoguePresenter (scene component): the truck / conversation / Zenji speech boxes of the Maboroshi Bridge prologue.
// Same timing as the original: letters at lettersPerSecond, holdSeconds per page, then a fade; Enter/Space/Tap advances.
const advancePressed = () => !G.paused && Input.hit("Enter", "NumpadEnter", "Space", "Tap");
export class CarDialoguePresenter extends Component {
  init(d) {
    this.girlDialogue = d.girlDialogue || null; this.automaticAfterGirl = !!d.automaticAfterGirl; this.unscaled = !!d.unscaled;
    this.speaker = d.speaker || null; this.speakerOffset = d.speakerOffset || { x: 0.7, y: 1.5 };
    this.message = d.message || ""; this.lettersPerSecond = d.lettersPerSecond ?? 36; this.holdSeconds = d.holdSeconds ?? 3; this.fadeSeconds = d.fadeSeconds ?? 0.4;
    this.boxAnchor = d.boxAnchor || { x: 0.84, y: 0.68 };
    this.lastAdvanceFrame = -1;
    this.resetPresentation();
  }
  onEnable() { Speech.boxes.add(this); }
  onDisable() { Speech.boxes.delete(this); }
  resetPresentation() { this.letterColors = null; this.FinishedFrame = -1; this.HasShown = false; this.presenting = false; this.clock = 0; this.RevealedLetters = 0; this.pages = []; this.pageIndex = 0; this.alpha = 0; }
  get CurrentMessage() { return this.pages.length ? this.pages[this.pageIndex] : ""; }
  get CurrentPage() { return this.pageIndex + 1; }
  get FullyRevealed() { return this.pages.length > 0 && this.pageIndex === this.pages.length - 1 && this.RevealedLetters >= this.CurrentMessage.length; }
  get Visible() { return this.presenting && this.alpha > 0; }
  get presentingNow() { return this.presenting; }
  show() {
    if (this.HasShown || !this.speaker) return;
    this.pages = this.message.replace(/\r/g, "").split("\n").filter((x) => x.length);
    if (!this.pages.length) return;
    this.clock = 0; this.RevealedLetters = 0; this.HasShown = this.presenting = true; this.alpha = 1;
    this.beginPage(0);
  }
  showLine(text, source, offset, anchor, colors) {
    this.resetPresentation();
    this.message = text; this.speaker = source; this.speakerOffset = offset; if (anchor) this.boxAnchor = anchor; this.letterColors = colors || null;
    this.show();
  }
  revealFirstLetter() {
    if (!this.presenting || !this.CurrentMessage.length) return;
    this.clock = Math.max(this.clock, 1 / Math.max(1, this.lettersPerSecond) + 0.0001);
    DialogueAudio.printed(this.CurrentMessage, this.RevealedLetters, Math.max(1, this.RevealedLetters));
    this.RevealedLetters = Math.max(1, this.RevealedLetters);
  }
  advance() {
    if (!this.presenting || !this.CurrentMessage.length || this.lastAdvanceFrame === Time.frameCount) return;
    this.lastAdvanceFrame = Time.frameCount;
    const dur = this.CurrentMessage.length / Math.max(1, this.lettersPerSecond);
    if (this.RevealedLetters < this.CurrentMessage.length) { this.clock = Math.max(this.clock, dur + 0.0001); this.RevealedLetters = this.CurrentMessage.length; return; }
    if (this.pageIndex < this.pages.length - 1) { this.beginPage(this.pageIndex + 1); return; }
    this.clock = dur + this.holdSeconds + this.fadeSeconds + 0.001;
    this.presenting = false; this.FinishedFrame = Time.frameCount; this.alpha = 0;
  }
  beginPage(i) { this.pageIndex = i; this.clock = 0; this.RevealedLetters = 0; }
  update() {
    if (G.paused || G.menuOpen) return;
    if (this.automaticAfterGirl && !this.girlDialogue) { this.alpha = 0; return; }
    if (this.automaticAfterGirl && !this.girlDialogue.HasShown) { if (this.HasShown) this.resetPresentation(); return; }
    if (this.automaticAfterGirl && !this.HasShown && this.girlDialogue.FullyRevealed && !this.girlDialogue.Visible) this.show();
    if (!this.presenting) return;
    Music.dialogue();
    if (advancePressed()) this.advance();
    if (!this.presenting) return;
    this.clock += this.unscaled ? GameClock.UnscaledDt : Time.deltaTime;
    const lps = Math.max(1, this.lettersPerSecond);
    while (this.pageIndex < this.pages.length - 1) {
      const end = this.CurrentMessage.length / lps + this.holdSeconds;
      if (this.clock < end) break;
      const rest = this.clock - end; this.beginPage(this.pageIndex + 1); this.clock = rest;
    }
    const n = Math.min(this.CurrentMessage.length, Math.floor(this.clock * lps));
    if (n !== this.RevealedLetters) { DialogueAudio.printed(this.CurrentMessage, this.RevealedLetters, n); this.RevealedLetters = n; }
    if (this.pageIndex !== this.pages.length - 1) return;
    const fin = this.CurrentMessage.length / lps + this.holdSeconds;
    if (this.clock >= fin) {
      const k = Mathf.clamp01((this.clock - fin) / Math.max(0.05, this.fadeSeconds));
      this.alpha = 1 - k;
      if (k >= 1) { this.presenting = false; this.FinishedFrame = Time.frameCount; }
    }
  }
  speech() {
    if (!this.Visible || !this.speaker) return null;
    const p = this.speaker.position, cols = this.letterColors;
    return placeSpeech({ text: this.CurrentMessage, revealed: this.RevealedLetters, color: (i) => (cols ? cols[i] || WHITE : RED), at: { x: p.x + this.speakerOffset.x, y: p.y + this.speakerOffset.y }, alpha: this.alpha, anchorX: this.boxAnchor.x, anchorY: this.boxAnchor.y });
  }
}
const WHITE = { r: 1, g: 1, b: 1, a: 1 };
CarDialoguePresenter.typeName = "HypoFangs.Prologue.CarDialoguePresenter";
registerScript(CarDialoguePresenter);

// colour array for a line: base colour, then phrases recoloured (first occurrence, like string.IndexOf)
export function lineColors(text, base, highlights = []) {
  const c = Array.from({ length: text.length }, () => base);
  for (const [phrase, col] of highlights) { const i = text.indexOf(phrase); if (i >= 0) for (let j = i; j < i + phrase.length; j++) c[j] = col; }
  return c;
}

// LevelTwoDialogueClearance.Place: the box goes to the free spot (not covering the protected actors' sprites) that is
// closest to "centred over the speaker, at the anchor height of the screen, never below the speaker's head".
// Canvas units are 1080p pixels in the original (constant pixel size), i.e. 1/3 of an overlay unit here.
// The overlay centres the box on the given point and draws its bottom 14 units above it, so the point is moved there.
const PX = 1 / 3, GAP = 14 * PX, CLEAR = 6 * PX, EDGE = 16 * PX, HEAD = 12 * PX;
let protectedActors = null;
export function protectSpeechActors(renderers) { protectedActors = renderers; }
export function placeSpeech(s) {
  const cam = Camera.main;
  if (!cam || !UI.ctx || s.anchorY == null) return s;
  const W = UI.W, H = UI.H, cp = cam.node.position, h = cam.orthographicSize, w = h * cam.aspect;
  const toX = (x) => (x - (cp.x - w)) / (2 * w) * W, toY = (y) => (y - (cp.y - h)) / (2 * h) * H; // y up
  const size = 56 / 3, lines = UI.wrap(s.text, W * 0.68 - 12, size, "Pixels");
  UI.font(size, "Pixels");
  const bw = Math.ceil(Math.max(...lines.map((l) => UI.ctx.measureText(l).width)) + 12), bh = Math.ceil(lines.length * size * 1.05 + 8);
  const w3 = bw + 2 * GAP, h3 = bh + 2 * GAP;
  const spx = toX(s.at.x), spy = toY(s.at.y);
  const vx = spx - w3 / 2, vy = Math.max((s.anchorY ?? 0.68) * H - h3 / 2, spy + HEAD);
  const xMin = EDGE, xMax = W - EDGE - w3, yMin = EDGE, yMax = H - EDGE - h3;
  const obstacles = [];
  for (const r of protectedActors || []) {
    if (!r || !r.enabled || !r.sprite || !r.node.activeInHierarchy || r.color.a < 0.01) continue;
    const b = r.bounds, x0 = toX(b.minX), x1 = toX(b.maxX), y0 = toY(b.minY), y1 = toY(b.maxY);
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;
    obstacles.push([x0 - CLEAR, y0 - CLEAR, x1 + CLEAR, y1 + CLEAR]);
  }
  const xs = [], ys = [];
  const add = (list, v, lo, hi) => { v = Mathf.clamp(v, lo, hi); if (!list.some((u) => Math.abs(u - v) < 0.5)) list.push(v); };
  add(xs, vx, xMin, xMax); add(xs, xMin, xMin, xMax); add(xs, xMax, xMin, xMax);
  add(ys, vy, yMin, yMax); add(ys, yMax, yMin, yMax); add(ys, yMin, yMin, yMax);
  for (const o of obstacles) { add(xs, o[0] - w3 - 1, xMin, xMax); add(xs, o[2] + 1, xMin, xMax); add(ys, o[1] - h3 - 1, yMin, yMax); add(ys, o[3] + 1, yMin, yMax); }
  let best = Infinity, px = vx, py = vy;
  for (const x of xs) for (const y of ys) {
    let overlap = 0;
    for (const o of obstacles) overlap += Math.max(0, Math.min(x + w3, o[2]) - Math.max(x, o[0])) * Math.max(0, Math.min(y + h3, o[3]) - Math.max(y, o[1]));
    if (overlap > 0.01) continue;
    const dx = x + w3 / 2 - Mathf.clamp(spx, xMin, W - EDGE), dy = y - vy, below = Math.max(0, spy - y);
    const cost = dx * dx * 8 + dy * dy + below * below * 30;
    if (cost < best) { best = cost; px = x; py = y; }
  }
  const bottomTD = H - (py + GAP); // box bottom, top-down
  const cx = px + GAP + bw / 2;
  s.at = { x: cp.x - w + cx / W * 2 * w, y: cp.y - h + (H - (bottomTD + 14)) / H * 2 * h };
  return s;
}
