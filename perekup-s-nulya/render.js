// Render an episode HTML into MP4 (1080x1920, 30 fps) + SRT subtitles + cover.
// Usage:
//   node render.js episode1.html            -> out/episode1.mp4, out/episode1.srt, out/episode1_cover.png
//   node render.js episode1.html --shots 5,40,100   -> out/shot_*.png (preview frames only)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const file = path.resolve(process.argv[2] || 'episode1.html');
const name = path.basename(file, '.html');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const shotsArg = process.argv.indexOf('--shots');

const srtTime = s => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  await page.goto('file://' + file + '?render=1');
  await page.waitForFunction(() => window.READY === true);
  const grab = async t => {
    const url = await page.evaluate(tt => { window.renderAt(tt); return document.getElementById('c').toDataURL('image/png'); }, t);
    return Buffer.from(url.split(',')[1], 'base64');
  };

  if (shotsArg > 0) {
    for (const t of process.argv[shotsArg + 1].split(',').map(Number)) {
      fs.writeFileSync(path.join(outDir, `shot_${t}.png`), await grab(t));
    }
    await browser.close();
    return;
  }

  // subtitles (SRT) for CapCut / TikTok
  const subs = await page.evaluate(() => window.SUBS);
  const names = { S: 'Продавец: ', M: 'Мастер: ', C: 'Голос: ', T: '' };
  const srt = subs.map((s, i) => `${i + 1}\n${srtTime(s[0])} --> ${srtTime(s[1])}\n${names[s[2]]}${s[3].replace(/\*/g, '')}\n`).join('\n');
  fs.writeFileSync(path.join(outDir, `${name}.srt`), srt);

  // cover
  fs.writeFileSync(path.join(outDir, `${name}_cover.png`), await grab(7.6));

  const dur = await page.evaluate(() => window.DURATION);
  const total = Math.round(dur * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    path.join(outDir, `${name}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const url = await page.evaluate(tt => { window.renderAt(tt); return document.getElementById('c').toDataURL('image/jpeg', 0.93); }, f / FPS);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('done', path.join(outDir, `${name}.mp4`));
})();
