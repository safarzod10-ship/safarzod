/**
 * Everything the Mini App needs, loaded once at start (boot screen) and shared by the home screen
 * and the battle: arena, three heroes, props, colliders, mockup images and fonts.
 *
 * Assets: <html data-assets="b64"> (claude.ai artifact: no .glb hosting, no WebAssembly) loads
 * models/<id>.txt (base64 GLB without Meshopt); otherwise models/<id>.glb with the Meshopt decoder.
 */
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Collider } from '../arena';
import { HEROES } from './data';

export const BASE = './models/';
const B64 = document.documentElement.dataset.assets === 'b64';

let loaderP: Promise<GLTFLoader> | null = null;
function getLoader(): Promise<GLTFLoader> {
  loaderP ??= (async () => {
    const l = new GLTFLoader();
    if (B64) {
      (window as unknown as { createImageBitmap?: unknown }).createImageBitmap = undefined;   // <img> decoding
    } else {
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      l.setMeshoptDecoder(MeshoptDecoder);
    }
    return l;
  })();
  return loaderP;
}

const cache = new Map<string, Promise<GLTF>>();
export function load(id: string, onBytes: (id: string, n: number) => void = () => {}): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const loader = await getLoader();
      if (!B64) return loader.loadAsync(`${BASE}${id}.glb`, (e) => onBytes(id, e.loaded));
      const res = await fetch(`${BASE}${id}.txt`);
      if (!res.ok || !res.body) throw new Error(`${id}: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
        onBytes(id, n * 0.75);
      }
      const all = new Uint8Array(n);
      let o = 0;
      for (const q of parts) { all.set(q, o); o += q.length; }
      const bin = atob(new TextDecoder().decode(all));
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return loader.parseAsync(buf.buffer, BASE);
    })();
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

let collidersP: Promise<Collider[]> | null = null;
export function loadColliders(): Promise<Collider[]> {
  collidersP ??= fetch(`${BASE}MAP_Dvor.colliders.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return collidersP;
}

export const UI_IMAGES = ['ui/menu_bg.jpg', 'ui/search_bg.jpg', 'ui/detail_technik.jpg', ...HEROES.map((h) => h.card)];

/** Approximate download sizes (bytes) for an honest progress bar. */
const SIZES: Record<string, number> = B64
  ? { MAP_Dvor: 768e3, USER_CH_Technik: 346e3, USER_CH_Tank: 315e3, USER_CH_Sprinter: 363e3, PROPS: 40e3 }
  : { MAP_Dvor: 751e3, USER_CH_Technik: 313e3, USER_CH_Tank: 287e3, USER_CH_Sprinter: 334e3, PROPS: 30e3 };
export const MODELS = Object.keys(SIZES);

/**
 * Load everything; `progress` gets 0..1, `onModel` each model id as it is ready. Images count by file, models by bytes.
 * Resolves when every model is parsed, every image decoded and the fonts are ready.
 */
export async function preloadAll(progress: (k: number) => void, onModel: (id: string) => void = () => {}): Promise<void> {
  const got = new Map<string, number>();
  let imgs = 0;
  const totalBytes = Object.values(SIZES).reduce((a, b) => a + b, 0);
  const report = () => {
    const b = MODELS.reduce((a, id) => a + Math.min(got.get(id) ?? 0, SIZES[id]), 0) / totalBytes;
    progress(Math.min(1, 0.85 * b + 0.15 * (imgs / UI_IMAGES.length)));
  };
  const onBytes = (id: string, n: number) => { got.set(id, n); report(); };
  const image = (src: string) => new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { (im.decode?.() ?? Promise.resolve()).catch(() => {}).finally(() => { imgs++; report(); res(); }); };
    im.onerror = () => { imgs++; report(); res(); };
    im.src = src;
  });
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  await Promise.all([
    ...MODELS.map((id) => load(id, onBytes).then(() => { got.set(id, SIZES[id]); report(); onModel(id); })),
    loadColliders(),
    ...UI_IMAGES.map(image),
    fonts ? Promise.race([Promise.all([fonts.load('italic 800 20px "Exo 2"'), fonts.load('500 16px Rubik')]), new Promise((r) => setTimeout(r, 4000))]) : null,
  ]);
  progress(1);
}
