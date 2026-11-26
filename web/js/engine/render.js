// Collects visible renderers, sorts them like Unity's 2D renderer (sorting layer, order in layer, depth) and draws them.
import { Renderers, Lights, SpriteRenderer, Tilemap, TextMesh, Camera, QuadRenderer } from "./scene.js";
import { Assets } from "./assets.js";
import { Time } from "./core.js";

const textCache = new Map();
let textCanvas = null;

function textTexture(R, tm) {
  const key = tm.text + "|" + tm.fontSize + "|" + tm.alignment;
  let e = textCache.get(key);
  if (e) { e.used = Time.frameCount; return e; }
  const scale = 2;
  const px = tm.fontSize * scale;
  if (!textCanvas) textCanvas = document.createElement("canvas");
  const ctx = textCanvas.getContext("2d");
  const font = `${px}px BoldPixels, monospace`;
  ctx.font = font;
  const lines = String(tm.text).replace(/<[^>]+>/g, "").split("\n");
  const lh = px * tm.lineSpacing;
  const w = Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width))) + 4;
  const h = Math.ceil(lh * lines.length) + 4;
  textCanvas.width = w; textCanvas.height = h;
  ctx.font = font; ctx.textBaseline = "top"; ctx.fillStyle = "#fff";
  ctx.imageSmoothingEnabled = false;
  lines.forEach((l, i) => {
    const lw = ctx.measureText(l).width;
    const x = tm.alignment === 1 ? (w - lw) / 2 : tm.alignment === 2 ? w - lw - 2 : 2;
    ctx.fillText(l, Math.round(x), Math.round(2 + i * lh + px * 0.1));
  });
  e = { tex: R.makeTexture(textCanvas), w, h, scale, used: Time.frameCount };
  textCache.set(key, e);
  return e;
}

export function collectLights(cam) {
  const out = [];
  let global = null;
  for (const l of Lights) {
    if (!l.enabled || l._dead || !l.node.activeInHierarchy || l.intensity <= 0) continue;
    if (l.type === 4) { global = l; continue; }
    const p = l.node.position;
    const R = l.outerRadius;
    if (p.x + R < cam.x - cam.halfW || p.x - R > cam.x + cam.halfW || p.y + R < cam.y - cam.halfH || p.y - R > cam.y + cam.halfH) continue;
    out.push({ x: p.x, y: p.y, inR: l.innerRadius, outR: R, falloff: l.falloff, r: l.color.r, g: l.color.g, b: l.color.b, i: l.intensity });
  }
  return { global, lights: out };
}

export function drawWorld(R, cam, interp) {
  const items = [];
  const vx0 = cam.x - cam.halfW - 1, vx1 = cam.x + cam.halfW + 1, vy0 = cam.y - cam.halfH - 1, vy1 = cam.y + cam.halfH + 1;
  for (const r of Renderers) {
    if (r._dead) continue;
    if (r instanceof SpriteRenderer) {
      if (!r.enabled || !r.sprite || r.color.a <= 0.001 || !r.node.activeInHierarchy) continue;
      if (!r.sprite.loaded) continue;
      items.push({ r, k0: r.layerRank, k1: r.sortingOrder, k2: -worldZ(r.node), k3: r.node.id, t: 0 });
    } else if (r instanceof Tilemap) {
      if (!r.enabledRender || !r.node.activeInHierarchy) continue;
      items.push({ r, k0: r.renderer.l ?? 3, k1: r.renderer.o || 0, k2: -worldZ(r.node), k3: r.node.id, t: 1 });
    } else if (r instanceof QuadRenderer) {
      if (!r.enabled || !r.node.activeInHierarchy || r.color.a <= 0.001) continue;
      items.push({ r, k0: r.layerRank, k1: r.sortingOrder, k2: -worldZ(r.node), k3: r.node.id, t: 3 });
    } else if (r instanceof TextMesh) {
      if (!r.node.activeInHierarchy || (r.mr && r.mr.e === 0) || r.color.a <= 0.001) continue;
      items.push({ r, k0: r.mr ? r.mr.l ?? 3 : 3, k1: r.mr ? r.mr.o || 0 : 0, k2: -worldZ(r.node), k3: r.node.id, t: 2 });
    }
  }
  items.sort((a, b) => a.k0 - b.k0 || a.k1 - b.k1 || a.k2 - b.k2 || a.k3 - b.k3);
  for (const it of items) {
    if (it.t === 0) drawSprite(R, it.r, vx0, vx1, vy0, vy1, interp);
    else if (it.t === 1) drawTilemap(R, it.r, vx0, vx1, vy0, vy1);
    else if (it.t === 3) { const q = it.r, p = q.pts, c = q.color; R.quad(R.white, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 0, 0, 1, 1, c.r, c.g, c.b, c.a, q.lit); }
    else drawText(R, it.r);
  }
  // free unused text textures
  if (Time.frameCount % 300 === 0) for (const [k, e] of textCache) if (Time.frameCount - e.used > 600) { R.deleteTexture(e.tex); textCache.delete(k); }
}

function worldZ(n) { let z = 0; for (let p = n; p; p = p.parent) z += p.lz; return z; }

function matrixFor(node, interp) {
  const m = node.worldMatrix();
  if (interp) {
    // render-time interpolation of rigidbody motion (Rigidbody2D interpolation)
    for (let p = node; p; p = p.parent) {
      const rb = p._rb;
      if (rb && rb.interp) { m[4] += rb.interp.x; m[5] += rb.interp.y; break; }
    }
  }
  return m;
}

function drawSprite(R, sr, vx0, vx1, vy0, vy1, interp) {
  const s = sr.sprite, m = matrixFor(sr.node, interp);
  const c = sr.color;
  const fx = sr.flipX ? -1 : 1, fy = sr.flipY ? -1 : 1;
  const [u0, v0, u1, v1] = s.uv();
  if (sr.drawMode && sr.size) {
    drawTiled(R, sr, s, m, fx, fy, u0, v0, u1, v1, vx0, vx1, vy0, vy1);
    return;
  }
  const x0 = s.minX * fx, x1 = s.maxX * fx, y0 = s.minY * fy, y1 = s.maxY * fy;
  const tx = m[4], ty = m[5];
  // quick cull
  const ex = Math.abs(m[0]) * Math.max(Math.abs(x0), Math.abs(x1)) + Math.abs(m[2]) * Math.max(Math.abs(y0), Math.abs(y1));
  const ey = Math.abs(m[1]) * Math.max(Math.abs(x0), Math.abs(x1)) + Math.abs(m[3]) * Math.max(Math.abs(y0), Math.abs(y1));
  if (tx + ex < vx0 || tx - ex > vx1 || ty + ey < vy0 || ty - ey > vy1) return;
  const X = (x, y) => m[0] * x + m[2] * y + tx, Y = (x, y) => m[1] * x + m[3] * y + ty;
  R.quad(s.tex, X(x0, y0), Y(x0, y0), X(x1, y0), Y(x1, y0), X(x0, y1), Y(x0, y1), X(x1, y1), Y(x1, y1), u0, v0, u1, v1, c.r, c.g, c.b, c.a, sr.lit);
}

function drawTiled(R, sr, s, m, fx, fy, u0, v0, u1, v1, vx0, vx1, vy0, vy1) {
  const W = sr.size.x, H = sr.size.y;
  const rx0 = -s.px * W, ry0 = -s.py * H;
  const c = sr.color;
  const tw = s.boundsW, th = s.boundsH;
  const X = (x, y) => m[0] * x * fx + m[2] * y * fy + m[4], Y = (x, y) => m[1] * x * fx + m[3] * y * fy + m[5];
  if (sr.drawMode === 1 && s.border) { // sliced
    nineSlice(R, s, rx0, ry0, W, H, X, Y, c, sr.lit);
    return;
  }
  // tiles laid out from the centre of the rect
  const cx = rx0 + W / 2, cy = ry0 + H / 2;
  const nx0 = Math.floor((rx0 - cx) / tw), nx1 = Math.ceil((rx0 + W - cx) / tw);
  const ny0 = Math.floor((ry0 - cy) / th), ny1 = Math.ceil((ry0 + H - cy) / th);
  const sx = Math.abs(m[0]) || 1;
  for (let i = nx0; i < nx1; i++) {
    let ax = cx + i * tw, bx = ax + tw, ua = u0, ub = u1;
    if (ax < rx0) { ua = u0 + (u1 - u0) * (rx0 - ax) / tw; ax = rx0; }
    if (bx > rx0 + W) { ub = u0 + (u1 - u0) * (rx0 + W - (bx - tw)) / tw; bx = rx0 + W; }
    const wx0 = X(ax, 0), wx1 = X(bx, 0);
    if (Math.max(wx0, wx1) < vx0 || Math.min(wx0, wx1) > vx1) continue;
    for (let j = ny0; j < ny1; j++) {
      let ay = cy + j * th, by = ay + th, va = v1, vb = v0; // va bottom
      if (ay < ry0) { va = v1 - (v1 - v0) * (ry0 - ay) / th; ay = ry0; }
      if (by > ry0 + H) { vb = v1 - (v1 - v0) * (ry0 + H - (by - th)) / th; by = ry0 + H; }
      R.quad(s.tex, X(ax, ay), Y(ax, ay), X(bx, ay), Y(bx, ay), X(ax, by), Y(ax, by), X(bx, by), Y(bx, by), ua, vb, ub, va, c.r, c.g, c.b, c.a, sr.lit);
    }
  }
}

function nineSlice(R, s, x, y, W, H, X, Y, c, lit) {
  const [l, b, r, t] = s.border;
  const p = s.pageObj, ppu = s.ppu;
  const xs = [x, x + l / ppu, x + W - r / ppu, x + W], ys = [y, y + b / ppu, y + H - t / ppu, y + H];
  const us = [s.x, s.x + l, s.x + s.w - r, s.x + s.w].map((v) => v / p.w);
  const vs = [s.y + s.h, s.y + s.h - b, s.y + t, s.y].map((v) => v / p.h);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ax = xs[i], bx = xs[i + 1], ay = ys[j], by = ys[j + 1];
    R.quad(s.tex, X(ax, ay), Y(ax, ay), X(bx, ay), Y(bx, ay), X(ax, by), Y(ax, by), X(bx, by), Y(bx, by), us[i], vs[j + 1], us[i + 1], vs[j], c.r, c.g, c.b, c.a, lit);
  }
}

function drawTilemap(R, tm, vx0, vx1, vy0, vy1) {
  const d = tm.d, m = tm.node.worldMatrix();
  const cw = tm.cell[0], ch = tm.cell[1];
  const ax = d.anchor[0], ay = d.anchor[1];
  const tc = tm.color, lit = !!(tm.renderer && tm.renderer.lit);
  if (!tm._sorted) { tm._sorted = d.tiles.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]); }
  for (const t of tm._sorted) {
    const cx = m[4] + (t[0] + ax) * cw, cy = m[5] + (t[1] + ay) * ch;
    if (cx < vx0 - 2 || cx > vx1 + 2 || cy < vy0 - 2 || cy > vy1 + 2) continue;
    const s = tm.sprites[t[2]];
    if (!s || !s.loaded) continue;
    const col = d.colors[t[3]] || [1, 1, 1, 1];
    const mt = d.mats[t[4]] || [1, 0, 0, 1, 0, 0];
    const [u0, v0, u1, v1] = s.uv();
    const x0 = s.minX, x1 = s.maxX, y0 = s.minY, y1 = s.maxY;
    const X = (x, y) => cx + mt[0] * x + mt[1] * y + mt[4], Y = (x, y) => cy + mt[2] * x + mt[3] * y + mt[5];
    R.quad(s.tex, X(x0, y0), Y(x0, y0), X(x1, y0), Y(x1, y0), X(x0, y1), Y(x0, y1), X(x1, y1), Y(x1, y1), u0, v0, u1, v1,
      tc[0] * col[0], tc[1] * col[1], tc[2] * col[2], tc[3] * col[3], lit);
  }
}

function drawText(R, tm) {
  const e = textTexture(R, tm);
  const m = tm.node.worldMatrix();
  const k = tm.characterSize / 10 / e.scale; // world units per canvas pixel
  const w = e.w * k, h = e.h * k;
  const col = tm.anchor % 3, row = Math.floor(tm.anchor / 3);
  const x0 = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
  const y1 = row === 0 ? 0 : row === 1 ? h / 2 : h;
  const y0 = y1 - h, x1 = x0 + w;
  const X = (x, y) => m[0] * x + m[2] * y + m[4], Y = (x, y) => m[1] * x + m[3] * y + m[5];
  const c = tm.color;
  R.quad(e.tex, X(x0, y0), Y(x0, y0), X(x1, y0), Y(x1, y0), X(x0, y1), Y(x0, y1), X(x1, y1), Y(x1, y1), 0, 0, 1, 1, c.r, c.g, c.b, c.a, false);
}

export function cameraView() {
  const c = Camera.main;
  if (!c) return null;
  const p = c.node.position;
  return { x: p.x, y: p.y, halfH: c.orthographicSize, halfW: c.orthographicSize * c.aspect, cam: c };
}
