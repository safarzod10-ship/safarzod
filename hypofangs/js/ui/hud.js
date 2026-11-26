// HUD.cs: top bar (room, targets, knives, held item, timer), boss bar, flash text, centre text, glitch noise, fade, vignette, scanlines.
import { Time, Mathf, Random } from "../engine/core.js";
import { UI, rgba } from "./draw.js";
import { G, GA, GameClock } from "../game/common.js";
import { InputPrompts } from "../game/prompts.js";

const PINK = "rgba(255,64,179,0.85)", CYAN = "rgba(77,242,255,0.85)";
const GLITCHY = [[PINK, 2, 0], [CYAN, -2, 0]];
const NAVY = "#000080", INK = "rgb(24,24,28)";

export class HUD {
  constructor() { this.reset(); }
  reset() {
    this.room = ""; this.enemies = -1; this.knives = 0; this.maxKnives = 3; this.held = false; this.timer = 1;
    this.flashMsg = ""; this.flashT = 0; this.flashDur = 0; this.flashJitter = 0;
    this.centerTitle = ""; this.centerSub = ""; this.titleJitter = 0;
    this.boss = null; this.bossHp = 0; this.bossMax = 1; this.lastBossHp = -1; this.bossShake = 0; this.bossJitter = 0;
    this.glitchT = 0; this.fade = 1; this.fadeTarget = null; this.fadeCo = null; this.visible = true; this.bossOverlay = 0; this.noise = null;
    this.topBar = true;
  }
  build() { this.reset(); }
  setRoom(level, name, i, count) { this.room = `${i + 1}/${count}  ${name}`; }
  setBossOverlay(lv) { this.bossOverlay = lv; }
  setEnemies(n) { this.enemies = n; }
  setBoss(name, hp, max) {
    const on = !!name && hp > 0;
    if (!on) { this.boss = null; this.lastBossHp = -1; return; }
    if (hp !== this.lastBossHp) { if (this.lastBossHp > 0) this.bossShake = 0.25; this.lastBossHp = hp; }
    this.boss = name; this.bossHp = hp; this.bossMax = max;
  }
  setKnives(n, max) { this.knives = n; this.maxKnives = max; }
  setTimer(k) { this.timer = Mathf.clamp01(k); }
  setHeld(item) { this.held = !!item; }
  clearFlash() { this.flashT = 0; this.flashDur = 0; this.flashMsg = ""; }
  flash(msg, d) { this.flashMsg = msg; this.flashT = d; this.flashDur = d; }
  showCenter(t, s) { this.centerTitle = t; this.centerSub = s; this.glitch(0.15); }
  setCenterSubtitle(s) { this.centerSub = s; }
  hideCenter() { this.centerTitle = ""; this.centerSub = ""; }
  glitch(s) { this.glitchT = Math.max(this.glitchT, s); }
  fadeIn(t) { if (this.fadeCo) this.fadeCo.dead = true; this.fadeCo = G.runtime.startCoroutine(this.fadeTo(0, t), null); }
  *fadeOut(t) { if (this.fadeCo) this.fadeCo.dead = true; yield* this.fadeTo(1, t); }
  *fadeTo(a, dur) {
    const start = this.fade;
    let t = 0;
    while (t < dur) { t += GameClock.UnscaledDt; this.fade = Mathf.lerp(start, a, t / dur); yield; }
    this.fade = a;
  }
  tick() {
    const dt = GameClock.UnscaledDt;
    if (this.flashT > 0) { this.flashT -= dt; this.flashJitter = this.flashDur - this.flashT < 0.1 ? Random.range(-3, 3) : 0; }
    else if (this.flashMsg) this.flashMsg = "";
    this.titleJitter = Random.value() < 0.04 ? Random.range(-4, 4) : 0;
    this.bossShake -= dt;
    this.bossJitter = this.bossShake > 0 ? Random.range(-4, 4) : 0;
    if (this.glitchT > 0) this.glitchT -= dt;
  }
  draw(ctx) {
    const W = UI.W, H = UI.H;
    // vignette + scanlines
    if (GA.vignette) UI.sprite(GA.vignette, 0, 0, W, H, 0.85);
    if (GA.scanline && GA.scanline.loaded) {
      if (!this.scanPat || this.scanPatS !== UI.s) {
        const sp = GA.scanline, cv = document.createElement("canvas");
        // uvRect (0,0,160,180): the texture repeats 160 x 180 times across the screen
        const tw = Math.max(1, Math.round(W * UI.s / 160)), th = Math.max(1, Math.round(H * UI.s / 180));
        cv.width = tw; cv.height = th;
        const c = cv.getContext("2d"); c.imageSmoothingEnabled = false;
        c.drawImage(sp.pageObj.img, sp.x, sp.y, sp.w, sp.h, 0, 0, tw, th);
        this.scanPat = ctx.createPattern(cv, "repeat"); this.scanPatS = UI.s;
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.55; ctx.fillStyle = this.scanPat; ctx.fillRect(0, 0, W * UI.s, H * UI.s); ctx.restore();
    }
    if (this.topBar) this.drawTopBar(W);
    if (this.boss) this.drawBoss(W, H);
    if (this.flashMsg) {
      const a = Mathf.clamp01(this.flashT / Math.min(0.4, this.flashDur));
      UI.textTop(this.flashMsg, W / 2 + this.flashJitter, 44, 24, "#fff", 1, "RetroWindows", a, GLITCHY);
    }
    if (this.centerTitle) UI.text(this.centerTitle, W / 2 + this.titleJitter, H / 2 - 30, 32, "#fff", 1, "RetroWindows", 1, GLITCHY);
    if (this.centerSub) UI.textTop(this.centerSub, W / 2, H / 2, 16, "rgba(255,255,255,0.85)", 1);
    if (this.glitchT > 0) this.drawNoise(ctx, W, H);
    const lm = G.level;
    if (lm && !G.paused && !G.tutorialActive) {
      const hint = lm.player.Dead ? InputPrompts.Retry : G.previewing || lm.laserPreviewPlaying ? InputPrompts.Accept + " Skip preview" : lm.bossFarewellPlaying ? InputPrompts.Accept + " Continue" : "";
      if (hint) UI.text(hint, W - 8, H - 16, 8, "#fff", 2);
      if (lm.RoomTime < 5) UI.text(InputPrompts.DeviceName + (G.touch ? "" : "  |  Controller recommended"), W - 8, H - 34, 8, "#fff", 2);
    }
    if (this.fade > 0.001) UI.rect(0, 0, W, H, `rgba(0,0,0,${this.fade})`);
  }
  drawTopBar(W) {
    UI.slice("Window_Base", 0, 0, W, 28);
    UI.rect(5, 4, 222, 20, NAVY);
    let size = 12;
    while (size > 10 && UI.measure(this.room, size) > 220) size--;
    UI.text(this.room, 10, 14, size, "#fff", 0);
    if (this.enemies >= 0) UI.text(this.enemies > 0 ? `<color=#800000>TARGETS ${this.enemies}</color>` : "<color=#006040>CLEAR-GO</color>", 238, 14, 12, INK, 0);
    UI.text(`KNIVES <color=#000080>${"|".repeat(this.knives)}</color><color=#808080>${"|".repeat(Math.max(0, this.maxKnives - this.knives))}</color>`, W - 196, 14, 12, INK, 2);
    // item box
    UI.slice("Windows_Inner_Frame", W - 30, 3, 22, 22, 0.9);
    UI.rect(W - 28, 5, 18, 18, "#fff");
    if (this.held && GA.kunai) {
      const s = GA.kunai, k = Math.min(16 / s.w, 16 / s.h);
      UI.sprite(s, W - 19 - s.w * k / 2, 14 - s.h * k / 2, s.w * k, s.h * k, 1, 35);
    }
    // timer
    const x = W - 40 - 150, y = 8;
    UI.slice("Windows_Inner_Frame", x, y, 150, 12, 0.9);
    UI.rect(x + 2, y + 2, 146, 8, "rgb(236,236,232)");
    const k = this.timer;
    const fc = k < 0.25 ? lerpCol([1, 0.2, 0.3], [1, 1, 1], Mathf.pingPong(Time.unscaledTime * 6, 1)) : NAVY;
    UI.rect(x + 2, y + 2, 146 * k, 8, fc);
  }
  drawBoss(W, H) {
    const bw = 330, x = W / 2 - bw / 2 + this.bossJitter, y = H - 14 - 34;
    const bars = "|".repeat(this.bossHp) + ".".repeat(Math.max(0, this.bossMax - this.bossHp));
    UI.text(this.boss + "   " + bars, x + bw / 2, y - 6 + 10, 16, "rgb(255,89,128)", 1);
    UI.slice("Windows_Inner_Frame", x, y + 22, bw, 12, 0.9);
    UI.rect(x + 2, y + 24, bw - 4, 8, "rgb(40,40,48)");
    const k = Mathf.clamp01(this.bossHp / Math.max(1, this.bossMax));
    const c = this.bossShake > 0 ? "#fff" : k < 0.3 ? lerpCol([1, 0.2, 0.35], [1, 0.8, 0.3], Mathf.pingPong(Time.unscaledTime * 4, 1)) : "rgb(255,51,89)";
    UI.rect(x + 2, y + 24, (bw - 4) * k, 8, c);
  }
  drawNoise(ctx, W, H) {
    if (!this.noise) { this.noise = document.createElement("canvas"); this.noise.width = 160; this.noise.height = 90; }
    const c = this.noise.getContext("2d");
    const img = c.createImageData(160, 90);
    const band = Random.rangeInt(0, 90);
    for (let j = 0; j < 90; j++) {
      const inBand = Math.abs(j - band) < 6;
      for (let k = 0; k < 160; k++) {
        const o = (j * 160 + k) * 4, b = Random.rangeInt(0, 255);
        img.data[o] = img.data[o + 1] = img.data[o + 2] = b;
        img.data[o + 3] = inBand ? 140 : Random.value() < 0.15 ? 60 : 0;
      }
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(this.noise, 0, 0, W, H);
  }
}

function lerpCol(a, b, t) { return `rgb(${[0, 1, 2].map((i) => Math.round((a[i] + (b[i] - a[i]) * t) * 255)).join(",")})`; }
