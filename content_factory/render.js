// usage: node render.js <episodeRelDir e.g. episodes/ep02> <outFramesDir> <fps> [t1,t2,...]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [ep, out, fpsS, times] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.log('[err]', e.message); process.exitCode = 2; });
  await page.goto(`http://127.0.0.1:8766/engine/index.html?ep=${encodeURIComponent(ep)}`);
  await page.waitForFunction('window.READY === true', null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const dur = await page.evaluate('window.DURATION');
  const fps = Number(fpsS);
  const list = times ? times.split(',').map(Number) : Array.from({ length: Math.ceil(dur * fps) }, (_, i) => i / fps);
  const t0 = Date.now();
  for (let i = 0; i < list.length; i++) {
    await page.evaluate(t => window.renderAt(t), list[i]);
    await page.screenshot({ path: `${out}/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (i % 300 === 0) console.log(`frame ${i}/${list.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('rendered', list.length, 'frames in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await browser.close();
})();
