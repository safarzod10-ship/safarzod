/**
 * Draws one city on the map: its land (a soft warm tint of the owned cells),
 * its buildings (atlas sprites, y-sorted) and construction progress bars.
 * Used for the player's own city and for neighbours seen up close.
 * Rebuilt only when the city's layout changes, never per frame.
 */
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../../core/math.ts';
import { getBit } from '../../game/bits.ts';
import { BUILDINGS, CELL_M } from '../../game/config.ts';
import { buildHours, type RegionMask } from '../../game/rules.ts';
import type { Building } from '../../game/types.ts';
import type { BuildingAtlas } from './atlas.ts';
import { PAD_M, PX_PER_M } from './buildingArt.ts';

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

  constructor(atlas: BuildingAtlas, layers: CityLayers, mask: RegionMask, own: boolean) {
    this.atlas = atlas;
    this.mask = mask;
    this.own = own;
    this.land.eventMode = 'none';
    this.sprites.eventMode = 'none';
    this.sprites.sortableChildren = false;
    this.bars.eventMode = 'none';
    layers.ground.addChild(this.land);
    layers.objects.addChild(this.sprites);
    layers.overlay.addChild(this.bars);
  }

  /** Rebuild land and buildings. */
  set(owned: Uint8Array, buildings: Building[], now: number): void {
    this.drawLand(owned);
    this.buildingsList = buildings;
    const list = buildings.slice().sort((a, b) => a.y + BUILDINGS[a.t].size - (b.y + BUILDINGS[b.t].size) || a.x - b.x);
    // reuse sprites
    const kids = this.sprites.children as Sprite[];
    while (kids.length > list.length) kids[kids.length - 1].destroy();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let s = kids[i];
      if (!s) {
        s = new Sprite();
        s.scale.set(1 / PX_PER_M);
        this.sprites.addChild(s);
      }
      s.texture = this.atlas.get(b.t, b.lvl, variantOf(b));
      s.position.set(b.x * CELL_M - PAD_M, b.y * CELL_M - PAD_M);
    }
    this.atlas.flush();
    this.drawBars(now);
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
      const w = Math.min(40, size * 0.7);
      const x = b.x * CELL_M + (size - w) / 2;
      const y = b.y * CELL_M + size - 7;
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
  }

  private drawLand(owned: Uint8Array): void {
    const m = this.mask;
    const canvas = document.createElement('canvas');
    // one pixel per cell + a 1 px frame so the soft edge fades to nothing
    canvas.width = m.w + 2;
    canvas.height = m.h + 2;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const own = this.own;
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        if (!getBit(owned, i)) continue;
        const edge =
          x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1 ||
          !getBit(owned, i - 1) || !getBit(owned, i + 1) || !getBit(owned, i - m.w) || !getBit(owned, i + m.w);
        const o = ((y + 1) * canvas.width + (x + 1)) * 4;
        img.data[o] = own ? 252 : 240;
        img.data[o + 1] = own ? 238 : 236;
        img.data[o + 2] = own ? 196 : 220;
        img.data[o + 3] = edge ? (own ? 150 : 90) : own ? 105 : 60;
      }
    ctx.putImageData(img, 0, 0);
    this.landSource?.destroy();
    this.landSource = new CanvasSource({ resource: canvas, scaleMode: 'linear' });
    this.land.texture = new Texture({ source: this.landSource });
    this.land.position.set((m.x0 - 1) * CELL_M, (m.y0 - 1) * CELL_M);
    this.land.scale.set(CELL_M);
  }

  destroy(): void {
    this.land.destroy();
    this.landSource?.destroy();
    this.sprites.destroy({ children: true });
    this.bars.destroy();
  }
}
