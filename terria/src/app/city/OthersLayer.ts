/**
 * Everyone else on the continent: a dot per city when zoomed out, atlas-style
 * italic name labels at middle zoom, and the real buildings of the cities
 * near the camera when zoomed in (fetched on demand, a few kept in memory).
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { CameraView } from '../../camera/CameraController.ts';
import { CELL_M } from '../../game/config.ts';
import { fromB64 } from '../../game/bits.ts';
import { decodeMask, type RegionMask } from '../../game/rules.ts';
import type { PublicCity, WorldCitySummary } from '../../game/types.ts';
import type { Api } from '../api.ts';
import type { BuildingAtlas } from './atlas.ts';
import { CityRenderer, type CityLayers } from './CityRenderer.ts';

export interface RegionIndexEntry {
  id: number;
  cells: number;
  hx: number;
  hy: number;
}

const LABEL_POOL = 36;
const DETAIL_FROM = 0.28; // css px per metre: show buildings of neighbours
const LABEL_FROM = 0.035;

export class OthersLayer {
  private readonly dots = new Graphics();
  private ownAt: { x: number; y: number } | null = null;
  private readonly labels = new Container({ label: 'city-labels' });
  private readonly pool: Text[] = [];
  private cities: WorldCitySummary[] = [];
  private index: RegionIndexEntry[] = [];
  private lastDotScale = 0;
  private readonly detailed = new Map<number, { r: CityRenderer; used: number }>();
  private readonly loading = new Set<number>();
  private readonly masks = new Map<number, RegionMask>();
  private ownRegion = -1;
  private frame = 0;
  onClearingsChanged: (() => void) | null = null;

  private readonly api: Api;
  private readonly atlas: BuildingAtlas;
  private readonly layers: CityLayers;

  constructor(api: Api, atlas: BuildingAtlas, layers: CityLayers) {
    this.api = api;
    this.atlas = atlas;
    this.layers = layers;
    this.dots.eventMode = 'none';
    this.labels.eventMode = 'none';
    layers.overlay.addChild(this.dots, this.labels);
    const style = new TextStyle({
      fontFamily: 'Alegreya, Georgia, serif',
      fontStyle: 'italic',
      fontWeight: '600',
      fontSize: 30,
      fill: 0x173f52,
      letterSpacing: 2,
      stroke: { color: 0xf4f7f2, width: 6, join: 'round' },
    });
    for (let i = 0; i < LABEL_POOL; i++) {
      const t = new Text({ text: '', style, resolution: 2 });
      t.anchor.set(0.5, 1);
      t.visible = false;
      this.pool.push(t);
      this.labels.addChild(t);
    }
  }

  setIndex(index: RegionIndexEntry[]): void {
    this.index = index;
  }

  setOwn(regionId: number, hallX?: number, hallY?: number): void {
    this.ownRegion = regionId;
    if (hallX !== undefined && hallY !== undefined) this.ownAt = { x: (hallX + 2) * CELL_M, y: (hallY + 2) * CELL_M };
    this.lastDotScale = 0;
  }

  setCities(list: WorldCitySummary[]): void {
    this.cities = list;
    this.lastDotScale = 0;
  }

  /** Find a city whose town hall is near a world point (for taps). */
  cityNear(wx: number, wy: number, scale: number): WorldCitySummary | null {
    const r = Math.max(60, 22 / scale);
    let best: WorldCitySummary | null = null;
    let bd = r * r;
    for (const c of this.cities) {
      const e = this.index[c.r];
      if (!e || c.r === this.ownRegion) continue;
      const dx = (e.hx + 2) * CELL_M - wx;
      const dy = (e.hy + 2) * CELL_M - wy;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Detailed neighbour cities intersecting a view rectangle. */
  clearings(): { x: number; y: number; width: number; height: number }[] {
    const out = [];
    for (const d of this.detailed.values()) out.push(...d.r.clearings());
    return out;
  }

  update(view: CameraView): void {
    this.frame++;
    const s = view.scale;
    // dots keep a constant screen size; redraw only when the zoom changed enough
    if (Math.abs(s - this.lastDotScale) / s > 0.06) {
      this.lastDotScale = s;
      this.drawDots(s);
    }
    this.placeLabels(view);
    if (s >= DETAIL_FROM) this.loadDetail(view);
    for (const [id, d] of this.detailed) {
      d.r.setVisible(s >= DETAIL_FROM * 0.8);
      if (this.frame - d.used > 600 && this.detailed.size > 6) {
        d.r.destroy();
        this.detailed.delete(id);
        this.onClearingsChanged?.();
      }
    }
  }

  private drawDots(scale: number): void {
    const g = this.dots.clear();
    if (scale > DETAIL_FROM) return;
    const px = 1 / scale;
    for (const c of this.cities) {
      const e = this.index[c.r];
      if (!e || c.r === this.ownRegion) continue;
      const x = (e.hx + 2) * CELL_M;
      const y = (e.hy + 2) * CELL_M;
      const size = (1.3 + c.th * 0.32) * px;
      const col = c.s === 'abandoned' ? 0x8f9a9e : 0x173f52;
      g.circle(x, y, size + 1.1 * px).fill({ color: 0xf6f8f3, alpha: 0.9 });
      g.circle(x, y, size).fill({ color: col, alpha: c.s === 'abandoned' ? 0.6 : 0.85 });
    }
    // the player's own city: a gold seal that stays findable from anywhere
    if (this.ownAt) {
      const { x, y } = this.ownAt;
      g.circle(x, y, 9 * px).fill({ color: 0xb9861c, alpha: 0.22 });
      g.circle(x, y, 5.5 * px).fill({ color: 0xf6f8f3 });
      g.circle(x, y, 4 * px).fill({ color: 0xb9861c });
    }
  }

  private placeLabels(view: CameraView): void {
    const s = view.scale;
    let used = 0;
    if (s >= LABEL_FROM) {
      const b = view.bounds;
      const k = 1 / (s * 2.4); // ~12.5 css px text
      for (const c of this.cities) {
        if (used >= LABEL_POOL) break;
        const e = this.index[c.r];
        if (!e || c.r === this.ownRegion) continue;
        const x = (e.hx + 2) * CELL_M;
        const y = (e.hy + 2) * CELL_M;
        if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue;
        // at low zoom only the bigger cities get a name
        if (s < 0.08 && c.th < 3) continue;
        const t = this.pool[used++];
        const label = c.s === 'abandoned' ? `${c.n} · заброшен` : c.n;
        if (t.text !== label) t.text = label;
        t.alpha = c.s === 'abandoned' ? 0.55 : 1;
        t.scale.set(k);
        t.position.set(x, y - 8 / s);
        t.visible = true;
      }
    }
    for (let i = used; i < LABEL_POOL; i++) this.pool[i].visible = false;
  }

  private loadDetail(view: CameraView): void {
    const b = view.bounds;
    for (const c of this.cities) {
      if (c.r === this.ownRegion) continue;
      const e = this.index[c.r];
      if (!e) continue;
      const x = (e.hx + 2) * CELL_M;
      const y = (e.hy + 2) * CELL_M;
      const pad = 700;
      if (x < b.x - pad || x > b.x + b.width + pad || y < b.y - pad || y > b.y + b.height + pad) continue;
      const hit = this.detailed.get(c.r);
      if (hit) {
        hit.used = this.frame;
        continue;
      }
      if (this.loading.has(c.r) || this.loading.size >= 2) continue;
      this.loading.add(c.r);
      void this.fetchCity(c.r).finally(() => this.loading.delete(c.r));
    }
  }

  private async fetchCity(id: number): Promise<void> {
    try {
      const [pub, mask] = await Promise.all([this.api.publicCity(id), this.mask(id)]);
      this.show(pub, mask);
    } catch {
      /* a neighbour is decoration: ignore failures */
    }
  }

  private async mask(id: number): Promise<RegionMask> {
    const hit = this.masks.get(id);
    if (hit) return hit;
    const m = decodeMask(await this.api.region(id));
    this.masks.set(id, m);
    return m;
  }

  private show(pub: PublicCity, mask: RegionMask): void {
    const r = new CityRenderer(this.atlas, this.layers, mask, false);
    r.set(fromB64(pub.owned, (mask.w * mask.h + 7) >> 3), pub.buildings, Date.now());
    this.detailed.set(pub.regionId, { r, used: this.frame });
    this.onClearingsChanged?.();
  }
}
