type HapticImpact = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotification = "error" | "success" | "warning";

interface Inset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface BackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface PopupButton {
  id?: string;
  type?: "default" | "ok" | "close" | "cancel" | "destructive";
  text?: string;
}

export interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number } };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  BackButton: BackButton;
  HapticFeedback?: {
    impactOccurred(style: HapticImpact): void;
    notificationOccurred(type: HapticNotification): void;
    selectionChanged(): void;
  };
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  showAlert?(message: string, cb?: () => void): void;
  showPopup?(params: { title?: string; message: string; buttons?: PopupButton[] }, cb?: (id: string) => void): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export function webApp(): WebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function initData(): string {
  return webApp()?.initData ?? "";
}

function supports(version: string): boolean {
  const app = webApp();
  if (!app) return false;
  try {
    return app.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

export function setupWebApp(): void {
  if (window.location.hash && !window.location.hash.startsWith("#/")) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
  }
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  if (supports("7.7")) app.disableVerticalSwipes?.();
  applyInsets();
  app.onEvent("safeAreaChanged", applyInsets);
  app.onEvent("contentSafeAreaChanged", applyInsets);
}

function applyInsets(): void {
  const app = webApp();
  const root = document.documentElement.style;
  const safe = app?.safeAreaInset;
  const content = app?.contentSafeAreaInset;
  root.setProperty("--tg-safe-top", `${(safe?.top ?? 0) + (content?.top ?? 0)}px`);
  root.setProperty("--tg-safe-bottom", `${(safe?.bottom ?? 0) + (content?.bottom ?? 0)}px`);
}

export function colorScheme(): "light" | "dark" {
  const app = webApp();
  if (app?.initData) return app.colorScheme === "dark" ? "dark" : "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function paintChrome(background: string): void {
  const app = webApp();
  if (!app) return;
  try {
    if (supports("6.1")) {
      app.setHeaderColor(background);
      app.setBackgroundColor(background);
    }
    if (supports("7.10")) app.setBottomBarColor?.(background);
  } catch {
    return;
  }
}

export function onThemeChange(cb: () => void): () => void {
  const app = webApp();
  if (!app) return () => undefined;
  app.onEvent("themeChanged", cb);
  return () => app.offEvent("themeChanged", cb);
}

export function haptic(kind: HapticImpact | HapticNotification | "select"): void {
  const feedback = webApp()?.HapticFeedback;
  if (!feedback || !supports("6.1")) return;
  if (kind === "select") feedback.selectionChanged();
  else if (kind === "error" || kind === "success" || kind === "warning") feedback.notificationOccurred(kind);
  else feedback.impactOccurred(kind);
}

export function isTelegramLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "t.me" || host === "telegram.me";
  } catch {
    return false;
  }
}

export function openExternal(url: string): void {
  const app = webApp();
  if (!app) {
    window.open(url, "_blank", "noopener");
    return;
  }
  if (isTelegramLink(url)) app.openTelegramLink(url);
  else app.openLink(url);
}

export function confirmDialog(message: string): Promise<boolean> {
  const app = webApp();
  if (app?.showConfirm && supports("6.2")) {
    return new Promise((resolve) => app.showConfirm!(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(window.confirm(message));
}

export function alertDialog(message: string): Promise<void> {
  const app = webApp();
  if (app?.showAlert && supports("6.2")) {
    return new Promise((resolve) => app.showAlert!(message, () => resolve()));
  }
  window.alert(message);
  return Promise.resolve();
}

export function showBackButton(handler: () => void): () => void {
  const app = webApp();
  if (!app || !supports("6.1")) return () => undefined;
  app.BackButton.onClick(handler);
  app.BackButton.show();
  return () => {
    app.BackButton.offClick(handler);
    app.BackButton.hide();
  };
}

export function parseInitData(raw: string): { user: { id: number; first_name?: string; username?: string } | null; startParam: string | null; authDate: number | null } {
  const params = new URLSearchParams(raw);
  let user = null;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      const parsed = JSON.parse(userRaw);
      if (parsed && typeof parsed.id === "number") user = parsed;
    } catch {
      user = null;
    }
  }
  const authDate = Number(params.get("auth_date"));
  return {
    user,
    startParam: params.get("start_param"),
    authDate: Number.isFinite(authDate) && authDate > 0 ? authDate : null,
  };
}
