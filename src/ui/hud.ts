/**
 * DOM overlay: zoom controls, scale bar, region card, optional perf panel.
 * Plain DOM on purpose - it is tiny and does not cost draw calls.
 * (The loading screen is its own module: src/splash.)
 */
import type { MapStats } from '../rendering/MapApp.ts';

export interface HudActions {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  togglePerf(on: boolean): void;
  /** Jump to a random region (demo of "you were given one of 1000 places"). */
  randomRegion(): void;
}

export interface Hud {
  readonly stage: HTMLElement;
  /** Fade the controls in (they start hidden while the game loads). */
  show(): void;
  setActions(actions: HudActions): void;
  setInfo(title: string, meta: string): void;
  /** Show the facts of the selected region, or hide the card with null. */
  setRegion(region: { number: number; total: number; areaM2: number; plotSideM: number } | null): void;
  /** @param scale CSS px per world unit */
  setView(scale: number, minScale: number, maxScale: number): void;
  setPerf(stats: MapStats): void;
  readonly perfVisible: boolean;
}

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  perf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15l3.5-4 3 2.5L19 8"/></svg>',
  dice:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/>' +
    '<circle cx="9" cy="9" r="0.6"/><circle cx="15" cy="15" r="0.6"/><circle cx="15" cy="9" r="0.6"/><circle cx="9" cy="15" r="0.6"/></svg>',
};

const SCALE_STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function button(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  const b = el('button', 'vcm-btn', parent);
  b.type = 'button';
  b.innerHTML = icon;
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

export function createHud(root: HTMLElement): Hud {
  const stage = el('div', 'vcm-stage', root);
  const hud = el('div', 'vcm-hud', root);

  const chip = el('div', 'vcm-chip', hud);
  const chipTitle = el('div', 'vcm-chip__title', chip);
  const chipMeta = el('div', 'vcm-chip__meta', chip);

  const scaleBox = el('div', 'vcm-scale', hud);
  const scaleLabel = el('div', 'vcm-scale__label', scaleBox);
  const scaleBar = el('div', 'vcm-scale__bar', scaleBox);

  const controls = el('div', 'vcm-controls', hud);
  const tools = el('div', 'vcm-group', controls);
  const perfBtn = button(tools, ICONS.perf, 'Показатели производительности');
  const diceBtn = button(tools, ICONS.dice, 'Случайный участок');
  const zoom = el('div', 'vcm-group', controls);
  const inBtn = button(zoom, ICONS.plus, 'Приблизить');
  const outBtn = button(zoom, ICONS.minus, 'Отдалить');
  const fitBtn = button(zoom, ICONS.fit, 'Показать весь континент');

  const perf = el('div', 'vcm-perf', hud);
  perf.hidden = true;

  const regionCard = el('div', 'vcm-region', hud);
  regionCard.hidden = true;
  regionCard.setAttribute('role', 'status');
  const regionTitle = el('div', 'vcm-region__title', regionCard);
  const regionMeta = el('div', 'vcm-region__meta', regionCard);

  let actions: HudActions | null = null;
  let perfOn = false;
  let lastScaleKey = '';

  inBtn.addEventListener('click', () => actions?.zoomIn());
  outBtn.addEventListener('click', () => actions?.zoomOut());
  fitBtn.addEventListener('click', () => actions?.fit());
  diceBtn.addEventListener('click', () => actions?.randomRegion());
  perfBtn.addEventListener('click', () => {
    perfOn = !perfOn;
    perf.hidden = !perfOn;
    perfBtn.classList.toggle('is-on', perfOn);
    actions?.togglePerf(perfOn);
  });

  return {
    stage,
    get perfVisible() {
      return perfOn;
    },
    show() {
      hud.classList.add('is-ready');
    },
    setActions(a) {
      actions = a;
    },
    setInfo(titleText, meta) {
      chipTitle.textContent = titleText;
      chipMeta.textContent = meta;
    },
    setRegion(region) {
      regionCard.hidden = !region;
      if (!region) return;
      regionTitle.textContent = `Участок ${region.number} из ${region.total}`;
      const km2 = (region.areaM2 / 1e6).toFixed(2).replace('.', ',');
      regionMeta.textContent = `${km2} км² · стартовая зона ${region.plotSideM}×${region.plotSideM} м`;
    },
    setView(scale, minScale, maxScale) {
      // scale bar: the longest "round" distance that fits in ~120 px
      let metres = SCALE_STEPS[0];
      for (const step of SCALE_STEPS) {
        if (step * scale <= 120) metres = step;
      }
      const px = Math.round(metres * scale);
      const key = `${metres}:${px}`;
      if (key !== lastScaleKey) {
        lastScaleKey = key;
        scaleBar.style.width = `${px}px`;
        scaleLabel.textContent = metres >= 1000 ? `${metres / 1000} км` : `${metres} м`;
      }
      inBtn.disabled = scale >= maxScale * 0.999;
      const atMin = scale <= minScale * 1.001;
      outBtn.disabled = atMin;
    },
    setPerf(s) {
      if (!perfOn) return;
      const heap = s.jsHeapMB === null ? 'n/a' : `${s.jsHeapMB.toFixed(0)} MB`;
      perf.textContent =
        `FPS        ${s.fps.toFixed(0).padStart(5)}\n` +
        `frame avg  ${s.frameMs.toFixed(1).padStart(5)} ms\n` +
        `frame p99  ${s.p99Ms.toFixed(1).padStart(5)} ms\n` +
        `cpu / tick ${s.cpuMs.toFixed(1).padStart(5)} ms\n` +
        `draw calls ${String(s.drawCalls).padStart(5)}\n` +
        `resolution ${s.resolution.toFixed(2).padStart(5)}x\n` +
        `LOD ${s.lod}  chunks ${s.drawnChunks}/${s.chunks}\n` +
        `bake avg   ${s.avgBakeMs.toFixed(1).padStart(5)} ms\n` +
        `trees      ${String(s.trees).padStart(5)}\n` +
        `terrain    ${s.terrainTextureMB.toFixed(1).padStart(5)} MB\n` +
        `JS heap    ${heap.padStart(8)}\n` +
        `${s.api} · ${s.backend}`;
    },
  };
}
