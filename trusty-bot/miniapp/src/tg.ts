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
  initDataUnsafe: { user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string; is_premium?: boolean }; start_param?: string };
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
  shareMessage?(msgId: string, cb?: (sent: boolean) => void): void;
  switchInlineQuery?(query: string, chooseChatTypes?: string[]): void;
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

export const inTelegram = !!wa && !!wa.initData;
export const tg = inTelegram ? wa : undefined;

export const tgUser = tg?.initDataUnsafe.user;

const BG = '#000000';

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

export function openTg(url: string) {
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function payInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  return new Promise((resolve) => {
    if (tg?.openInvoice && tg.isVersionAtLeast('6.1')) tg.openInvoice(url, (st) => resolve(st));
    else { openTg(url); resolve('pending'); }
  });
}

export const absUrl = (path: string) => (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:') ? path : `${location.origin}${path}`);

export function downloadFile(path: string, name: string) {
  const url = absUrl(path);
  if (tg?.downloadFile && tg.isVersionAtLeast('8.0')) { try { tg.downloadFile({ url, file_name: name }); return; } catch {} }
  if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
}

export function onReturn(fn: () => void): () => void {
  const vis = () => { if (document.visibilityState === 'visible') fn(); };
  document.addEventListener('visibilitychange', vis);
  tg?.onEvent('activated', fn);
  return () => { document.removeEventListener('visibilitychange', vis); tg?.offEvent?.('activated', fn); };
}

export function hideSplash(): Promise<void> {
  const sp = (window as unknown as { __tlSplash?: { finish(): Promise<void> } }).__tlSplash;
  if (sp) return sp.finish();
  document.getElementById('tl-splash')?.remove();
  return Promise.resolve();
}

export function sharePrepared(id: string, done?: (sent: boolean) => void): boolean {
  if (!tg?.shareMessage || !tg.isVersionAtLeast('8.0')) return false;
  let fired = false;
  const onSent = () => finish(true);
  const onFailed = () => finish(false);
  const off = () => { tg?.offEvent?.('shareMessageSent', onSent); tg?.offEvent?.('shareMessageFailed', onFailed); };
  function finish(sent: boolean) { if (fired) return; fired = true; off(); done?.(sent); }
  tg.onEvent('shareMessageSent', onSent);
  tg.onEvent('shareMessageFailed', onFailed);
  try { tg.shareMessage(id, (sent) => finish(!!sent)); } catch { off(); return false; }
  return true;
}

export function shareInline(query: string): boolean {
  if (!tg?.switchInlineQuery || !tg.isVersionAtLeast('6.7')) return false;
  try { tg.switchInlineQuery(query, ['users', 'groups', 'channels']); return true; } catch { return false; }
}
