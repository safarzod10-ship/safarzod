const { chromium } = require('playwright'); const fs = require('fs'); const http = require('http'); const path = require('path');
(async () => {
  const root = __dirname;
  const srv = http.createServer((q, r) => { const p = path.join(root, q.url.split('?')[0]); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } fs.createReadStream(p).pipe(r); }).listen(0);
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto(`http://127.0.0.1:${srv.address().port}/art.html`); await pg.waitForFunction(() => window.READY); await pg.evaluate(() => document.fonts.ready);
  for (const [id, f] of [['a', 'avatar.png'], ['b', 'post_cover.png']]) {
    const d = await pg.evaluate(i => document.getElementById(i).toDataURL('image/png'), id);
    fs.writeFileSync(path.join(root, f), Buffer.from(d.split(',')[1], 'base64'));
  }
  await b.close(); srv.close();
})();
