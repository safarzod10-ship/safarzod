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

/**
 * @param onViewportChange called when Telegram resizes the Mini App
 * @returns true when running inside Telegram and the SDK was initialised
 */
export async function initTelegram(color: string, onViewportChange: () => void): Promise<boolean> {
  if (!isTelegram()) return false;
  const app = await loadSdk();
  if (!app) return false;
  try {
    app.ready();
    app.expand();
    // Dragging the map down must not collapse / close the Mini App.
    app.disableVerticalSwipes?.();
    app.setHeaderColor?.(color);
    app.setBackgroundColor?.(color);
    app.onEvent?.('viewportChanged', onViewportChange);
  } catch (err) {
    console.warn('[telegram] init failed', err);
  }
  return true;
}
