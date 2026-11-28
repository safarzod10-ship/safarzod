/**
 * TERRIA loading splash: life cycle and the thin DOM layer around the scene.
 *
 *   createSplash(root)     a dark veil is on screen at once (plain DOM)
 *   attach(app)            the WebGL scene is built on the game's own PixiJS
 *                          application and the intro starts; never throws,
 *                          never waits for the game
 *   setProgress(p, label)  the game's real loading state
 *   settle()               "the game is ready": resolves as soon as the intro
 *                          may be cut (it is sped up, not waited for)
 *   reveal()               opens onto the map, then frees everything
 *   fail(message)          the game cannot start: say so and offer a reload
 *
 * Modes: `cinematic` (WebGL), `lite` (DOM only: for prefers-reduced-motion and
 * as the fallback when images or shaders fail), `off`.
 */
import { UPDATE_PRIORITY, type Application, type Container } from 'pixi.js';
import { gsap } from 'gsap';
import { loadSplashImages, releasePreloadElements, worldImageUrl, type SplashImages } from './assets.ts';
import logoSvgUrl from './assets/terria-logo.svg';
import { driveGsapFrom } from './gsapDriver.ts';
import { mergeProgress } from './layout.ts';
import { SplashScene, type SceneQuality } from './SplashScene.ts';
import { buildIdle, buildIntro, buildOutro } from './timeline.ts';
import './splash.css';

export type SplashMode = 'auto' | 'cinematic' | 'lite' | 'off';
export type SplashPhase = 'boot' | 'intro' | 'idle' | 'outro' | 'lite' | 'error' | 'done';

export type SplashQuality = 'auto' | 'high' | 'low';

export interface SplashOptions {
  mode?: SplashMode;
  /** Detail level of the cinematic scene; `auto` decides by the device. */
  quality?: SplashQuality;
  /** Called when the map starts to show through (switch the page / Telegram colours here). */
  onReveal?: () => void;
}

export interface Splash {
  readonly phase: SplashPhase;
  attach(app: Application, hints?: { lowPower?: boolean }): void;
  setProgress(progress: number, label?: string): void;
  settle(): Promise<void>;
  reveal(): Promise<void>;
  fail(message: string): void;
}

declare global {
  interface Window {
    /** Debug / automation handle of the splash. Not a stable API. */
    __splash?: SplashDebug;
  }
}
export interface SplashDebug {
  readonly phase: SplashPhase;
  readonly mode: string;
  readonly quality: SceneQuality | null;
  /** Freeze the intro at `seconds` (and the ambient motion with it). */
  seek(seconds: number): void;
  resume(): void;
  /** When set, the outro is created paused; step it with seekOutro(). */
  freezeOutro: boolean;
  seekOutro(seconds: number): void;
}

/** How fast the rest of the intro plays once the game is ready, and after a tap. */
const HURRY = 1.9;
const SKIP = 4;
/** The finished logo stays at least this long before the map opens, ms. */
const HOLD_MS = 320;
/** Lite mode: shortest time on screen, ms. */
const LITE_MIN_MS = 650;
const FADE_MS = 380;

const QUALITY_HIGH: SceneQuality = { richWater: true, sparks: 72, clouds: 6, cloudShadows: true };
const QUALITY_LOW: SceneQuality = { richWater: false, sparks: 28, clouds: 4, cloudShadows: false };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function isLowPower(hint: boolean | undefined): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (
    !!hint ||
    (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) ||
    (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4)
  );
}

class SplashScreen implements Splash {
  phase: SplashPhase = 'boot';
  private mode: 'cinematic' | 'lite';
  private readonly options: SplashOptions;
  private readonly root: HTMLElement;
  private readonly lite: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly error: HTMLElement;
  private readonly errorText: HTMLElement;

  private app: Application | null = null;
  private scene: SplashScene | null = null;
  private images: SplashImages | null = null;
  private quality: SceneQuality | null = null;
  private intro: gsap.core.Timeline | null = null;
  private idle: gsap.core.Timeline | null = null;
  private outro: gsap.core.Timeline | null = null;
  private releaseGsap: (() => void) | null = null;

  private progress = 0;
  private shownAt = performance.now();
  private settledAt = 0;
  private gameReady = false;
  private skipped = false;
  /** The scene must not start any more (the game was ready first, or the splash is gone). */
  private sceneCancelled = false;
  private waiters: (() => void)[] = [];
  private holdTimer = 0;
  private footTimer = 0;
  private frames = 0;
  private frameMs = 0;

  constructor(host: HTMLElement, options: SplashOptions) {
    this.options = options;
    this.mode = options.mode === 'lite' || (options.mode !== 'cinematic' && prefersReducedMotion()) ? 'lite' : 'cinematic';

    this.root = el('div', 'tsp', host);
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'TERRIA: загрузка');
    this.lite = el('div', 'tsp__lite', this.root);
    el('div', 'tsp__veil', this.root);
    this.foot = el('div', 'tsp__foot', this.root);
    this.label = el('div', 'tsp__label', this.foot);
    this.fill = el('div', 'tsp__fill', el('div', 'tsp__track', this.foot));
    this.error = el('div', 'tsp__error', this.root);
    this.error.hidden = true;
    this.errorText = el('p', 'tsp__error-text', this.error);
    const retry = el('button', 'tsp__retry', this.error);
    retry.type = 'button';
    retry.textContent = 'Обновить';
    retry.addEventListener('click', () => location.reload());

    // a tap anywhere hurries the intro along; it never reaches the map underneath
    this.root.addEventListener('pointerdown', this.onPointer);
    // the progress line appears only if loading is not instant
    this.footTimer = window.setTimeout(() => this.root.classList.add('is-loading'), 420);

    const splash = this; // eslint-disable-line @typescript-eslint/no-this-alias
    window.__splash = {
      seek: (seconds) => this.debugSeek(seconds),
      resume: () => this.debugResume(),
      freezeOutro: false,
      seekOutro: (seconds) => {
        if (this.scene) this.scene.paused = true;
        this.outro?.pause().time(seconds, true);
      },
      get phase() {
        return splash.phase;
      },
      get mode() {
        return splash.mode;
      },
      get quality() {
        return splash.quality;
      },
    };

    if (this.mode === 'lite') this.startLite();
  }

  // ---- public ---------------------------------------------------------------
  attach(app: Application, hints: { lowPower?: boolean } = {}): void {
    if (this.app || this.phase !== 'boot' || this.mode !== 'cinematic') return;
    this.app = app;
    void this.prepareScene(app, isLowPower(hints.lowPower));
  }

  setProgress(progress: number, label?: string): void {
    this.progress = mergeProgress(this.progress, progress);
    this.fill.style.transform = `scaleX(${this.progress.toFixed(3)})`;
    if (label !== undefined && label !== this.label.textContent) this.label.textContent = label;
  }

  settle(): Promise<void> {
    this.gameReady = true;
    this.setProgress(1);
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.checkSettled();
    });
  }

  reveal(): Promise<void> {
    if (this.phase === 'done' || this.phase === 'error') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        this.dispose();
        resolve();
      };
      this.root.classList.add('is-leaving');
      try {
        this.options.onReveal?.();
      } catch (err) {
        console.warn('[splash] onReveal failed', err);
      }
      const scene = this.scene;
      if (scene && (this.phase === 'intro' || this.phase === 'idle')) {
        this.phase = 'outro';
        this.intro?.kill();
        this.idle?.kill();
        // if the animation ever stops being stepped (context lost, tab frozen), still get out of the way
        const guard = window.setTimeout(finish, 4000);
        this.outro = buildOutro(scene, () => {
          window.clearTimeout(guard);
          finish();
        });
        if (window.__splash?.freezeOutro) {
          window.clearTimeout(guard);
          this.outro.pause();
        }
        return;
      }
      // no running scene (lite mode, or the game was ready before the pictures were): a plain
      // cross-fade of the DOM layer. A scene that never went live must not cover the map meanwhile.
      this.phase = 'outro';
      this.sceneCancelled = true;
      this.teardownScene();
      this.root.classList.add('is-fading');
      window.setTimeout(finish, FADE_MS + 40);
    });
  }

  fail(message: string): void {
    if (this.phase === 'done') return;
    this.sceneCancelled = true;
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.footTimer);
    const hadScene = !!this.scene && (this.phase === 'intro' || this.phase === 'idle');
    this.phase = 'error';
    this.errorText.textContent = message;
    this.error.hidden = false;
    this.root.classList.add('is-error');
    this.root.classList.remove('is-loading');
    this.root.setAttribute('aria-live', 'assertive');
    // with a running scene the logo simply finishes and stays; otherwise show the DOM one
    if (hadScene) this.intro?.timeScale(HURRY);
    else this.showLite();
    this.flush();
  }

  // ---- cinematic scene --------------------------------------------------------
  private async prepareScene(app: Application, lowPower: boolean): Promise<void> {
    let loaded: SplashImages | null = null;
    try {
      const screen = app.renderer.screen;
      loaded = await loadSplashImages(Math.ceil(screen.height * app.renderer.resolution * 1.25));
      if (this.sceneCancelled || this.phase !== 'boot') {
        loaded.destroy();
        return;
      }
      const wanted = this.options.quality ?? 'auto';
      this.quality = wanted === 'low' || (wanted === 'auto' && lowPower) ? QUALITY_LOW : QUALITY_HIGH;
      const images = loaded;
      this.images = images; // from here on teardownScene() owns them
      loaded = null;
      const scene = new SplashScene(app, images, this.quality);
      this.scene = scene;
      app.stage.addChild(scene.root);
      app.stage.on('childAdded', this.keepOnTop);
      app.renderer.on('resize', this.onResize);
      this.releaseGsap = driveGsapFrom(app.ticker);
      this.intro = buildIntro(scene, () => this.onSettled());
      this.idle = buildIdle(scene);
      app.ticker.add(this.tick);
      // Draw the scene once under the veil (it starts just as dark), so texture
      // uploads and shader compilation are over before anything moves.
      app.ticker.addOnce(
        () => {
          if (this.phase !== 'boot' || this.sceneCancelled) return;
          this.phase = 'intro';
          this.root.classList.add('is-live');
          this.intro?.timeScale(this.skipped ? SKIP : this.gameReady ? HURRY : 1).play(0);
        },
        undefined,
        UPDATE_PRIORITY.UTILITY,
      );
    } catch (err) {
      console.warn('[splash] cinematic scene unavailable, using the lite splash:', err);
      this.teardownScene();
      loaded?.destroy();
      if (this.phase === 'boot' && !this.sceneCancelled) this.startLite();
    }
  }

  private readonly tick = (): void => {
    const app = this.app;
    const scene = this.scene;
    if (!app || !scene) return;
    try {
      const ms = app.ticker.elapsedMS;
      scene.update(ms);
      // the first second tells whether this GPU keeps up; if not, shed the optional parts
      if (this.phase === 'intro' && this.frames < 45 && ms < 250) {
        this.frameMs += ms;
        if (++this.frames === 45 && this.frameMs / 45 > 26) scene.relax();
      }
    } catch (err) {
      console.warn('[splash] scene failed, falling back:', err);
      this.teardownScene();
      if (this.phase === 'intro' || this.phase === 'idle' || this.phase === 'boot') {
        this.root.classList.add('is-instant'); // the scene is gone: cover the canvas at once
        this.startLite();
      } else if (this.phase === 'outro') {
        this.root.classList.add('is-fading');
      }
    }
  };

  private readonly keepOnTop = (child: Container): void => {
    const scene = this.scene;
    const app = this.app;
    // re-adding an existing child only moves it to the end: no event, no loop
    if (scene && app && child !== scene.root) app.stage.addChild(scene.root);
  };

  private readonly onResize = (): void => {
    this.scene?.resize();
  };

  private onSettled(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'idle';
    this.settledAt = performance.now();
    this.idle?.play(0);
    this.checkSettled();
  }

  private readonly onPointer = (ev: Event): void => {
    if (ev.target instanceof HTMLButtonElement) return;
    ev.preventDefault();
    if (this.phase !== 'intro' || this.skipped) return;
    this.skipped = true;
    this.hurry(SKIP);
  };

  private hurry(rate: number): void {
    const intro = this.intro;
    if (!intro || this.phase !== 'intro') return;
    if (intro.timeScale() >= rate) return;
    gsap.to(intro, { timeScale: rate, duration: 0.25, ease: 'power1.in', overwrite: true });
  }

  // ---- lite (DOM only) ----------------------------------------------------------
  private startLite(): void {
    this.mode = 'lite';
    this.phase = 'lite';
    this.shownAt = performance.now();
    this.showLite();
    this.checkSettled();
  }

  private showLite(): void {
    if (this.lite.childElementCount === 0) {
      this.lite.style.backgroundImage = `url("${worldImageUrl()}")`;
      const mark = el('div', 'tsp__mark', this.lite);
      const mask = `url("${logoSvgUrl}")`;
      mark.style.setProperty('-webkit-mask-image', mask);
      mark.style.setProperty('mask-image', mask);
    }
    // next frame, so the opacity transition has a starting state
    requestAnimationFrame(() => this.root.classList.add('is-lite'));
  }

  // ---- when may the map open? -----------------------------------------------------
  private checkSettled(): void {
    if (!this.gameReady || !this.waiters.length) return;
    window.clearTimeout(this.holdTimer);
    let wait = 0;
    switch (this.phase) {
      case 'boot':
        // The game is ready and the scene has not even started: do not make anyone wait for it.
        this.sceneCancelled = true;
        break;
      case 'intro':
        this.hurry(this.skipped ? SKIP : HURRY);
        return; // onSettled() comes back here
      case 'idle':
        wait = this.skipped ? 0 : Math.max(0, HOLD_MS - (performance.now() - this.settledAt));
        break;
      case 'lite':
        wait = Math.max(0, LITE_MIN_MS - (performance.now() - this.shownAt));
        break;
      default:
        break;
    }
    if (wait > 0) this.holdTimer = window.setTimeout(() => this.flush(), wait);
    else this.flush();
  }

  private flush(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  // ---- teardown -----------------------------------------------------------------
  private teardownScene(): void {
    this.intro?.kill();
    this.idle?.kill();
    this.outro?.kill();
    this.intro = this.idle = this.outro = null;
    const app = this.app;
    if (app) {
      app.ticker.remove(this.tick);
      app.stage.off('childAdded', this.keepOnTop);
      app.renderer.off('resize', this.onResize);
    }
    this.releaseGsap?.();
    this.releaseGsap = null;
    try {
      this.scene?.destroy();
      this.images?.destroy();
    } catch (err) {
      console.warn('[splash] cleanup failed', err);
    }
    this.scene = null;
    this.images = null;
  }

  private dispose(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.sceneCancelled = true;
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.footTimer);
    this.teardownScene();
    this.root.removeEventListener('pointerdown', this.onPointer);
    this.root.remove();
    releasePreloadElements();
    this.flush();
  }

  // ---- debug ----------------------------------------------------------------------
  private debugSeek(seconds: number): void {
    const scene = this.scene;
    if (!scene || !this.intro) return;
    this.idle?.pause();
    this.phase = 'intro';
    this.intro.pause().time(seconds, true); // no callbacks: a still must not end the splash
    scene.paused = true;
    scene.timeSec = seconds;
  }

  private debugResume(): void {
    if (!this.scene || !this.intro) return;
    this.scene.paused = false;
    this.intro.play();
  }
}

/** A splash that is not there (`mode: 'off'`): the map shows as soon as it is ready. */
class NoSplash implements Splash {
  phase: SplashPhase = 'done';
  private readonly options: SplashOptions;
  constructor(options: SplashOptions) {
    this.options = options;
    releasePreloadElements();
  }
  attach(): void {}
  setProgress(): void {}
  settle(): Promise<void> {
    return Promise.resolve();
  }
  reveal(): Promise<void> {
    this.options.onReveal?.();
    return Promise.resolve();
  }
  fail(message: string): void {
    // still tell the user: a bare DOM message, no assets involved
    const box = document.createElement('div');
    box.className = 'tsp tsp--plain is-error';
    const text = el('p', 'tsp__error-text', el('div', 'tsp__error', box));
    text.textContent = message;
    document.getElementById('app')?.appendChild(box);
  }
}

export function createSplash(host: HTMLElement, options: SplashOptions = {}): Splash {
  if (options.mode === 'off') return new NoSplash(options);
  try {
    return new SplashScreen(host, options);
  } catch (err) {
    console.warn('[splash] could not start:', err);
    return new NoSplash(options);
  }
}
