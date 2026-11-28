/**
 * Game-side Telegram helpers: init data for auth, haptics, the native back
 * button, invoices, safe areas. Everything is a no-op outside Telegram.
 */

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface TgApp {
  initData?: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string; language_code?: string } };
  version?: string;
  platform?: string;
  viewportStableHeight?: number;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  openInvoice?: (url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  isVersionAtLeast?: (v: string) => boolean;
}

export function tg(): TgApp | null {
  return (window as unknown as { Telegram?: { WebApp?: TgApp } }).Telegram?.WebApp ?? null;
}

export function initData(): string {
  return tg()?.initData ?? '';
}

export function tgUserName(): string {
  const u = tg()?.initDataUnsafe?.user;
  return u?.first_name ?? u?.username ?? '';
}

export const haptic = {
  tap(): void {
    try {
      tg()?.HapticFeedback?.impactOccurred('light');
    } catch {
      /* not supported */
    }
  },
  select(): void {
    try {
      tg()?.HapticFeedback?.selectionChanged();
    } catch {
      /* not supported */
    }
  },
  ok(): void {
    try {
      tg()?.HapticFeedback?.notificationOccurred('success');
    } catch {
      /* not supported */
    }
  },
  error(): void {
    try {
      tg()?.HapticFeedback?.notificationOccurred('error');
    } catch {
      /* not supported */
    }
  },
  heavy(): void {
    try {
      tg()?.HapticFeedback?.impactOccurred('medium');
    } catch {
      /* not supported */
    }
  },
};

/** One handler at a time: the most recently opened panel owns the back button. */
let backHandler: (() => void) | null = null;
const onBack = (): void => backHandler?.();
let backBound = false;

export function setBack(handler: (() => void) | null): void {
  const app = tg();
  backHandler = handler;
  if (!app?.BackButton) return;
  if (!backBound) {
    app.BackButton.onClick(onBack);
    backBound = true;
  }
  if (handler) app.BackButton.show();
  else app.BackButton.hide();
}

export function openInvoice(link: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  const app = tg();
  return new Promise((resolve) => {
    if (app?.openInvoice) app.openInvoice(link, (status) => resolve(status));
    else resolve('failed');
  });
}

/**
 * Mirror Telegram's safe areas into CSS variables (--tg-safe-*). The map
 * already reads --tg-content-safe-area-inset-top which Telegram sets itself
 * in recent clients; this also covers older ones.
 */
export function watchSafeArea(): void {
  const apply = (): void => {
    const app = tg();
    const s = app?.safeAreaInset;
    const c = app?.contentSafeAreaInset;
    const root = document.documentElement.style;
    root.setProperty('--tg-top', `${(s?.top ?? 0) + (c?.top ?? 0)}px`);
    root.setProperty('--tg-bottom', `${(s?.bottom ?? 0) + (c?.bottom ?? 0)}px`);
    if (app?.viewportStableHeight) root.setProperty('--tg-vh', `${app.viewportStableHeight}px`);
  };
  apply();
  const app = tg();
  app?.onEvent?.('safeAreaChanged', apply);
  app?.onEvent?.('contentSafeAreaChanged', apply);
  app?.onEvent?.('viewportChanged', apply);
  // the SDK may finish loading after us
  window.setTimeout(apply, 600);
  window.setTimeout(apply, 2000);
}
