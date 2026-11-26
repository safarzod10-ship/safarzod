/**
 * Telegram Mini App bridge. Everything is optional: outside Telegram (browser, artifact) the calls
 * do nothing. The Telegram script is only injected when the page was opened by Telegram.
 */
interface TgWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  isVersionAtLeast?(v: string): boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  lockOrientation?(): void;
  unlockOrientation?(): void;
  isFullscreen?: boolean;
  initDataUnsafe?: { user?: { first_name?: string; username?: string } };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy'): void; notificationOccurred(t: 'success' | 'error' | 'warning'): void };
}

let wa: TgWebApp | null = null;
let backCb: (() => void) | null = null;

export async function initTelegram(): Promise<void> {
  const inTelegram = /tgWebApp/.test(location.hash) || 'TelegramWebviewProxy' in window;
  if (!inTelegram) return;
  const get = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
  // the splash (splash/splash.html) already started loading the SDK as script#tg-sdk
  if (!get()) {
    await new Promise<void>((res) => {
      let s = document.getElementById('tg-sdk') as HTMLScriptElement | null;
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://telegram.org/js/telegram-web-app.js';
        document.head.appendChild(s);
      }
      s.addEventListener('load', () => res());
      s.addEventListener('error', () => res());
      setTimeout(res, 6000);   // never hold the game on Telegram's CDN
    });
  }
  wa = get();
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.setHeaderColor?.('#1b1a1e');
  wa.setBackgroundColor?.('#121114');
  wa.disableVerticalSwipes?.();
}

/** Telegram's own back button (shown on pushed screens); null hides it. */
export function setBack(cb: (() => void) | null): void {
  if (!wa) return;
  if (backCb) wa.BackButton.offClick(backCb);
  backCb = cb;
  if (cb) {
    wa.BackButton.onClick(cb);
    wa.BackButton.show();
  } else {
    wa.BackButton.hide();
  }
}

export function haptic(kind: 'light' | 'medium' | 'success' = 'light'): void {
  if (!wa?.HapticFeedback) return;
  if (kind === 'success') wa.HapticFeedback.notificationOccurred('success');
  else wa.HapticFeedback.impactOccurred(kind);
}

const v8 = () => !!wa?.isVersionAtLeast?.('8.0');

/**
 * Battle in landscape. Telegram (Bot API 8.0+): full screen, and once the phone is held sideways,
 * lock that orientation. Telegram cannot rotate the screen by itself, the player turns the phone.
 */
export function battleScreen(on: boolean): void {
  if (!wa || !v8()) return;
  try {
    if (on) wa.requestFullscreen?.();
    else { wa.unlockOrientation?.(); if (wa.isFullscreen) wa.exitFullscreen?.(); }
  } catch { /* old client */ }
}
export function lockLandscape(): void {
  if (!wa || !v8()) return;
  try { wa.lockOrientation?.(); } catch { /* old client */ }
}
export const inTelegram = (): boolean => !!wa;

/** The player's first name from Telegram, or a neutral name outside Telegram. */
export const playerName = (): string => wa?.initDataUnsafe?.user?.first_name?.slice(0, 16) || 'Игрок';
