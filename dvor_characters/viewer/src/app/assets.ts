import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Collider } from './game/arena';
import { HEROES } from './data';

export const BASE = './models/';

let loaderP: Promise<GLTFLoader> | null = null;
function getLoader(): Promise<GLTFLoader> {
  loaderP ??= import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
    const l = new GLTFLoader();
    l.setMeshoptDecoder(MeshoptDecoder);
    return l;
  });
  return loaderP;
}

const cache = new Map<string, Promise<GLTF>>();
export function load(id: string, onBytes: (id: string, n: number) => void = () => {}): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    p = getLoader().then((l) => l.loadAsync(`${BASE}${id}.glb`, (e) => onBytes(id, e.loaded)));
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

export const UI_IMAGES = ['ui/search_bg.jpg', ...HEROES.flatMap((h) => [h.menu, h.card])];

const SIZES: Record<string, number> = {
  MAP_Dvor: 751e3, PROPS: 21e3,

  ...Object.fromEntries(HEROES.map((h) => [h.model, ({ technik: 346e3, sprinter: 339e3, tank: 307e3, sniper: 474e3, medic: 484e3 } as Record<string, number>)[h.id]])),
};
export const MODELS = Object.keys(SIZES);

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
