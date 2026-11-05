// Export still images of the character for sharing / handing over to other tools.
//   node tools/export_png.mjs [outDir] [scale]
// Writes <outDir>/robodog.png (transparent, cropped to the character, idle pose),
//        <outDir>/robodog_bg.png (same frame on the demo background)
//        <outDir>/robodog_poses.png (idle / bark / laser key poses side by side).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const outDir = path.resolve(process.argv[2] || 'media');
const scale = Number(process.argv[3] || 3);
const { url, close } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: scale });

async function shot(transparent, t, file) {
  await page.goto(url + '/index.html?capture=1' + (transparent ? '&transparent=1' : ''));
  await page.waitForFunction(() => window.__capture);
  await page.addStyleTag({ content: '#play{display:none!important}' + (transparent ? 'html,body{background:transparent!important}.stage-wrap{box-shadow:none!important}' : '') });
  await page.evaluate((t) => { const c = window.__capture; c.reset(); c.advance(1.0); if (t >= 0) { c.start(); c.advance(0.05 + t); } }, t);
  // crop to the character (+ flames) using the canvas alpha / a fixed frame
  const clip = transparent
    ? await page.evaluate(() => {
        const cv = document.getElementById('stage');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) if (d[(y * cv.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const k = cv.width / cv.clientWidth, pad = 14;
        return { x: Math.max(0, x0 / k - pad), y: Math.max(0, y0 / k - pad), width: Math.min(540, (x1 - x0) / k + pad * 2), height: Math.min(960, (y1 - y0) / k + pad * 2) };
      })
    : { x: 0, y: 150, width: 540, height: 680 };
  await page.screenshot({ path: file, clip, omitBackground: transparent });
}

fs.mkdirSync(outDir, { recursive: true });
await shot(true, -1, path.join(outDir, 'robodog.png'));
await shot(false, -1, path.join(outDir, 'robodog_bg.png'));
const tmp = [];
for (const [i, t] of [-1, 2.5, 5.4].entries()) { const f = path.join(outDir, `.pose${i}.png`); await shot(false, t, f); tmp.push(f); }
await browser.close();
close();
console.log(JSON.stringify(tmp));
