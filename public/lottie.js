const CACHE = 'anim-v1';
const memory = new Map();
const pending = new Map();
const live = new WeakMap();
let player = null;

function loadPlayer() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (!player) {
    player = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '/vendor/lottie_light.min.js';
      el.onload = () => resolve(window.lottie);
      el.onerror = () => {
        player = null;
        reject(new Error('player'));
      };
      document.head.append(el);
    });
  }
  return player;
}

async function fetchStored(url) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.json();
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {}
  }
  return res.json();
}

export function load(slug) {
  if (memory.has(slug)) return Promise.resolve(memory.get(slug));
  if (!pending.has(slug)) {
    pending.set(
      slug,
      fetchStored(`/gifts/${slug}.json`)
        .then((d) => {
          memory.set(slug, d);
          pending.delete(slug);
          return d;
        })
        .catch((e) => {
          pending.delete(slug);
          throw e;
        }),
    );
  }
  return pending.get(slug);
}

export const ready = (slug) => memory.has(slug);

export async function preloadAll(slugs, onProgress = () => {}) {
  let done = 0;
  onProgress(0, slugs.length);
  await Promise.all([
    loadPlayer().catch(() => {}),
    ...slugs.map((slug) =>
      load(slug)
        .catch(() => {})
        .finally(() => onProgress(++done, slugs.length)),
    ),
  ]);
  return slugs.every(ready);
}

export async function play(container, slug, { loop = true } = {}) {
  if (!container || live.has(container)) return live.get(container);
  live.set(container, null);
  try {
    const [lottie, animationData] = await Promise.all([loadPlayer(), load(slug)]);
    if (!container.isConnected) return live.delete(container);
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop,
      autoplay: true,
      animationData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
    });
    anim.addEventListener('DOMLoaded', () => container.classList.add('playing'));
    live.set(container, anim);
    return anim;
  } catch {
    live.delete(container);
  }
}

export function playAll(root, selector = '[data-lottie]') {
  root.querySelectorAll(selector).forEach((n) => play(n, n.dataset.lottie));
}
