// Renders uGUI prefabs exported from the build (RectTransform layout, Image with sliced sprites, TextMeshPro labels, Buttons)
// so menus keep the original retro window look. Reference canvas 640x360.
import { Assets } from "../engine/assets.js";
import { UI } from "./draw.js";

const INK = "rgb(24,24,28)";

export class UINode {
  constructor(d) {
    this.name = d.n; this.active = d.a !== 0; this.children = []; this.parent = null;
    const rt = d.rt || { amin: [0, 0], amax: [1, 1], pos: [0, 0], size: [0, 0], pivot: [0.5, 0.5] };
    this.rt = { amin: [...rt.amin], amax: [...rt.amax], pos: [...rt.pos], size: [...rt.size], pivot: [...rt.pivot] };
    this.image = null; this.text = null; this.button = false; this.onClick = null; this.rect = { x: 0, y: 0, w: 0, h: 0 }; this.interactable = true;
    for (const c of d.c || []) {
      if (!c || c.T !== "mb") continue;
      const s = (c.s || "").split(".").pop(), dd = c.d || {};
      if (s === "Image") this.image = { sprite: dd.m_Sprite ? dd.m_Sprite.slice(2) : null, color: dd.m_Color || { r: 1, g: 1, b: 1, a: 1 }, type: dd.m_Type };
      else if (s === "TextMeshProUGUI") this.text = { text: dd.m_text || "", size: dd.m_fontSize || 12, color: dd.m_fontColor || { r: 1, g: 1, b: 1, a: 1 }, ha: dd.m_HorizontalAlignment || 1, va: dd.m_VerticalAlignment || 256, wrap: !!dd.m_TextWrappingMode };
      else if (s === "Text") this.text = { text: dd.m_Text || "", size: 12, color: dd.m_Color || { r: 1, g: 1, b: 1, a: 1 }, ha: 2, va: 512 };
      else if (s === "Button") this.button = true;
    }
  }
  find(path) {
    let n = this;
    for (const part of path.split("/")) { n = n && n.children.find((c) => c.name === part); }
    return n || null;
  }
  get activeInHierarchy() { for (let n = this; n; n = n.parent) if (!n.active) return false; return true; }
  add(child) { child.parent = this; this.children.push(child); return child; }
  clone() {
    const c = Object.create(UINode.prototype);
    Object.assign(c, this);
    c.rt = JSON.parse(JSON.stringify(this.rt));
    c.image = this.image ? { ...this.image } : null; c.text = this.text ? { ...this.text } : null;
    c.children = []; c.parent = null; c.rect = { x: 0, y: 0, w: 0, h: 0 };
    for (const ch of this.children) c.add(ch.clone());
    return c;
  }
  setLabel(t) { const l = this.text ? this : this.children.find((c) => c.text); if (l) l.text.text = t; }
}

export function buildTree(nodes, rootName) {
  const start = nodes.findIndex((n) => n.n === rootName && n.p < 0);
  const map = new Map();
  let root = null;
  for (let i = start; i < nodes.length; i++) {
    const d = nodes[i];
    if (i > start && d.p < 0) break;
    const n = new UINode(d);
    map.set(i, n);
    if (i === start) root = n; else map.get(d.p).add(n);
  }
  root.rt = { amin: [0, 0], amax: [1, 1], pos: [0, 0], size: [0, 0], pivot: [0.5, 0.5] };
  return root;
}

export function layout(n, px, py, pw, ph, H) {
  // y-up rectangle math like RectTransform, then stored in screen space (y down)
  const r = n.rt;
  const ax0 = px + r.amin[0] * pw, ax1 = px + r.amax[0] * pw, ay0 = py + r.amin[1] * ph, ay1 = py + r.amax[1] * ph;
  const w = ax1 - ax0 + r.size[0], h = ay1 - ay0 + r.size[1];
  const cx = ax0 + (ax1 - ax0) * r.pivot[0] + r.pos[0], cy = ay0 + (ay1 - ay0) * r.pivot[1] + r.pos[1];
  const x0 = cx - w * r.pivot[0], y0 = cy - h * r.pivot[1];
  n.rect = { x: x0, y: H - (y0 + h), w, h };
  for (const c of n.children) layout(c, x0, y0, w, h, H);
}

const css = (c) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a ?? 1})`;

export function drawTree(n, state = {}) {
  if (!n.active) return;
  const r = n.rect;
  if (n.image) {
    let sp = n.image.sprite;
    if (n.button) {
      if (!n.interactable) sp = "Windows_Button_Inactive";
      else if (state.pressed === n) sp = "Windows_Button_Pressed";
      else if (state.hover === n || state.selected === n || n.toggled) sp = n.toggled ? "Windows_Button_Pressed" : "Windows_Button_Focus";
    }
    const c = n.image.color;
    if (sp) {
      const s = Assets.sprite(sp);
      if (s && s.border) UI.slice(s, r.x, r.y, r.w, r.h, c.a ?? 1);
      else UI.sprite(s, r.x, r.y, r.w, r.h, c.a ?? 1);
    } else UI.rect(r.x, r.y, r.w, r.h, css(c));
  }
  if (n.text && n.text.text) drawText(n, state);
  for (const c of n.children) drawTree(c, state);
}

function drawText(n, state) {
  const t = n.text, r = n.rect;
  let color = css(t.color);
  if (n.parent && n.parent.button && !n.parent.interactable) color = "rgb(128,128,128)";
  let size = t.size;
  let lines = String(t.text).split("\n");
  if (!t.wrap && n.parent && n.parent.button) while (size > 6 && Math.max(...lines.map((l) => UI.measure(l, size))) > r.w) size -= 0.5;
  if (t.wrap) lines = UI.wrap(t.text, r.w, size);
  const lh = size * 1.2;
  const total = lines.length * lh;
  let y = t.va === 256 ? r.y + lh / 2 : t.va === 1024 ? r.y + r.h - total + lh / 2 : r.y + r.h / 2 - total / 2 + lh / 2;
  for (const line of lines) {
    const parts = line.split(/<pos=(\d+)>/);
    if (parts.length > 1) {
      UI.text(parts[0], r.x, y, size, color, 0);
      for (let i = 1; i < parts.length; i += 2) UI.text(parts[i + 1], r.x + parseFloat(parts[i]), y, size, color, 0);
    } else {
      const al = t.ha === 2 ? 1 : t.ha === 4 ? 2 : 0;
      const x = al === 1 ? r.x + r.w / 2 : al === 2 ? r.x + r.w : r.x;
      UI.text(line, x, y, size, color, al);
    }
    y += lh;
  }
}

export function buttonsOf(n, out = []) {
  if (!n.active) return out;
  if (n.button && n.onClick) out.push(n);
  for (const c of n.children) buttonsOf(c, out);
  return out;
}

export function hitButton(n, x, y) {
  const list = buttonsOf(n);
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i], r = b.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return b;
  }
  return null;
}
export { INK };
