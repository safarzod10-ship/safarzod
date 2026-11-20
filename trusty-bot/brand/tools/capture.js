// node capture.js <page.html> <framesDir> <width> <height> <fps> [light]
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const [, , html, dir, w, h, fps, theme] = process.argv;
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.resolve(html) + '?capture' + (theme ? '&theme=' + theme : ''));
  const dur = await p.evaluate(() => window.DURATION);
  const n = Math.round((dur + 0.6) * +fps);
  for (let i = 0; i < n; i++) {
    await p.evaluate(t => window.render(t), Math.min(i / +fps, dur));
    await p.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.png') });
  }
  await b.close(); console.log('frames', n);
})();
