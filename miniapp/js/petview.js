// Live idle pets for the mini app: the real skeletal rigs (same code as the attack
// animations) running in their calm rest pose — breathing, blinking, tail sway,
// head nods, ear twitches, panting. Attack poses are only used for attacks.
import { Mat } from './pets/util.js';
import { Dragon } from './pets/dragon.js';
import { Dog } from './pets/dog.js';
import { Cheetah } from './pets/cheetah.js';
import { samplePose as dragonPose } from './pets/dragon_tl.js';
import { samplePose as dogPose } from './pets/dog_tl.js';
import { samplePose as cheetahPose } from './pets/cheetah_tl.js';

// Rest-pose bounding boxes in each pet's own units (measured), [x0, y0, x1, y1], ground at y = 0.
// All pets share ONE unit scale, so their sizes stay natural relative to each other
// (the dragon is the biggest, the dog and the cheetah are smaller).
export const PET_DEFS = {
  dragon: { make: () => new Dragon(), pose: () => dragonPose(null), box: [-220, -406, 222, 6], unit: 1.0 },
  dog: { make: () => new Dog(), pose: () => dogPose(null), box: [-134, -296, 194, 4], unit: 0.78 },
  cheetah: { make: () => new Cheetah(), pose: () => cheetahPose(null), box: [-186, -254, 164, 4], unit: 0.9 },
};

const views = new Set();
let raf = 0, last = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  if (document.hidden) return;
  for (const v of views) v.frame(dt);
}

export class PetView {
  /**
   * @param host element to fill
   * @param id pet id (dragon | dog | cheetah)
   * @param opt.fit 'shared' — common scale for all pets (size relative to the farm);
   *                'self'   — fill the host (e.g. the pet portrait slot)
   * @param opt.maxUnits height of the host in pet units for the shared scale
   * @param opt.align 'left' | 'center'
   */
  constructor(host, id, opt = {}) {
    this.host = host; this.id = id; this.opt = { fit: 'shared', maxUnits: 430, maxWidth: 470, align: 'center', shadow: true, ...opt };
    const def = PET_DEFS[id];
    this.def = def; this.pet = def.make(); this.pose = def.pose();
    this.pet.time = Math.random() * 10; // desynchronise idle cycles
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pet-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.resize();
    for (let i = 0; i < 30; i++) this.pet.update(1 / 60, this.pose); // settle springs
    views.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }
  visible() { return this.w > 2 && this.h > 2 && this.host.offsetParent !== null; }
  frame(dt) {
    if (!this.visible()) return;
    this.pet.update(dt, this.pose);
    const { ctx, def, opt } = this;
    const [x0, y0, x1, y1] = def.box;
    const bw = x1 - x0, bh = y1 - y0;
    let s;
    if (opt.fit === 'self') s = Math.min(this.w / bw, this.h / bh) * 0.94;
    else s = Math.min(this.h / opt.maxUnits, this.w / opt.maxWidth) * def.unit; // one scale for every pet
    const cx = opt.align === 'left' ? -x0 * s + 4 : this.w / 2 - (x0 + bw / 2) * s;
    const gy = this.h - Math.max(6, this.h * 0.04);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (opt.shadow) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const g = ctx.createRadialGradient(cx + (x0 + bw / 2) * s, gy, 2, cx + (x0 + bw / 2) * s, gy, bw * s * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx + (x0 + bw / 2) * s, gy, bw * s * 0.5, bw * s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    }
    const base = new Mat(this.dpr, 0, 0, this.dpr, 0, 0).translate(cx, gy).scale(s);
    this.pet.draw(ctx, base, this.dpr * s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  destroy() { views.delete(this); this.ro.disconnect(); this.canvas.remove(); }
}
