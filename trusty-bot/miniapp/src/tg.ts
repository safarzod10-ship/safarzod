// Thin wrapper over Telegram.WebApp with browser fallbacks, so the prototype runs both inside Telegram and in a normal tab.

type BtnParams = { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean };
type NativeButton = {
  setParams(p: BtnParams): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  show(): void;
  hide(): void;
};

interface WebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }; start_param?: string };
  colorScheme: 'light' | 'dark';
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  onEvent(e: string, cb: () => void): void;
  offEvent?(e: string, cb: () => void): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  openInvoice?(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: NativeButton;
  SecondaryButton?: NativeButton & { setParams(p: BtnParams & { position?: string }): void };
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  disableVerticalSwipes?(): void;
}

const wa: WebApp | undefined = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

/** true only when opened from Telegram (initData is empty in a normal browser tab) */
export const inTelegram = !!wa && !!wa.initData;
export const tg = inTelegram ? wa : undefined;

export const tgUser = tg?.initDataUnsafe.user;

const BG = '#000000';

/** IT Trusty is always dark: black ground, whatever the Telegram theme is */
export function applyTheme() {
  const root = document.documentElement;
  root.classList.add('dark');
  root.classList.remove('light');
  if (tg) {
    try {
      tg.setHeaderColor(BG);
      tg.setBackgroundColor(BG);
      tg.setBottomBarColor?.(BG);
    } catch {
      /* older clients accept only keywords */
    }
  }
}

export function initTelegram() {
  applyTheme();
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.disableVerticalSwipes?.();
    } catch {
      /* not supported */
    }
    tg.onEvent('themeChanged', applyTheme);
  }
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.impactOccurred('light'),
  select: () => tg?.HapticFeedback?.selectionChanged(),
  success: () => tg?.HapticFeedback?.notificationOccurred('success'),
  warning: () => tg?.HapticFeedback?.notificationOccurred('warning'),
  error: () => tg?.HapticFeedback?.notificationOccurred('error'),
};

/** opens a t.me link (Crypto Bot invoice or check) inside Telegram, or a new tab in a browser */
export function openTg(url: string) {
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

/** pays a Telegram Stars invoice inside Telegram; resolves with the final status */
export function payInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  return new Promise((resolve) => {
    if (tg?.openInvoice && tg.isVersionAtLeast('6.1')) tg.openInvoice(url, (st) => resolve(st));
    else { openTg(url); resolve('pending'); }
  });
}

/** an absolute URL for a server path like /api/f/a/1?sig=... */
export const absUrl = (path: string) => (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:') ? path : `${location.origin}${path}`);

/** saves a file: Telegram's own download dialog when available, else a new tab */
export function downloadFile(path: string, name: string) {
  const url = absUrl(path);
  if (tg?.downloadFile && tg.isVersionAtLeast('8.0')) { try { tg.downloadFile({ url, file_name: name }); return; } catch { /* fall back */ } }
  if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
}

/** calls fn when the user comes back to the Mini App (e.g. after paying in @CryptoBot) */
export function onReturn(fn: () => void): () => void {
  const vis = () => { if (document.visibilityState === 'visible') fn(); };
  document.addEventListener('visibilitychange', vis);
  tg?.onEvent('activated', fn);
  return () => { document.removeEventListener('visibilitychange', vis); tg?.offEvent?.('activated', fn); };
}

/** plays the splash exit once its intro has finished (the splash lives in index.html) */
export function hideSplash(): Promise<void> {
  const sp = (window as unknown as { __tlSplash?: { finish(): Promise<void> } }).__tlSplash;
  if (sp) return sp.finish();
  document.getElementById('tl-splash')?.remove();
  return Promise.resolve();
}
