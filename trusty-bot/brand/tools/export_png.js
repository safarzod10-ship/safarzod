const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const jobs = [
  ['avatar-square.svg', 'png/telegram-avatar-640.png', 640, 640],
  ['avatar.svg', 'png/avatar-round-512.png', 512, 512],
  ['app-icon.svg', 'png/app-icon-1024.png', 1024, 1024],
  ['app-icon.svg', 'png/apple-touch-icon-180.png', 180, 180],
  ['avatar.svg', 'png/favicon-32.png', 32, 32],
  ['avatar.svg', 'png/favicon-16.png', 16, 16],
  ['mark-on-light.svg', 'png/mark-on-light-1024.png', 1024, 1024],
  ['mark-on-dark.svg', 'png/mark-on-dark-1024.png', 1024, 1024],
  ['mark-on-emerald.svg', 'png/mark-on-emerald-1024.png', 1024, 1024],
  ['mark-mono.svg', 'png/mark-mono-1024.png', 1024, 1024],
  ['lockup-on-light.svg', 'png/lockup-on-light-2400.png', 2400, 0],
  ['lockup-on-dark.svg', 'png/lockup-on-dark-2400.png', 2400, 0],
  ['lockup-on-emerald.svg', 'png/lockup-on-emerald-2400.png', 2400, 0],
  ['lockup-mono.svg', 'png/lockup-mono-2400.png', 2400, 0],
];
(async () => {
  const dir = path.resolve(process.argv[2]);
  const pngDir = path.join(dir, 'png');
  fs.rmSync(pngDir, { recursive: true, force: true });
  fs.mkdirSync(pngDir, { recursive: true });
  const b = await chromium.launch();
  for (const [src, out, w, h0] of jobs) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    const h = h0 || Math.round(w * vb[3] / vb[2]);
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
    await p.screenshot({ path: path.join(dir, out), omitBackground: true });
    await p.close();
  }
  await b.close(); console.log('exported', jobs.length);
})();
