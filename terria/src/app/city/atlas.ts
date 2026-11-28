/**
 * Lazily painted texture atlas for buildings: every (type, level, variant)
 * is painted once into a shared 2048 px canvas page, so all buildings of all
 * visible cities batch into very few draw calls. Pages are uploaded to the
 * GPU only when something new was painted (flush()).
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import type { BuildingType } from '../../game/config.ts';
import { paintBuilding, tilePx } from './buildingArt.ts';

const PAGE = 2048;

interface Page {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  source: CanvasSource;
  x: number;
  y: number;
  rowH: number;
  dirty: boolean;
}

export class BuildingAtlas {
  private readonly pages: Page[] = [];
  private readonly cache = new Map<string, Texture>();

  get(t: BuildingType, lvl: number, variant: number): Texture {
    const key = `${t}:${lvl}:${variant}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const px = tilePx(t);
    let page = this.pages[this.pages.length - 1];
    if (!page || !this.fits(page, px)) {
      if (page && page.x + px > PAGE) {
        page.x = 0;
        page.y += page.rowH + 2;
        page.rowH = 0;
      }
      if (!page || page.y + px > PAGE) page = this.newPage();
    }
    if (page.x + px > PAGE) {
      page.x = 0;
      page.y += page.rowH + 2;
      page.rowH = 0;
    }
    const x = page.x;
    const y = page.y;
    page.ctx.clearRect(x, y, px, px);
    paintBuilding(page.ctx, x, y, t, lvl, variant);
    page.x += px + 2;
    page.rowH = Math.max(page.rowH, px);
    page.dirty = true;
    const tex = new Texture({ source: page.source, frame: new Rectangle(x, y, px, px) });
    this.cache.set(key, tex);
    return tex;
  }

  private fits(p: Page, px: number): boolean {
    if (p.x + px <= PAGE && p.y + px <= PAGE) return true;
    return p.y + p.rowH + 2 + px <= PAGE;
  }

  private newPage(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PAGE;
    const ctx = canvas.getContext('2d')!;
    const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
    const page: Page = { canvas, ctx, source, x: 0, y: 0, rowH: 0, dirty: false };
    this.pages.push(page);
    return page;
  }

  /** Upload pages that changed. Call after a batch of get()s. */
  flush(): void {
    for (const p of this.pages)
      if (p.dirty) {
        p.dirty = false;
        p.source.update();
      }
  }

  destroy(): void {
    for (const t of this.cache.values()) t.destroy(false);
    for (const p of this.pages) p.source.destroy();
    this.cache.clear();
    this.pages.length = 0;
  }
}
