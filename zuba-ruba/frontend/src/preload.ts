import { giftAnimationUrl, preloadAnimation } from "./lottie";

const MIN_SPLASH_MS = 1300;
const CRITICAL_TIMEOUT_MS = 4000;

export const GIFT_IDS = [
  "5170145012310081615",
  "5170233102089322756",
  "5168103777563050263",
  "5170250947678437525",
  "5170144170496491616",
  "5170314324215857265",
  "5170564780938756245",
  "6028601630662853006",
  "5168043875654172773",
  "5170521118301225164",
  "5170690322832818290",
];

let splashHidden = false;

export function setSplashProgress(value: number): void {
  const fill = document.getElementById("splash-fill");
  if (fill) fill.style.width = `${Math.round(Math.max(0.08, Math.min(value, 1)) * 100)}%`;
}

export async function hideSplash(): Promise<void> {
  if (splashHidden) return;
  splashHidden = true;
  const splash = document.getElementById("splash");
  if (!splash) return;
  setSplashProgress(1);
  const wait = MIN_SPLASH_MS - performance.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  splash.classList.add("splash-out");
  window.setTimeout(() => splash.remove(), 340);
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

function loadFont(): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve();
  return document.fonts.load('600 16px "Unbounded"').then(
    () => undefined,
    () => undefined,
  );
}

export async function preloadCritical(options: { onboarding: boolean; theme: "light" | "dark" }, onProgress: (value: number) => void): Promise<void> {
  const suffix = options.theme === "dark" ? "-dark" : "";
  const tasks: Array<() => Promise<unknown>> = [() => loadImage("/img/star.png"), loadFont];
  if (options.onboarding) {
    for (const index of [1, 2, 3]) tasks.push(() => loadImage(`/img/onboarding-${index}${suffix}.webp`));
  }
  let done = 0;
  const all = Promise.all(
    tasks.map((task) =>
      task().finally(() => {
        done += 1;
        onProgress(done / tasks.length);
      }),
    ),
  );
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, CRITICAL_TIMEOUT_MS))]);
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData) || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g";
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const request = (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (request) request(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 300);
  });
}

export async function preloadInBackground(): Promise<void> {
  if (saveData()) return;
  await idle();
  await import("lottie-web/build/player/lottie_light").catch(() => undefined);
  for (const id of GIFT_IDS) {
    await idle();
    await preloadAnimation(giftAnimationUrl(id)).catch(() => undefined);
  }
}
