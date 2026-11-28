/**
 * Map overlays for the two editing modes:
 * - Ghost: the building being placed, snapped to the grid, tinted by validity.
 * - ExpandOverlay: buyable frontier cells and the cells picked for purchase.
 */
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { getBit } from '../../game/bits.ts';
import { BUILDINGS, CELL_M, type BuildingType } from '../../game/config.ts';
import type { RegionMask } from '../../game/rules.ts';
import type { BuildingAtlas } from './atlas.ts';
import { PAD_M, PX_PER_M } from './buildingArt.ts';

export class Ghost {
  readonly container = new Container({ label: 'ghost' });
  private readonly sprite = new Sprite();
  private readonly frame = new Graphics();
  private readonly atlas: BuildingAtlas;
  private type: BuildingType | null = null;

  constructor(atlas: BuildingAtlas, overlay: Container) {
    this.atlas = atlas;
    this.container.eventMode = 'none';
    this.sprite.scale.set(1 / PX_PER_M);
    this.sprite.alpha = 0.82;
    this.container.addChild(this.frame, this.sprite);
    this.container.visible = false;
    overlay.addChild(this.container);
  }

  show(t: BuildingType): void {
    this.type = t;
    this.sprite.texture = this.atlas.get(t, 1, 1);
    this.atlas.flush();
    this.container.visible = true;
  }

  hide(): void {
    this.type = null;
    this.container.visible = false;
  }

  /** @param scale camera scale, keeps the frame line ~2 px on screen */
  place(cx: number, cy: number, valid: boolean, scale: number): void {
    if (!this.type) return;
    const s = BUILDINGS[this.type].size * CELL_M;
    const x = cx * CELL_M;
    const y = cy * CELL_M;
    this.sprite.position.set(x - PAD_M, y - PAD_M);
    const lw = 2 / scale;
    const col = valid ? 0x2f9a77 : 0xc0442e;
    this.frame
      .clear()
      .rect(x, y, s, s)
      .fill({ color: col, alpha: 0.22 })
      .rect(x, y, s, s)
      .stroke({ color: col, width: lw, alpha: 0.95 });
    // grid ticks so the footprint reads as cells
    const n = BUILDINGS[this.type].size;
    for (let i = 1; i < n; i++) {
      this.frame.moveTo(x + i * CELL_M, y).lineTo(x + i * CELL_M, y + s);
      this.frame.moveTo(x, y + i * CELL_M).lineTo(x + s, y + i * CELL_M);
    }
    this.frame.stroke({ color: 0xffffff, width: lw * 0.5, alpha: 0.5 });
  }
}

const PX = 6; // pixels per cell in the overlay canvas

export class ExpandOverlay {
  private readonly sprite = new Sprite();
  private source: CanvasSource | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(overlay: Container) {
    this.sprite.eventMode = 'none';
    this.sprite.visible = false;
    overlay.addChild(this.sprite);
  }

  hide(): void {
    this.sprite.visible = false;
  }

  /** Redraw: frontier of (owned + selected), selected cells highlighted. */
  draw(m: RegionMask, owned: Uint8Array, selected: Set<number>): number[] {
    if (!this.canvas || this.canvas.width !== m.w * PX || this.canvas.height !== m.h * PX) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = m.w * PX;
      this.canvas.height = m.h * PX;
      this.source?.destroy();
      this.source = new CanvasSource({ resource: this.canvas, scaleMode: 'nearest' });
      this.sprite.texture = new Texture({ source: this.source });
      this.sprite.position.set(m.x0 * CELL_M, m.y0 * CELL_M);
      this.sprite.scale.set(CELL_M / PX);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const taken = (i: number): boolean => getBit(owned, i) || selected.has(i);
    const frontier: number[] = [];
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        if (!getBit(m.build, i)) continue;
        if (selected.has(i)) {
          ctx.fillStyle = 'rgba(23, 143, 158, 0.62)';
          ctx.fillRect(x * PX, y * PX, PX, PX);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fillRect(x * PX + 2, y * PX + 2, PX - 4, PX - 4);
          ctx.fillStyle = 'rgba(23, 143, 158, 0.9)';
          ctx.fillRect(x * PX + 2.5, y * PX + 2.5, PX - 5, PX - 5);
          continue;
        }
        if (getBit(owned, i)) continue;
        const near =
          (x > 0 && taken(i - 1)) || (x < m.w - 1 && taken(i + 1)) || (y > 0 && taken(i - m.w)) || (y < m.h - 1 && taken(i + m.w));
        if (near) {
          frontier.push(i);
          ctx.fillStyle = 'rgba(255, 252, 235, 0.42)';
          ctx.fillRect(x * PX, y * PX, PX, PX);
          ctx.fillStyle = 'rgba(15, 50, 69, 0.35)';
          ctx.fillRect(x * PX + PX / 2 - 0.5, y * PX + PX / 2 - 0.5, 1, 1);
        } else {
          // the rest of the region: a faint wash so its extent is readable
          ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
          ctx.fillRect(x * PX, y * PX, PX, PX);
        }
      }
    this.source!.update();
    this.sprite.visible = true;
    return frontier;
  }
}
