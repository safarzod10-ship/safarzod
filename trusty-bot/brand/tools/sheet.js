// Contact sheet renderer: node sheet.js <svgDir> <out.png> [--ids 1,2,3] [--cols 8] [--cell 150] [--title "..."] [--from 1 --to 40] [--small]
// --small adds a 32px and a 16px preview under every concept (legibility check).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dir = path.resolve(args[0]);
const out = path.resolve(args[1]);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const cols = +opt('cols', 8), cell = +opt('cell', 150), title = opt('title', '');
let files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')).sort();
if (opt('ids')) { const ids = opt('ids').split(',').map(s => s.trim()); files = ids.map(i => (i.endsWith('.svg') ? i : i.padStart(3, '0') + '.svg')); }
const from = +opt('from', 0), to = +opt('to', 1e9);
files = files.filter(f => { const n = parseInt(f); return isNaN(n) || (n >= from && n <= to); });
const small = flag('small');
const dark = flag('dark');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${dark ? '#121316' : '#F3F1EC'};font:12px/1.2 Inter,sans-serif;color:${dark ? '#bbb' : '#555'};padding:18px}
h1{font:600 15px Inter;margin:0 0 12px;color:${dark ? '#eee' : '#16181D'}}
.g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:10px}
.c{background:${dark ? '#1b1d21' : '#fff'};border-radius:8px;padding:8px;display:flex;flex-direction:column;align-items:center}
.c img.big{width:${cell - 30}px;height:${cell - 30}px}
.l{margin-top:4px;font-weight:600}
.s{display:flex;gap:8px;align-items:center;margin-top:4px}
.s img{display:block}
</style></head><body>${title ? `<h1>${title}</h1>` : ''}<div class="g">
${files.map(fn => `<div class="c"><img class="big" src="${fn}">${small ? `<div class="s"><img src="${fn}" width="32" height="32"><img src="${fn}" width="16" height="16"><span style="width:44px;height:44px;border-radius:50%;background:#16181D;display:flex;align-items:center;justify-content:center"><img src="${fn}" width="30" height="30" style="filter:invert(1)"></span></div>` : ''}<div class="l">${fn.replace('.svg', '')}</div></div>`).join('')}
</div></body></html>`;
const tmp = path.join(dir, '_sheet.html');
fs.writeFileSync(tmp, html);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: cols * (cell + 10) + 36, height: 400 }, deviceScaleFactor: 1 });
  await p.goto('file://' + tmp);
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
  fs.unlinkSync(tmp);
  console.log('wrote', out, files.length, 'items');
})();
