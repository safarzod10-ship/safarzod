const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [, , html, out, w = '1230', s = '1'] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: 600 }, deviceScaleFactor: +s });
  await p.goto('file://' + path.resolve(html));
  await p.waitForTimeout(400);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
  console.log('wrote', out);
})();
