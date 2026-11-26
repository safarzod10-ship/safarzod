// Boot, main loop and scene switching.
import { Time, Runtime, Mathf } from "./engine/core.js";
import { Assets } from "./engine/assets.js";
import { Audio } from "./engine/audio.js";
import { Input } from "./engine/input.js";
import { Renderer } from "./engine/gl.js";
import { buildScene, Renderers, Lights, Camera } from "./engine/scene.js";
import { Physics, stepBodies, triggerPass } from "./engine/physics.js";
import { drawWorld, collectLights, cameraView } from "./engine/render.js";
import { G, GA, initGameAssets, TimeFX, Music, CameraRig } from "./game/common.js";
import "./game/player.js";
import { Enemies } from "./game/enemy.js";
import { Pickups, Hints, Lasers, Bullets, ThrownList } from "./game/world.js";
import "./game/levelmanager.js";
import "./game/prologue.js";
import { HUD } from "./ui/hud.js";
import { UI } from "./ui/draw.js";
import { Overlays } from "./ui/overlays.js";
import { Touch } from "./ui/touch.js";

const glCanvas = document.getElementById("gl");
const uiCanvas = document.getElementById("ui");
const stage = document.getElementById("stage");
const loading = document.getElementById("loading");
let R, uiCtx;
let acc = 0, last = 0;
let sceneReady = false;
let loadingScene = null;

G.runtime = Runtime;
window.__hypo = G;

function safeInsets() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const z = { top: 0, bottom: 0, left: 0, right: 0 };
  if (!tg || !tg.initData) return z;
  const a = tg.safeAreaInset || z, c = tg.contentSafeAreaInset || z;
  return { top: (a.top || 0) + (c.top || 0), bottom: (a.bottom || 0) + (c.bottom || 0), left: (a.left || 0) + (c.left || 0), right: (a.right || 0) + (c.right || 0) };
}

function resize() {
  const ins = safeInsets();
  const vw = window.innerWidth, vh = window.innerHeight;
  const aw = Math.max(1, vw - ins.left - ins.right), ah = Math.max(1, vh - ins.top - ins.bottom);
  let w = aw, h = aw * 9 / 16;
  if (h > ah) { h = ah; w = ah * 16 / 9; }
  stage.style.width = w + "px"; stage.style.height = h + "px";
  stage.style.left = ins.left + (aw - w) / 2 + "px"; stage.style.top = ins.top + (ah - h) / 2 + "px";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.min(Math.round(w * dpr), 1920), ph = Math.round(pw * 9 / 16);
  if (glCanvas.width !== pw || glCanvas.height !== ph) for (const c of [glCanvas, uiCanvas]) { c.width = pw; c.height = ph; }
  G.viewW = pw; G.viewH = ph; G.cssW = w; G.cssH = h;
  checkRotation();
  Touch.layout();
}

function checkRotation() {
  const portrait = window.innerHeight > window.innerWidth;
  document.getElementById("rotate").classList.toggle("on", !!G.touch && portrait);
  // Telegram locks the current orientation, so lock only once the phone is held in landscape
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData && !portrait && tg.lockOrientation && !G.orientationLocked) { try { tg.lockOrientation(); G.orientationLocked = true; } catch (e) { } }
}

function clearSceneState() {
  Runtime.reset();
  Physics.reset();
  Renderers.clear(); Lights.clear();
  for (const l of [Enemies, Pickups, Hints, Lasers, Bullets, ThrownList]) l.length = 0;
  Camera._main = null; CameraRig.I = null;
  TimeFX.reset();
  G.level = null; G.prologue = null; G.akari = null; G.tutorialActive = false;
  G.frozen = G.inputLocked = G.paused = G.previewing = false;
}

export async function loadScene(name) {
  loadingScene = name;
  sceneReady = false;
  G.sceneName = name;
  const data = await Assets.loadJSON("data/" + name + ".json");
  await Assets.loadForScene(data, name === "level1" ? ["core"] : ["core", "level0"]);
  if (loadingScene !== name) return;
  clearSceneState();
  G.hud.reset();
  buildScene(data, null, (nodes) => (G.sceneNodes = nodes));
  sceneReady = true;
}
G.loadScene = (n) => loadScene(n);

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  Time.unscaledDeltaTime = realDt;
  Time.unscaledTime += realDt;
  Input.beginFrame();
  Touch.update();
  if (sceneReady) {
    const dt = realDt * Time.timeScale;
    Time.deltaTime = dt;
    Time.time += dt;
    Runtime.runStarts();
    acc += dt;
    let steps = 0;
    while (acc >= Time.fixedDeltaTime && steps < 5) {
      const keep = Time.deltaTime;
      Time.deltaTime = Time.fixedDeltaTime; Time.inFixed = true;
      Runtime.each("fixedUpdate");
      stepBodies(Time.fixedDeltaTime);
      triggerPass();
      Time.deltaTime = keep; Time.inFixed = false;
      acc -= Time.fixedDeltaTime;
      steps++;
    }
    if (steps >= 5) acc = 0;
    const alpha = acc / Time.fixedDeltaTime;
    for (const b of Physics.bodies) {
      if (!b.interpolate) continue;
      const p = b.node.position;
      b.interp = { x: (b.prevX - p.x) * (1 - alpha), y: (b.prevY - p.y) * (1 - alpha) };
      if (Math.abs(b.interp.x) > 1 || Math.abs(b.interp.y) > 1) b.interp = null;
    }
    Runtime.each("update");
    Runtime.tickCoroutines();
    Runtime.runStarts();
    Runtime.each("lateUpdate");
    Overlays.update();
    Music.tick();
    G.hud.tick();
    TimeFX.tick();
    Runtime.flushDestroy();
    render();
  } else {
    Runtime.tickCoroutines();
    renderLoading();
  }
  Time.frameCount++;
}

function render() {
  const view = cameraView();
  if (!view) return;
  const cam = view.cam;
  const { global, lights } = collectLights(view);
  const g = global ? [global.color.r * global.intensity, global.color.g * global.intensity, global.color.b * global.intensity] : [1, 1, 1];
  R.lightPass(view, g, lights);
  const bg = cam.backgroundColor;
  R.begin(view, [bg.r, bg.g, bg.b]);
  drawWorld(R, view, true);
  R.end();
  UI.begin(uiCtx, uiCanvas.width, uiCanvas.height);
  if (G.level) G.hud.draw(uiCtx);
  Overlays.draw(uiCtx);
  Touch.draw(uiCtx);
}

function renderLoading() {
  if (!R) return;
  R.begin({ x: 0, y: 0, halfW: 1, halfH: 1 }, [0, 0, 0]);
  R.end();
  if (uiCtx) { UI.begin(uiCtx, uiCanvas.width, uiCanvas.height); Overlays.draw(uiCtx); }
}

async function waitForTelegram() {
  for (let i = 0; i < 30 && !(window.Telegram && window.Telegram.WebApp); i++) await new Promise((r) => setTimeout(r, 50));
}

function initTelegram() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if (coarse) G.touch = true;
  if (tg && tg.initData) {
    try {
      tg.ready(); tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.setHeaderColor) tg.setHeaderColor("#000000");
      if (tg.setBackgroundColor) tg.setBackgroundColor("#000000");
      if (tg.setBottomBarColor) tg.setBottomBarColor("#000000");
      if (tg.requestFullscreen) tg.requestFullscreen();
      if (tg.platform === "android" || tg.platform === "ios") G.touch = true;
      for (const ev of ["viewportChanged", "fullscreenChanged", "fullscreenFailed", "safeAreaChanged", "contentSafeAreaChanged"]) tg.onEvent(ev, () => resize());
    } catch (e) { }
    return;
  }
  // plain browser: fullscreen + landscape lock on the first touch
  const goFull = () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try {
        const p = req.call(el, { navigationUI: "hide" });
        const lock = () => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => { }); };
        if (p && p.then) p.then(lock).catch(() => { }); else lock();
      } catch (e) { }
    }
  };
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") goFull(); }, { capture: true });
}

async function boot() {
  try {
    R = new Renderer(glCanvas);
  } catch (e) {
    loading.textContent = "WebGL is not available on this device.";
    return;
  }
  uiCtx = uiCanvas.getContext("2d");
  G.renderer = R;
  await waitForTelegram();
  initTelegram();
  Audio.init();
  Input.init(stage);
  Touch.init(stage);
  resize();
  window.addEventListener("resize", resize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  document.addEventListener("fullscreenchange", resize);
  await Assets.init(R);
  const [assetsJson] = await Promise.all([Assets.loadJSON("data/assets.json"), document.fonts ? Promise.all([document.fonts.load("12px RetroWindows"), document.fonts.load("12px BoldPixels"), document.fonts.load("12px Pixels")]).catch(() => { }) : null]);
  await Assets.loadGroup("core");
  initGameAssets(assetsJson);
  G.hud = new HUD();
  loading.style.display = "none";
  requestAnimationFrame((t) => { last = t; frame(t); });
  const params = new URLSearchParams(location.search);
  const start = params.get("scene");
  if (params.has("room")) { G.roomIndex = parseInt(params.get("room"), 10) || 0; }
  Overlays.boot(start);
}

boot();
