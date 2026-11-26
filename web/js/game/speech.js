// CarDialoguePresenter: a speech box over a speaker that types its pages letter by letter, holds, then fades.
// Drawn by the overlay (drawSpeech) through Speech.boxes.
import { Time, Mathf } from "../engine/core.js";
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
