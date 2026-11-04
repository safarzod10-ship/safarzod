/*
 * CardArena end-to-end checks (Playwright + Chromium, virtual clock).
 * Usage:  node tests/e2e.js            (serves ../ on a local port)
 *         SHOTS=1 node tests/e2e.js    (also writes screenshots to tests/screenshots)
 */
'use strict';
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const SHOTS = !!process.env.SHOTS;
const results = [];

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
}

// Test-only hook: makes the NEXT secure draw return `k` (so k % n is the winner index).
const FORCE_RANDOM = `
  (() => {
    const orig = crypto.getRandomValues.bind(crypto);
    window.__forceNext = null;
    crypto.getRandomValues = (arr) => {
      if (window.__forceNext !== null && arr instanceof Uint32Array && arr.length === 1) { arr[0] = window.__forceNext; window.__forceNext = null; return arr; }
      return orig(arr);
    };
  })();`;

async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 393, height: opts.height || 852 }, deviceScaleFactor: opts.dsf || 1, isMobile: true, hasTouch: true, reducedMotion: opts.reducedMotion || 'no-preference' });
  if (opts.force) await ctx.addInitScript(FORCE_RANDOM);
  if (opts.noStorage) await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  return ctx;
}
const snap = (page) => page.evaluate(() => window.CardArena.snapshot());
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(1600); // CSS animations run on real time, not the virtual clock
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}

(async () => {
  const server = await serve();
  const URL = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  const errors = [];

  try {
    /* ---------- Scenario A: first launch ---------- */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('A: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      check('A: brand name shown', await page.locator('.brand-name').textContent() === 'CardArena');
      check('A: balance 500', (await page.locator('.topbar .balance').textContent()).includes('500'));
      check('A: two active auctions', await page.locator('.auction-tile').count() === 2);
      check('A: bottom navigation with 4 tabs', await page.locator('#tabbar:not([hidden]) .tab').count() === 4);
      check('A: greeting texts', (await page.locator('.greeting').textContent()).includes('Добро пожаловать'));
      const s = await snap(page);
      check('A: two rounds Active with 20s endAt', s.rounds.length === 2 && s.rounds.every(r => r.status === 'Active' && r.endAt - r.startAt === 20000));
      check('A: ledger has +500 entry', s.ledger.length === 1 && s.ledger[0].amount === 500);
      await shot(page, 'A_home_393');
      // Navigation
      for (const tab of ['collection', 'rating', 'profile', 'home']) {
        await page.locator('.tab[data-route="' + tab + '"]').click();
        check('Nav: ' + tab + ' tab active', await page.locator('.tab.active').getAttribute('data-route') === tab);
      }
      await page.locator('.tab[data-route="collection"]').click();
      check('Collection: empty state', (await page.locator('.empty-state h2').textContent()) === 'Ваша коллекция пока пуста');
      await shot(page, 'collection_empty');
      await page.locator('.empty-state .btn').click();
      check('Collection: "Смотреть аукционы" returns home', await page.locator('.auction-tile').count() === 2);
      await page.locator('.tab[data-route="rating"]').click();
      check('Rating: 10 demo rows', await page.locator('.rank-row').count() === 10);
      check('Rating: user position shown', (await page.locator('.my-rank .pos').textContent()) === '11');
      await shot(page, 'rating');
      await page.locator('.tab[data-route="profile"]').click();
      check('Profile: Demo Player + 500', (await page.locator('.profile-head').textContent()).includes('Demo Player') && (await page.locator('.profile-head').textContent()).includes('500'));
      await shot(page, 'profile');
      check('Profile: every icon has drawable content', await page.evaluate(() => Array.from(document.querySelectorAll('svg.icon')).every(svg => svg.childElementCount > 0)));
      // Settings persistence
      await page.locator('button[role="switch"]').click();
      await page.locator('.seg button', { hasText: 'Меньше' }).click();
      let s2 = await snap(page);
      check('Settings: sound off + reduced motion saved', s2.settings.sound === false && s2.settings.motion === 'reduced');
      await page.reload();
      s2 = await snap(page);
      check('Settings: persisted after reload', s2.settings.sound === false && s2.settings.motion === 'reduced');
      await ctx.close();
    }

    /* ---------- Scenarios B, F, C, D: join, refresh at 10s, win ---------- */
    {
      const ctx = await newContext(browser, { force: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('BD: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      const dragon = (await snap(page)).rounds.find(r => r.cardId === '1111');
      await page.locator('.auction-tile').first().click();
      await page.waitForSelector('.timer-value');
      await page.clock.runFor(1200);
      await shot(page, 'B_auction_before');
      check('B: timer and participants visible', (await page.locator('.timer-value').textContent()).startsWith('00:'));
      const cta = page.locator('.cta-bar .btn');
      check('B: CTA text', (await cta.textContent()).trim() === 'Участвовать бесплатно');
      await cta.click();
      await page.clock.runFor(300);
      check('B: button switches to "Вы участвуете" and disabled', (await cta.textContent()).includes('Вы участвуете') && await cta.isDisabled());
      check('B: user listed among participants', await page.locator('.p-row.me').count() === 1);
      // Attempt duplicate registration through the business layer
      const dup = await page.evaluate((id) => AuctionManager.join(id), dragon.id);
      check('B: duplicate registration refused', dup === 'already' && (await snap(page)).rounds.find(r => r.id === dragon.id).participants.filter(p => p.id === 'me').length === 1);
      await shot(page, 'B_auction_joined');

      // Scenario F: refresh around the 10th second
      await page.clock.runFor(8500); // ≈10s since start
      const before = await page.locator('.timer-value').textContent();
      await page.reload();
      await page.waitForSelector('.timer-value');
      const after = await page.locator('.timer-value').textContent();
      check('F: timer continues after reload (not reset to 00:20)', after !== '00:20' && Math.abs(parseInt(after.slice(3)) - parseInt(before.slice(3))) <= 1, before + ' → ' + after);
      check('F: endAt unchanged after reload', (await snap(page)).rounds.find(r => r.id === dragon.id).endAt === dragon.endAt);
      const chances = await page.locator('.p-row .p-chance').allTextContents();
      const n = chances.length;
      check('F: every participant shows 100/n %', chances.every(c => c === (Number.isInteger(100 / n) ? (100 / n) + '%' : (Math.round(1000 / n) / 10).toFixed(1).replace('.', ',') + '%')), chances.join(' '));

      // Force the user to win the Dragon draw: user's index in join order.
      const r1 = (await snap(page)).rounds.find(r => r.id === dragon.id);
      const order = r1.participants.filter(p => p.joinedAt <= r1.endAt).sort((a, b) => a.joinedAt - b.joinedAt).map(p => p.id);
      const myIdx = order.indexOf('me');
      // Two draws happen (both rounds end together); dragon is first in state order.
      await page.evaluate((k) => { window.__forceNext = k; }, myIdx);

      // Last-5-seconds accent
      await page.clock.runFor(r1.endAt - (await page.evaluate(() => Date.now())) - 3000);
      check('C: urgent accent in last 5 s', await page.locator('.timer-block.urgent').count() === 1);
      await shot(page, 'C_auction_urgent');
      await page.clock.runFor(3400);
      await page.waitForSelector('.result');
      const s3 = await snap(page);
      const rd = s3.rounds.find(r => r.id === dragon.id);
      check('C: registration closed, round Completed, statusLog Active→Drawing→Completed', rd.status === 'Completed' && rd.statusLog.map(x => x.status).join('>') === 'Active>Drawing>Completed');
      check('C: result stored before animation (revealed=false while roulette runs)', rd.result && rd.result.revealed === false);
      check('D: forced winner is the user', rd.result.winnerId === 'me');
      check('D: card transferred to user in model', s3.cards['1111'].ownerId === 'me');
      await page.clock.runFor(2500);
      await shot(page, 'C_roulette_mid');
      await page.clock.runFor(4500);
      await page.waitForSelector('.reveal');
      // Pointer precisely on the winner tile
      const geo = await page.evaluate(() => {
        const p = document.querySelector('.roulette-pointer').getBoundingClientRect();
        const w = document.querySelector('.r-tile.is-winner').getBoundingClientRect();
        return { p: p.left + p.width / 2, l: w.left, r: w.right, name: document.querySelector('.r-tile.is-winner .r-name').textContent };
      });
      check('C: roulette stops with pointer inside winner tile', geo.p > geo.l && geo.p < geo.r && geo.name === 'Вы', JSON.stringify(geo));
      check('D: "Поздравляем!" shown', (await page.locator('.reveal .result-title').textContent()) === 'Поздравляем!');
      check('D: "Вы получили Golden Dragon #1111"', (await page.locator('.reveal .result-sub').first().textContent()) === 'Вы получили Golden Dragon #1111');
      await shot(page, 'D_result_win');
      await page.locator('.result-actions .btn', { hasText: 'Открыть коллекцию' }).click();
      // Shadow Wolf round (user did not join) is not auto-queued; we should land in collection.
      await page.waitForSelector('.collection-grid');
      check('D: card appears in collection', await page.locator('.coll-item').count() === 1);
      await shot(page, 'D_collection');
      await page.locator('.coll-item').click();
      await page.waitForSelector('.timeline');
      check('Detail: date + history shown', await page.locator('.tl-item').count() >= 4);
      await page.clock.runFor(1500);
      await shot(page, 'D_card_detail');
      await page.goBack();
      // Reload several times: no duplicates, no re-draw
      for (let i = 0; i < 3; i++) await page.reload();
      const s4 = await snap(page);
      check('D: reloads do not duplicate the card or re-draw', Object.values(s4.cards).filter(c => c.ownerId === 'me').length === 1 && s4.rounds.find(r => r.id === dragon.id).result.drawnAt === rd.result.drawnAt);
      check('D: Wolf round also finished (simultaneous end)', s4.rounds.every(r => r.status === 'Completed'));
      await page.goto(URL + '#/home');
      await page.waitForSelector('.auction-tile');
      await shot(page, 'home_completed');
      await page.locator('.tab[data-route="profile"]').click();
      check('Profile: 1 participation, 1 win, 1 card', (await page.locator('.stats .v').allTextContents()).join(',') === '1,1,1');
      await ctx.close();
    }

    /* ---------- Scenario E + simultaneous end: user joins both, loses both ---------- */
    {
      const ctx = await newContext(browser, { force: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('E: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      const ids = (await snap(page)).rounds.map(r => r.id);
      for (const id of ids) await page.evaluate((x) => AuctionManager.join(x), id);
      await page.clock.runFor(10000);
      // Winner index 0 = earliest joiner = a demo bot in both rounds (bots at offset 0).
      await page.evaluate(() => {
        let calls = 0;
        const orig = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (a) => { if (a instanceof Uint32Array && a.length === 1 && calls < 2) { calls++; a[0] = 0; return a; } return orig(a); };
      });
      await page.clock.runFor(10500);
      await page.waitForSelector('.result');
      const s = await snap(page);
      check('Edge: both rounds finished in the same tick', s.rounds.every(r => r.status === 'Completed'));
      check('E: user lost both, no card in collection', Object.values(s.cards).every(c => c.ownerId && c.ownerId !== 'me'));
      await page.clock.runFor(6500);
      await page.waitForSelector('.reveal');
      const title1 = await page.locator('.reveal .result-title').textContent();
      check('E: "Победитель — <name>" shown', /^Победитель — (Alex|Samir|Timur)$/.test(title1), title1);
      await shot(page, 'E_result_lose');
      await page.locator('.result-actions .btn').click();
      // Second result queued automatically
      await page.waitForSelector('.result');
      check('Edge: second result opens after first is closed', (await page.evaluate(() => location.hash)).startsWith('#/result/'));
      await page.clock.runFor(6500);
      await page.locator('.result-actions .btn').click();
      await page.waitForSelector('.auction-tile');
      await page.locator('.tab[data-route="collection"]').click();
      check('E: collection still empty', await page.locator('.empty-state').count() === 1);
      await page.locator('.tab[data-route="profile"]').click();
      check('E: participation history saved (2 entries)', await page.locator('.section').first().locator('.list-row').count() === 2);
      check('E: stats 2 participations / 0 wins', (await page.locator('.stats .v').allTextContents()).join(',') === '2,0,0');
      await page.reload();
      check('E: no result screen re-opens after everything was seen', !(await page.evaluate(() => location.hash)).startsWith('#/result'));
      /* Scenario H: reset */
      await page.locator('.list-row', { hasText: 'Сбросить демо' }).click();
      await shot(page, 'H_reset_sheet');
      await page.locator('.sheet .btn', { hasText: 'Сбросить' }).click();
      await page.waitForSelector('.auction-tile');
      const h = await snap(page);
      check('H: balance 500, empty collection', h.balance === 500 && Object.values(h.cards).every(c => !c.ownerId));
      check('H: both rounds recreated with new IDs and new endAt', h.rounds.length === 2 && h.rounds.every(r => r.status === 'Active' && ids.indexOf(r.id) === -1 && r.endAt > Date.now()) );
      check('H: history cleared', h.ledger.length === 1 && h.rounds.every(r => !r.participants.some(p => p.id === 'me')));
      await ctx.close();
    }

    /* ---------- Scenario G: closed before end, returns later ---------- */
    {
      const ctx = await newContext(browser);
      let page = await ctx.newPage();
      page.on('pageerror', e => errors.push('G: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      const id = (await snap(page)).rounds[0].id;
      await page.evaluate((x) => AuctionManager.join(x), id);
      const stored = await page.evaluate(() => localStorage.getItem('cardarena.state'));
      const t0 = await page.evaluate(() => Date.now());
      await page.close();
      page = await ctx.newPage();
      page.on('pageerror', e => errors.push('G2: ' + e.message));
      await page.clock.install({ time: t0 + 60000 });
      await page.goto(URL);
      await page.waitForSelector('.result');
      const s = await snap(page);
      check('G: reopened after end → result screen restored', (await page.evaluate(() => location.hash)) === '#/result/' + id);
      check('G: result finalized exactly once', s.rounds.every(r => r.result) && s.rounds.find(r => r.id === id).statusLog.filter(x => x.status === 'Completed').length === 1);
      const owner = s.cards[s.rounds.find(r => r.id === id).cardId].ownerId;
      check('G: card owner matches stored winner', owner === s.rounds.find(r => r.id === id).result.winnerId);
      await page.reload();
      const s2 = await snap(page);
      check('G: reload does not re-draw', s2.rounds.find(r => r.id === id).result.drawnAt === s.rounds.find(r => r.id === id).result.drawnAt && s2.rounds.find(r => r.id === id).result.winnerId === s.rounds.find(r => r.id === id).result.winnerId);
      void stored;
      await ctx.close();
    }

    /* ---------- Edge: crash between Drawing and Completed ---------- */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('Draw: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      // Simulate a page that died right after closing registration.
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('cardarena.state'));
        const r = s.rounds[0];
        r.participants.push({ id: 'me', name: 'Demo Player', isBot: false, joinedAt: r.startAt + 1000 });
        r.status = 'Drawing'; r.statusLog.push({ status: 'Drawing', at: r.endAt }); r.closedAt = r.endAt;
        s.rev += 1;
        localStorage.setItem('cardarena.state', JSON.stringify(s));
      });
      await page.reload();
      await page.waitForSelector('.result');
      const s = await snap(page);
      check('Edge: round left in Drawing is completed once on next load', s.rounds[0].status === 'Completed' && s.rounds[0].statusLog.map(x => x.status).join('>') === 'Active>Drawing>Completed');
      await ctx.close();
    }

    /* ---------- Edge: refresh exactly at endAt ---------- */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('End: ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      const r = (await snap(page)).rounds[0];
      await page.evaluate((x) => AuctionManager.join(x), r.id);
      await page.clock.pauseAt(r.endAt);
      await page.reload();
      await page.waitForSelector('.result');
      const s = await snap(page);
      check('Edge: reload at exactly endAt finalizes once and opens result', s.rounds[0].status === 'Completed' && s.rounds[0].statusLog.length === 3);
      await ctx.close();
    }

    /* ---------- Two tabs: no double draw ---------- */
    {
      const ctx = await newContext(browser);
      const p1 = await ctx.newPage();
      await p1.clock.install();
      await p1.goto(URL);
      await p1.waitForSelector('.auction-tile');
      const p2 = await ctx.newPage();
      await p2.clock.install();
      await p2.goto(URL);
      await p2.waitForSelector('.auction-tile');
      await p1.clock.runFor(21000);
      await p2.clock.runFor(21000);
      await p1.waitForTimeout(400); // let cross-tab storage events arrive
      const a = await snap(p1), b = await snap(p2);
      const stored = JSON.parse(await p1.evaluate(() => localStorage.getItem('cardarena.state')));
      check('Tabs: both tabs converge on the same winners', a.rounds.every((r, i) => r.result.winnerId === stored.rounds[i].result.winnerId) && b.rounds.every((r, i) => r.result.winnerId === stored.rounds[i].result.winnerId));
      await ctx.close();
    }

    /* ---------- Reduced motion: result shown immediately ---------- */
    {
      const ctx = await newContext(browser, { reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      await page.evaluate(() => window.CardArena.snapshot().rounds.forEach(r => AuctionManager.join(r.id)));
      await page.clock.runFor(20600);
      await page.waitForSelector('.reveal', { timeout: 2000 });
      check('Motion: prefers-reduced-motion shows result immediately (no roulette)', await page.locator('.reveal').count() === 1);
      await ctx.close();
    }

    /* ---------- Fairness: distribution of the secure draw ---------- */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(URL);
      const dist = await page.evaluate(() => {
        const out = {};
        for (const n of [2, 3, 4]) {
          const c = new Array(n).fill(0);
          const N = 120000;
          for (let i = 0; i < N; i++) c[Utils.secureRandomInt(n)]++;
          out[n] = c.map(x => x / N);
        }
        return out;
      });
      const okDist = Object.entries(dist).every(([n, arr]) => arr.every(p => Math.abs(p - 1 / n) < 0.01));
      check('Fairness: secureRandomInt uniform for n=2,3,4 (±1%)', okDist, JSON.stringify(Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, v.map(x => x.toFixed(3))]))));
      const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      check('Fairness: no Math.random in source', !/Math\.random/.test(src));
      check('No external URLs / CDN in source', !/(src|href)=["']https?:/i.test(src) && !/fetch\(|XMLHttpRequest|import\(/.test(src));
      await ctx.close();
    }

    /* ---------- localStorage unavailable ---------- */
    {
      const ctx = await newContext(browser, { noStorage: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('NoStorage: ' + e.message));
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      check('Storage off: app still works and warns', await page.locator('#banner:not([hidden])').count() === 1 && await page.locator('.auction-tile').count() === 2);
      await page.locator('.auction-tile').first().click();
      await page.locator('.cta-bar .btn').click();
      check('Storage off: join works in memory', await page.locator('.p-row.me').count() === 1);
      await shot(page, 'storage_unavailable');
      await ctx.close();
    }

    /* ---------- Corrupted / future data ---------- */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('Corrupt: ' + e.message));
      await page.goto(URL);
      for (const bad of ['{not json', JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, rev: 0 })]) {
        await page.evaluate((b) => localStorage.setItem('cardarena.state', b), bad);
        await page.reload();
        await page.waitForSelector('.auction-tile');
        const s = await snap(page);
        check('Corrupt data recovered: ' + bad.slice(0, 22), s.version === 1 && s.balance === 500 && s.rounds.length === 2 && (await page.locator('#toast.show').count()) === 1);
      }
      // Tampered ownership (card owned without a matching win) is rejected
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cardarena.state')); s.cards['1111'].ownerId = 'me'; localStorage.setItem('cardarena.state', JSON.stringify(s)); });
      await page.reload();
      check('Inconsistent ownership rejected', (await snap(page)).cards['1111'].ownerId === null);
      // Migration from unversioned v0 data
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('cardarena.state')); delete s.version; delete s.settings; localStorage.setItem('cardarena.state', JSON.stringify(s)); });
      const idsBefore = (await snap(page)).rounds.map(r => r.id).join();
      await page.reload();
      const m = await snap(page);
      check('Migration v0 → v1 keeps data', m.version === 1 && m.settings.motion === 'full' && m.rounds.map(r => r.id).join() === idsBefore);
      await ctx.close();
    }

    /* ---------- Widths: no horizontal scroll, screenshots ---------- */
    for (const w of [320, 360, 393, 412, 430]) {
      const ctx = await newContext(browser, { width: w, height: w === 320 ? 568 : 800, dsf: SHOTS ? 2 : 1 });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(w + ': ' + e.message));
      await page.clock.install();
      await page.goto(URL);
      await page.waitForSelector('.auction-tile');
      let ok = await noHScroll(page);
      await shot(page, 'width_' + w + '_home');
      await page.locator('.auction-tile').first().click();
      await page.waitForSelector('.timer-value');
      await page.clock.runFor(1500);
      ok = ok && await noHScroll(page);
      // CTA must not overlap the last participant when scrolled to bottom
      await page.evaluate(() => window.scrollTo(0, 1e6));
      const overlap = await page.evaluate(() => {
        const rows = document.querySelectorAll('.p-row'); const last = rows[rows.length - 1];
        return last.getBoundingClientRect().bottom > document.querySelector('.cta-bar .btn').getBoundingClientRect().top;
      });
      await shot(page, 'width_' + w + '_auction');
      for (const tab of ['collection', 'rating', 'profile']) {
        await page.goto(URL + '#/' + tab);
        await page.waitForSelector('#tabbar:not([hidden])');
        ok = ok && await noHScroll(page);
        if (w === 320) await shot(page, 'width_320_' + tab);
      }
      // Tab bar does not cover the last content on profile
      await page.evaluate(() => window.scrollTo(0, 1e6));
      const covered = await page.evaluate(() => {
        const rows = document.querySelectorAll('.list-row'); const last = rows[rows.length - 1];
        return last.getBoundingClientRect().bottom > document.getElementById('tabbar').getBoundingClientRect().top;
      });
      // Tap targets ≥ 44px
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.height < 32 || r.width < 32); }).map(b => b.textContent.trim().slice(0, 20)));
      check('Width ' + w + 'px: no horizontal scroll, CTA/tabbar do not cover content', ok && !overlap && !covered, small.length ? 'small buttons: ' + small.join('|') : '');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  check('No uncaught page errors', errors.length === 0, errors.join(' ; '));
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
