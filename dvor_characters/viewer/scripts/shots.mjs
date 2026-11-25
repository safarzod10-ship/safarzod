// Turnaround + pose screenshots of the real GLBs rendered by three.js in headless Chromium.
//   node scripts/shots.mjs CH_Technik [--base http://127.0.0.1:5179] [--tex png|ktx2]
// Writes ../review/<char>/{front,back,side,threequarter,game}_lod{0,1}.png and poses_*.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const chars = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const base = opt('--base', 'http://127.0.0.1:5179');
const tex = opt('--tex', 'png');
const only = opt('--only', 'all');

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });

async function shot(url, file, vp) {
  await page.setViewportSize(vp);
  await page.goto(`${base}/preview.html?${url}`);
  await page.waitForFunction(() => window.__preview?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(50);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  return page.evaluate(() => window.__preview);
}

const stats = {};
for (const char of chars) {
  const out = path.join(here, '..', '..', 'review', char);
  if (only === 'all' || only === 'turn') {
    for (const lod of [0, 1]) {
      for (const view of ['front', 'back', 'side', 'threequarter']) {
        stats[`${char}/${view}_lod${lod}`] = await shot(`char=${char}&view=${view}&lod=${lod}&tex=${tex}&clip=Idle&t=0`,
          path.join(out, `${view}_lod${lod}.png`), { width: 420, height: 640 });
      }
      // game camera at phone-like size (CSS px of a 390x844 phone, arena camera)
      stats[`${char}/game_lod${lod}`] = await shot(`char=${char}&view=game&lod=${lod}&tex=${tex}&clip=Idle&t=0`,
        path.join(out, `game_lod${lod}.png`), { width: 390, height: 420 });
    }
    await shot(`char=${char}&view=face&lod=0&tex=${tex}`, path.join(out, 'face_lod0.png'), { width: 420, height: 420 });
    await shot(`char=${char}&view=threequarter&lod=0&tex=${tex}&wire=1`, path.join(out, 'wire_lod0.png'), { width: 420, height: 640 });
    await shot(`char=${char}&view=threequarter&lod=1&tex=${tex}&wire=1`, path.join(out, 'wire_lod1.png'), { width: 420, height: 640 });
  }
  if (only === 'all' || only === 'poses') {
    const poses = {
      Idle: [0.0, 1.0], Run: [0.0, 0.17, 0.33, 0.5], Attack: [0.2, 0.33, 0.45], Ability: [0.25, 0.55, 0.8],
      Hit: [0.1, 0.2], Defeat: [0.3, 0.6, 1.6], Victory: [0.0, 0.33],
    };
    for (const [clip, times] of Object.entries(poses)) {
      for (const t of times) {
        await shot(`char=${char}&view=threequarter&lod=0&tex=${tex}&clip=${clip}&t=${t}`,
          path.join(out, 'poses', `${clip}_${t.toFixed(2)}.png`), { width: 300, height: 420 });
      }
    }
  }
}
fs.writeFileSync(path.join(here, '..', '..', 'review', `shots_${chars.join('_')}.json`), JSON.stringify(stats, null, 2));
await browser.close();
console.log('done', Object.keys(stats).length, 'shots');
