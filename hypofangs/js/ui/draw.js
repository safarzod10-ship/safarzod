// 2D-canvas helpers for the UI overlay: sprites from the atlases, 9-slice frames, pixel-font text with <color> tags.
import { Assets } from "../engine/assets.js";

export const UI = {
  ctx: null, s: 1, W: 640, H: 360, // reference resolution 640x360, scale s
  begin(ctx, w, h) {
    this.ctx = ctx; this.s = h / 360; this.W = w / this.s; this.H = 360;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.s, 0, 0, this.s, 0, 0);
  },
  rect(x, y, w, h, color) { const c = this.ctx; c.fillStyle = color; c.fillRect(x, y, w, h); },
  sprite(sp, x, y, w, h, alpha = 1, rot = 0) {
    if (typeof sp === "string") sp = Assets.sprite(sp);
    if (!sp || !sp.loaded) return;
    const p = sp.pageObj, c = this.ctx;
    c.globalAlpha = alpha;
    if (rot) {
      c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(-rot * Math.PI / 180);
      c.drawImage(p.img, sp.x, sp.y, sp.w, sp.h, -w / 2, -h / 2, w, h);
      c.restore();
    } else c.drawImage(p.img, sp.x, sp.y, sp.w, sp.h, x, y, w, h);
    c.globalAlpha = 1;
  },
  tinted: new Map(),
  // 9-slice draw of a sprite with border (pixels), optional tint (via cached tinted copy)
  slice(sp, x, y, w, h, alpha = 1, tint = null) {
    if (typeof sp === "string") sp = Assets.sprite(sp);
    if (!sp || !sp.loaded) return;
    const b = sp.border || [0, 0, 0, 0];
    const [l, bo, r, t] = b;
    const img = tint ? this.tintImage(sp, tint) : null;
    const src = img || sp.pageObj.img;
    const ox = img ? 0 : sp.x, oy = img ? 0 : sp.y;
    const c = this.ctx;
    c.globalAlpha = alpha;
    const sx = [0, l, sp.w - r, sp.w], sy = [0, t, sp.h - bo, sp.h];
    const dx = [x, x + l, x + w - r, x + w], dy = [y, y + t, y + h - bo, y + h];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j], dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      c.drawImage(src, ox + sx[i], oy + sy[j], sw, sh, dx[i], dy[j], dw, dh);
    }
    c.globalAlpha = 1;
  },
  tintImage(sp, tint) {
    const key = sp.name + tint;
    let cv = this.tinted.get(key);
    if (cv) return cv;
    cv = document.createElement("canvas"); cv.width = sp.w; cv.height = sp.h;
    const c = cv.getContext("2d");
    c.drawImage(sp.pageObj.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    c.globalCompositeOperation = "multiply"; c.fillStyle = tint; c.fillRect(0, 0, sp.w, sp.h);
    c.globalCompositeOperation = "destination-in"; c.drawImage(sp.pageObj.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    this.tinted.set(key, cv);
    return cv;
  },
  font(size, family = "RetroWindows") { this.ctx.font = `${size}px ${family}, monospace`; },
  // rich text with <color=#rrggbb>...</color>; align: 0 left 1 center 2 right; baseline middle
  runs(text, color) {
    const out = [];
    const re = /<color=(#[0-9a-fA-F]{6,8}|[a-z]+)>(.*?)<\/color>/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push([text.slice(last, m.index), color]);
      out.push([m[2], m[1]]);
      last = re.lastIndex;
    }
    if (last < text.length) out.push([text.slice(last), color]);
    return out.map(([t, c]) => [t.replace(/<[^>]+>/g, ""), c]);
  },
  measure(text, size, family) { this.font(size, family); return this.runs(String(text), "#fff").reduce((w, [t]) => w + this.ctx.measureText(t).width, 0); },
  text(text, x, y, size, color = "#fff", align = 0, family = "RetroWindows", alpha = 1, shadow = null, lineH = 1.15) {
    const c = this.ctx;
    this.font(size, family);
    c.textBaseline = "middle";
    c.globalAlpha = alpha;
    const lines = String(text).split("\n");
    const y0 = y - ((lines.length - 1) * size * lineH) / 2;
    lines.forEach((line, i) => {
      const runs = this.runs(line, color);
      const w = runs.reduce((a, [t]) => a + c.measureText(t).width, 0);
      let cx = align === 1 ? x - w / 2 : align === 2 ? x - w : x;
      const ly = y0 + i * size * lineH;
      for (const [t, col] of runs) {
        if (shadow) for (const [sc, dx, dy] of shadow) { c.fillStyle = sc; c.fillText(t, cx + dx, ly + dy); }
        c.fillStyle = col; c.fillText(t, cx, ly);
        cx += c.measureText(t).width;
      }
    });
    c.globalAlpha = 1;
  },
  // text laid out from the top (UpperCenter etc.)
  textTop(text, x, y, size, color, align, family, alpha, shadow, lineH = 1.15) {
    const n = String(text).split("\n").length;
    this.text(text, x, y + size * lineH * (n - 1) / 2 + size / 2, size, color, align, family, alpha, shadow, lineH);
  },
  wrap(text, maxW, size, family) {
    this.font(size, family);
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const w of para.split(" ")) {
        const t = line ? line + " " + w : w;
        if (this.ctx.measureText(t.replace(/<[^>]+>/g, "")).width > maxW && line) { out.push(line); line = w; }
        else line = t;
      }
      out.push(line);
    }
    return out;
  },
};

export function rgba(c, a = null) {
  const al = a === null ? (c.a ?? 1) : a;
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${al})`;
}
