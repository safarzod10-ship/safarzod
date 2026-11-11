// Render an episode HTML into MP4 (1080x1920, 30 fps) + SRT subtitles + cover.
// Usage:
//   node render.js episode1.html            -> out/episode1.mp4, out/episode1.srt, out/episode1_cover.png
//   node render.js episode1.html --shots 5,40,100   -> out/shot_*.png (preview frames only)
//   node render.js episode1.html --voice out/ep1_voice  -> video follows the voice track (.json + .wav from build_voice.py)
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
const voiceArg = process.argv.indexOf('--voice');
const voice = voiceArg > 0 ? JSON.parse(fs.readFileSync(process.argv[voiceArg + 1] + '.json', 'utf8')) : null;
const voiceWav = voice ? path.resolve(process.argv[voiceArg + 1] + '.wav') : null;
// piecewise-linear map between animation time and output (voice) time
const interp = (x, xs, ys) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return xs[i] === xs[i - 1] ? ys[i] : ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};
const KA = voice ? voice.knots.map(k => k[0]) : [0, 180], KO = voice ? voice.knots.map(k => k[1]) : [0, 180];
const outToAnim = t => interp(t, KO, KA), animToOut = t => interp(t, KA, KO);

const srtTime = s => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  // serve the project over local http so images drawn into the canvas don't taint it
  const http = require('http');
  const root = path.dirname(file);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.wav': 'audio/wav' };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  await page.goto(`http://127.0.0.1:${server.address().port}/${path.basename(file)}?render=1`);
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
  const names = { T: '', S: 'Продавец: ', M: 'Мастер: ', C: 'Голос: ', R: 'Рустам: ', A: 'Администратор ТЦ: ', K: 'Покупатель: ', P: 'Клиент: ', D: 'Даня: ', N: 'Рассказчик: ', O: 'Мама: ', F: 'Отец: ', X: 'Коллектор: ' };
  if (voice) await page.evaluate(env => { window.ENV = env; }, voice.env);
  const srt = subs.map((s, i) => `${i + 1}\n${srtTime(animToOut(s[0]))} --> ${srtTime(animToOut(s[1]))}\n${names[s[2]] || ''}${s[3].replace(/\*/g, '')}\n`).join('\n');
  fs.writeFileSync(path.join(outDir, `${name}.srt`), srt);

  // cover
  fs.writeFileSync(path.join(outDir, `${name}_cover.png`), await grab(await page.evaluate(() => window.COVER_T)));

  const dur = voice ? voice.duration : await page.evaluate(() => window.DURATION);
  // extra audio clips placed at animation times (e.g. an ad banner's own sound)
  const overlays = await page.evaluate(() => window.AUDIO_OVERLAYS || []);
  const base = voiceWav ? '[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[v]' : '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[v]';
  const ov = overlays.map((o, i) => { const ms = Math.round(animToOut(o.at) * 1000); return `[${i + 2}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${o.volume ?? 0.9},adelay=${ms}|${ms}[o${i}]`; });
  const audioGraph = [base, ...ov, overlays.length ? `[v]${overlays.map((_, i) => `[o${i}]`).join('')}amix=inputs=${overlays.length + 1}:normalize=0:duration=first[aout]` : '[v]anull[aout]'].join(';');
  const total = Math.round(dur * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...(voiceWav ? ['-i', voiceWav] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    ...overlays.flatMap(o => ['-i', path.resolve(o.src)]),
    '-filter_complex', audioGraph, '-map', '0:v', '-map', '[aout]',
    '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
    path.join(outDir, `${name}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const url = await page.evaluate(([ta, to]) => { window.OUT_T = to; window.renderAt(ta); return document.getElementById('c').toDataURL('image/jpeg', 0.93); }, [outToAnim(f / FPS), f / FPS]);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('done', path.join(outDir, `${name}.mp4`));
})();
