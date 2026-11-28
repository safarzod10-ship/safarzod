/**
 * Render every building model to sprites and pack them into a WebP atlas:
 *   node tools/models/render.mjs [outDir=public/models] [--only key,key] [--preview dir]
 *
 * Needs Playwright's Chromium (pre-installed here) and three (devDependency).
 * Output: <outDir>/atlas-<n>.webp + atlas.json
 *   { pxPerM, tilt, pages: [file], sprites: { key: { p, x, y, w, h, ax, ay } } }
 * (ax, ay) is the pixel of the lot centre inside the sprite.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const outDir = resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'public/models');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const previewDir = args.includes('--preview') ? resolve(args[args.indexOf('--preview') + 1]) : null;

const PX_PER_M = 3; // max zoom 1.6 CSS px/m x DPR 2 = 3.2 device px/m
const SS = 2; // supersampling
const PAGE = 2048;
const TILT = Math.sin((40 * Math.PI) / 180);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(ROOT)) return void res.writeHead(403).end();
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/models/render.html`);
await page.waitForFunction(() => window.modelsReady === true, null, { timeout: 60000 });
const keys = (await page.evaluate(() => window.modelKeys)).filter((k) => !only || only.includes(k));

const sprites = [];
for (const key of keys) {
  const t0 = Date.now();
  const r = await page.evaluate(([k, p, s]) => window.renderModel(k, p, s), [key, PX_PER_M, SS]);
  const full = Buffer.from(r.png.split(',')[1], 'base64');
  // downsample, then crop to the visible pixels
  const w = Math.round(r.w / SS);
  const h = Math.round(r.h / SS);
  const small = await sharp(full).resize(w, h, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (small[(y * w + x) * 4 + 3] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const cw = x1 - x0 + 1;
  const chh = y1 - y0 + 1;
  const png = await sharp(small, { raw: { width: w, height: h, channels: 4 } }).extract({ left: x0, top: y0, width: cw, height: chh }).png().toBuffer();
  sprites.push({ key, png, w: cw, h: chh, ax: r.ax / SS - x0, ay: r.ay / SS - y0 });
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, key.replace(':', '-') + '.png'), png);
  }
  console.log(`${key.padEnd(14)} ${cw}x${chh}  ${Date.now() - t0} ms`);
}
await browser.close();
server.close();

// trees share one frame size and anchor (the map draws them as particles)
const trees = sprites.filter((s) => s.key.startsWith('tree:'));
if (trees.length) {
  const L = Math.ceil(Math.max(...trees.map((t) => t.ax)));
  const R = Math.ceil(Math.max(...trees.map((t) => t.w - t.ax)));
  const U = Math.ceil(Math.max(...trees.map((t) => t.ay)));
  const D = Math.ceil(Math.max(...trees.map((t) => t.h - t.ay)));
  for (const t of trees) {
    const left = Math.round(L - t.ax);
    const top = Math.round(U - t.ay);
    t.png = await sharp(t.png)
      .extend({ left, top, right: L + R - t.w - left, bottom: U + D - t.h - top, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    t.w = L + R;
    t.h = U + D;
    t.ax = L;
    t.ay = U;
  }
}

// shelf packing, tallest first
const order = sprites.slice().sort((a, b) => b.h - a.h);
const pages = [[]];
let x = 0, y = 0, rowH = 0;
const placed = {};
for (const s of order) {
  if (x + s.w > PAGE) {
    x = 0;
    y += rowH + 2;
    rowH = 0;
  }
  if (y + s.h > PAGE) {
    pages.push([]);
    x = 0;
    y = 0;
    rowH = 0;
  }
  pages[pages.length - 1].push({ input: s.png, left: x, top: y });
  placed[s.key] = { p: pages.length - 1, x, y, w: s.w, h: s.h, ax: +s.ax.toFixed(1), ay: +s.ay.toFixed(1) };
  x += s.w + 2;
  rowH = Math.max(rowH, s.h);
}
mkdirSync(outDir, { recursive: true });
const files = [];
for (let i = 0; i < pages.length; i++) {
  const height = i === pages.length - 1 ? Math.min(PAGE, 2 ** Math.ceil(Math.log2(y + rowH + 2))) : PAGE;
  const file = `atlas-${i}.webp`;
  await sharp({ create: { width: PAGE, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(pages[i])
    .webp({ quality: 90, alphaQuality: 95, effort: 6 })
    .toFile(join(outDir, file));
  files.push(file);
}
writeFileSync(join(outDir, 'atlas.json'), JSON.stringify({ pxPerM: PX_PER_M, tilt: TILT, pages: files, sprites: placed }));
console.log(`atlas: ${sprites.length} sprites on ${files.length} page(s) -> ${outDir}`);
