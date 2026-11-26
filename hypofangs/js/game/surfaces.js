// SpriteSurfaces + CorpseGrounding: keep fallen bodies and blood stains on the floor they lie on.
import { Component, Time } from "../engine/core.js";
import { raycast, mask } from "../engine/physics.js";
import { GA, G } from "./common.js";

const GROUND = mask("Ground", "OneWay");

export const SpriteSurfaces = {
  ink(sprite) {
    if (!sprite) return { x: 0, y: 0, width: 0, height: 0 };
    const e = GA.surface && GA.surface.get(sprite.name);
    if (e) return e;
    return { x: sprite.minX, y: sprite.minY, width: sprite.maxX - sprite.minX, height: sprite.maxY - sprite.minY };
  },
  bounds(sr, sprite = null, flip = null) {
    const r = SpriteSurfaces.ink(sprite || sr.sprite);
    const f = flip === null ? sr.flipX : flip;
    const m = sr.node.worldMatrix();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [r.x, r.x + r.width]) for (const y of [r.y, r.y + r.height]) {
      const lx = f ? -x : x, ly = sr.flipY ? -y : y;
      const wx = m[0] * lx + m[2] * ly + m[4], wy = m[1] * lx + m[3] * ly + m[5];
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, sx: maxX - minX, sy: maxY - minY };
  },
  ground(sr, surfaceY, sink = 0.01) {
    const p = sr.node.position;
    sr.node.setPosition(p.x, p.y + surfaceY - sink - SpriteSurfaces.bounds(sr).minY);
  },
  floor(x, y, dist) {
    const h = raycast(x, y, 0, -1, dist, GROUND, { noTriggers: true });
    return h && h.normal.y > 0.6 ? h : null;
  },
  flattenBlood(sr, point, normal, width, thickness = 0.07) {
    const r = SpriteSurfaces.ink(sr.sprite);
    sr.node.setRotation(Math.atan2(normal.y, normal.x) * 180 / Math.PI - 90);
    const ps = sr.node.parent ? sr.node.parent.lossyScale : { x: 1, y: 1 };
    sr.node.lsx = width / Math.max(0.001, r.width * Math.abs(ps.x));
    sr.node.lsy = thickness / Math.max(0.001, r.height * Math.abs(ps.y));
    sr.node.setPosition(point.x, point.y);
    let mx = -Infinity;
    const m = sr.node.worldMatrix();
    for (const x of [r.x, r.x + r.width]) for (const y of [r.y, r.y + r.height]) {
      const lx = sr.flipX ? -x : x, ly = sr.flipY ? -y : y;
      const wx = m[0] * lx + m[2] * ly + m[4], wy = m[1] * lx + m[3] * ly + m[5];
      mx = Math.max(mx, wx * normal.x + wy * normal.y);
    }
    const d = point.x * normal.x + point.y * normal.y + 0.002 - mx;
    sr.node.setPosition(point.x + normal.x * d, point.y + normal.y * d);
  },
};

export class CorpseGrounding extends Component {
  constructor() { super(); this.depth = 0.01; this.Settled = false; }
  configure(sr, anim, rb, col) { this.art = sr; this.animation = anim; this.body = rb; this.shape = col; this.Settled = false; this.enabled = true; }
  supported(x, y) { const h = SpriteSurfaces.floor(x, y + 0.07, 0.14); return h && Math.abs(h.point.y - y) < 0.035; }
  edge(x, y, dir, dist) {
    let a = x;
    for (let s = 0.05; s <= dist + 0.05; s += 0.05) {
      let b = x + dir * s;
      if (!this.supported(b, y)) {
        for (let i = 0; i < 6; i++) { const m = (a + b) * 0.5; if (this.supported(m, y)) a = m; else b = m; }
        return a;
      }
      a = b;
    }
    return a;
  }
  lateUpdate() {
    if (G.paused || !this.art || !this.shape || (this.animation && this.animation.frames && !this.animation.Finished)) return;
    if (this.body && (this.body.velocity.y > 0.15 || this.body.velocity.y < -0.3)) { this.Settled = false; return; }
    const b = this.shape.bounds;
    const hit = SpriteSurfaces.floor(b.cx, b.minY + 0.1, 0.25);
    if (!hit) { this.Settled = false; return; }
    const ab = SpriteSurfaces.bounds(this.art);
    const l = this.edge(hit.point.x, hit.point.y, -1, ab.sx + 0.3);
    const r = this.edge(hit.point.x, hit.point.y, 1, ab.sx + 0.3);
    if (r - l < ab.sx + 0.03) {
      const tx = b.cx - l < r - b.cx ? l - b.ex - 0.04 : r + b.ex + 0.04;
      const p = this.node.position;
      this.node.setPosition(p.x + (tx - b.cx), p.y);
      if (this.body) this.body.velocity = { x: 0, y: -0.5 };
      this.Settled = false;
      return;
    }
    const shift = Math.max(0, l + 0.015 - ab.minX) - Math.max(0, ab.maxX - (r - 0.015));
    if (Math.abs(shift) > 0.001) {
      const p = this.node.position;
      this.node.setPosition(p.x + shift, p.y);
      if (this.body) this.body.velocity.x = 0;
    }
    SpriteSurfaces.ground(this.art, hit.point.y, this.depth);
    this.Settled = true;
  }
}
CorpseGrounding.order = 250;
