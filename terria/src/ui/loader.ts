/**
 * The loading screen is public/loader/terria-loader.js, started from index.html
 * before any module loads. This is the game's side of it: report progress,
 * wait for its intro, finish it, or show an error on it.
 */

interface TerriaLoaderApi {
  set(progress: number): void;
  done(): void;
  fail(message: string): void;
  readonly progress: number;
  readonly introDone: boolean;
}

declare global {
  interface Window {
    TerriaLoader?: TerriaLoaderApi;
  }
}

const api = (): TerriaLoaderApi | undefined => window.TerriaLoader;

const once = (event: string, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    const finish = (): void => {
      window.removeEventListener(event, finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    window.addEventListener(event, finish);
  });

export const loader = {
  /** Loading progress, 0..1 (never goes back). */
  set(progress: number): void {
    api()?.set(progress);
  },

  /** Resolves when the logo has finished assembling (at once without a loader). */
  intro(): Promise<void> {
    const l = api();
    if (!l || l.introDone) return Promise.resolve();
    return once('terria-loader-intro', 12000);
  },

  /**
   * Plays the exit. `revealed` resolves when the screen starts to fade out over
   * the map, `gone` when it has been removed.
   */
  finish(): { revealed: Promise<void>; gone: Promise<void> } {
    const l = api();
    if (!l || !document.getElementById('terria-loader')) return { revealed: Promise.resolve(), gone: Promise.resolve() };
    const revealed = once('terria-loader-reveal', 6000);
    const gone = once('terria-loader-done', 8000);
    l.done();
    return { revealed, gone };
  },

  fail(message: string): void {
    const l = api();
    if (l) l.fail(message);
    else window.alert(message);
  },
};
