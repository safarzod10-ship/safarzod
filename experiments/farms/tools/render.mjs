// Render the farm props to transparent PNG/WebP (cropped) for the mini app.
//   node tools/render.mjs <outDir>
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'media';
const { url, close } = await serve();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 640, height: 560 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('ERR', e.message));
for (const id of ['crystal', 'server', 'reactor']) {
  await p.goto(`${url}/index.html?transparent&farm=${id}`);
  await p.waitForFunction(() => window.__done);
  const png = await p.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  (await import('node:fs')).writeFileSync(`${out}/farm_${id}.png`, Buffer.from(png.split(',')[1], 'base64'));
}
await b.close(); close();
