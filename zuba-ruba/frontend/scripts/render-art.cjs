const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const pub = path.join(root, "public");
const lottieSource = fs.readFileSync(path.join(root, "node_modules/lottie-web/build/player/lottie_light.min.js"), "utf8");
const font = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, "assets", "fonts", file)).toString("base64")}`;

const GIFTS = {
  bear: "5170233102089322756",
  heart: "5170145012310081615",
  rose: "5168103777563050263",
  rocket: "5170564780938756245",
  trophy: "5168043875654172773",
  diamond: "5170521118301225164",
};

const base = `
@font-face { font-family: Unbounded; src: url(${font("unbounded-cyrillic.woff2")}) format("woff2"); unicode-range: U+0400-045F; font-weight: 400 900; }
@font-face { font-family: Unbounded; src: url(${font("unbounded-latin.woff2")}) format("woff2"); font-weight: 400 900; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
body { width: 360px; height: 300px; position: relative; overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #16140f; }
.lottie { position: absolute; }
.num { font-family: Unbounded, sans-serif; font-weight: 800; letter-spacing: -0.02em; }
.card { position: absolute; background: #fffdf8; border-radius: 18px; box-shadow: 0 0 0 1px rgba(22,20,15,.1), 0 18px 30px -18px rgba(22,20,15,.55); }
.ink { background: var(--ink); color: #f6f2e8; }
.gold { background: #ffb21a; }
`;

const star = (x, y, size, frame = 0, rotate = 0) =>
  `<div class="lottie" data-src="star" data-frame="${frame}" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;transform:rotate(${rotate}deg)"></div>`;
const gift = (name, x, y, size, frame = 0) =>
  `<div class="lottie" data-src="${GIFTS[name]}" data-frame="${frame}" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px"></div>`;

const prizeCard = (x, y, w, h, amount, rotate, highlight) => `
  <div class="card ${highlight ? "" : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rotate}deg);${highlight ? "box-shadow:0 0 0 3px #ffb21a, 0 22px 34px -18px rgba(22,20,15,.6)" : ""}">
    ${star(w / 2 - w * 0.29, h * 0.14, w * 0.58)}
    <div class="num" style="position:absolute;left:0;right:0;bottom:${h * 0.13}px;text-align:center;font-size:${w * 0.22}px">${amount}</div>
  </div>`;

const scenes = {
  "onboarding-1": `
    <div class="gold" style="position:absolute;left:40px;top:28px;width:280px;height:244px;border-radius:120px 120px 28px 28px"></div>
    ${prizeCard(38, 92, 92, 112, "0,2", -10, false)}
    ${prizeCard(230, 92, 92, 112, "0,5", 10, false)}
    ${prizeCard(122, 64, 116, 142, "2", 0, true)}
    <div style="position:absolute;left:170px;top:36px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:16px solid var(--ink)"></div>
    <div style="position:absolute;left:179px;top:214px;width:2px;height:22px;background:var(--ink);border-radius:2px"></div>
    <div class="card ink num" style="left:122px;top:236px;width:116px;height:38px;border-radius:19px;display:flex;align-items:center;justify-content:center;gap:4px;font-size:15px;color:#ffb21a">+2 <span style="position:relative;width:22px;height:22px">${star(0, 0, 22)}</span></div>
    ${star(18, 30, 30, 0, -18)}
    ${star(316, 214, 26, 0, 14)}
  `,
  "onboarding-2": `
    <div class="ink" style="position:absolute;left:52px;top:24px;width:256px;height:256px;border-radius:50%"></div>
    ${taskRow(40, 40, -4, "channel", "Дизайн-канал", "Подписка", false)}
    ${taskRow(56, 120, 3, "bot", "Погодный бот", "Запуск бота", true)}
    ${taskRow(36, 200, -2, "boost", "Новости IT", "Буст канала", false)}
    ${star(300, 26, 34, 0, 12)}
  `,
  "onboarding-3": `
    <div class="gold" style="position:absolute;left:96px;top:34px;width:168px;height:168px;border-radius:50%"></div>
    <div class="ink" style="position:absolute;left:24px;top:196px;width:312px;height:20px;border-radius:10px"></div>
    ${gift("trophy", 112, 42, 136, 40)}
    ${gift("bear", 20, 104, 96, 30)}
    ${gift("rose", 250, 108, 90, 60)}
    ${priceTag(36, 222, "15")}
    ${priceTag(150, 222, "100")}
    ${priceTag(260, 222, "25")}
    ${star(300, 20, 28, 0, -10)}
    ${star(28, 40, 22, 0, 16)}
  `,
};

function taskRow(x, y, rotate, kind, title, label, done) {
  const icons = {
    channel: '<path d="M5 12.5 19 6l-3 13-4.5-4-2 3v-4.5L19 6" fill="none" stroke="#16140f" stroke-width="2" stroke-linejoin="round"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="#16140f" stroke-width="2"/><circle cx="9.5" cy="13.5" r="1.5" fill="#16140f"/><circle cx="14.5" cy="13.5" r="1.5" fill="#16140f"/><path d="M12 8V5" stroke="#16140f" stroke-width="2" stroke-linecap="round"/>',
    boost: '<path d="M13 3 6 14h5l-1 7 7-11h-5l1-7Z" fill="none" stroke="#16140f" stroke-width="2" stroke-linejoin="round"/>',
  };
  return `
  <div class="card" style="left:${x}px;top:${y}px;width:268px;height:64px;transform:rotate(${rotate}deg);display:flex;align-items:center;gap:12px;padding:0 12px">
    <div style="width:40px;height:40px;border-radius:12px;background:#ffe7b0;display:flex;align-items:center;justify-content:center"><svg width="24" height="24" viewBox="0 0 24 24">${icons[kind]}</svg></div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:14px">${title}</div>
      <div style="font-size:12px;color:#6c665b;margin-top:2px">${label}</div>
    </div>
    ${
      done
        ? '<div class="num" style="font-size:10px;color:#1d7a45;border:2px solid #1d7a45;border-radius:8px;padding:5px 7px;transform:rotate(-8deg)">ГОТОВО</div>'
        : '<div style="width:68px;height:30px;border-radius:9px;background:#16140f;color:#f6f2e8;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">Перейти</div>'
    }
  </div>`;
}

function priceTag(x, y, value) {
  return `<div class="card num" style="left:${x}px;top:${y}px;height:34px;padding:0 12px 0 34px;border-radius:17px;display:flex;align-items:center;font-size:14px">${star(8, 6, 22)}${value}</div>`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 300 }, deviceScaleFactor: 2 });
  const data = {};
  const load = (id) => {
    if (!data[id]) {
      const file = id === "star" ? path.join(__dirname, "assets/star.json") : path.join(pub, "gifts", `${id}.json`);
      data[id] = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    return data[id];
  };
  const themes = { light: "#16140f", dark: "#3a352c" };
  const targets = [];
  for (const [name, body] of Object.entries(scenes)) {
    targets.push([name, body, themes.light]);
    targets.push([`${name}-dark`, body, themes.dark]);
  }
  targets.push(["star", `<div class="lottie" data-src="star" data-frame="0" style="left:0;top:0;width:160px;height:160px"></div>`, themes.light]);
  for (const [name, body, ink] of targets) {
    const size = name === "star" ? { width: 160, height: 160 } : { width: 360, height: 300 };
    await page.setViewportSize(size);
    await page.setContent(`<!doctype html><html><head><style>:root{--ink:${ink}} ${base} body{width:${size.width}px;height:${size.height}px}</style></head><body>${body}</body></html>`);
    await page.addScriptTag({ content: lottieSource });
    const ids = await page.$$eval(".lottie", (nodes) => [...new Set(nodes.map((n) => n.dataset.src))]);
    const payload = Object.fromEntries(ids.map((id) => [id, load(id)]));
    await page.evaluate((animations) => {
      document.querySelectorAll(".lottie").forEach((node) => {
        const anim = window.lottie.loadAnimation({ container: node, renderer: "svg", loop: false, autoplay: false, animationData: animations[node.dataset.src] });
        anim.goToAndStop(Number(node.dataset.frame), true);
      });
    }, payload);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const png = path.join(pub, "img", `${name}.png`);
    await page.screenshot({ path: png, omitBackground: true, scale: name === "star" ? "css" : "device" });
    if (name === "star") {
      console.log("rendered", path.relative(root, png));
      continue;
    }
    const webp = path.join(pub, "img", `${name}.webp`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-c:v", "libwebp", "-quality", "82", "-pix_fmt", "yuva420p", webp]);
    fs.rmSync(png);
    console.log("rendered", path.relative(root, webp));
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
