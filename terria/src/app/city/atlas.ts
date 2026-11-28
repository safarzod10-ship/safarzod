/**
 * Pre-rendered 3D building sprites (tools/models: three.js models rendered
 * from the game's 40 degree camera angle into a WebP atlas).
 *
 * A sprite is drawn inside the tilted world container, so its vertical
 * scale undoes the tilt: the picture already contains the foreshortening.
 * (ax, ay) is the pixel of the lot centre; it becomes the sprite anchor.
 */
import { ImageSource, Rectangle, Sprite, Texture } from 'pixi.js';
import { BUILDINGS, type BuildingType } from '../../game/config.ts';

interface Frame {
  p: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
interface AtlasJson {
  pxPerM: number;
  tilt: number;
  pages: string[];
  sprites: Record<string, Frame>;
}

export class BuildingAtlas {
  private json: AtlasJson | null = null;
  private bitmaps: ImageBitmap[] = [];
  private sources: ImageSource[] = [];
  private readonly textures = new Map<string, Texture>();
  readonly ready: Promise<void>;

  constructor(base = './models/') {
    this.ready = this.load(base);
  }

  private async load(base: string): Promise<void> {
    const json = (await (await fetch(base + 'atlas.json')).json()) as AtlasJson;
    const bitmaps = await Promise.all(
      json.pages.map(async (f) => createImageBitmap(await (await fetch(base + f)).blob(), { premultiplyAlpha: 'none' })),
    );
    this.bitmaps = bitmaps;
    this.sources = bitmaps.map((b) => new ImageSource({ resource: b, autoGenerateMipmaps: true, scaleMode: 'linear' }));
    this.json = json;
  }

  get loaded(): boolean {
    return this.json !== null;
  }

  /** Sprite key of a building at a level (0 = construction site). */
  key(t: BuildingType, lvl: number): string {
    const d = BUILDINGS[t];
    if (lvl < 1) return `site:${d.size}`;
    return `${t}:${Math.min(Math.max(1, lvl), d.maxLevel)}`;
  }

  frame(key: string): Frame | null {
    return this.json?.sprites[key] ?? null;
  }

  texture(key: string): Texture {
    let t = this.textures.get(key);
    if (t) return t;
    const f = this.frame(key);
    if (!f) return Texture.EMPTY;
    t = new Texture({ source: this.sources[f.p], frame: new Rectangle(f.x, f.y, f.w, f.h) });
    this.textures.set(key, t);
    return t;
  }

  /** Metres per sprite pixel, horizontally. */
  get mPerPx(): number {
    return 1 / (this.json?.pxPerM ?? 3);
  }

  /**
   * Show sprite `key` with the lot centre at world (wx, wy). The sprite must
   * live inside the tilted world container.
   */
  apply(s: Sprite, key: string, wx: number, wy: number): void {
    const f = this.frame(key);
    if (!f || !this.json) {
      s.visible = false;
      return;
    }
    s.visible = true;
    s.texture = this.texture(key);
    s.anchor.set(f.ax / f.w, f.ay / f.h);
    const k = 1 / this.json.pxPerM;
    s.scale.set(k, k / this.json.tilt);
    s.position.set(wx, wy);
  }

  /** A picture of the building for the UI (data URL), fitted into a square. */
  thumbnail(key: string, cssPx: number): string | null {
    const f = this.frame(key);
    if (!f) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(cssPx * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d')!;
    const k = Math.min(px / f.w, px / f.h);
    const w = f.w * k;
    const h = f.h * k;
    ctx.drawImage(this.bitmaps[f.p], f.x, f.y, f.w, f.h, (px - w) / 2, (px - h) / 2, w, h);
    return c.toDataURL('image/png');
  }

  destroy(): void {
    for (const t of this.textures.values()) t.destroy(false);
    for (const s of this.sources) s.destroy();
    for (const b of this.bitmaps) b.close();
    this.textures.clear();
  }
}

/** One shared atlas for the whole app (the UI thumbnails use it too). */
export const models = new BuildingAtlas();

const thumbs = new Map<string, string>();
/** <img> of a building for panels; fills in once the atlas has loaded. */
export function thumbnail(t: BuildingType, lvl: number, cssPx: number): HTMLImageElement {
  const img = document.createElement('img');
  img.width = img.height = cssPx;
  img.alt = BUILDINGS[t].name;
  img.className = 't-thumb';
  const key = models.key(t, lvl);
  const fill = (): void => {
    const id = `${key}:${cssPx}`;
    let url = thumbs.get(id);
    if (!url) {
      url = models.thumbnail(key, cssPx) ?? '';
      if (url) thumbs.set(id, url);
    }
    if (url) img.src = url;
  };
  if (models.loaded) fill();
  else void models.ready.then(fill);
  return img;
}
