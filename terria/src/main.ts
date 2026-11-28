import './ui/styles.css';
import { loadCameraState, resolveWorldParams, saveCameraState } from './core/storage.ts';
import { initTelegram, setTelegramColors } from './core/telegram.ts';
import { createRenderer } from './rendering/createRenderer.ts';
import { MapApp } from './rendering/MapApp.ts';
import { createSplash, type SplashMode, type SplashQuality } from './splash/index.ts';
import { createHud } from './ui/hud.ts';
import type { RegionInfo } from './world/regions/regions.ts';
import { startWorld } from './world/generation/WorldBackend.ts';
import { createDetailTextures } from './world/terrain/detailTextures.ts';

declare global {
  interface Window {
    /** Debug / automation handle. Not a stable API. */
    __vcm?: MapApp;
  }
}

/** Page / Telegram chrome colour under the loading splash and under the map (the fog). */
const SPLASH_COLOR = '#06120f';
const MAP_COLOR = '#ecf2f6';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * `?splash=lite|off` (or `?nosplash`) and `?splash=full|high|low` override the
 * automatic choice of mode and of detail level (for testing).
 */
function splashChoice(query: URLSearchParams): { mode: SplashMode; quality: SplashQuality } {
  const value = query.get('splash');
  if (query.has('nosplash') || value === 'off') return { mode: 'off', quality: 'auto' };
  if (value === 'lite') return { mode: 'lite', quality: 'auto' };
  if (value === 'high' || value === 'low') return { mode: 'cinematic', quality: value };
  if (value === 'full') return { mode: 'cinematic', quality: 'auto' };
  return { mode: 'auto', quality: 'auto' };
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  const query = new URLSearchParams(location.search);

  const hud = createHud(root);
  // The splash is on screen before anything heavy is created and never blocks
  // the steps below: they only tell it how far they are.
  const splash = createSplash(root, {
    ...splashChoice(query),
    onReveal: () => {
      // the map starts to show: the page and Telegram's chrome turn from night to fog
      document.documentElement.classList.remove('splash-active');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MAP_COLOR);
      setTelegramColors(MAP_COLOR);
      window.setTimeout(() => hud.show(), 450);
    },
  });
  splash.setProgress(0.03, 'Запуск…');

  const { params, preview } = resolveWorldParams();

  let map: MapApp | null = null;
  void initTelegram(SPLASH_COLOR, () => map?.resize());

  try {
    const info = await createRenderer(hud.stage);
    // Until the map exists nobody else follows the size of the page, and
    // Telegram expands the Mini App right after start.
    const earlyResize = new ResizeObserver(() => {
      const w = Math.max(1, Math.round(hud.stage.clientWidth));
      const h = Math.max(1, Math.round(hud.stage.clientHeight));
      const r = info.app.renderer;
      if (w !== r.screen.width || h !== r.screen.height) r.resize(w, h);
    });
    earlyResize.observe(hud.stage);
    splash.attach(info.app, { lowPower: info.lowMemory });
    splash.setProgress(0.08, 'Создаём континент…');

    const { backend, world } = await startWorld(
      params,
      (p) => splash.setProgress(0.08 + 0.5 * p, 'Создаём континент…'),
      { forceMainThread: query.has('noworker') },
    );

    // The next steps run on the main thread; a frame between them keeps the
    // splash moving.
    splash.setProgress(0.6, 'Готовим текстуры…');
    await nextFrame();
    const textures = createDetailTextures(params.seed);
    await nextFrame();

    earlyResize.disconnect();
    map = new MapApp(info, world, backend, textures, hud.stage);
    // Nothing of the map is drawn while the splash covers it (see below).
    map.camera.viewport.visible = false;
    await map.preload((p) => splash.setProgress(0.64 + 0.34 * p, 'Рисуем берега…'));

    const saved = preview ? null : loadCameraState(params.seed);
    if (saved) map.camera.flyTo(saved.x, saved.y, saved.scale, false);

    const m = world.meta;
    const km = (v: number): string => (v / 1000).toFixed(1);
    hud.setInfo(
      'Континент',
      `${km(m.landBounds.width)}×${km(m.landBounds.height)} км · ${m.regionCount} участков · seed ${params.seed}` +
        (preview ? ' · предпросмотр' : ''),
    );
    const showRegion = (info: RegionInfo | null): void => {
      hud.setRegion(
        info
          ? { number: info.id + 1, total: m.regionCount, areaM2: info.area, plotSideM: info.starterPlot.width }
          : null,
      );
    };
    hud.setActions({
      zoomIn: () => map!.camera.zoomBy(2.2),
      zoomOut: () => map!.camera.zoomBy(1 / 2.2),
      fit: () => map!.camera.fitWorld(),
      togglePerf: (on) => {
        if (on) map!.enableDrawCallCounter();
      },
      // Which region a player gets is game logic for a later module; this
      // button only demonstrates what "one place out of a thousand" looks like.
      randomRegion: () => {
        const id = Math.floor(Math.random() * m.regionCount);
        showRegion(map!.selectRegion(id));
        map!.showRegion(id);
      },
    });
    // tap / click on the map selects the region under the pointer
    map.camera.viewport.on('clicked', (ev) => {
      const region = map!.query.regionAt(ev.world.x, ev.world.y);
      showRegion(map!.selectRegion(region ? region.id : null));
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

    // The game is ready. The splash wraps its intro up (sped up, never waited
    // for in full) and holds on the finished logo. Only then is the map
    // drawn for the first time, still under the splash: its shaders compile
    // and its textures upload while nothing on screen moves much. After that
    // the splash opens onto a map that is already running smoothly.
    splash.setProgress(1, 'Готово');
    await splash.settle();
    map.camera.viewport.visible = true;
    map.warmUp();
    map.start();
    window.__vcm = map;
    const warmUntil = performance.now() + 1200;
    for (let frames = 0; frames < 3 || (map.scene.busy && performance.now() < warmUntil); frames++) await nextFrame();
    map.wake(); // full frame rate for the transition
    await splash.reveal();
    hud.show();
    console.info(
      `[vcm] world ready: seed ${params.seed}, generated in ${m.generationMs.toFixed(0)} ms (${backend.mode}), ` +
        `${info.api}, land ${(m.landArea / 1e6).toFixed(0)} km², ${m.regionCount} regions of ~${(m.regionAreaAvg / 1e6).toFixed(2)} km², ` +
        `${m.lakeCount} lakes, ${(m.riverLength / 1000).toFixed(0)} km of rivers, forest ${(m.forestFraction * 100).toFixed(0)}%`,
    );
  } catch (err) {
    console.error(err);
    const noGl = err instanceof Error && /webgl|renderer|context/i.test(err.message);
    splash.fail(noGl ? 'Не удалось запустить WebGL на этом устройстве.' : 'Не удалось загрузить карту. Обновите страницу.');
  }
}

void boot();
