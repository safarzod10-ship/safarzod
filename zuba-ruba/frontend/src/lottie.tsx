import { useEffect, useRef } from "react";

type LottieModule = typeof import("lottie-web/build/player/lottie_light");
type AnimationItem = ReturnType<LottieModule["default"]["loadAnimation"]>;

const FPS = 30;
let lottiePromise: Promise<LottieModule["default"]> | null = null;
const dataCache = new Map<string, Promise<unknown>>();

function loadLottie() {
  lottiePromise ??= import("lottie-web/build/player/lottie_light").then((module) => module.default);
  return lottiePromise;
}

function loadData(src: string) {
  let promise = dataCache.get(src);
  if (!promise) {
    promise = fetch(src).then((response) => {
      if (!response.ok) throw new Error(`animation ${src}: ${response.status}`);
      return response.json();
    });
    promise.catch(() => dataCache.delete(src));
    dataCache.set(src, promise);
  }
  return promise;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function giftAnimationUrl(giftId: string): string {
  return `/gifts/${giftId}.json`;
}

export function Lottie({
  src,
  size,
  play = true,
  frame = 0,
  className,
  fallback,
}: {
  src: string;
  size: number;
  play?: boolean;
  frame?: number;
  className?: string;
  fallback?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let animation: AnimationItem | null = null;
    let raf = 0;
    let visible = true;
    let cancelled = false;
    const animate = play && !reducedMotion();

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(container);

    Promise.all([loadLottie(), loadData(src)])
      .then(([lottie, data]) => {
        if (cancelled) return;
        container.textContent = "";
        animation = lottie.loadAnimation({ container, renderer: "svg", loop: true, autoplay: false, animationData: data });
        const total = animation.totalFrames;
        const sourceFps = (data as { fr?: number }).fr ?? 60;
        animation.goToAndStop(Math.min(frame, total - 1), true);
        if (!animate) return;
        let current = frame;
        let last = 0;
        const step = sourceFps / FPS;
        const tick = (time: number) => {
          raf = requestAnimationFrame(tick);
          if (!visible || document.hidden || time - last < 1000 / FPS - 1) return;
          last = time;
          current = (current + step) % total;
          animation?.goToAndStop(Math.floor(current), true);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled && fallback) container.textContent = fallback;
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      animation?.destroy();
    };
  }, [src, play, frame, fallback]);

  return <div ref={ref} className={["lottie", className ?? ""].join(" ").trim()} style={{ width: size, height: size, fontSize: size * 0.6 }} aria-hidden="true" />;
}
