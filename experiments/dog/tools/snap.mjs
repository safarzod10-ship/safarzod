// Render specific moments of the sequence to PNGs (visual QA).
// usage: node tools/snap.mjs <outDir> <t1> <t2> ...   (t = seconds since button press; negative = idle)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { serve } from './serve.mjs';

const [outDir, ...times] = process.argv.slice(2);
const { url, close } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: Number(process.env.SNAP_SCALE || 1) });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url + '/index.html?capture=1');
await page.waitForFunction(() => window.__capture);
for (const t of times.map(Number)) {
  await page.evaluate(async (t) => {
    const c = window.__capture;
    c.reset();
    c.advance(1.0);
    if (t >= 0) { c.start(); c.advance(0.05 + t); } else c.advance(-t);
  }, t);
  const clip = process.env.SNAP_CLIP ? (([x, y, width, height]) => ({ x, y, width, height }))(process.env.SNAP_CLIP.split(',').map(Number)) : null;
  if (clip) await page.screenshot({ path: `${outDir}/t_${t.toFixed(2)}.png`, clip });
  else await page.locator('.stage-wrap').screenshot({ path: `${outDir}/t_${t.toFixed(2)}.png` });
}
await browser.close();
close();
