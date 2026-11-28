/**
 * Draws one city on the map: its land (a soft warm tint of the owned cells),
 * its buildings (atlas sprites, y-sorted) and construction progress bars.
 * Used for the player's own city and for neighbours seen up close.
 * Rebuilt only when the city's layout changes, never per frame.
 */
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { CAMERA } from '../../core/config.ts';
import type { Rect } from '../../core/math.ts';
import { getBit } from '../../game/bits.ts';
import { BUILDINGS, CELL_M } from '../../game/config.ts';
import { buildHours, type RegionMask } from '../../game/rules.ts';
import type { Building } from '../../game/types.ts';
import type { BuildingAtlas } from './atlas.ts';
import { Smoke } from './Smoke.ts';

export interface CityLayers {
  ground: Container;
  objects: Container;
  overlay: Container;
}

const HOUR = 3_600_000;

export function variantOf(b: Building): number {
  return b.t === 'house' ? (b.x * 7 + b.y * 13) % 3 : 0;
}

export class CityRenderer {
  readonly mask: RegionMask;
  private readonly atlas: BuildingAtlas;
  private readonly land = new Sprite();
  private landSource: CanvasSource | null = null;
  private readonly sprites = new Container({ label: 'city:buildings' });
  private readonly bars = new Graphics();
  private buildingsList: Building[] = [];
  private readonly own: boolean;
  /** chimney smoke (own city only) */
  readonly smoke: Smoke | null;

  constructor(atlas: BuildingAtlas, layers: CityLayers, mask: RegionMask, own: boolean) {
    this.atlas = atlas;
    this.mask = mask;
    this.own = own;
    this.land.eventMode = 'none';
    this.sprites.eventMode = 'none';
    this.sprites.sortableChildren = false;
    this.bars.eventMode = 'none';
    // bars are drawn in screen-plane units: undo the world's turn and squash
    this.bars.rotation = -CAMERA.rotation;
    this.bars.scale.y = 1 / CAMERA.tilt;
    layers.ground.addChild(this.land);
    layers.objects.addChild(this.sprites);
    layers.overlay.addChild(this.bars);
    this.smoke = own ? new Smoke(layers.overlay) : null;
  }

  /** Rebuild land and buildings. */
  set(owned: Uint8Array, buildings: Building[], now: number): void {
    this.drawLand(owned);
    this.buildingsList = buildings;
    // back to front: in the isometric view depth grows with x + y of the lot centre
    const depth = (b: Building): number => b.x + b.y + BUILDINGS[b.t].size;
    const list = buildings.slice().sort((a, b) => depth(a) - depth(b) || a.x - b.x);
    // one sprite per building (upgrades show a progress bar)
    const want: { key: string; x: number; y: number }[] = [];
    for (const b of list) {
      const half = (BUILDINGS[b.t].size * CELL_M) / 2;
      const cx = b.x * CELL_M + half;
      const cy = b.y * CELL_M + half;
      want.push({ key: this.atlas.key(b.t, b.lvl), x: cx, y: cy });
    }
    const kids = this.sprites.children as Sprite[];
    while (kids.length > want.length) kids[kids.length - 1].destroy();
    for (let i = 0; i < want.length; i++) {
      let s = kids[i];
      if (!s) {
        s = new Sprite();
        this.sprites.addChild(s);
      }
      this.atlas.apply(s, want[i].key, want[i].x, want[i].y);
    }
    this.updateSmoke();
    this.drawBars(now);
  }

  /** Chimney tops of every finished building, on the screen plane. */
  private updateSmoke(): void {
    if (!this.smoke) return;
    const c = Math.cos(CAMERA.rotation);
    const sn = Math.sin(CAMERA.rotation);
    const pts: { x: number; y: number }[] = [];
    for (const b of this.buildingsList) {
      if (b.lvl < 1) continue;
      const half = (BUILDINGS[b.t].size * CELL_M) / 2;
      const wx = b.x * CELL_M + half;
      const wy = b.y * CELL_M + half;
      const lx = wx * c - wy * sn;
      const ly = (wx * sn + wy * c) * CAMERA.tilt;
      for (const [name, o] of Object.entries(this.atlas.points(this.atlas.key(b.t, b.lvl)))) {
        if (name.startsWith('smoke')) pts.push({ x: lx + o.x, y: ly + o.y });
      }
    }
    this.smoke.setEmitters(pts);
  }

  /** Progress bars of running constructions (call about once a second). */
  drawBars(now: number): void {
    const g = this.bars;
    g.clear();
    if (!this.own) return;
    for (const b of this.buildingsList) {
      if (!b.until || b.until <= now) continue;
      const total = buildHours(b.t, b.lvl + 1) * HOUR;
      const p = Math.max(0, Math.min(1, 1 - (b.until - now) / total));
      const size = BUILDINGS[b.t].size * CELL_M;
      const w = Math.min(44, size * 0.9);
      // the lot's front corner, in screen-plane units, a little above it
      const fx = (b.x + BUILDINGS[b.t].size) * CELL_M;
      const fy = (b.y + BUILDINGS[b.t].size) * CELL_M;
      const c = Math.cos(CAMERA.rotation);
      const sn = Math.sin(CAMERA.rotation);
      const x = fx * c - fy * sn - w / 2;
      const y = (fx * sn + fy * c) * CAMERA.tilt - 10;
      g.roundRect(x - 0.8, y - 0.8, w + 1.6, 4.6, 2.3).fill({ color: 0x0f3245, alpha: 0.78 });
      g.roundRect(x, y, Math.max(1.5, w * p), 3, 1.5).fill({ color: 0xf2c14e });
    }
  }

  get hasConstruction(): boolean {
    return this.buildingsList.some((b) => b.until > 0);
  }

  /** Rectangles (world units) where trees must go. */
  clearings(): Rect[] {
    return this.buildingsList.map((b) => {
      const s = BUILDINGS[b.t].size * CELL_M;
      return { x: b.x * CELL_M - 2, y: b.y * CELL_M - 2, width: s + 4, height: s + 4 };
    });
  }

  /** Building under a world point. */
  pick(wx: number, wy: number): Building | null {
    const cx = Math.floor(wx / CELL_M);
    const cy = Math.floor(wy / CELL_M);
    for (const b of this.buildingsList) {
      const s = BUILDINGS[b.t].size;
      if (cx >= b.x && cx < b.x + s && cy >= b.y && cy < b.y + s) return b;
    }
    return null;
  }

  setVisible(v: boolean): void {
    this.land.visible = v;
    this.sprites.visible = v;
    this.bars.visible = v;
    this.smoke?.setVisible(v);
  }

  private drawLand(owned: Uint8Array): void {
    const m = this.mask;
    // 4 px per cell: a light wash over owned land and a crisp gold border line
    // on the outer edge (in the isometric view cells are diamonds)
    const P = 4;
    const canvas = document.createElement('canvas');
    canvas.width = (m.w + 2) * P;
    canvas.height = (m.h + 2) * P;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const own = this.own;
    const has = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < m.w && y < m.h && getBit(owned, y * m.w + x);
    const put = (px: number, py: number, r: number, g: number, b: number, a: number): void => {
      const o = (py * canvas.width + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    };
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        if (!has(x, y)) continue;
        const l = !has(x - 1, y);
        const r = !has(x + 1, y);
        const t = !has(x, y - 1);
        const bo = !has(x, y + 1);
        for (let j = 0; j < P; j++)
          for (let i = 0; i < P; i++) {
            const px = (x + 1) * P + i;
            const py = (y + 1) * P + j;
            const border = (l && i === 0) || (r && i === P - 1) || (t && j === 0) || (bo && j === P - 1);
            if (border) put(px, py, own ? 232 : 220, own ? 190 : 214, own ? 92 : 196, own ? 235 : 120);
            else put(px, py, own ? 236 : 228, own ? 232 : 232, own ? 190 : 214, own ? 70 : 40);
          }
      }
    ctx.putImageData(img, 0, 0);
    this.landSource?.destroy();
    this.landSource = new CanvasSource({ resource: canvas, scaleMode: 'nearest' });
    this.land.texture = new Texture({ source: this.landSource });
    this.land.position.set((m.x0 - 1) * CELL_M, (m.y0 - 1) * CELL_M);
    this.land.scale.set(CELL_M / P);
  }

  destroy(): void {
    this.land.destroy();
    this.landSource?.destroy();
    this.sprites.destroy({ children: true });
    this.bars.destroy();
    this.smoke?.destroy();
  }
}
