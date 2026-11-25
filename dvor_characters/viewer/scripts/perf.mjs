// Measured checks of the test scene in headless Chromium (software GL / SwiftShader):
//   node scripts/perf.mjs            (after `npx vite build`)
// Scenarios: CPU throttling 1x/4x/6x on a 390x844 phone viewport, 3 and 9 characters, and
// cold loads over emulated Fast 3G / Slow 3G. Writes ../review/perf.json and a screenshot.
// NOTE: SwiftShader renders on the CPU, so FPS here is a pessimistic proxy, not a phone result.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(path.join(here, '..', 'node_modules', '.bin', 'vite'), ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(here, '..'), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = { note: 'Headless Chromium + SwiftShader (CPU rendering). Not a phone measurement.', runs: [] };

async function run({ name, query, cpu = 1, net = null, seconds = 6, shot = null }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  let bytes = 0;
  const byType = {};
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  cdp.on('Network.responseReceived', (e) => { byType[e.response.url.split('/').pop().split('?')[0]] = e.response.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(`${BASE}/index.html?${query}`);
  await page.waitForFunction(() => window.__dvor?.ready, null, { timeout: 180000 });
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(seconds * 1000);
  const m = await page.evaluate(() => ({ ...window.__dvor.metrics, load: window.__dvor.loadInfo }));
  if (shot) await page.screenshot({ path: shot });
  const r = { name, query, cpuThrottle: cpu, network: net ? `${Math.round(net.downloadThroughput * 8 / 1000)} kbit/s, ${net.latency} ms` : 'none',
    readyMs, transferredBytes: bytes, ...m };
  results.runs.push(r);
  console.log(name, JSON.stringify({ readyMs, fps: m.fps, p95: m.frameMsP95, cpu: m.cpuMsAvg, calls: m.calls, tris: m.triangles, bytes }));
  await ctx.close();
}

const out = path.join(here, '..', '..', 'review');
fs.mkdirSync(path.join(out, 'map'), { recursive: true });
// characters only, as in the character report (neutral grid floor, fixed camera)
const CH = 'map=0&cam=fixed&';
await run({ name: '3 chars, no throttle', query: CH + 'count=3&tex=png', shot: path.join(out, 'test_scene_phone.png') });
await run({ name: '3 chars, CPU x4', query: CH + 'count=3&tex=png', cpu: 4 });
await run({ name: '3 chars, CPU x6, lambert, dpr1', query: CH + 'count=3&tex=png&lambert=1&dpr=1', cpu: 6 });
await run({ name: '9 chars, CPU x4', query: CH + 'count=9&tex=png', cpu: 4 });
await run({ name: '3 chars, KTX2, CPU x4', query: CH + 'count=3&tex=ktx2', cpu: 4 });
const fast3g = { latency: 150, downloadThroughput: (1.6 * 1e6) / 8, uploadThroughput: (750 * 1e3) / 8 };
const slow3g = { latency: 400, downloadThroughput: (400 * 1e3) / 8, uploadThroughput: (400 * 1e3) / 8 };
await run({ name: 'cold load Fast 3G (1.6 Mbit/s)', query: CH + 'count=3&tex=png', net: fast3g, seconds: 2 });
await run({ name: 'cold load Slow 3G (400 kbit/s)', query: CH + 'count=3&tex=png', net: slow3g, seconds: 2 });
// arena map + 3 characters, game-like follow camera
await run({ name: 'MAP + 3 chars', query: 'count=3&tex=png', shot: path.join(out, 'map', 'map_test_scene_phone.png') /* converted to .jpg for the repo */ });
await run({ name: 'MAP + 3 chars, CPU x6, lambert, dpr1', query: 'count=3&tex=png&lambert=1&dpr=1', cpu: 6 });
await run({ name: 'MAP + 3 chars, KTX2, CPU x4', query: 'count=3&tex=ktx2', cpu: 4 });
await run({ name: 'MAP cold load Fast 3G (1.6 Mbit/s)', query: 'count=3&tex=png', net: fast3g, seconds: 2 });
await run({ name: 'MAP cold load Slow 3G (400 kbit/s)', query: 'count=3&tex=png', net: slow3g, seconds: 2 });
results.generated = new Date().toISOString();
fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(results, null, 2));
await browser.close();
server.kill();
