/**
 * Telegram Mini App integration. Does nothing outside Telegram (no network
 * request, no globals), so the map also runs as a plain web page.
 */
interface TelegramWebApp {
  ready(): void;
  expand(): void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    TelegramWebviewProxy?: unknown;
  }
}

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

export function isTelegram(): boolean {
  return (
    typeof window !== 'undefined' &&
    (!!window.Telegram?.WebApp || !!window.TelegramWebviewProxy || /tgWebApp(Data|Version|Platform)=/.test(location.hash))
  );
}

function loadSdk(): Promise<TelegramWebApp | null> {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(window.Telegram?.WebApp ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

/** Colour Telegram's header and backdrop currently should have (the SDK may still be loading). */
let chromeColor = '';

function applyChromeColor(app: TelegramWebApp | null | undefined): void {
  if (!app || !chromeColor) return;
  try {
    app.setHeaderColor?.(chromeColor);
    app.setBackgroundColor?.(chromeColor);
  } catch (err) {
    console.warn('[telegram] colours rejected', err);
  }
}

/**
 * Recolour Telegram's header and backdrop, e.g. when the dark loading splash
 * gives way to the map. Safe to call at any time, inside or outside Telegram.
 */
export function setTelegramColors(color: string): void {
  chromeColor = color;
  applyChromeColor(window.Telegram?.WebApp);
}

/**
 * @param color header / backdrop colour to start with (see setTelegramColors)
 * @param onViewportChange called when Telegram resizes the Mini App
 * @returns true when running inside Telegram and the SDK was initialised
 */
export async function initTelegram(color: string, onViewportChange: () => void): Promise<boolean> {
  if (!isTelegram()) return false;
  if (!chromeColor) chromeColor = color;
  const app = await loadSdk();
  if (!app) return false;
  try {
    app.ready();
    app.expand();
    // Dragging the map down must not collapse / close the Mini App.
    app.disableVerticalSwipes?.();
    applyChromeColor(app); // whatever was asked for last, also while the SDK was loading
    app.onEvent?.('viewportChanged', onViewportChange);
  } catch (err) {
    console.warn('[telegram] init failed', err);
  }
  return true;
}
