// Frame-exact video recording of the demo page (with the synthesized sound).
//
//   node tools/record.mjs [out.mp4]
//
// The page is opened in capture mode (?capture=1): instead of requestAnimationFrame
// the recorder advances the simulation by exactly 1/FPS per frame and takes a
// screenshot of the 9:16 stage (button included). The soundtrack is rendered by
// the very same Web Audio graph in an OfflineAudioContext, then ffmpeg muxes both.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const TRANSPARENT = args.includes('--transparent'); // character only, alpha channel (VP9 WebM)
const out = path.resolve(args.find((a) => !a.startsWith('--')) || (TRANSPARENT ? 'media/robocheetah_alpha.webm' : 'media/robocheetah_demo.mp4'));
const FPS = 60, LEAD = 1.2, TAIL = 1.0, PRESS = 0.18;

const { url, close } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(url + '/index.html?capture=1' + (TRANSPARENT ? '&transparent=1' : ''));
await page.waitForFunction(() => window.__capture);
await page.addStyleTag({ content: '#play{transition:none!important}' + (TRANSPARENT ? 'html,body{background:transparent!important}.stage-wrap{box-shadow:none!important}#play{display:none!important}' : '') });
const duration = await page.evaluate(() => window.__capture.duration);
await page.evaluate(() => window.__capture.reset());

const startFrame = Math.round(LEAD * FPS);
const total = startFrame + Math.round((duration + TAIL) * FPS);

// soundtrack: the sequence starts 0.05 s after the click (same as the live page)
const wavPath = out.replace(/\.\w+$/, '') + '.wav';
const b64 = await page.evaluate(([lead, tail]) => window.__capture.audioWav(lead, tail), [startFrame / FPS + 0.05, TAIL + 1]);
fs.writeFileSync(wavPath, Buffer.from(b64, 'base64'));

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-i', wavPath,
  ...(TRANSPARENT
    ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0', '-c:a', 'libopus', '-b:a', '128k']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k']),
  '-shortest', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const stage = page.locator('.stage-wrap');
const t0 = Date.now();
for (let f = 0; f < total; f++) {
  if (f === startFrame - Math.round(PRESS * FPS)) await page.evaluate(() => window.__capture.pressVisual(true));
  if (f === startFrame) await page.evaluate(() => { window.__capture.pressVisual(false); window.__capture.start(); });
  const png = await stage.screenshot({ type: 'png', omitBackground: TRANSPARENT });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  await page.evaluate((dt) => window.__capture.advance(dt), 1 / FPS);
  if (f % 60 === 0) process.stdout.write(`frame ${f}/${total}  (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
close();
if (!process.env.KEEP_WAV) fs.rmSync(wavPath, { force: true });
console.log('saved', out);
