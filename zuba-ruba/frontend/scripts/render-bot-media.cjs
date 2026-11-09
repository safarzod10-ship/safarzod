const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const pub = path.join(root, "public");
const project = path.resolve(root, "..");
const brandDir = path.join(project, "docs", "brand");
const botAssets = path.join(project, "backend", "app", "bot", "assets");
const lottieSource = fs.readFileSync(path.join(root, "node_modules/lottie-web/build/player/lottie_light.min.js"), "utf8");
const font = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(pub, "fonts", file)).toString("base64")}`;
const starPng = `data:image/png;base64,${fs.readFileSync(path.join(pub, "img", "star.png")).toString("base64")}`;

const GIFTS = { bear: "5170233102089322756", rose: "5168103777563050263", trophy: "5168043875654172773", diamond: "5170521118301225164" };
const FPS = 30;
const SECONDS = 6;
const STRIP = ["0,2", "1", "0,1", "0,5", "0,3", "2", "0,1", "0,2"];

const base = `
@font-face { font-family: Unbounded; src: url(${font("unbounded-cyrillic.woff2")}) format("woff2"); unicode-range: U+0400-045F; font-weight: 400 900; }
@font-face { font-family: Unbounded; src: url(${font("unbounded-latin.woff2")}) format("woff2"); font-weight: 400 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { position: relative; overflow: hidden; background: #f2efe7; color: #16140f; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.lottie { position: absolute; }
.brand { font-family: Unbounded, sans-serif; font-weight: 600; letter-spacing: 0.01em; }
.prize { position: absolute; top: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border-radius: 26px; background: #fffdf8; box-shadow: 0 0 0 2px rgba(22,20,15,.08), 0 18px 30px -20px rgba(22,20,15,.5); }
.prize img { display: block; }
.prize b { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; }
.prize.top { background: #ffb21a; }
.prize.rare { background: #ffe7b0; }
`;

function prize(amount, x, w, h) {
  const tier = amount === "2" ? "top" : amount === "1" ? "rare" : "";
  return `<div class="prize ${tier}" style="left:${x}px;width:${w}px;height:${h}px"><img src="${starPng}" width="${w * 0.5}" height="${w * 0.5}"><b>${amount}</b></div>`;
}

function bannerHtml() {
  const card = 150;
  const gap = 18;
  const step = card + gap;
  const cards = [];
  for (let i = 0; i < STRIP.length * 4; i += 1) cards.push(prize(STRIP[i % STRIP.length], i * step, card, 176));
  return {
    step,
    body: `
    <div class="brand" style="position:absolute;left:72px;top:64px;font-size:64px">ZUBA RUBA</div>
    <div style="position:absolute;left:74px;top:150px;font-size:30px;color:#6c665b">Задания · Кейсы · Подарки Telegram</div>
    <div style="position:absolute;left:74px;top:204px;display:flex;gap:12px">
      <span style="padding:10px 18px;border-radius:22px;background:#16140f;color:#f6f2e8;font-size:24px;font-weight:600">Кейс за каждое задание</span>
      <span style="padding:10px 18px;border-radius:22px;background:#ffb21a;color:#2b1d00;font-size:24px;font-weight:600;display:inline-flex;align-items:center;gap:6px">Вывод от 15 <img src="${starPng}" width="26" height="26"></span>
    </div>
    <div class="lottie" data-src="${GIFTS.trophy}" style="left:900px;top:30px;width:210px;height:210px"></div>
    <div class="lottie" data-src="${GIFTS.bear}" style="left:1060px;top:150px;width:150px;height:150px"></div>
    <div class="lottie" data-src="${GIFTS.rose}" style="left:820px;top:170px;width:120px;height:120px"></div>
    <div style="position:absolute;left:0;right:0;top:362px;height:296px;background:#e9e5da"></div>
    <div id="track" style="position:absolute;left:0;top:420px;height:176px;width:${cards.length * step}px">${cards.join("")}</div>
    <div style="position:absolute;left:631px;top:384px;width:0;height:0;border-left:18px solid transparent;border-right:18px solid transparent;border-top:26px solid #ffb21a;margin-left:-9px"></div>
    <div style="position:absolute;left:631px;top:612px;width:0;height:0;border-left:18px solid transparent;border-right:18px solid transparent;border-bottom:26px solid #ffb21a;margin-left:-9px"></div>
  `,
  };
}

function avatarHtml() {
  return `
    <div style="position:absolute;inset:0;background:#ffb21a"></div>
    <div class="prize" style="left:170px;top:120px;width:300px;height:380px;border-radius:52px;transform:rotate(-8deg);gap:22px">
      <img src="${starPng}" width="190" height="190"><b class="brand" style="font-size:52px;font-family:Unbounded">ZR</b>
    </div>
  `;
}

async function renderLottie(page, frames) {
  const ids = await page.$$eval(".lottie", (nodes) => [...new Set(nodes.map((n) => n.dataset.src))]);
  const data = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(path.join(pub, "gifts", `${id}.json`), "utf8"))]));
  await page.addScriptTag({ content: lottieSource });
  await page.evaluate((animations) => {
    window.anims = [...document.querySelectorAll(".lottie")].map((node) =>
      window.lottie.loadAnimation({ container: node, renderer: "svg", loop: true, autoplay: false, animationData: animations[node.dataset.src] }),
    );
  }, data);
  await page.evaluate((frame) => window.anims.forEach((a) => a.goToAndStop(frame % a.totalFrames, true)), frames);
}

async function main() {
  fs.mkdirSync(brandDir, { recursive: true });
  fs.mkdirSync(botAssets, { recursive: true });
  const browser = await chromium.launch();

  const avatar = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await avatar.setContent(`<!doctype html><html><head><style>${base}</style></head><body>${avatarHtml()}</body></html>`);
  await avatar.evaluate(() => document.fonts.ready);
  await avatar.screenshot({ path: path.join(brandDir, "avatar.png") });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const banner = bannerHtml();
  await page.setContent(`<!doctype html><html><head><style>${base}</style></head><body>${banner.body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await renderLottie(page, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zr-frames-"));
  const total = FPS * SECONDS;
  const distance = banner.step * STRIP.length;
  for (let frame = 0; frame < total; frame += 1) {
    const shift = (frame / total) * distance;
    await page.evaluate(
      ({ shift, giftFrame, center }) => {
        document.getElementById("track").style.transform = `translateX(${center - shift}px)`;
        window.anims.forEach((a) => a.goToAndStop(giftFrame % a.totalFrames, true));
      },
      { shift, giftFrame: Math.round(frame * 2), center: -banner.step * STRIP.length + 640 - 75 },
    );
    await page.screenshot({ path: path.join(tmp, `f${String(frame).padStart(4, "0")}.png`) });
    if (frame === 0) fs.copyFileSync(path.join(tmp, "f0000.png"), path.join(brandDir, "banner.png"));
  }
  await browser.close();

  const video = path.join(brandDir, "banner.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(tmp, "f%04d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", video]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(brandDir, "banner.png"), "-vf", "scale=640:360", path.join(brandDir, "description.png")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "scale=640:360", "-c:v", "libx264", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path.join(brandDir, "description.mp4")]);
  fs.copyFileSync(video, path.join(botAssets, "welcome.mp4"));
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const file of ["avatar.png", "banner.png", "banner.mp4", "description.png", "description.mp4"]) {
    console.log(file, fs.statSync(path.join(brandDir, file)).size);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
