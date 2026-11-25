// Edge / hole check of the arena map with the game-like follow camera.
//   npx vite build && node scripts/edges.mjs
// Character #1 is parked at each edge and corner of the courtyard (n s e w nw ne sw se), the camera
// follows it (55°, the test-scene rig). The page is rendered twice per spot and screen size:
//   - bg=void: magenta background -> every magenta pixel is a hole in the scenery (must be 0)
//   - normal background, kept as a screenshot for review
// Writes ../review/map/edges.json and ../review/map/edge_<screen>_<spot>.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4181;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const server = process.env.BASE ? null : spawn(path.join(here, '..', 'node_modules', '.bin', 'vite'),
  ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(here, '..'), stdio: 'ignore' });
if (server) await new Promise((r) => setTimeout(r, 2500));

const OUT = path.join(here, '..', '..', 'review', 'map');
fs.mkdirSync(OUT, { recursive: true });
const SPOTS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
const SCREENS = [
  { name: 'phone', width: 390, height: 844 },        // Telegram Mini App, portrait
  { name: 'phone_small', width: 360, height: 640 },  // older 16:9 Android
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 720 },     // Telegram Desktop, landscape
];
const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];

async function render(screen, spot, voidBg, extra = '') {
  const page = await browser.newPage({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?ui=0&count=3&tex=png&spot=${spot}${voidBg ? '&bg=void' : ''}${extra}`);
  await page.waitForFunction(() => window.__dvor?.ready && window.__dvor.spot, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  let res = { spot: await page.evaluate(() => window.__dvor.spot) };
  if (voidBg) {
    // Count on a real screenshot (reading the WebGL canvas back would return a cleared buffer).
    const png = (await page.screenshot()).toString('base64');
    res.voidPixels = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const g = document.createElement('canvas');
      g.width = img.width; g.height = img.height;
      const x = g.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, g.width, g.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) n++;
      return { count: n, of: g.width * g.height };
    }, png);
    if (res.voidPixels.count) await page.screenshot({ path: path.join(OUT, `void_${screen.name}_${spot}.png`) });
  } else {
    await page.screenshot({ path: path.join(OUT, `edge_${screen.name}_${spot}.png`) });
  }
  await page.close();
  return res;
}

// Control: the same check without the map must find holes, otherwise the detector is broken.
const control = await render(SCREENS[0], 'n', true, '&map=0');
console.log('control (no map), magenta pixels:', control.voidPixels.count);
if (!control.voidPixels.count) throw new Error('void detector found nothing on the empty scene');

for (const screen of SCREENS) {
  for (const spot of SPOTS) {
    const v = await render(screen, spot, true);
    await render(screen, spot, false);
    const r = { screen: screen.name, size: `${screen.width}x${screen.height}`, spot, at: v.spot, voidPixels: v.voidPixels.count, pixels: v.voidPixels.of };
    results.push(r);
    console.log(JSON.stringify(r));
  }
}
const summary = { control_without_map_void_pixels: control.voidPixels.count, camera: 'follow character #1, 55° pitch, fov 40°, distance 16 (portrait) / 15 (landscape)', holes: results.filter((r) => r.voidPixels > 0).length, runs: results, generated: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'edges.json'), JSON.stringify(summary, null, 2));
console.log('spots with holes:', summary.holes, 'of', results.length);
await browser.close();
server?.kill();
