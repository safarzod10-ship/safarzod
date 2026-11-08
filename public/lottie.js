let player = null;
const cache = new Map();
const live = new WeakMap();

function loadPlayer() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (!player) {
    player = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '/vendor/lottie_light.min.js';
      el.onload = () => resolve(window.lottie);
      el.onerror = reject;
      document.head.append(el);
    });
  }
  return player;
}

function data(slug) {
  if (!cache.has(slug))
    cache.set(
      slug,
      fetch(`/gifts/${slug}.json`).then((r) => r.json()),
    );
  return cache.get(slug);
}

export async function play(container, slug) {
  if (!container || live.has(container)) return;
  live.set(container, null);
  try {
    const [lottie, animationData] = await Promise.all([loadPlayer(), data(slug)]);
    if (!container.isConnected) return live.delete(container);
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice', progressiveLoad: true },
    });
    anim.addEventListener('DOMLoaded', () => container.classList.add('playing'));
    live.set(container, anim);
  } catch {
    live.delete(container);
  }
}

export function stop(container) {
  const anim = live.get(container);
  anim?.destroy();
  live.delete(container);
  container?.classList.remove('playing');
}

export function playVisible(root, selector = '[data-lottie]') {
  const nodes = [...root.querySelectorAll(selector)];
  if (!('IntersectionObserver' in window)) return nodes.forEach((n) => play(n, n.dataset.lottie));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const n = e.target;
      if (e.isIntersecting) play(n, n.dataset.lottie);
      else {
        const anim = live.get(n);
        anim?.pause();
      }
      if (e.isIntersecting) live.get(n)?.play();
    }
  });
  nodes.forEach((n) => io.observe(n));
  return io;
}
