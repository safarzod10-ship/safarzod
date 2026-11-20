// Measures kerned pen positions of each character (font units at 1000px) using Chromium's shaper.
// node measure.js <font.ttf> <text>  -> JSON [{ch, x}], width
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [, , font, text] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<style>@font-face{font-family:M;src:url('file://${path.resolve(font)}')}span{font:1000px M;white-space:pre;font-kerning:normal}</style><span id=s>${text}</span>`);
  await p.goto('about:blank');
  await p.setContent(`<style>@font-face{font-family:M;src:url('data:font/ttf;base64,${require('fs').readFileSync(font).toString('base64')}')}span{font:1000px M;white-space:pre;font-kerning:normal;position:absolute;left:0;top:0}</style><span id=s>${text}</span>`);
  await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate(() => {
    const n = document.getElementById('s').firstChild, out = [];
    for (let i = 0; i < n.length; i++) { const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1); const b = rg.getBoundingClientRect(); out.push({ ch: n.data[i], x: b.left, w: b.width }); }
    return out;
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
