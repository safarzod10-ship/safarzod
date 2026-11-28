import './ui/styles.css';
import { loadCameraState, resolveWorldParams, saveCameraState } from './core/storage.ts';
import { initTelegram, setTelegramColors } from './core/telegram.ts';
import { createRenderer } from './rendering/createRenderer.ts';
import { MapApp } from './rendering/MapApp.ts';
import { createHud } from './ui/hud.ts';
import { loader } from './ui/loader.ts';
import { createApi } from './app/api.ts';
import { startWorld } from './world/generation/WorldBackend.ts';
import { createDetailTextures } from './world/terrain/detailTextures.ts';

declare global {
  interface Window {
    /** Debug / automation handle. Not a stable API. */
    __vcm?: MapApp;
  }
}

/** Page / Telegram chrome colour under the loading screen (public/loader) and under the map (the fog). */
const LOADER_COLOR = '#07110c';
const MAP_COLOR = '#ecf2f6';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  const query = new URLSearchParams(location.search);

  const hud = createHud(root);
  // The loading screen is already on (index.html); the steps below only tell
  // it how far they are.
  loader.set(0.03);

  const { params, preview } = resolveWorldParams();
  // The account and the city load while the loading screen plays.
  const apiReady = createApi();
  const me = apiReady.then((api) => api.me());
  me.catch(() => undefined); // reported later by the game

  let map: MapApp | null = null;
  void initTelegram(LOADER_COLOR, () => map?.resize());

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
    loader.set(0.08);

    const { backend, world } = await startWorld(params, (p) => loader.set(0.08 + 0.5 * p), {
      forceMainThread: query.has('noworker'),
    });

    // The next steps run on the main thread; a frame between them keeps the
    // loading animation moving.
    loader.set(0.6);
    await nextFrame();
    const textures = createDetailTextures(params.seed);
    await nextFrame();

    earlyResize.disconnect();
    map = new MapApp(info, world, backend, textures, hud.stage);
    // Nothing of the map is drawn while the loading screen covers it (see below).
    map.camera.viewport.visible = false;
    await map.preload((p) => loader.set(0.64 + 0.34 * p));

    const saved = preview ? null : loadCameraState(params.seed);
    if (saved) map.camera.flyTo(saved.x, saved.y, saved.scale, false);

    const m = world.meta;
    const { TerriaGame } = await import('./app/game.ts');
    const game = new TerriaGame(map, root, await apiReady, () => {
      if (hud.togglePerf()) map!.enableDrawCallCounter();
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

    // The game is ready. The loading screen finishes its logo first; only then
    // is the map drawn for the first time, still under the screen: its shaders
    // compile and its textures upload while the logo just idles. After that
    // the screen opens onto a map that is already running smoothly.
    loader.set(1);
    await loader.intro();
    map.camera.viewport.visible = true;
    map.warmUp();
    map.start();
    window.__vcm = map;
    const warmUntil = performance.now() + 1200;
    for (let frames = 0; frames < 3 || (map.scene.busy && performance.now() < warmUntil); frames++) await nextFrame();
    map.wake(); // full frame rate for the transition
    game.bind();
    (window as unknown as { __terria?: unknown }).__terria = game; // debug / automation only
    const exit = loader.finish();
    await exit.revealed;
    // the map starts to show: the page and Telegram's chrome turn to the fog colour
    document.documentElement.style.background = MAP_COLOR;
    document.body.style.background = MAP_COLOR;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MAP_COLOR);
    setTelegramColors(MAP_COLOR);
    hud.show();
    await exit.gone;
    void game.start(me);
    console.info(
      `[vcm] world ready: seed ${params.seed}, generated in ${m.generationMs.toFixed(0)} ms (${backend.mode}), ` +
        `${info.api}, land ${(m.landArea / 1e6).toFixed(0)} km², ${m.regionCount} regions of ~${(m.regionAreaAvg / 1e6).toFixed(2)} km², ` +
        `${m.lakeCount} lakes, ${(m.riverLength / 1000).toFixed(0)} km of rivers, forest ${(m.forestFraction * 100).toFixed(0)}%`,
    );
  } catch (err) {
    console.error(err);
    const noGl = err instanceof Error && /webgl|renderer|context/i.test(err.message);
    loader.fail(noGl ? 'Не удалось запустить WebGL на этом устройстве.' : 'Не удалось загрузить карту. Обновите страницу.');
  }
}

void boot();
