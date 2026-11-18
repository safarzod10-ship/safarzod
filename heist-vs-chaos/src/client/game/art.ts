// Procedural art: every sprite is painted once with Canvas2D (soft gradients, paper drop-shadows,
// stitched seams) and registered as a Phaser texture. Keeps the look cohesive and the runtime cheap.
import type Phaser from 'phaser';
import { C } from './palette.js';
import type { ExhibitShape } from '../../shared/types.js';

export type Ctx2 = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx2] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return [c, ctx];
}

export function rr(ctx: Ctx2, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** Paper cut-out drop shadow. */
export function shadow(ctx: Ctx2, blur = 10, dy = 5, alpha = 0.28): void {
  ctx.shadowColor = `rgba(40,52,46,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = dy;
}
export function noShadow(ctx: Ctx2): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

export function radial(ctx: Ctx2, x: number, y: number, r: number, inner: string, outer: string): CanvasGradient {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  return g;
}

export function linear(ctx: Ctx2, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

/** Stitched seam: short dashes, like a plush toy. */
export function stitches(ctx: Ctx2, path: () => void, color: string, width = 2): void {
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  path();
  ctx.stroke();
  ctx.restore();
}

let grain: CanvasPattern | null = null;
export function paperGrain(ctx: Ctx2): CanvasPattern {
  if (grain) return grain;
  const [c, g] = canvas(160, 160);
  const img = g.createImageData(160, 160);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd();
    const dark = v < 0.5;
    img.data[i] = dark ? 60 : 255;
    img.data[i + 1] = dark ? 70 : 250;
    img.data[i + 2] = dark ? 60 : 235;
    img.data[i + 3] = Math.floor(rnd() * 22);
  }
  g.putImageData(img, 0, 0);
  // fibres
  g.globalAlpha = 0.06;
  g.strokeStyle = '#5a5040';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    const x = rnd() * 160;
    const y = rnd() * 160;
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 8);
    g.stroke();
  }
  grain = ctx.createPattern(c, 'repeat')!;
  return grain;
}

/** Slightly irregular "torn paper" polygon edge along a horizontal line. */
export function tornEdge(ctx: Ctx2, x0: number, x1: number, y: number, amp: number, seed: number): void {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.lineTo(x1, y);
  for (let x = x1; x >= x0; x -= 14) ctx.lineTo(x, y + (rnd() - 0.5) * amp);
  ctx.lineTo(x0, y);
}

// ------------------------------------------------------------------------------------------------
// Textures

type Painter = (ctx: Ctx2, w: number, h: number) => void;

export function addTex(scene: Phaser.Scene, key: string, w: number, h: number, paint: Painter): void {
  if (scene.textures.exists(key)) return;
  const [c, ctx] = canvas(w, h);
  paint(ctx, w, h);
  scene.textures.addCanvas(key, c);
}

export function makeTextures(scene: Phaser.Scene): void {
  // ----- robot (plush toy) -----
  addTex(scene, 'robot-body', 150, 120, (ctx) => {
    shadow(ctx, 12, 6, 0.3);
    rr(ctx, 15, 12, 120, 96, 44);
    ctx.fillStyle = radial(ctx, 75, 55, 90, '#FFF9EC', C.creamDeep);
    ctx.fill();
    noShadow(ctx);
    // belly patch
    rr(ctx, 48, 40, 54, 38, 14);
    ctx.fillStyle = radial(ctx, 75, 58, 40, C.mintLight, C.mint);
    ctx.fill();
    stitches(ctx, () => rr(ctx, 52, 44, 46, 30, 10), C.sageDark, 2);
    // seam
    stitches(ctx, () => { ctx.beginPath(); ctx.moveTo(30, 30); ctx.quadraticCurveTo(75, 20, 120, 30); }, C.creamShade, 2);
    // soft highlight
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(48, 32, 20, 9, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  addTex(scene, 'robot-head', 170, 130, (ctx) => {
    // antenna
    ctx.strokeStyle = C.sageDeep;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(85, 30);
    ctx.quadraticCurveTo(80, 16, 88, 8);
    ctx.stroke();
    shadow(ctx, 8, 3, 0.25);
    ctx.fillStyle = radial(ctx, 90, 9, 10, C.terracottaLight, C.terracotta);
    ctx.beginPath();
    ctx.arc(89, 9, 8, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.fillStyle = radial(ctx, 15, 75, 16, C.mintLight, C.sage);
    ctx.beginPath();
    ctx.ellipse(16, 76, 12, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(154, 76, 12, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    shadow(ctx, 14, 6, 0.3);
    rr(ctx, 14, 28, 142, 96, 46);
    ctx.fillStyle = radial(ctx, 85, 70, 105, '#DDEBD8', C.sage);
    ctx.fill();
    noShadow(ctx);
    // screen face
    rr(ctx, 36, 46, 98, 60, 26);
    ctx.fillStyle = linear(ctx, 0, 46, 0, 106, [[0, '#3B4B44'], [1, C.ink]]);
    ctx.fill();
    stitches(ctx, () => rr(ctx, 26, 37, 118, 78, 34), C.sageDark, 2);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fff';
    rr(ctx, 44, 50, 50, 10, 5);
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.ellipse(50, 44, 22, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // cheeks
    ctx.fillStyle = 'rgba(224,154,128,0.55)';
    ctx.beginPath();
    ctx.ellipse(30, 100, 9, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(140, 100, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const eyes = (key: string, draw: (ctx: Ctx2) => void) =>
    addTex(scene, key, 98, 60, (ctx) => {
      ctx.shadowColor = C.mintGlow;
      ctx.shadowBlur = 10;
      ctx.fillStyle = C.mintGlow;
      ctx.strokeStyle = C.mintGlow;
      ctx.lineWidth = 6;
      draw(ctx);
    });
  eyes('eyes-normal', (ctx) => {
    rr(ctx, 22, 16, 16, 26, 8);
    ctx.fill();
    rr(ctx, 60, 16, 16, 26, 8);
    ctx.fill();
  });
  eyes('eyes-blink', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(20, 32);
    ctx.lineTo(40, 32);
    ctx.moveTo(58, 32);
    ctx.lineTo(78, 32);
    ctx.stroke();
  });
  eyes('eyes-happy', (ctx) => {
    ctx.beginPath();
    ctx.arc(30, 36, 10, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(68, 36, 10, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  });
  eyes('eyes-scared', (ctx) => {
    ctx.beginPath();
    ctx.arc(30, 30, 9, 0, Math.PI * 2);
    ctx.arc(68, 30, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(30, 30, 4, 0, Math.PI * 2);
    ctx.arc(68, 30, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  eyes('eyes-hurt', (ctx) => {
    ctx.beginPath();
    for (const x of [30, 68]) {
      ctx.moveTo(x - 9, 21);
      ctx.lineTo(x + 9, 39);
      ctx.moveTo(x + 9, 21);
      ctx.lineTo(x - 9, 39);
    }
    ctx.stroke();
  });
  eyes('eyes-focus', (ctx) => {
    rr(ctx, 21, 26, 18, 13, 6);
    ctx.fill();
    rr(ctx, 59, 26, 18, 13, 6);
    ctx.fill();
  });
  addTex(scene, 'robot-leg', 34, 40, (ctx) => {
    shadow(ctx, 5, 3, 0.25);
    rr(ctx, 5, 2, 24, 34, 11);
    ctx.fillStyle = radial(ctx, 17, 15, 26, C.sage, C.sageDark);
    ctx.fill();
  });
  addTex(scene, 'robot-arm', 34, 48, (ctx) => {
    shadow(ctx, 5, 3, 0.25);
    rr(ctx, 6, 2, 22, 42, 11);
    ctx.fillStyle = radial(ctx, 15, 14, 30, '#FFF9EC', C.creamShade);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.mint;
    ctx.beginPath();
    ctx.arc(17, 36, 9, 0, Math.PI * 2);
    ctx.fill();
  });
  addTex(scene, 'ground-shadow', 140, 30, (ctx) => {
    const g = ctx.createRadialGradient(70, 15, 4, 70, 15, 68);
    g.addColorStop(0, 'rgba(40,52,46,0.35)');
    g.addColorStop(1, 'rgba(40,52,46,0)');
    ctx.fillStyle = g;
    ctx.scale(1, 0.22);
    ctx.beginPath();
    ctx.arc(70, 68, 68, 0, Math.PI * 2);
    ctx.fill();
  });

  // ----- guard (paper cut-out) -----
  const guard = (key: string, sleeping: boolean) =>
    addTex(scene, key, 130, 230, (ctx) => {
      shadow(ctx, 10, 5, 0.3);
      // legs
      ctx.fillStyle = C.sageDeep;
      rr(ctx, 42, 160, 20, 62, 8);
      ctx.fill();
      rr(ctx, 68, 160, 20, 62, 8);
      ctx.fill();
      ctx.fillStyle = C.ink;
      rr(ctx, 38, 212, 28, 14, 6);
      ctx.fill();
      rr(ctx, 64, 212, 30, 14, 6);
      ctx.fill();
      // body
      rr(ctx, 30, 82, 72, 92, 26);
      ctx.fillStyle = linear(ctx, 30, 0, 102, 0, [[0, '#4F6E5C'], [1, C.sageDeep]]);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = C.goldLight;
      for (const y of [102, 122, 142]) {
        ctx.beginPath();
        ctx.arc(66, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // belt
      ctx.fillStyle = C.ink;
      ctx.fillRect(32, 150, 68, 9);
      // arm with flashlight
      shadow(ctx, 6, 3, 0.25);
      ctx.fillStyle = '#4F6E5C';
      rr(ctx, 84, 96, 36, 18, 9);
      ctx.fill();
      ctx.fillStyle = C.ink;
      rr(ctx, 110, 92, 16, 24, 5);
      ctx.fill();
      // head
      ctx.fillStyle = radial(ctx, 66, 54, 34, '#F6DCC0', C.peach);
      ctx.beginPath();
      ctx.arc(66, 56, 30, 0, Math.PI * 2);
      ctx.fill();
      noShadow(ctx);
      // cap
      ctx.fillStyle = C.sageDeep;
      ctx.beginPath();
      ctx.moveTo(34, 44);
      ctx.quadraticCurveTo(66, 10, 98, 44);
      ctx.closePath();
      ctx.fill();
      rr(ctx, 60, 38, 50, 9, 4);
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(66, 30, 6, 0, Math.PI * 2);
      ctx.fill();
      // face
      ctx.fillStyle = C.ink;
      if (sleeping) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.ink;
        ctx.beginPath();
        ctx.arc(76, 58, 5, 0.1, Math.PI - 0.1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(78, 58, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // moustache
      ctx.fillStyle = C.woodDark;
      ctx.beginPath();
      ctx.ellipse(84, 70, 12, 5, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(224,154,128,0.6)';
      ctx.beginPath();
      ctx.arc(62, 68, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  guard('guard', false);
  guard('guard-sleep', true);
  addTex(scene, 'flash-cone', 420, 200, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 420, 0);
    g.addColorStop(0, 'rgba(255,236,170,0.75)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 92);
    ctx.lineTo(420, 0);
    ctx.lineTo(420, 200);
    ctx.lineTo(0, 108);
    ctx.closePath();
    ctx.fill();
  });

  // ----- museum cat -----
  addTex(scene, 'cat-sleep', 150, 90, (ctx) => {
    shadow(ctx, 8, 4, 0.25);
    ctx.fillStyle = C.terracottaLight;
    ctx.beginPath();
    ctx.ellipse(76, 58, 58, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(118, 54, 22, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    noShadow(ctx);
    ctx.beginPath();
    ctx.moveTo(104, 40);
    ctx.lineTo(108, 24);
    ctx.lineTo(118, 36);
    ctx.lineTo(128, 24);
    ctx.lineTo(134, 42);
    ctx.fill();
    ctx.strokeStyle = C.terracottaDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(110, 56);
    ctx.quadraticCurveTo(114, 60, 118, 56);
    ctx.moveTo(122, 56);
    ctx.quadraticCurveTo(126, 60, 130, 56);
    ctx.stroke();
    ctx.lineWidth = 9;
    ctx.strokeStyle = C.terracottaLight;
    ctx.beginPath();
    ctx.moveTo(22, 64);
    ctx.quadraticCurveTo(10, 84, 60, 84);
    ctx.stroke();
    ctx.fillStyle = C.cream;
    ctx.beginPath();
    ctx.ellipse(80, 72, 30, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  addTex(scene, 'cat-awake', 120, 150, (ctx) => {
    shadow(ctx, 8, 4, 0.25);
    ctx.fillStyle = C.terracottaLight;
    ctx.beginPath();
    ctx.ellipse(56, 104, 34, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(60, 52, 28, 0, Math.PI * 2);
    ctx.fill();
    noShadow(ctx);
    ctx.beginPath();
    ctx.moveTo(36, 40);
    ctx.lineTo(38, 14);
    ctx.lineTo(54, 30);
    ctx.lineTo(68, 28);
    ctx.lineTo(84, 12);
    ctx.lineTo(86, 42);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.beginPath();
    ctx.ellipse(58, 112, 18, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyes wide
    ctx.fillStyle = C.goldLight;
    ctx.beginPath();
    ctx.ellipse(50, 50, 7, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(72, 50, 7, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.ellipse(51, 51, 2.5, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(73, 51, 2.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.terracottaLight;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(84, 128);
    ctx.quadraticCurveTo(118, 120, 104, 80);
    ctx.stroke();
  });

  // ----- props -----
  addTex(scene, 'cam', 90, 60, (ctx) => {
    shadow(ctx, 6, 3, 0.3);
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 10, 16, 14);
    rr(ctx, 12, 6, 56, 26, 8);
    ctx.fillStyle = linear(ctx, 0, 6, 0, 32, [[0, '#E9E6DA'], [1, C.creamShade]]);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(66, 19, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.laser;
    ctx.beginPath();
    ctx.arc(24, 13, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  addTex(scene, 'cam-cone', 380, 220, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 380, 0);
    g.addColorStop(0, 'rgba(143,211,182,0.55)');
    g.addColorStop(1, 'rgba(143,211,182,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 104);
    ctx.lineTo(380, 0);
    ctx.lineTo(380, 220);
    ctx.lineTo(0, 116);
    ctx.closePath();
    ctx.fill();
  });
  addTex(scene, 'search-cone', 260, 520, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 520);
    g.addColorStop(0, 'rgba(255,240,190,0.65)');
    g.addColorStop(1, 'rgba(255,240,190,0.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(118, 0);
    ctx.lineTo(142, 0);
    ctx.lineTo(260, 520);
    ctx.lineTo(0, 520);
    ctx.closePath();
    ctx.fill();
  });
  addTex(scene, 'laser-post', 30, 190, (ctx) => {
    shadow(ctx, 6, 3, 0.3);
    rr(ctx, 6, 4, 18, 182, 8);
    ctx.fillStyle = linear(ctx, 6, 0, 24, 0, [[0, C.sageDark], [1, C.sageDeep]]);
    ctx.fill();
    noShadow(ctx);
    for (const y of [24, 70, 116, 162]) {
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(15, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  addTex(scene, 'statue', 150, 260, (ctx) => {
    shadow(ctx, 12, 6, 0.3);
    ctx.fillStyle = linear(ctx, 0, 190, 0, 260, [[0, C.creamDeep], [1, C.creamShade]]);
    rr(ctx, 18, 196, 114, 60, 6);
    ctx.fill();
    ctx.fillStyle = radial(ctx, 75, 110, 110, '#FFFDF6', '#D9CFB8');
    // a thinking figure
    ctx.beginPath();
    ctx.ellipse(75, 132, 40, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(80, 52, 28, 0, Math.PI * 2);
    ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = 'rgba(120,110,90,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(64, 120);
    ctx.quadraticCurveTo(100, 90, 92, 70);
    ctx.stroke();
  });
  addTex(scene, 'crate', 150, 120, (ctx) => {
    shadow(ctx, 10, 5, 0.3);
    ctx.fillStyle = linear(ctx, 0, 0, 0, 120, [[0, '#CDA275'], [1, C.wood]]);
    rr(ctx, 6, 6, 138, 108, 8);
    ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = C.woodDark;
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, 122, 92);
    ctx.beginPath();
    ctx.moveTo(14, 14);
    ctx.lineTo(136, 106);
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = 'bold 14px Fredoka, sans-serif';
    ctx.fillText('FRAGILE', 46, 60);
  });
  const fuse = (key: string, linked: boolean) =>
    addTex(scene, key, 120, 160, (ctx) => {
      shadow(ctx, 10, 5, 0.3);
      rr(ctx, 10, 10, 100, 140, 10);
      ctx.fillStyle = linear(ctx, 0, 0, 120, 0, [[0, '#B9C7BB'], [1, '#8FA295']]);
      ctx.fill();
      noShadow(ctx);
      rr(ctx, 22, 24, 76, 70, 6);
      ctx.fillStyle = C.ink;
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? C.goldLight : C.mint;
        ctx.fillRect(30 + i * 17, 36, 10, 46);
      }
      ctx.fillStyle = C.goldDark;
      rr(ctx, 52, 100, 16, 40, 6);
      ctx.fill();
      ctx.fillStyle = linked ? C.laser : C.goldLight;
      rr(ctx, 70, 104, 34, 22, 4);
      ctx.fill();
      ctx.fillStyle = linked ? '#fff' : C.ink;
      ctx.font = 'bold 10px Fredoka, sans-serif';
      ctx.fillText(linked ? 'ALARM' : '220V', 74, 119);
    });
  fuse('fusebox', false);
  fuse('fusebox-linked', true);
  addTex(scene, 'desk', 240, 130, (ctx) => {
    shadow(ctx, 10, 5, 0.3);
    ctx.fillStyle = linear(ctx, 0, 0, 0, 40, [[0, '#C79B6C'], [1, C.wood]]);
    rr(ctx, 4, 20, 232, 24, 6);
    ctx.fill();
    ctx.fillStyle = C.woodDark;
    rr(ctx, 14, 44, 90, 82, 6);
    ctx.fill();
    rr(ctx, 196, 44, 24, 82, 6);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.wood;
    rr(ctx, 22, 56, 74, 26, 4);
    ctx.fill();
    rr(ctx, 22, 88, 74, 26, 4);
    ctx.fill();
    ctx.fillStyle = C.goldLight;
    ctx.fillRect(52, 66, 16, 5);
    ctx.fillRect(52, 98, 16, 5);
    // lamp
    ctx.fillStyle = C.sageDark;
    ctx.fillRect(184, 2, 6, 20);
    ctx.fillStyle = C.mint;
    ctx.beginPath();
    ctx.moveTo(170, 6);
    ctx.lineTo(204, 6);
    ctx.lineTo(196, -6);
    ctx.lineTo(178, -6);
    ctx.fill();
  });
  addTex(scene, 'drawer-open', 90, 40, (ctx) => {
    shadow(ctx, 6, 3, 0.3);
    ctx.fillStyle = C.wood;
    rr(ctx, 4, 6, 82, 28, 4);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.mint;
    rr(ctx, 30, 10, 30, 18, 3);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.fillRect(34, 14, 10, 4);
  });
  addTex(scene, 'keycard', 40, 28, (ctx) => {
    shadow(ctx, 4, 2, 0.3);
    ctx.fillStyle = C.mint;
    rr(ctx, 2, 2, 36, 22, 4);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.ink;
    ctx.fillRect(6, 6, 12, 5);
    ctx.fillStyle = C.goldLight;
    ctx.fillRect(24, 12, 9, 8);
  });
  const door = (key: string, magnetic: boolean) =>
    addTex(scene, key, 200, 320, (ctx) => {
      shadow(ctx, 14, 6, 0.3);
      ctx.fillStyle = linear(ctx, 0, 0, 200, 0, [[0, '#9DA8A0'], [0.5, '#C9D0C8'], [1, '#8C978F']]);
      rr(ctx, 10, 10, 180, 304, 14);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = 'rgba(47,59,54,0.35)';
      ctx.lineWidth = 3;
      rr(ctx, 26, 26, 148, 272, 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(47,59,54,0.4)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(26 + (i % 2) * 148, 40 + Math.floor(i / 2) * 120, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // lock
      if (magnetic) {
        ctx.fillStyle = C.ink;
        rr(ctx, 136, 130, 36, 64, 6);
        ctx.fill();
        ctx.fillStyle = C.laser;
        ctx.beginPath();
        ctx.arc(154, 148, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.mint;
        ctx.fillRect(142, 164, 24, 6);
        ctx.fillRect(142, 176, 24, 6);
        ctx.strokeStyle = C.goldLight;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(150, 202);
        ctx.lineTo(146, 214);
        ctx.lineTo(156, 214);
        ctx.lineTo(152, 226);
        ctx.stroke();
      } else {
        ctx.fillStyle = radial(ctx, 154, 160, 26, C.goldLight, C.goldDark);
        rr(ctx, 136, 130, 36, 60, 14);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(154, 152, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(151, 152, 6, 18);
      }
      // card reader
      ctx.fillStyle = C.ink;
      rr(ctx, 30, 140, 30, 46, 5);
      ctx.fill();
      ctx.fillStyle = C.mint;
      ctx.fillRect(36, 148, 18, 4);
    });
  door('door-brass', false);
  door('door-magnetic', true);
  addTex(scene, 'vent', 130, 80, (ctx) => {
    shadow(ctx, 8, 4, 0.3);
    rr(ctx, 5, 5, 120, 70, 8);
    ctx.fillStyle = '#BFC6BC';
    ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = C.sageDeep;
    ctx.lineWidth = 5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(18, 18 + i * 11);
      ctx.lineTo(112, 18 + i * 11);
      ctx.stroke();
    }
  });
  addTex(scene, 'case', 200, 300, (ctx) => {
    shadow(ctx, 12, 6, 0.3);
    ctx.fillStyle = linear(ctx, 0, 190, 0, 300, [[0, C.creamDeep], [1, C.creamShade]]);
    rr(ctx, 20, 188, 160, 108, 8);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.gold;
    ctx.fillRect(20, 188, 160, 10);
    // glass
    ctx.fillStyle = 'rgba(200,238,221,0.28)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    rr(ctx, 28, 30, 144, 158, 6);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(44, 40);
    ctx.lineTo(70, 40);
    ctx.lineTo(44, 120);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  const sensor = (key: string, draw: (ctx: Ctx2) => void) =>
    addTex(scene, key, 64, 64, (ctx) => {
      shadow(ctx, 6, 3, 0.3);
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(32, 32, 28, 0, Math.PI * 2);
      ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = C.goldLight;
      ctx.fillStyle = C.goldLight;
      ctx.lineWidth = 4;
      draw(ctx);
    });
  sensor('sensor-weight', (ctx) => {
    ctx.beginPath();
    ctx.moveTo(32, 16);
    ctx.lineTo(32, 46);
    ctx.moveTo(16, 24);
    ctx.lineTo(48, 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, 36, 8, 0, Math.PI);
    ctx.arc(46, 36, 8, 0, Math.PI);
    ctx.fill();
    ctx.fillRect(22, 44, 20, 5);
  });
  sensor('sensor-beam', (ctx) => {
    ctx.strokeStyle = C.laser;
    ctx.beginPath();
    ctx.moveTo(14, 22);
    ctx.lineTo(50, 42);
    ctx.moveTo(14, 42);
    ctx.lineTo(50, 22);
    ctx.stroke();
  });
  sensor('sensor-motion', (ctx) => {
    ctx.beginPath();
    ctx.ellipse(32, 32, 18, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  sensor('sensor-heat', (ctx) => {
    ctx.strokeStyle = C.terracottaLight;
    for (const x of [22, 32, 42]) {
      ctx.beginPath();
      ctx.moveTo(x, 48);
      ctx.bezierCurveTo(x - 8, 38, x + 8, 28, x, 16);
      ctx.stroke();
    }
  });
  addTex(scene, 'net', 180, 160, (ctx) => {
    ctx.strokeStyle = C.woodDark;
    ctx.lineWidth = 4;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(10 + i * 20, 0);
      ctx.quadraticCurveTo(10 + i * 20 + (i - 4) * 4, 90, 90 + (i - 4) * 10, 160);
      ctx.stroke();
    }
    for (let j = 1; j < 7; j++) {
      ctx.beginPath();
      ctx.moveTo(10 + j * 4, j * 22);
      ctx.quadraticCurveTo(90, j * 22 + 14, 170 - j * 4, j * 22);
      ctx.stroke();
    }
  });
  addTex(scene, 'yarn', 40, 40, (ctx) => {
    ctx.fillStyle = radial(ctx, 20, 20, 18, C.mintLight, C.sage);
    ctx.beginPath();
    ctx.arc(20, 20, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.sageDark;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(20, 20, 6 + i * 3, i, i + 2.4);
      ctx.stroke();
    }
  });
  addTex(scene, 'coin', 26, 26, (ctx) => {
    ctx.fillStyle = radial(ctx, 13, 13, 12, C.goldLight, C.goldDark);
    ctx.beginPath();
    ctx.arc(13, 13, 11, 0, Math.PI * 2);
    ctx.fill();
  });
  addTex(scene, 'mirror', 50, 60, (ctx) => {
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.ellipse(25, 24, 20, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 0, 50, 50, [[0, '#FFFFFF'], [1, C.mintLight]]);
    ctx.beginPath();
    ctx.ellipse(25, 24, 15, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.goldDark;
    ctx.fillRect(22, 44, 6, 16);
  });
  addTex(scene, 'zzz', 60, 50, (ctx) => {
    ctx.fillStyle = C.sageDeep;
    ctx.font = 'bold 22px Fredoka, sans-serif';
    ctx.fillText('z', 4, 44);
    ctx.font = 'bold 28px Fredoka, sans-serif';
    ctx.fillText('Z', 22, 30);
  });
  addTex(scene, 'van', 330, 180, (ctx) => {
    shadow(ctx, 14, 6, 0.3);
    ctx.fillStyle = linear(ctx, 0, 20, 0, 150, [[0, C.mint], [1, '#6FB596']]);
    rr(ctx, 10, 20, 300, 120, 30);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = C.mintLight;
    rr(ctx, 210, 34, 80, 46, 12);
    ctx.fill();
    ctx.fillStyle = C.cream;
    rr(ctx, 30, 70, 160, 30, 8);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.font = 'bold 20px Fredoka, sans-serif';
    ctx.fillText('TOTALLY NORMAL VAN', 36, 92);
    for (const x of [70, 250]) {
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(x, 142, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.creamShade;
      ctx.beginPath();
      ctx.arc(x, 142, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // pixel particles
  const px: [string, string][] = [
    ['px-red', C.laser],
    ['px-gold', C.goldLight],
    ['px-mint', C.mintGlow],
    ['px-terra', C.terracotta],
    ['px-white', '#FFFFFF'],
    ['px-ink', C.ink],
  ];
  for (const [k, col] of px)
    addTex(scene, k, 8, 8, (ctx) => {
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, 8, 8);
    });
  addTex(scene, 'siren-glow', 300, 300, (ctx) => {
    const g = ctx.createRadialGradient(150, 150, 10, 150, 150, 150);
    g.addColorStop(0, 'rgba(226,85,61,0.55)');
    g.addColorStop(1, 'rgba(226,85,61,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 300, 300);
  });
}

// ------------------------------------------------------------------------------------------------
// Exhibits

export function exhibitKey(name: string): string {
  return `exhibit-${name.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
}

export function makeExhibit(scene: Phaser.Scene, key: string, shape: ExhibitShape, a: string, b: string): void {
  addTex(scene, key, 110, 110, (ctx) => {
    shadow(ctx, 8, 4, 0.3);
    const fillA = radial(ctx, 55, 55, 52, lighten(a), a);
    ctx.fillStyle = fillA;
    ctx.strokeStyle = b;
    ctx.lineWidth = 5;
    const sparkle = () => {
      noShadow(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(40, 34, 8, 4, -0.5, 0, Math.PI * 2);
      ctx.fill();
    };
    switch (shape) {
      case 'vase':
        ctx.beginPath();
        ctx.moveTo(40, 10);
        ctx.lineTo(70, 10);
        ctx.quadraticCurveTo(64, 30, 82, 50);
        ctx.quadraticCurveTo(96, 80, 70, 102);
        ctx.lineTo(40, 102);
        ctx.quadraticCurveTo(14, 80, 28, 50);
        ctx.quadraticCurveTo(46, 30, 40, 10);
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.moveTo(26, 62);
        ctx.quadraticCurveTo(55, 74, 84, 62);
        ctx.stroke();
        break;
      case 'crown':
        ctx.beginPath();
        ctx.moveTo(12, 88);
        ctx.lineTo(16, 30);
        ctx.lineTo(36, 56);
        ctx.lineTo(55, 18);
        ctx.lineTo(74, 56);
        ctx.lineTo(94, 30);
        ctx.lineTo(98, 88);
        ctx.closePath();
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        for (const [x, y] of [[16, 30], [55, 18], [94, 30]] as const) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillRect(12, 78, 86, 10);
        break;
      case 'mask':
        ctx.beginPath();
        ctx.moveTo(10, 30);
        ctx.quadraticCurveTo(55, 6, 100, 30);
        ctx.quadraticCurveTo(100, 96, 55, 104);
        ctx.quadraticCurveTo(10, 96, 10, 30);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(36, 48, 12, 8, 0.2, 0, Math.PI * 2);
        ctx.ellipse(74, 48, 12, 8, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(55, 74, 14, 0.2, Math.PI - 0.2);
        ctx.stroke();
        break;
      case 'egg':
        ctx.beginPath();
        ctx.ellipse(55, 58, 36, 46, 0, 0, Math.PI * 2);
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.moveTo(22, 58);
        for (let x = 22; x <= 88; x += 11) ctx.lineTo(x, 58 + ((x / 11) % 2 ? -8 : 8));
        ctx.stroke();
        break;
      case 'gem':
        ctx.beginPath();
        ctx.moveTo(30, 18);
        ctx.lineTo(80, 18);
        ctx.lineTo(102, 44);
        ctx.lineTo(55, 104);
        ctx.lineTo(8, 44);
        ctx.closePath();
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.moveTo(8, 44);
        ctx.lineTo(102, 44);
        ctx.moveTo(30, 18);
        ctx.lineTo(55, 104);
        ctx.lineTo(80, 18);
        ctx.stroke();
        break;
      case 'statuette':
        ctx.fillRect(30, 90, 50, 14);
        ctx.beginPath();
        ctx.arc(55, 22, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(55, 34);
        ctx.quadraticCurveTo(80, 40, 92, 22);
        ctx.lineTo(96, 28);
        ctx.quadraticCurveTo(76, 56, 64, 58);
        ctx.lineTo(74, 90);
        ctx.lineTo(36, 90);
        ctx.lineTo(48, 58);
        ctx.quadraticCurveTo(30, 52, 18, 40);
        ctx.lineTo(22, 34);
        ctx.closePath();
        ctx.fill();
        break;
      case 'scroll':
        rr(ctx, 18, 22, 74, 66, 6);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        rr(ctx, 10, 14, 90, 14, 7);
        ctx.fill();
        rr(ctx, 10, 82, 90, 14, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(47,59,54,0.5)';
        ctx.lineWidth = 3;
        for (const y of [42, 54, 66]) {
          ctx.beginPath();
          ctx.moveTo(28, y);
          ctx.lineTo(82, y);
          ctx.stroke();
        }
        break;
      case 'clock':
        ctx.beginPath();
        ctx.arc(55, 58, 42, 0, Math.PI * 2);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = '#FFF9EC';
        ctx.beginPath();
        ctx.arc(55, 58, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = b;
        ctx.beginPath();
        ctx.moveTo(55, 58);
        ctx.lineTo(55, 36);
        ctx.moveTo(55, 58);
        ctx.lineTo(40, 66);
        ctx.stroke();
        ctx.fillStyle = b;
        ctx.fillRect(48, 8, 14, 10);
        break;
      case 'teapot':
        ctx.beginPath();
        ctx.ellipse(55, 66, 38, 32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(90, 60);
        ctx.quadraticCurveTo(108, 50, 106, 30);
        ctx.lineTo(98, 34);
        ctx.quadraticCurveTo(98, 48, 86, 54);
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.arc(14, 66, 14, Math.PI * 0.5, Math.PI * 1.5);
        ctx.stroke();
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(55, 34, 20, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(55, 24, 6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'helmet':
        ctx.beginPath();
        ctx.moveTo(14, 96);
        ctx.lineTo(14, 52);
        ctx.quadraticCurveTo(55, -10, 96, 52);
        ctx.lineTo(96, 96);
        ctx.closePath();
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = C.ink;
        rr(ctx, 26, 50, 58, 12, 4);
        ctx.fill();
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.moveTo(55, 10);
        ctx.quadraticCurveTo(80, -2, 92, 16);
        ctx.quadraticCurveTo(72, 10, 58, 22);
        ctx.fill();
        break;
      case 'coin':
        ctx.beginPath();
        ctx.arc(55, 55, 44, 0, Math.PI * 2);
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.arc(55, 55, 32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = b;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 9 : 20;
          const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(55 + Math.cos(ang) * r, 55 + Math.sin(ang) * r);
        }
        ctx.fill();
        break;
      case 'compass':
        ctx.beginPath();
        ctx.arc(55, 58, 42, 0, Math.PI * 2);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = '#FFF9EC';
        ctx.beginPath();
        ctx.arc(55, 58, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.moveTo(55, 30);
        ctx.lineTo(63, 58);
        ctx.lineTo(55, 86);
        ctx.lineTo(47, 58);
        ctx.fill();
        break;
      case 'lamp':
        ctx.beginPath();
        ctx.ellipse(55, 74, 44, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(96, 70);
        ctx.quadraticCurveTo(110, 50, 104, 40);
        ctx.lineTo(96, 54);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(55, 56, 18, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,240,190,0.9)';
        ctx.beginPath();
        ctx.moveTo(16, 70);
        ctx.quadraticCurveTo(6, 52, 14, 40);
        ctx.quadraticCurveTo(22, 56, 16, 70);
        ctx.fill();
        break;
      case 'harp':
        ctx.lineWidth = 9;
        ctx.strokeStyle = a;
        ctx.beginPath();
        ctx.moveTo(24, 100);
        ctx.lineTo(24, 14);
        ctx.quadraticCurveTo(70, 6, 92, 40);
        ctx.lineTo(24, 100);
        ctx.stroke();
        noShadow(ctx);
        ctx.strokeStyle = b;
        ctx.lineWidth = 2;
        for (let i = 1; i < 7; i++) {
          ctx.beginPath();
          ctx.moveTo(24 + i * 9, 14 + i * 2);
          ctx.lineTo(24 + i * 9, 100 - i * 8);
          ctx.stroke();
        }
        break;
      case 'globe':
        ctx.beginPath();
        ctx.arc(55, 48, 38, 0, Math.PI * 2);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(44, 40, 14, 9, 0.5, 0, Math.PI * 2);
        ctx.ellipse(70, 60, 10, 7, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.goldDark;
        ctx.fillRect(50, 86, 10, 12);
        ctx.fillRect(34, 98, 42, 8);
        break;
      case 'skull':
        ctx.beginPath();
        ctx.arc(55, 46, 38, 0, Math.PI * 2);
        ctx.fill();
        rr(ctx, 32, 66, 46, 34, 10);
        ctx.fill();
        noShadow(ctx);
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(40, 50, 11, 0, Math.PI * 2);
        ctx.arc(70, 50, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = b;
        ctx.beginPath();
        ctx.arc(55, 74, 14, 0.2, Math.PI - 0.2);
        ctx.stroke();
        break;
      case 'feather':
        ctx.beginPath();
        ctx.moveTo(20, 100);
        ctx.quadraticCurveTo(30, 30, 92, 8);
        ctx.quadraticCurveTo(84, 70, 20, 100);
        ctx.fill();
        noShadow(ctx);
        ctx.beginPath();
        ctx.moveTo(18, 104);
        ctx.quadraticCurveTo(52, 52, 90, 12);
        ctx.stroke();
        break;
      case 'ring':
        ctx.lineWidth = 12;
        ctx.strokeStyle = a;
        ctx.beginPath();
        ctx.arc(55, 66, 30, 0, Math.PI * 2);
        ctx.stroke();
        noShadow(ctx);
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.moveTo(40, 34);
        ctx.lineTo(70, 34);
        ctx.lineTo(78, 22);
        ctx.lineTo(55, 4);
        ctx.lineTo(32, 22);
        ctx.closePath();
        ctx.fill();
        break;
    }
    sparkle();
  });
}

function lighten(hexColor: string): string {
  const n = Number.parseInt(hexColor.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 50);
  const g = Math.min(255, ((n >> 8) & 255) + 50);
  const b = Math.min(255, (n & 255) + 50);
  return `rgb(${r},${g},${b})`;
}
