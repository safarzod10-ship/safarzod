// Real-time check of the live page: clicks the button like a user, measures the
// frame rate, verifies the button is re-enabled for a replay and records a
// real-time screen capture (WebM, no audio — Playwright cannot capture sound).
//
//   node tools/live_check.mjs [out.webm]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.resolve(process.argv[2] || 'media/dragon_live_capture.webm');
const tmpDir = path.join(path.dirname(out), '.live_tmp');
const { url, close } = await serve();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, recordVideo: { dir: tmpDir, size: { width: 540, height: 960 } } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url + '/index.html');
await page.waitForTimeout(1200);

const fps = () => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(f);
}));
const idleFps = await fps();
await page.click('#play');
const disabledAfterClick = await page.$eval('#play', (b) => b.disabled);
await page.waitForTimeout(4300);
const fireFps = await fps(); // measured during the fire breath
const tEnd = Date.now();
await page.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 15000 });
const enabledAfter = true;
const sequenceWallSeconds = +((Date.now() - tEnd) / 1000 + 4.3 + 1.5).toFixed(2);
// replay
await page.click('#play');
const replayStarted = await page.$eval('#play', (b) => b.disabled);
await page.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 15000 });
const enabledAfterReplay = true;
await page.waitForTimeout(600);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), out);
fs.rmSync(tmpDir, { recursive: true, force: true });
await browser.close();
close();
console.log(JSON.stringify({ idleFps: +idleFps.toFixed(1), fireFps: +fireFps.toFixed(1), disabledAfterClick, enabledAfter, sequenceWallSeconds, replayStarted, enabledAfterReplay, errors, video: out }, null, 2));
