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
const font = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, "assets", "fonts", file)).toString("base64")}`;
const starPng = `data:image/png;base64,${fs.readFileSync(path.join(pub, "img", "star.png")).toString("base64")}`;

const GIFTS = { bear: "5170233102089322756", rose: "5168103777563050263", trophy: "5168043875654172773" };
const FPS = 30;
const SECONDS = 7;
const CARD = 150;
const GAP = 18;
const STEP = CARD + GAP;
const START_INDEX = 4;
const WIN_INDEX = 36;
const PATTERN = ["0,2", "0,1", "0,5", "0,1", "0,3", "1", "0,2", "0,1", "0,5", "0,3", "0,1", "0,2"];
const TIMELINE = { spinStart: 0.6, spinEnd: 4.4, burst: 0.9 };

const base = `
@font-face { font-family: Unbounded; src: url(${font("unbounded-cyrillic.woff2")}) format("woff2"); unicode-range: U+0400-045F; font-weight: 400 900; }
@font-face { font-family: Unbounded; src: url(${font("unbounded-latin.woff2")}) format("woff2"); font-weight: 400 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { position: relative; overflow: hidden; background: #f2efe7; color: #16140f; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.lottie { position: absolute; }
.brand { font-family: Unbounded, sans-serif; font-weight: 600; letter-spacing: 0.01em; }
.prize { position: absolute; top: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border-radius: 26px; background: #fffdf8; box-shadow: 0 0 0 2px rgba(22,20,15,.08), 0 18px 30px -20px rgba(22,20,15,.5); transform-origin: 50% 50%; }
.prize img { display: block; }
.prize b { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; }
.prize.top { background: #ffb21a; }
.prize.rare { background: #ffe7b0; }
.spark { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; opacity: 0; }
`;

function stripAmounts() {
  const amounts = [];
  for (let i = 0; i < WIN_INDEX + 8; i += 1) amounts.push(PATTERN[i % PATTERN.length]);
  amounts[WIN_INDEX] = "2";
  amounts[WIN_INDEX - 1] = "0,1";
  amounts[WIN_INDEX + 1] = "1";
  return amounts;
}

function prize(amount, index) {
  const tier = amount === "2" ? "top" : amount === "1" ? "rare" : "";
  return `<div class="prize ${tier}" data-index="${index}" style="left:${index * STEP}px;width:${CARD}px;height:176px"><img src="${starPng}" width="${CARD * 0.5}" height="${CARD * 0.5}"><b>${amount}</b></div>`;
}

function bannerHtml() {
  const cards = stripAmounts().map(prize).join("");
  const sparks = Array.from({ length: 12 }, (_, i) => `<img class="spark" data-spark="${i}" src="${starPng}">`).join("");
  return `
    <div class="brand" style="position:absolute;left:72px;top:58px;font-size:62px">ZUBA RUBA</div>
    <div style="position:absolute;left:74px;top:142px;font-size:29px;color:#6c665b">Задания · Кейсы · Подарки Telegram</div>
    <div style="position:absolute;left:74px;top:196px;display:flex;gap:12px">
      <span style="padding:10px 18px;border-radius:22px;background:#16140f;color:#f6f2e8;font-size:24px;font-weight:600">Кейс за каждое задание</span>
      <span style="padding:10px 18px;border-radius:22px;background:#ffb21a;color:#2b1d00;font-size:24px;font-weight:600;display:inline-flex;align-items:center;gap:6px">Вывод от 15 <img src="${starPng}" width="26" height="26"></span>
    </div>
    <div class="lottie" data-src="${GIFTS.trophy}" style="left:900px;top:26px;width:210px;height:210px"></div>
    <div class="lottie" data-src="${GIFTS.bear}" style="left:1060px;top:146px;width:150px;height:150px"></div>
    <div class="lottie" data-src="${GIFTS.rose}" style="left:820px;top:166px;width:120px;height:120px"></div>
    <div style="position:absolute;left:0;right:0;top:330px;bottom:0;background:#e9e5da"></div>
    <div id="track" style="position:absolute;left:0;top:380px;height:176px;width:${(WIN_INDEX + 8) * STEP}px">${cards}</div>
    <div style="position:absolute;left:631px;top:346px;width:0;height:0;border-left:18px solid transparent;border-right:18px solid transparent;border-top:26px solid #ffb21a;margin-left:-9px"></div>
    <div style="position:absolute;left:631px;top:572px;width:0;height:0;border-left:18px solid transparent;border-right:18px solid transparent;border-bottom:26px solid #ffb21a;margin-left:-9px"></div>
    ${sparks}
    <div id="win" style="position:absolute;left:50%;top:618px;transform:translate(-50%,40px);opacity:0;display:flex;align-items:center;gap:12px;padding:12px 26px;border-radius:34px;background:#16140f;color:#f6f2e8;font-size:34px;font-weight:700;white-space:nowrap">
      Выпало <span style="color:#ffb21a;display:inline-flex;align-items:center;gap:6px">+2 <img src="${starPng}" width="36" height="36"></span>
    </div>
  `;
}

function avatarHtml() {
  return `
    <div style="position:absolute;inset:0;background:#ffb21a"></div>
    <div class="prize rare" style="left:250px;top:140px;width:270px;height:350px;border-radius:48px;transform:rotate(12deg)">
      <img src="${starPng}" width="120" height="120" style="opacity:.55">
    </div>
    <div class="prize" style="left:140px;top:128px;width:290px;height:370px;border-radius:50px;transform:rotate(-7deg);gap:20px">
      <img src="${starPng}" width="186" height="186"><b class="brand" style="font-size:50px;font-family:Unbounded">ZR</b>
    </div>
  `;
}

async function loadLottie(page) {
  const ids = await page.$$eval(".lottie", (nodes) => [...new Set(nodes.map((n) => n.dataset.src))]);
  const data = Object.fromEntries(ids.map((id) => [id, JSON.parse(fs.readFileSync(path.join(pub, "gifts", `${id}.json`), "utf8"))]));
  await page.addScriptTag({ content: lottieSource });
  await page.evaluate((animations) => {
    window.anims = [...document.querySelectorAll(".lottie")].map((node) =>
      window.lottie.loadAnimation({ container: node, renderer: "svg", loop: true, autoplay: false, animationData: animations[node.dataset.src] }),
    );
  }, data);
}

function sceneScript() {
  window.renderFrame = ({ t, step, card, startIndex, winIndex, timeline }) => {
    const center = 640;
    const offsetFor = (index) => center - (index * step + card / 2);
    const from = offsetFor(startIndex);
    const to = offsetFor(winIndex);
    const drift = 40;
    let offset;
    if (t < timeline.spinStart) {
      offset = from - t * drift;
    } else if (t < timeline.spinEnd) {
      const p = (t - timeline.spinStart) / (timeline.spinEnd - timeline.spinStart);
      const start = from - timeline.spinStart * drift;
      offset = start + (to - start) * (1 - Math.pow(1 - p, 4));
    } else {
      offset = to;
    }
    document.getElementById("track").style.transform = `translateX(${offset}px)`;

    const sinceWin = t - timeline.spinEnd;
    const won = document.querySelector(`.prize[data-index="${winIndex}"]`);
    document.querySelectorAll("#track .prize").forEach((node) => {
      node.style.opacity = sinceWin > 0 && node !== won ? String(Math.max(0.45, 1 - sinceWin * 2)) : "1";
    });
    if (sinceWin > 0) {
      const pop = Math.min(sinceWin / 0.35, 1);
      const scale = pop < 1 ? 1 + 0.2 * Math.sin(pop * Math.PI * 0.75) : 1.12;
      won.style.transform = `scale(${scale})`;
      won.style.boxShadow = `0 0 0 6px #16140f, 0 0 0 ${10 + Math.sin(sinceWin * 6) * 2}px rgba(255,178,26,.55), 0 24px 40px -18px rgba(22,20,15,.6)`;
      won.style.zIndex = "2";
    } else {
      won.style.transform = "scale(1)";
      won.style.boxShadow = "";
    }

    document.querySelectorAll(".spark").forEach((node, i) => {
      if (sinceWin <= 0 || sinceWin > timeline.burst) {
        node.style.opacity = "0";
        return;
      }
      const p = sinceWin / timeline.burst;
      const angle = (i / 12) * Math.PI * 2 + 0.3;
      const radius = 70 + 230 * (1 - Math.pow(1 - p, 2));
      node.style.left = `${center + Math.cos(angle) * radius}px`;
      node.style.top = `${468 + Math.sin(angle) * radius * 0.62}px`;
      node.style.opacity = String(1 - p);
      node.style.transform = `rotate(${p * 220 * (i % 2 ? 1 : -1)}deg) scale(${1.2 - p * 0.5})`;
    });

    const chip = document.getElementById("win");
    const chipP = Math.max(0, Math.min((sinceWin - 0.25) / 0.35, 1));
    chip.style.opacity = String(chipP);
    chip.style.transform = `translate(-50%, ${(1 - chipP) * 40}px)`;

    window.anims.forEach((a) => a.goToAndStop(Math.round(t * 60) % a.totalFrames, true));
  };
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
  await page.setContent(`<!doctype html><html><head><style>${base}</style></head><body>${bannerHtml()}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await loadLottie(page);
  await page.evaluate(sceneScript);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zr-frames-"));
  const total = FPS * SECONDS;
  const still = Math.round((TIMELINE.spinEnd + 1.2) * FPS);
  for (let frame = 0; frame < total; frame += 1) {
    await page.evaluate((params) => window.renderFrame(params), {
      t: frame / FPS,
      step: STEP,
      card: CARD,
      startIndex: START_INDEX,
      winIndex: WIN_INDEX,
      timeline: TIMELINE,
    });
    const file = path.join(tmp, `f${String(frame).padStart(4, "0")}.png`);
    await page.screenshot({ path: file });
    if (frame === still) fs.copyFileSync(file, path.join(brandDir, "banner.png"));
  }
  await browser.close();

  const video = path.join(brandDir, "banner.mp4");
  const encode = ["-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(tmp, "f%04d.png"), ...encode, "-crf", "24", video]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(brandDir, "banner.png"), "-vf", "scale=640:360", path.join(brandDir, "description.png")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "scale=640:360", ...encode, "-crf", "26", path.join(brandDir, "description.mp4")]);
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
