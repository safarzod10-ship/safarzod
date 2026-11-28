/**
 * The game on top of the map: wires the store (server state + prediction),
 * the city layers on the map, the editing modes and the UI shell.
 */
import type { CameraView } from '../camera/CameraController.ts';
import { BUILDINGS, CELL_M, type BuildingType } from '../game/config.ts';
import { getBit } from '../game/bits.ts';
import {
  builderCount,
  busyBuilders,
  buildingCost,
  canAfford,
  cityStats,
  ERRORS,
  landCost,
  landCrystals,
  ownedBits,
  placementError,
  occupancy,
  type RegionMask,
} from '../game/rules.ts';
import type { CityState, MeResponse, WorldCitySummary } from '../game/types.ts';
import type { MapApp } from '../rendering/MapApp.ts';
import { ApiError, type Api } from './api.ts';
import { models } from './city/atlas.ts';
import { CityRenderer } from './city/CityRenderer.ts';
import { Clouds } from './clouds.ts';
import { OthersLayer, type RegionIndexEntry } from './city/OthersLayer.ts';
import { ExpandOverlay, Ghost } from './city/tools.ts';
import type { Game } from './context.ts';
import { btn, h, int, num, plural } from './dom.ts';
import { UI_SVG } from './icons.ts';
import { Store, errorText } from './store.ts';
import { haptic, openInvoice, tg, tgUserName, watchSafeArea } from './tg.ts';
import { buildScreen } from './ui/build.ts';
import { buildingScreen } from './ui/building.ts';
import { cityScreen } from './ui/city.ts';
import { marketScreen } from './ui/market.ts';
import { otherCityScreen, treasuryScreen } from './ui/misc.ts';
import { showOnboarding } from './ui/onboarding.ts';
import { profileScreen } from './ui/profile.ts';
import { Shell, type Tab } from './ui/shell.ts';
import './app.css';

type Mode =
  | { kind: 'none' }
  | { kind: 'build'; t: BuildingType; cx: number; cy: number; pinned: boolean }
  | { kind: 'expand'; selected: Set<number>; brush: boolean; pay: 'coins' | 'crystals' };

const GUIDE_KEY = 'terria-guide-done';

export class TerriaGame implements Game {
  readonly store: Store;
  readonly shell: Shell;
  readonly map: MapApp;
  private readonly atlas = models;
  private city: CityRenderer | null = null;
  private readonly ghost: Ghost;
  private readonly expand: ExpandOverlay;
  private readonly others: OthersLayer;
  private mode: Mode = { kind: 'none' };
  private renderedLayout = -1;
  private secondTimer = 0;
  private worldTimer = 0;
  private perfToggle: () => void;
  private frontier: number[] = [];

  constructor(map: MapApp, root: HTMLElement, api: Api, perfToggle: () => void) {
    this.map = map;
    this.perfToggle = perfToggle;
    this.store = new Store(api);
    this.shell = new Shell(root);
    const layers = map.scene.layers;
    this.ghost = new Ghost(this.atlas, layers.overlay);
    this.expand = new ExpandOverlay(layers.overlay);
    this.others = new OthersLayer(api, this.atlas, layers);
    this.others.onClearingsChanged = () => this.updateClearings();
    this.shell.onTab = (t) => this.openTab(t);
    this.shell.onTreasury = () => this.shell.openSheet(treasuryScreen(this));
    this.store.on(() => this.onStore());
    this.store.onError((m) => this.shell.toast(m, true));
    this.sideButtons();
    watchSafeArea();
  }

  /** Called once the loading screen has revealed the map. */
  async start(me: Promise<MeResponse>): Promise<void> {
    await this.atlas.ready.catch((e) => console.error('building models failed to load', e));
    void Clouds.create(this.map);
    this.shell.show();
    void this.loadWorld();
    let res: MeResponse;
    try {
      res = await me;
    } catch (err) {
      this.shell.toast(err instanceof ApiError ? errorText(err.code, err.message) : 'Нет связи с сервером', true);
      return;
    }
    this.store.user = res.user;
    if (!res.city) {
      this.shell.root.classList.add('no-city'); // nothing to show until the city exists
      this.map.camera.fitWorld();
      showOnboarding(
        this.shell.root,
        {
          found: async (name) => {
            try {
              const r = await this.store.api.createCity(name);
              if (!r.city) return r.full ? 'full' : 'error';
              await this.store.loadMask(r.city.regionId);
              this.store.setServer(r.city, r.serverTime);
              this.store.user = r.user;
              this.flyToCity(true);
              return 'ok';
            } catch (err) {
              if (err instanceof ApiError && err.code === 'full') return 'full';
              return 'error';
            }
          },
          done: () => {
            this.flyToCity(false, 1.1);
            this.showGuide();
          },
        },
        tgUserName() ? `Город ${tgUserName()}` : '',
        res.freeRegions,
      );
      return;
    }
    await this.store.loadMask(res.city.regionId);
    this.store.setServer(res.city, res.serverTime);
    this.flyToCity(false);
    this.showGuide();
  }

  // ------------------------------------------------------------------ frame
  private onStore(): void {
    const c = this.store.city;
    const m = this.store.mask;
    if (!c || !m) return;
    if (!this.city) {
      this.city = new CityRenderer(this.atlas, this.map.scene.layers, m, true);
      this.map.addFrameListener((view, dt, t) => {
        const smoke = this.city?.smoke;
        if (!smoke?.active) return;
        // puffs are only worth drawing when the buildings are big enough to see
        const near = view.scale > 0.35;
        smoke.setVisible(near);
        // (no wake(): when nothing else moves the map runs at its calm idle rate)
        if (near) smoke.update(dt, t);
      });
      this.map.scene.regions.select(m.id);
      this.others.setOwn(m.id, m.hall.x, m.hall.y);
      this.shell.root.classList.remove('no-city');
    }
    if (this.store.layoutVersion !== this.renderedLayout) {
      this.renderedLayout = this.store.layoutVersion;
      this.city.set(ownedBits(c, m), c.buildings, this.store.now());
      this.updateClearings();
      if (this.mode.kind === 'expand') this.redrawExpand();
      if (this.mode.kind === 'build') this.placeGhost();
      this.map.wake();
    }
    const s = cityStats(c, m);
    const perHour = { coins: s.income.net } as Record<string, number>;
    for (const r of ['wood', 'stone', 'iron', 'food', 'goods'] as const) perHour[r] = s.prod[r] - s.use[r];
    this.shell.setTop({ res: c.res, perHour, crystals: c.crystals, pop: c.pop, housing: s.housing, happiness: s.happiness, storage: s.storage });
    this.shell.setBadge('build', 0);
    this.updateGuide();
  }

  /** Once a second: economy prediction, timers, progress bars. */
  private second(): void {
    this.store.tick();
    if (this.city?.hasConstruction) {
      this.city.drawBars(this.store.now());
      this.map.wake();
    }
    this.shell.refresh();
  }

  private onCamera(view: CameraView): void {
    this.others.update(view);
    if (this.mode.kind === 'build' && !this.mode.pinned) this.placeGhost();
  }

  private updateClearings(): void {
    const own = this.city?.clearings() ?? [];
    this.map.scene.trees.setClearings([...own, ...this.others.clearings()]);
  }

  bind(): void {
    this.map.camera.onChange((v) => this.onCamera(v));
    this.onCamera(this.map.camera.getView());
    this.secondTimer = window.setInterval(() => this.second(), 1000);
    this.worldTimer = window.setInterval(() => void this.loadWorld(), 120_000);
    const vp = this.map.camera.viewport;
    vp.on('clicked', (ev) => {
      const w = this.map.camera.screenToWorld(ev.screen.x, ev.screen.y);
      this.onTap(w.x, w.y);
    });
    // brush painting in expand mode
    vp.on('pointerdown', (e) => {
      if (this.mode.kind !== 'expand' || !this.mode.brush) return;
      this.painting = true;
      const p = this.map.camera.screenToWorld(e.global.x, e.global.y);
      this.paintAt(p.x, p.y);
    });
    vp.on('pointermove', (e) => {
      if (!this.painting) return;
      const p = this.map.camera.screenToWorld(e.global.x, e.global.y);
      this.paintAt(p.x, p.y);
    });
    const stop = (): void => void (this.painting = false);
    vp.on('pointerup', stop);
    vp.on('pointerupoutside', stop);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.store.refresh().catch(() => undefined);
      else void this.store.flush();
    });
  }
  private painting = false;

  private async loadWorld(): Promise<void> {
    try {
      const [list, index] = await Promise.all([this.store.api.world(), this.regionIndex()]);
      this.others.setIndex(index);
      this.others.setCities(list.cities);
      this.onCamera(this.map.camera.getView());
    } catch {
      /* the map works without neighbours */
    }
  }

  private indexCache: RegionIndexEntry[] | null = null;
  private async regionIndex(): Promise<RegionIndexEntry[]> {
    if (this.indexCache) return this.indexCache;
    const q = new URLSearchParams(location.search);
    const base = (q.get('api') ?? '.').replace(/\/$/, '');
    const r = await fetch(`${base}/regions/index.json`);
    const j = (await r.json()) as { regions: RegionIndexEntry[] };
    this.indexCache = j.regions;
    return j.regions;
  }

  // ------------------------------------------------------------------ taps
  private onTap(wx: number, wy: number): void {
    const m = this.store.mask;
    if (this.mode.kind === 'build') {
      if (!m) return;
      const s = BUILDINGS[this.mode.t].size;
      this.mode.cx = Math.floor(wx / CELL_M - s / 2 + 0.5);
      this.mode.cy = Math.floor(wy / CELL_M - s / 2 + 0.5);
      this.mode.pinned = true;
      haptic.select();
      this.placeGhost(false);
      return;
    }
    if (this.mode.kind === 'expand') {
      if (!this.mode.brush) this.toggleCell(wx, wy);
      return;
    }
    const b = this.city?.pick(wx, wy);
    if (b) {
      haptic.tap();
      if (b.t === 'townhall') this.openTab('city');
      else this.openBuilding(b.id);
      return;
    }
    const other = this.others.cityNear(wx, wy, this.map.camera.getView().scale);
    if (other) {
      haptic.tap();
      this.shell.openSheet(otherCityScreen(this, other, () => this.flyToRegion(other)));
    }
  }

  private flyToRegion(c: WorldCitySummary): void {
    void this.regionIndex().then((idx) => {
      const e = idx[c.r];
      if (e) this.map.camera.flyTo((e.hx + 2) * CELL_M, (e.hy + 2) * CELL_M, 0.6, true);
    });
  }

  // ------------------------------------------------------------------ Game API
  openTab(t: Tab): void {
    if (this.mode.kind !== 'none') this.endMode();
    this.shell.setTab(t);
    if (!this.store.city && t !== 'map') {
      this.shell.toast('Сначала основайте город');
      this.shell.setTab('map');
      return;
    }
    switch (t) {
      case 'map':
        this.shell.closeSheet();
        break;
      case 'build':
        this.shell.openSheet(buildScreen(this));
        break;
      case 'market':
        this.shell.openSheet(marketScreen(this));
        break;
      case 'city':
        this.shell.openSheet(cityScreen(this));
        break;
      case 'profile':
        this.shell.openSheet(profileScreen(this));
        break;
    }
  }

  openBuilding(id: number): void {
    this.shell.setTab('map');
    this.shell.openSheet(buildingScreen(this, id));
  }

  flyHome(): void {
    this.flyToCity(false);
  }

  togglePerf(): void {
    this.perfToggle();
  }

  async buyPack(pack: string): Promise<void> {
    try {
      const { link } = await this.store.api.invoice(pack);
      let status: string;
      if (link.startsWith('mock-invoice:')) {
        // dev mock: pretend Telegram charged the stars
        const t = this.store.api.t as unknown as { pay?: (p: string) => void };
        t.pay?.(pack);
        status = 'paid';
      } else if (tg()?.openInvoice) status = await openInvoice(link);
      else {
        window.open(link, '_blank');
        status = 'pending';
      }
      if (status === 'paid') {
        haptic.ok();
        this.shell.toast('Кристаллы зачислены');
        await this.store.refresh();
        this.shell.refresh();
      } else if (status === 'failed') this.shell.toast('Оплата не прошла', true);
    } catch (err) {
      this.shell.toast(err instanceof ApiError ? errorText(err.code, err.message) : 'Оплата сейчас недоступна', true);
    }
  }

  // ------------------------------------------------------------------ build mode
  startBuild(t: BuildingType): void {
    const c = this.store.city;
    if (!c) return;
    this.endMode();
    this.mode = { kind: 'build', t, cx: 0, cy: 0, pinned: false };
    const d = BUILDINGS[t];
    this.shell.setTab('build');
    this.shell.openMode(d.name, () => this.endMode());
    this.shell.root.classList.add('is-placing');
    this.ghost.show(t);
    const tools = this.shell.modeTools;
    btn(tools, 't-btn ghost', 'Отмена', () => this.endMode());
    this.confirmBtn = btn(tools, 't-btn', `${UI_SVG.check}Построить`, () => this.confirmBuild());
    // zoom in enough to see cells
    const v = this.map.camera.getView();
    if (v.scale < 0.7) this.flyToCity(false, 1);
    this.placeGhost();
    // start on the nearest free spot instead of on top of another building
    const m = this.store.mask;
    if (m && placementError(c, m, t, this.mode.cx, this.mode.cy)) {
      const spot = nearestFreeSpot(c, m, t, this.mode.cx, this.mode.cy);
      if (spot) {
        this.mode.cx = spot.x;
        this.mode.cy = spot.y;
        this.mode.pinned = true;
        this.placeGhost(false);
      }
    }
  }
  private confirmBtn: HTMLButtonElement | null = null;

  /** Position the ghost: at the tapped cell, or under the screen centre. */
  private placeGhost(followCentre = true): void {
    if (this.mode.kind !== 'build') return;
    const c = this.store.city;
    const m = this.store.mask;
    if (!c || !m) return;
    const t = this.mode.t;
    const s = BUILDINGS[t].size;
    if (followCentre && !this.mode.pinned) {
      const r = this.map.app.renderer.screen;
      const p = this.map.camera.screenToWorld(r.width / 2, r.height * 0.42);
      this.mode.cx = Math.floor(p.x / CELL_M - s / 2 + 0.5);
      this.mode.cy = Math.floor(p.y / CELL_M - s / 2 + 0.5);
    }
    const err = placementError(c, m, t, this.mode.cx, this.mode.cy);
    const cost = buildingCost(t, 1);
    const d = BUILDINGS[t];
    const noBuilder = d.category !== 'decor' && busyBuilders(c, this.store.now()) >= builderCount(c);
    const money = canAfford(c, cost) && (!d.crystals || c.crystals >= d.crystals);
    this.ghost.place(this.mode.cx, this.mode.cy, !err, this.map.camera.getView().scale);
    const msg = this.shell.modeMsg;
    msg.className = 't-mode__msg';
    if (err === 'not_owned') {
      msg.textContent = 'Здесь не ваша земля. Двигайте карту или нажмите на свободное место.';
      msg.classList.add('bad');
    } else if (err === 'occupied') {
      msg.textContent = 'Место занято другим зданием.';
      msg.classList.add('bad');
    } else if (noBuilder) {
      msg.textContent = 'Все строители заняты.';
      msg.classList.add('bad');
    } else if (!money) {
      msg.textContent = 'Не хватает ресурсов.';
      msg.classList.add('bad');
    } else msg.textContent = `${d.size}×${d.size} клетки. Нажмите на карту, чтобы выбрать место.`;
    if (this.confirmBtn) this.confirmBtn.disabled = !!err || noBuilder || !money;
    this.map.wake();
  }

  private confirmBuild(): void {
    if (this.mode.kind !== 'build') return;
    const { t, cx, cy } = this.mode;
    const r = this.store.act({ type: 'build', t, x: cx, y: cy });
    if (!r.ok) {
      this.shell.toast(ERRORS[r.error] ?? r.error, true);
      return;
    }
    haptic.ok();
    this.shell.toast(`${BUILDINGS[t].name}: стройка началась`);
    this.endMode();
  }

  // ------------------------------------------------------------------ expand mode
  startExpand(): void {
    const c = this.store.city;
    if (!c) return;
    this.endMode();
    this.mode = { kind: 'expand', selected: new Set(), brush: false, pay: 'coins' };
    this.shell.setTab('build');
    this.shell.openMode('Расширение земли', () => this.endMode());
    this.map.scene.regions.setEmphasis(1);
    const tools = this.shell.modeTools;
    const quick = (n: number): void => {
      if (this.mode.kind !== 'expand') return;
      this.autoSelect(n);
    };
    btn(tools, 't-btn ghost sm', '+16', () => quick(16));
    btn(tools, 't-btn ghost sm', '+64', () => quick(64));
    const brush = btn(tools, 't-btn ghost sm t-toggle', `${UI_SVG.brush}Кисть`, () => {
      if (this.mode.kind !== 'expand') return;
      this.mode.brush = !this.mode.brush;
      brush.classList.toggle('is-on', this.mode.brush);
      const drag = this.map.camera.viewport.plugins;
      if (this.mode.brush) drag.pause('drag');
      else drag.resume('drag');
    });
    const row2 = h('div', 't-mode__tools', this.shell.modeTools.parentElement!);
    row2.classList.add('t-expand-buy');
    this.payBtn = btn(row2, 't-btn ghost', 'Монеты', () => {
      if (this.mode.kind !== 'expand') return;
      this.mode.pay = this.mode.pay === 'coins' ? 'crystals' : 'coins';
      this.redrawExpand();
    });
    this.buyBtn = btn(row2, 't-btn', 'Купить', () => this.confirmLand());
    if (this.map.camera.getView().scale < 0.35) this.flyToCity(false, 0.55);
    this.redrawExpand();
  }
  private buyBtn: HTMLButtonElement | null = null;
  private payBtn: HTMLButtonElement | null = null;

  private cellAt(wx: number, wy: number): number {
    const m = this.store.mask!;
    const x = Math.floor(wx / CELL_M) - m.x0;
    const y = Math.floor(wy / CELL_M) - m.y0;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
    return y * m.w + x;
  }

  private toggleCell(wx: number, wy: number): void {
    if (this.mode.kind !== 'expand') return;
    const i = this.cellAt(wx, wy);
    if (i < 0) return;
    if (this.mode.selected.has(i)) {
      this.mode.selected.delete(i);
      // drop cells that lost their connection to the city
      this.pruneSelection();
    } else if (this.frontier.includes(i)) this.mode.selected.add(i);
    else return this.shell.toast('Можно брать только клетки рядом с вашей землёй');
    haptic.select();
    this.redrawExpand();
  }

  private paintAt(wx: number, wy: number): void {
    if (this.mode.kind !== 'expand') return;
    const i = this.cellAt(wx, wy);
    if (i < 0 || this.mode.selected.has(i) || !this.frontier.includes(i)) return;
    this.mode.selected.add(i);
    haptic.select();
    this.redrawExpand();
  }

  /** Pick the n frontier cells closest to the town hall. */
  private autoSelect(n: number): void {
    if (this.mode.kind !== 'expand') return;
    const m = this.store.mask!;
    const c = this.store.city!;
    const hall = c.buildings.find((b) => b.t === 'townhall')!;
    const hx = hall.x + 2 - m.x0;
    const hy = hall.y + 2 - m.y0;
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bd = Infinity;
      for (const i of this.frontier) {
        if (this.mode.selected.has(i)) continue;
        const x = i % m.w;
        const y = (i - x) / m.w;
        const d = (x - hx) * (x - hx) + (y - hy) * (y - hy);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0) break;
      this.mode.selected.add(best);
      this.redrawExpand(false);
    }
    haptic.tap();
    this.redrawExpand();
  }

  private pruneSelection(): void {
    if (this.mode.kind !== 'expand') return;
    const m = this.store.mask!;
    const owned = ownedBits(this.store.city!, m);
    const sel = this.mode.selected;
    const keep = new Set<number>();
    const queue: number[] = [];
    for (const i of sel) {
      const x = i % m.w;
      const touch = (x > 0 && getBit(owned, i - 1)) || (x < m.w - 1 && getBit(owned, i + 1)) || getBit(owned, i - m.w) || getBit(owned, i + m.w);
      if (touch) {
        keep.add(i);
        queue.push(i);
      }
    }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % m.w;
      for (const j of [x > 0 ? i - 1 : -1, x < m.w - 1 ? i + 1 : -1, i - m.w, i + m.w])
        if (sel.has(j) && !keep.has(j)) {
          keep.add(j);
          queue.push(j);
        }
    }
    this.mode.selected = keep;
  }

  private redrawExpand(full = true): void {
    if (this.mode.kind !== 'expand') return;
    const c = this.store.city!;
    const m = this.store.mask!;
    this.frontier = this.expand.draw(m, ownedBits(c, m), this.mode.selected);
    if (!full) return;
    const n = this.mode.selected.size;
    const coins = landCost(c.ownedCount, m.cells, n);
    const crystals = landCrystals(c.ownedCount, m.cells, n);
    const share = (c.ownedCount / m.cells) * 100;
    const msg = this.shell.modeMsg;
    msg.className = 't-mode__msg';
    if (!n)
      msg.textContent = `У вас ${share.toFixed(1).replace('.', ',')}% участка. Нажимайте на светлые клетки у края или возьмите сразу +16.`;
    else msg.textContent = `${n} ${plural(n, 'клетка', 'клетки', 'клеток')} · ${int(n * 256)} м² · ${num(coins)} монет или ${num(crystals)} 💎`;
    const crystalsMode = this.mode.pay === 'crystals';
    if (this.payBtn) this.payBtn.textContent = crystalsMode ? 'За кристаллы' : 'За монеты';
    if (this.buyBtn) {
      const enough = crystalsMode ? c.crystals >= crystals : c.res.coins >= coins;
      this.buyBtn.textContent = n ? `Купить за ${num(crystalsMode ? crystals : coins)} ${crystalsMode ? '💎' : 'мон.'}` : 'Купить';
      this.buyBtn.disabled = !n || !enough;
      if (n && !enough) {
        msg.textContent += crystalsMode ? ' · не хватает кристаллов' : ' · не хватает монет';
        msg.classList.add('bad');
      }
    }
    this.map.wake();
  }

  private confirmLand(): void {
    if (this.mode.kind !== 'expand') return;
    const cells = [...this.mode.selected];
    const r = this.store.act({ type: 'land', cells, pay: this.mode.pay }, true);
    if (!r.ok) {
      this.shell.toast(ERRORS[r.error] ?? r.error, true);
      return;
    }
    haptic.ok();
    this.shell.toast(`Земля ваша: +${cells.length} ${plural(cells.length, 'клетка', 'клетки', 'клеток')}`);
    this.mode.selected.clear();
    this.redrawExpand();
  }

  private endMode(): void {
    if (this.mode.kind === 'expand') {
      this.expand.hide();
      this.map.scene.regions.setEmphasis(0);
      this.map.camera.viewport.plugins.resume('drag');
      this.shell.modeTools.parentElement!.querySelector('.t-expand-buy')?.remove();
    }
    if (this.mode.kind === 'build') this.ghost.hide();
    this.mode = { kind: 'none' };
    this.confirmBtn = this.buyBtn = this.payBtn = null;
    this.painting = false;
    this.shell.closeMode();
    this.shell.setTab('map');
    this.map.wake();
  }

  // ------------------------------------------------------------------ camera
  private flyToCity(cinematic: boolean, scale = 0.95): void {
    const c = this.store.city;
    const m = this.store.mask;
    if (!c || !m) return;
    if (cinematic) scale = 1.3;
    // the centre of the starter plot, shown a little above the middle of the screen
    const x = (m.start.x + m.start.w / 2) * CELL_M;
    const y = (m.start.y + m.start.h / 2) * CELL_M + (cinematic ? 110 : 40) / scale;
    if (!cinematic) {
      this.map.camera.flyTo(x, y, scale, true);
      return;
    }
    // a slow descent from the continent to the plot
    const vp = this.map.camera.viewport;
    this.map.camera.fitWorld(false);
    window.setTimeout(() => {
      vp.animate({ position: { x, y }, scale: 0.12, time: 1300, ease: 'easeInOutSine' });
      window.setTimeout(() => {
        vp.animate({ position: { x, y }, scale, time: 1500, ease: 'easeOutCubic' });
        const label = this.shell.plotLabel;
        label.replaceChildren();
        h('b', '', label, c.name);
        h('small', '', label, `участок № ${c.regionId + 1}`);
        label.classList.add('is-on');
        window.setTimeout(() => label.classList.remove('is-on'), 2600);
      }, 1350);
    }, 150);
  }

  private sideButtons(): void {
    const side = this.shell.side;
    btn(side, 't-round', UI_SVG.plus, () => this.map.camera.zoomBy(2));
    btn(side, 't-round', UI_SVG.minus, () => this.map.camera.zoomBy(0.5));
    btn(side, 't-round', UI_SVG.globe, () => this.map.camera.fitWorld());
    btn(side, 't-round home', UI_SVG.home, () => {
      haptic.tap();
      this.flyHome();
    });
  }

  // ------------------------------------------------------------------ tutorial
  private guideList: HTMLElement | null = null;
  private showGuide(): void {
    try {
      if (localStorage.getItem(GUIDE_KEY)) return;
    } catch {
      /* no storage: show it */
    }
    const g = this.shell.guide;
    g.replaceChildren();
    h('h4', '', g, 'Первые шаги');
    this.guideList = h('ol', '', g);
    g.hidden = false;
    this.updateGuide();
  }

  private updateGuide(): void {
    const list = this.guideList;
    const c = this.store.city;
    const m = this.store.mask;
    if (!list || !c || !m) return;
    const has = (t: BuildingType): boolean => c.buildings.some((b) => b.t === t);
    const start = Math.round(m.start.w * m.start.h);
    const steps: [string, boolean][] = [
      ['Построить жилой квартал', has('house')],
      ['Поставить лесопилку', has('sawmill')],
      ['Расширить землю', c.ownedCount > start + 4],
      ['Заложить ферму', has('farm')],
    ];
    const key = steps.map((s) => (s[1] ? 1 : 0)).join('');
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.replaceChildren();
    let next = false;
    for (const [label, done] of steps) {
      const li = h('li', done ? 'done' : !next ? 'next' : '', list, label);
      if (!done) next = true;
      void li;
    }
    if (steps.every((s) => s[1])) {
      try {
        localStorage.setItem(GUIDE_KEY, '1');
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        this.shell.guide.hidden = true;
      }, 2500);
      this.shell.toast('Город заработал. Дальше — ратуша 2 уровня и биржа.');
    }
  }

  destroy(): void {
    window.clearInterval(this.secondTimer);
    window.clearInterval(this.worldTimer);
  }
}

/** The free, owned spot for a building of type t closest to (cx, cy), searched in rings. */
function nearestFreeSpot(c: CityState, m: RegionMask, t: BuildingType, cx: number, cy: number): { x: number; y: number } | null {
  const owned = ownedBits(c, m);
  const occ = occupancy(c, m);
  for (let r = 1; r < 80; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!placementError(c, m, t, cx + dx, cy + dy, owned, occ)) return { x: cx + dx, y: cy + dy };
      }
  return null;
}
