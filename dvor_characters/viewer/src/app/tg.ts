interface TgWebApp {
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  initData?: string;
  initDataUnsafe?: { user?: { first_name?: string; username?: string }; start_param?: string };
  isVersionAtLeast?(v: string): boolean;
  shareMessage?(id: string, cb?: (sent: boolean) => void): void;
  switchInlineQuery?(query: string, chatTypes?: string[]): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy'): void; notificationOccurred(t: 'success' | 'error' | 'warning'): void };
}

let wa: TgWebApp | null = null;
let backCb: (() => void) | null = null;

export async function initTelegram(): Promise<void> {
  const inTelegram = /tgWebApp/.test(location.hash) || 'TelegramWebviewProxy' in window;
  if (!inTelegram) return;
  const get = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;

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
      setTimeout(res, 6000);
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

export const inTelegram = (): boolean => !!wa;

export const playerName = (): string => wa?.initDataUnsafe?.user?.first_name?.slice(0, 16) || 'Игрок';

export const initData = (): string => wa?.initData ?? '';

export const startParam = (): string => wa?.initDataUnsafe?.start_param ?? new URLSearchParams(location.search).get('startapp') ?? '';

export function shareMessage(id: string): Promise<boolean | null> {
  return new Promise((res) => {
    if (!wa?.shareMessage || !wa.isVersionAtLeast?.('8.0')) return res(null);
    wa.shareMessage(id, (sent) => res(!!sent));
  });
}

export function switchInline(query: string): boolean {
  if (!wa?.switchInlineQuery || !wa.isVersionAtLeast?.('6.7')) return false;
  wa.switchInlineQuery(query, ['users', 'groups', 'supergroups']);
  return true;
}
