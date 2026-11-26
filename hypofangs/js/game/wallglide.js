// WallGlideSparkVfx: sparks where the dagger scrapes the wall during a wall slide.
import { Component, Time } from "../engine/core.js";
import { GA, G, FX } from "./common.js";

export class WallGlideSparkVfx extends Component {
  constructor() { super(); this.bursts = []; this.anchors = []; this.ages = []; this.contact = null; this.frames = null; this.point = { x: 0, y: 0 }; this.normal = { x: 1, y: 0 }; this.scraping = false; this.emission = 0; this.next = 0; }
  initialize(owner) {
    for (let i = 0; i < 4; i++) {
      const b = FX.makeSprite("Scrape spray", null, 0, 0, owner.sortingOrder - 1, true, this.node);
      b.enabled = false; this.bursts.push(b); this.anchors.push({ x: 0, y: 0 }); this.ages.push(99);
    }
    this.contact = FX.makeSprite("Knife wall contact", GA.white, 0, 0, owner.sortingOrder + 2, true, this.node);
    const s = GA.white;
    this.contact.node.lsx = 0.045 / s.boundsW; this.contact.node.lsy = 0.075 / s.boundsH;
    this.contact.color = { r: 1, g: 0.94, b: 0.65, a: 1 };
    this.contact.enabled = false;
  }
  scrape(clip, at, n) {
    this.frames = clip; this.point = at; this.normal = n;
    const first = !this.scraping;
    this.scraping = true;
    this.contact.enabled = true;
    this.contact.node.setPosition(at.x + n.x * 0.01, at.y + n.y * 0.01);
    if (first) { this.emitBurst(); this.emission = 0.065; }
  }
  stop() {
    this.scraping = false; this.emission = 0;
    if (this.contact) this.contact.enabled = false;
    for (let i = 0; i < this.bursts.length; i++) { this.bursts[i].enabled = false; this.ages[i] = 99; }
  }
  lateUpdate() {
    if (G.paused || !this.scraping || !this.frames || !this.frames.length) return;
    const dt = Time.deltaTime;
    this.contact.enabled = true;
    this.contact.node.setPosition(this.point.x + this.normal.x * 0.01, this.point.y + this.normal.y * 0.01);
    this.emission -= dt;
    if (this.emission <= 0 && dt > 0) { this.emitBurst(); this.emission = 0.065; }
    for (let i = 0; i < this.bursts.length; i++) {
      const f = Math.floor(this.ages[i] * 18);
      const b = this.bursts[i];
      b.enabled = f < this.frames.length;
      if (b.enabled) {
        b.sprite = this.frames[f];
        b.node.setPosition(this.anchors[i].x, this.anchors[i].y);
        b.color = { r: 1, g: 1, b: 1, a: f === this.frames.length - 1 ? 0.7 : 1 };
      }
      this.ages[i] += dt;
    }
  }
  emitBurst() {
    const i = this.next++ % this.bursts.length;
    this.anchors[i] = { x: this.point.x + this.normal.x * 0.012, y: this.point.y + this.normal.y * 0.012 };
    this.ages[i] = 1 / 18;
    const b = this.bursts[i];
    b.flipX = this.normal.x < 0;
    b.node.setRotation((this.normal.x < 0 ? 85 : -85) + (i % 2 === 0 ? -8 : 8));
    b.node.lsx = b.node.lsy = i % 2 === 0 ? 1.5 : 1.7;
    b.sprite = this.frames[Math.min(1, this.frames.length - 1)];
    b.node.setPosition(this.anchors[i].x, this.anchors[i].y);
    b.color = { r: 1, g: 1, b: 1, a: 1 };
    b.enabled = true;
  }
  onDisable() { this.stop(); }
}
WallGlideSparkVfx.order = 200;
