/**
 * Map-level DOM overlay: the scale bar and the optional perf panel.
 * The game UI (src/app) owns everything else: resources, navigation, zoom
 * buttons. (The loading screen is public/loader, driven by src/ui/loader.ts.)
 */
import type { MapStats } from '../rendering/MapApp.ts';

export interface Hud {
  readonly stage: HTMLElement;
  /** Fade the overlay in (it starts hidden while the game loads). */
  show(): void;
  /** @param scale CSS px per world unit */
  setView(scale: number, minScale: number, maxScale: number): void;
  setPerf(stats: MapStats): void;
  /** Show / hide the perf panel. @returns the new state */
  togglePerf(): boolean;
  readonly perfVisible: boolean;
}

const SCALE_STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

export function createHud(root: HTMLElement): Hud {
  const stage = el('div', 'vcm-stage', root);
  const hud = el('div', 'vcm-hud', root);

  const scaleBox = el('div', 'vcm-scale', hud);
  const scaleLabel = el('div', 'vcm-scale__label', scaleBox);
  const scaleBar = el('div', 'vcm-scale__bar', scaleBox);

  const perf = el('div', 'vcm-perf', hud);
  perf.hidden = true;

  let perfOn = false;
  let lastScaleKey = '';

  return {
    stage,
    get perfVisible() {
      return perfOn;
    },
    show() {
      hud.classList.add('is-ready');
    },
    togglePerf() {
      perfOn = !perfOn;
      perf.hidden = !perfOn;
      return perfOn;
    },
    setView(scale) {
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
