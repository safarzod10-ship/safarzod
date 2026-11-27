import './ui/styles.css';
import { loadCameraState, resolveWorldParams, saveCameraState } from './core/storage.ts';
import { initTelegram } from './core/telegram.ts';
import { createRenderer } from './rendering/createRenderer.ts';
import { MapApp } from './rendering/MapApp.ts';
import { createHud } from './ui/hud.ts';
import { startWorld } from './world/generation/WorldBackend.ts';
import { createDetailTextures } from './world/terrain/detailTextures.ts';

declare global {
  interface Window {
    /** Debug / automation handle. Not a stable API. */
    __vcm?: MapApp;
  }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  const hud = createHud(root);
  hud.setLoading(0.03, 'Запуск…');

  const query = new URLSearchParams(location.search);
  const { params, preview } = resolveWorldParams();

  let map: MapApp | null = null;
  void initTelegram('#ecf2f6', () => map?.resize());

  try {
    const info = await createRenderer(hud.stage);
    hud.setLoading(0.08, 'Создаём континент…');

    const { backend, world } = await startWorld(
      params,
      (p) => hud.setLoading(0.08 + 0.5 * p, 'Создаём континент…'),
      { forceMainThread: query.has('noworker') },
    );

    hud.setLoading(0.6, 'Готовим текстуры…');
    await nextFrame();
    const textures = createDetailTextures(params.seed);

    map = new MapApp(info, world, backend, textures, hud.stage);
    await map.preload((p) => hud.setLoading(0.64 + 0.34 * p, 'Рисуем берега…'));

    const saved = preview ? null : loadCameraState(params.seed);
    if (saved) map.camera.flyTo(saved.x, saved.y, saved.scale, false);

    const m = world.meta;
    const km = (v: number): string => (v / 1000).toFixed(1);
    hud.setInfo(
      'Континент',
      `seed ${params.seed}${preview ? ' · предпросмотр' : ''} · ${km(m.landBounds.width)}×${km(m.landBounds.height)} км`,
    );
    hud.setActions({
      zoomIn: () => map!.camera.zoomBy(1.8),
      zoomOut: () => map!.camera.zoomBy(1 / 1.8),
      fit: () => map!.camera.fitWorld(),
      togglePerf: (on) => {
        if (on) map!.enableDrawCallCounter();
      },
    });

    let saveTimer = 0;
    map.camera.onChange((view) => {
      if (preview) return;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(
        () => saveCameraState({ seed: params.seed, x: view.x, y: view.y, scale: view.scale }),
        600,
      );
    });

    let perfClock = 0;
    map.onFrame = (view, deltaMs) => {
      const limits = map!.camera.zoomLimits;
      hud.setView(view.scale, limits.minScale, limits.maxScale);
      perfClock += deltaMs;
      if (hud.perfVisible && perfClock > 400) {
        perfClock = 0;
        hud.setPerf(map!.stats());
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') map!.camera.zoomBy(1.5);
      else if (e.key === '-' || e.key === '_') map!.camera.zoomBy(1 / 1.5);
      else if (e.key === '0') map!.camera.fitWorld();
    });

    map.start();
    window.__vcm = map;
    await nextFrame();
    await nextFrame();
    hud.finishLoading();
    console.info(
      `[vcm] world ready: seed ${params.seed}, generated in ${m.generationMs.toFixed(0)} ms (${backend.mode}), ` +
        `${info.api}, land ${(m.landArea / 1e6).toFixed(1)} km², buildable ${(m.buildableFraction * 100).toFixed(0)}%`,
    );
  } catch (err) {
    console.error(err);
    const noGl = err instanceof Error && /webgl|renderer|context/i.test(err.message);
    hud.fail(noGl ? 'Не удалось запустить WebGL на этом устройстве.' : 'Не удалось загрузить карту. Обновите страницу.');
  }
}

void boot();
