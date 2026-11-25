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
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy'): void; notificationOccurred(t: 'success' | 'error' | 'warning'): void };
}

let wa: TgWebApp | null = null;
let backCb: (() => void) | null = null;

export async function initTelegram(): Promise<void> {
  const inTelegram = /tgWebApp/.test(location.hash) || 'TelegramWebviewProxy' in window;
  if (!inTelegram) return;
  await new Promise<void>((res) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => res();
    s.onerror = () => res();
    document.head.appendChild(s);
  });
  wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.setHeaderColor?.('#1b1a1e');
  wa.setBackgroundColor?.('#1b1a1e');
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
