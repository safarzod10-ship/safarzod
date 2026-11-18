// Paints one 1280x720 room backdrop (layered paper diorama) per beat. Static only; anything that moves or
// depends on run state is a separate sprite in the scene.
import { C, G, WALLS, type WallPalette } from './palette.js';
import { canvas, linear, noShadow, paperGrain, rr, shadow, tornEdge, type Ctx2 } from './art.js';
import type { Beat, RoomStyle } from '../../shared/types.js';
import { mulberry32 } from '../../shared/engine.js';

export function paintRoom(beat: Beat | null, style: RoomStyle, seed: number, wall: number): HTMLCanvasElement {
  const [cv, ctx] = canvas(G.W, G.H);
  const p = WALLS[wall % WALLS.length]!;
  const rnd = mulberry32(seed);
  const outdoor = style === 'rooftop' || style === 'courtyard';
  if (outdoor) paintSky(ctx, rnd);
  else paintWall(ctx, p);
  switch (style) {
    case 'gallery':
      paintGallery(ctx, p, rnd);
      break;
    case 'corridor':
      paintCorridor(ctx, p, rnd);
      break;
    case 'atrium':
      paintAtrium(ctx, p, rnd);
      break;
    case 'vault':
      paintVault(ctx, p);
      break;
    case 'library':
      paintLibrary(ctx, p, rnd);
      break;
    case 'sculpture':
      paintSculpture(ctx, p, rnd);
      break;
    case 'basement':
      paintBasement(ctx, p, rnd);
      break;
    case 'office':
      paintOffice(ctx, p, rnd);
      break;
    case 'shop':
      paintShop(ctx, p, rnd);
      break;
    case 'stairwell':
      paintStairwell(ctx, p);
      break;
    case 'rooftop':
      paintRooftop(ctx, rnd);
      break;
    case 'courtyard':
      paintCourtyard(ctx, rnd);
      break;
  }
  if (!outdoor) paintFloor(ctx, p, rnd, beat);
  if (beat) paintStatic(ctx, beat, p);
  // paper grain over everything
  ctx.fillStyle = paperGrain(ctx);
  ctx.fillRect(0, 0, G.W, G.H);
  return cv;
}

function paintWall(ctx: Ctx2, p: WallPalette): void {
  ctx.fillStyle = linear(ctx, 0, 0, 0, G.floorY, [[0, p.wallDark], [0.35, p.wall], [1, p.wall]]);
  ctx.fillRect(0, 0, G.W, G.floorY);
  // ceiling band with torn paper edge
  shadow(ctx, 12, 6, 0.25);
  ctx.fillStyle = p.trim;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(G.W, 0);
  tornEdge(ctx, 0, G.W, 26, 6, 7);
  ctx.closePath();
  ctx.fill();
  // wainscot
  ctx.fillStyle = p.wallDark;
  ctx.fillRect(0, G.floorY - 120, G.W, 120);
  noShadow(ctx);
  ctx.strokeStyle = 'rgba(47,59,54,0.12)';
  ctx.lineWidth = 3;
  for (let x = 40; x < G.W; x += 160) {
    rr(ctx, x, G.floorY - 100, 120, 80, 8);
    ctx.stroke();
  }
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, G.floorY - 126, G.W, 8);
}

function paintFloor(ctx: Ctx2, p: WallPalette, rnd: () => number, beat: Beat | null): void {
  shadow(ctx, 16, -4, 0.25);
  ctx.fillStyle = linear(ctx, 0, G.floorY - 80, 0, G.H, [[0, p.floor], [1, p.floorDark]]);
  ctx.beginPath();
  ctx.moveTo(0, G.floorY - 70);
  ctx.lineTo(G.W, G.floorY - 70);
  ctx.lineTo(G.W, G.H);
  ctx.lineTo(0, G.H);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  if (beat?.challenge === 'plates' || beat?.challenge === 'guardPlates') return;
  ctx.strokeStyle = 'rgba(47,59,54,0.12)';
  ctx.lineWidth = 2;
  for (let y = G.floorY - 50; y < G.H; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(G.W, y);
    ctx.stroke();
    const off = rnd() * 120;
    for (let x = off; x < G.W; x += 180) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 34);
      ctx.stroke();
    }
  }
}

function frame(ctx: Ctx2, x: number, y: number, w: number, h: number, p: WallPalette, rnd: () => number): void {
  shadow(ctx, 14, 7, 0.3);
  ctx.fillStyle = C.gold;
  rr(ctx, x - 12, y - 12, w + 24, h + 24, 6);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = C.paper;
  ctx.fillRect(x, y, w, h);
  // abstract paper-cut art
  const cols = [C.sage, C.terracotta, C.mint, C.goldLight, C.sageDark, p.accent];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
    shadow(ctx, 4, 2, 0.2);
    const kind = rnd();
    const cx = x + w * (0.2 + rnd() * 0.6);
    const cy = y + h * (0.25 + rnd() * 0.5);
    const r = Math.min(w, h) * (0.15 + rnd() * 0.22);
    ctx.beginPath();
    if (kind < 0.4) ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (kind < 0.7) {
      ctx.moveTo(cx - r, cy + r);
      ctx.lineTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
    } else ctx.ellipse(cx, cy, r * 1.4, r * 0.6, rnd(), 0, Math.PI * 2);
    ctx.fill();
  }
  noShadow(ctx);
  // picture light
  ctx.fillStyle = C.sageDeep;
  rr(ctx, x + w / 2 - 30, y - 30, 60, 10, 5);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y - 20, 0, y + h * 0.6);
  g.addColorStop(0, 'rgba(255,245,210,0.35)');
  g.addColorStop(1, 'rgba(255,245,210,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 30, y - 20);
  ctx.lineTo(x + w / 2 + 30, y - 20);
  ctx.lineTo(x + w + 10, y + h * 0.6);
  ctx.lineTo(x - 10, y + h * 0.6);
  ctx.fill();
}

function paintGallery(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const w = 150 + rnd() * 90;
    const h = 110 + rnd() * 80;
    const x = 110 + i * (1060 / n) + rnd() * 40;
    frame(ctx, x, 110 + rnd() * 50, w, h, p, rnd);
  }
}

function arch(ctx: Ctx2, x: number, w: number, top: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, G.floorY - 70);
  ctx.lineTo(x, top + w / 2);
  ctx.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w, G.floorY - 70);
  ctx.closePath();
  ctx.fill();
}

function paintCorridor(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  for (let i = 0; i < 4; i++) {
    const x = 60 + i * 320 + rnd() * 30;
    shadow(ctx, 12, 6, 0.25);
    arch(ctx, x, 170, 90, p.wallDark);
    noShadow(ctx);
    arch(ctx, x + 16, 138, 106, 'rgba(47,59,54,0.18)');
  }
  // hanging lamps
  for (let i = 0; i < 3; i++) lamp(ctx, 250 + i * 400);
}

function lamp(ctx: Ctx2, x: number): void {
  ctx.strokeStyle = C.sageDeep;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 26);
  ctx.lineTo(x, 70);
  ctx.stroke();
  shadow(ctx, 8, 4, 0.25);
  ctx.fillStyle = C.goldLight;
  ctx.beginPath();
  ctx.moveTo(x - 26, 92);
  ctx.quadraticCurveTo(x, 50, x + 26, 92);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  const g = ctx.createRadialGradient(x, 100, 4, x, 100, 120);
  g.addColorStop(0, 'rgba(255,240,190,0.35)');
  g.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 120, 80, 240, 160);
}

function column(ctx: Ctx2, x: number, w: number, p: WallPalette): void {
  shadow(ctx, 14, 6, 0.28);
  ctx.fillStyle = linear(ctx, x, 0, x + w, 0, [[0, C.paper], [0.6, C.creamDeep], [1, C.creamShade]]);
  ctx.fillRect(x, 60, w, G.floorY - 130);
  ctx.fillStyle = p.trim;
  ctx.fillRect(x - 12, 40, w + 24, 26);
  ctx.fillRect(x - 12, G.floorY - 90, w + 24, 22);
  noShadow(ctx);
  ctx.strokeStyle = 'rgba(47,59,54,0.12)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w / 4) * i, 70);
    ctx.lineTo(x + (w / 4) * i, G.floorY - 92);
    ctx.stroke();
  }
}

function paintAtrium(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  // skylight
  ctx.fillStyle = linear(ctx, 0, 30, 0, 160, [[0, '#BFE3EA'], [1, '#E7F4F1']]);
  rr(ctx, 380, 34, 520, 110, 12);
  ctx.fill();
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 6;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(380 + i * 104, 34);
    ctx.lineTo(380 + i * 104, 144);
    ctx.stroke();
  }
  for (const x of [120, 300, 940, 1120]) column(ctx, x + rnd() * 10, 64, p);
}

function paintVault(ctx: Ctx2, p: WallPalette): void {
  // big round vault door at the back
  shadow(ctx, 20, 8, 0.3);
  ctx.fillStyle = linear(ctx, 840, 80, 1180, 420, [[0, '#D3D8CF'], [1, '#9DA8A0']]);
  ctx.beginPath();
  ctx.arc(1030, 250, 170, 0, Math.PI * 2);
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = 'rgba(47,59,54,0.35)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(1030, 250, 130, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 10;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(1030, 250);
    ctx.lineTo(1030 + Math.cos(a) * 60, 250 + Math.sin(a) * 60);
    ctx.stroke();
  }
  ctx.fillStyle = C.goldDark;
  ctx.beginPath();
  ctx.arc(1030, 250, 18, 0, Math.PI * 2);
  ctx.fill();
  // rivet panels
  ctx.fillStyle = 'rgba(47,59,54,0.18)';
  for (let x = 40; x < 760; x += 90) for (let y = 70; y < 380; y += 90) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, 44, G.W, 6);
}

function paintLibrary(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  const cols = [C.sage, C.terracotta, C.mint, C.goldLight, C.sageDark, C.terracottaLight, C.creamShade];
  for (let s = 0; s < 3; s++) {
    const x0 = 60 + s * 420;
    shadow(ctx, 14, 6, 0.28);
    ctx.fillStyle = C.woodDark;
    ctx.fillRect(x0, 70, 330, G.floorY - 140);
    noShadow(ctx);
    for (let row = 0; row < 4; row++) {
      const y = 80 + row * 90;
      ctx.fillStyle = C.wood;
      ctx.fillRect(x0 + 8, y + 72, 314, 8);
      let x = x0 + 12;
      while (x < x0 + 312) {
        const w = 10 + rnd() * 16;
        const h = 44 + rnd() * 26;
        ctx.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
        ctx.fillRect(x, y + 72 - h, w, h);
        x += w + 2;
      }
    }
  }
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, 40, G.W, 6);
}

function paintSculpture(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  for (const x of [130, 1020]) {
    shadow(ctx, 12, 6, 0.28);
    ctx.fillStyle = p.wallDark;
    ctx.fillRect(x, 220, 120, G.floorY - 290);
    ctx.fillStyle = C.paper;
    ctx.beginPath();
    ctx.ellipse(x + 60, 170, 34 + rnd() * 10, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 60, 96, 24, 0, Math.PI * 2);
    ctx.fill();
    noShadow(ctx);
  }
  // banners
  for (const x of [420, 780]) {
    shadow(ctx, 10, 5, 0.25);
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x + 80, 40);
    ctx.lineTo(x + 80, 220);
    ctx.lineTo(x + 40, 196);
    ctx.lineTo(x, 220);
    ctx.closePath();
    ctx.fill();
    noShadow(ctx);
  }
}

function paintBasement(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  ctx.strokeStyle = 'rgba(47,59,54,0.14)';
  ctx.lineWidth = 2;
  for (let y = 40; y < G.floorY - 70; y += 32) {
    const off = (y / 32) % 2 ? 0 : 40;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(G.W, y);
    ctx.stroke();
    for (let x = off; x < G.W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 32);
      ctx.stroke();
    }
  }
  // pipes
  shadow(ctx, 8, 4, 0.3);
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(0, 80);
  ctx.lineTo(G.W, 80);
  ctx.moveTo(0, 120);
  ctx.lineTo(300 + rnd() * 200, 120);
  ctx.lineTo(300 + rnd() * 200, 300);
  ctx.stroke();
  ctx.strokeStyle = C.terracotta;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(G.W, 150);
  ctx.lineTo(820, 150);
  ctx.lineTo(820, 380);
  ctx.stroke();
  noShadow(ctx);
}

function paintOffice(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  // windows with night outside
  for (const x of [120, 900]) {
    shadow(ctx, 10, 5, 0.25);
    ctx.fillStyle = p.trim;
    rr(ctx, x - 10, 90, 240, 190, 8);
    ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = linear(ctx, 0, 100, 0, 270, [[0, C.nightDeep], [1, C.night]]);
    rr(ctx, x, 100, 220, 170, 6);
    ctx.fill();
    ctx.fillStyle = C.goldLight;
    for (let i = 0; i < 6; i++) ctx.fillRect(x + 10 + rnd() * 200, 110 + rnd() * 140, 3, 3);
    ctx.fillStyle = p.trim;
    ctx.fillRect(x + 106, 100, 8, 170);
  }
  // filing cabinets
  shadow(ctx, 10, 5, 0.28);
  ctx.fillStyle = '#B8C3B7';
  rr(ctx, 1150, 300, 90, 170, 6);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = C.sageDeep;
  for (let i = 0; i < 3; i++) ctx.fillRect(1180, 330 + i * 52, 30, 6);
  // poster
  shadow(ctx, 6, 3, 0.2);
  ctx.fillStyle = C.paper;
  ctx.fillRect(560, 120, 150, 110);
  noShadow(ctx);
  ctx.fillStyle = C.terracotta;
  ctx.font = 'bold 22px Fredoka, sans-serif';
  ctx.fillText('NIGHT', 590, 160);
  ctx.fillText('SHIFT', 592, 190);
}

function paintShop(ctx: Ctx2, p: WallPalette, rnd: () => number): void {
  shadow(ctx, 10, 5, 0.25);
  ctx.fillStyle = p.accent;
  rr(ctx, 380, 40, 520, 64, 12);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = C.paper;
  ctx.font = 'bold 40px Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GIFT SHOP', 640, 86);
  ctx.textAlign = 'left';
  const cols = [C.terracotta, C.sage, C.mint, C.goldLight, C.cream];
  for (const sx of [80, 900]) {
    for (let r = 0; r < 3; r++) {
      const y = 170 + r * 100;
      shadow(ctx, 6, 3, 0.25);
      ctx.fillStyle = C.wood;
      ctx.fillRect(sx, y + 60, 300, 10);
      noShadow(ctx);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
        ctx.beginPath();
        ctx.ellipse(sx + 30 + i * 60, y + 36, 18, 26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintStairwell(ctx: Ctx2, p: WallPalette): void {
  ctx.fillStyle = p.trim;
  ctx.fillRect(0, 40, G.W, 6);
}

function paintSky(ctx: Ctx2, rnd: () => number): void {
  ctx.fillStyle = linear(ctx, 0, 0, 0, G.H, [[0, C.nightDeep], [0.6, C.night], [1, '#4A6560']]);
  ctx.fillRect(0, 0, G.W, G.H);
  ctx.fillStyle = C.goldLight;
  for (let i = 0; i < 70; i++) {
    const s = rnd() < 0.15 ? 3 : 2;
    ctx.globalAlpha = 0.4 + rnd() * 0.6;
    ctx.fillRect(rnd() * G.W, rnd() * 360, s, s);
  }
  ctx.globalAlpha = 1;
  // paper moon
  shadow(ctx, 30, 0, 0.4);
  ctx.shadowColor = 'rgba(255,240,190,0.6)';
  ctx.fillStyle = C.cream;
  ctx.beginPath();
  ctx.arc(1080, 110, 48, 0, Math.PI * 2);
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = C.creamDeep;
  ctx.beginPath();
  ctx.arc(1066, 100, 9, 0, Math.PI * 2);
  ctx.arc(1094, 124, 6, 0, Math.PI * 2);
  ctx.fill();
  // far city skyline paper layer
  ctx.fillStyle = '#35504C';
  ctx.beginPath();
  ctx.moveTo(0, 430);
  let x = 0;
  while (x < G.W) {
    const w = 60 + rnd() * 90;
    const h = 60 + rnd() * 120;
    ctx.lineTo(x, 430 - h);
    ctx.lineTo(x + w, 430 - h);
    x += w;
  }
  ctx.lineTo(G.W, 430);
  ctx.lineTo(G.W, G.H);
  ctx.lineTo(0, G.H);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,207,149,0.55)';
  for (let i = 0; i < 40; i++) ctx.fillRect(rnd() * G.W, 300 + rnd() * 120, 5, 7);
}

function paintRooftop(ctx: Ctx2, rnd: () => number): void {
  // roof surface
  shadow(ctx, 16, -4, 0.35);
  ctx.fillStyle = linear(ctx, 0, G.floorY - 30, 0, G.H, [[0, C.terracotta], [1, C.terracottaDark]]);
  ctx.beginPath();
  ctx.moveTo(0, G.floorY - 20);
  tornEdge(ctx, 0, G.W, G.floorY - 20, 0, 3);
  ctx.lineTo(G.W, G.H);
  ctx.lineTo(0, G.H);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = 'rgba(47,30,20,0.25)';
  ctx.lineWidth = 3;
  for (let y = G.floorY; y < G.H; y += 26) {
    for (let x = (y / 26) % 2 ? 0 : 30; x < G.W; x += 60) {
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI);
      ctx.stroke();
    }
  }
  // chimney (cover spot)
  shadow(ctx, 12, 6, 0.35);
  ctx.fillStyle = C.terracottaDark;
  ctx.fillRect(440, 380, 90, 170);
  ctx.fillStyle = C.creamShade;
  ctx.fillRect(430, 368, 110, 22);
  noShadow(ctx);
  // drainpipe at the edge
  ctx.fillStyle = C.sageDark;
  ctx.fillRect(1180, 470, 20, 250);
  ctx.fillRect(1160, 470, 60, 16);
  // antenna
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(220 + rnd() * 40, G.floorY - 20);
  ctx.lineTo(240, 330);
  ctx.moveTo(214, 360);
  ctx.lineTo(266, 360);
  ctx.stroke();
}

function paintCourtyard(ctx: Ctx2, rnd: () => number): void {
  // museum facade
  shadow(ctx, 20, 8, 0.35);
  ctx.fillStyle = linear(ctx, 0, 150, 0, G.floorY, [[0, C.creamDeep], [1, C.creamShade]]);
  ctx.fillRect(140, 150, 1000, G.floorY - 150);
  ctx.fillStyle = C.cream;
  ctx.beginPath();
  ctx.moveTo(110, 160);
  ctx.lineTo(640, 50);
  ctx.lineTo(1170, 160);
  ctx.closePath();
  ctx.fill();
  noShadow(ctx);
  ctx.fillStyle = C.sageDark;
  ctx.font = 'bold 30px Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MUSEUM', 640, 140);
  ctx.textAlign = 'left';
  // windows
  for (let i = 0; i < 6; i++) {
    const x = 190 + i * 160;
    ctx.fillStyle = rnd() < 0.3 ? C.goldLight : C.night;
    if (x > 480 && x < 800) continue;
    rr(ctx, x, 240, 70, 110, 30);
    ctx.fill();
  }
  // hedges
  shadow(ctx, 10, 5, 0.3);
  ctx.fillStyle = C.sageDark;
  for (let x = -20; x < G.W; x += 90) {
    ctx.beginPath();
    ctx.arc(x + 45, G.floorY - 20, 50, Math.PI, 0);
    ctx.fill();
  }
  // ground
  ctx.fillStyle = linear(ctx, 0, G.floorY - 20, 0, G.H, [[0, '#7E9379'], [1, '#5E7F66']]);
  ctx.fillRect(0, G.floorY - 20, G.W, G.H);
  noShadow(ctx);
  // skylight rope anchor on the roof edge, dock door, window
  ctx.fillStyle = C.sageDeep;
  rr(ctx, 1000, 330, 130, G.floorY - 350, 6);
  ctx.fill();
  ctx.fillStyle = C.goldLight;
  ctx.font = 'bold 18px Fredoka, sans-serif';
  ctx.fillText('DOCK', 1040, 360);
}

// ------------------------------------------------------------------------------------------------

function paintStatic(ctx: Ctx2, beat: Beat, p: WallPalette): void {
  switch (beat.challenge) {
    case 'plates':
    case 'guardPlates': {
      const rows = beat.challenge === 'plates' ? Number(beat.cue.rows) : 3;
      const safe = Number(beat.cue.safe);
      paintPlates(ctx, rows, safe, p);
      break;
    }
    case 'camera':
    case 'laserCam':
      paintLedge(ctx, p);
      break;
    case 'chase':
      paintRoutes(ctx, String(beat.cue.routes).split(','), p);
      break;
    case 'entry':
      paintEntry(ctx);
      break;
  }
}

function paintLedge(ctx: Ctx2, p: WallPalette): void {
  shadow(ctx, 12, 6, 0.3);
  ctx.fillStyle = p.trim;
  ctx.fillRect(300, G.ledgeY, 760, 20);
  ctx.fillStyle = C.creamShade;
  for (let x = 320; x < 1050; x += 60) ctx.fillRect(x, G.ledgeY + 20, 10, 40);
  noShadow(ctx);
}

/** Plate rows are drawn bottom (front) to top (back); rims mark pressure plates. */
function paintPlates(ctx: Ctx2, rows: number, safe: number, p: WallPalette): void {
  const ys = rows === 3 ? [G.rows[0]!, G.rows[1]!, G.rows[2]!] : [...G.rows];
  const h = 34;
  for (let r = 0; r < rows; r++) {
    const y = ys[r]! - h / 2;
    for (let i = 0; i < 9; i++) {
      const x = 330 + i * 70;
      const plate = r !== safe && (i + r) % 2 === 0;
      shadow(ctx, 3, 2, 0.2);
      ctx.fillStyle = (i + r) % 2 ? p.floor : p.floorDark;
      ctx.fillRect(x, y, 68, h - 2);
      noShadow(ctx);
      if (plate) {
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 5, y + 4, 58, h - 10);
        ctx.fillStyle = 'rgba(201,165,90,0.25)';
        ctx.fillRect(x + 5, y + 4, 58, h - 10);
      }
    }
  }
}

const ROUTE_X: Record<string, number> = { stairs: 380, elevator: 640, window: 880, chute: 1110 };
export const routeX = (r: string): number => ROUTE_X[r] ?? 640;

function paintRoutes(ctx: Ctx2, routes: string[], p: WallPalette): void {
  for (const r of routes) {
    const x = ROUTE_X[r]!;
    shadow(ctx, 12, 6, 0.3);
    if (r === 'stairs') {
      ctx.fillStyle = C.creamShade;
      for (let i = 0; i < 8; i++) ctx.fillRect(x - 110 + i * 26, G.floorY - 260 + i * 30, 120 - i * 6, 30);
      ctx.fillStyle = p.trim;
      ctx.fillRect(x - 120, G.floorY - 270, 10, 270);
    } else if (r === 'elevator') {
      ctx.fillStyle = '#AEB8B0';
      rr(ctx, x - 80, G.floorY - 300, 160, 300, 8);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = '#C9D0C8';
      ctx.fillRect(x - 70, G.floorY - 260, 68, 260);
      ctx.fillRect(x + 2, G.floorY - 260, 68, 260);
      ctx.fillStyle = C.ink;
      rr(ctx, x - 40, G.floorY - 296, 80, 26, 6);
      ctx.fill();
    } else if (r === 'window') {
      ctx.fillStyle = p.trim;
      rr(ctx, x - 80, G.floorY - 330, 160, 220, 10);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = linear(ctx, 0, G.floorY - 320, 0, G.floorY - 120, [[0, C.nightDeep], [1, C.night]]);
      rr(ctx, x - 68, G.floorY - 318, 136, 196, 6);
      ctx.fill();
      ctx.fillStyle = C.goldLight;
      ctx.beginPath();
      ctx.arc(x + 30, G.floorY - 280, 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (r === 'chute') {
      ctx.fillStyle = '#9DA8A0';
      rr(ctx, x - 70, G.floorY - 200, 140, 120, 10);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = C.ink;
      rr(ctx, x - 54, G.floorY - 184, 108, 88, 8);
      ctx.fill();
      ctx.fillStyle = C.goldLight;
      ctx.font = 'bold 15px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LAUNDRY', x, G.floorY - 64);
      ctx.textAlign = 'left';
    }
    noShadow(ctx);
  }
}

function paintEntry(ctx: Ctx2): void {
  // skylight hatch under the roof line, window on the left - drawn over the courtyard backdrop
  shadow(ctx, 10, 5, 0.3);
  ctx.fillStyle = C.sageDeep;
  rr(ctx, 520, 178, 240, 44, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(191,227,234,0.8)';
  rr(ctx, 532, 186, 216, 28, 6);
  ctx.fill();
  ctx.fillStyle = C.sageDeep;
  ctx.fillRect(636, 186, 8, 28);
  ctx.fillStyle = C.sageDeep;
  rr(ctx, 120, 300, 170, 150, 10);
  ctx.fill();
  ctx.fillStyle = C.night;
  rr(ctx, 132, 312, 146, 126, 6);
  ctx.fill();
  noShadow(ctx);
}
