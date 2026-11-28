/**
 * The two images the splash needs, as textures:
 *   world  the illustration (AVIF where the browser can decode it, else WebP)
 *   data   the logo / mask atlas (PNG, read as raw numbers by the shaders)
 *
 * index.html already lists both in a hidden <picture>/<img>, so the browser
 * starts downloading them together with the script and picks the codec by
 * itself. If the page has no such elements (another host page), the same files
 * are loaded from here.
 */
import { ImageSource } from 'pixi.js';
import worldAvifUrl from './assets/world.avif';
import worldWebpUrl from './assets/world.webp';
import dataUrl from './assets/splash-data.png';

export const WORLD_ELEMENT_ID = 'splash-world';
export const DATA_ELEMENT_ID = 'splash-data';

export interface SplashImages {
  world: ImageSource;
  data: ImageSource;
  /** Address of the illustration the browser chose (for the DOM fallback). */
  worldUrl: string;
  destroy(): void;
}

type Drawable = HTMLImageElement | ImageBitmap;

function settle(img: HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const ok = (): void => {
      // decode() keeps the pixels ready, so the first draw does not decode on the main thread
      const decoded = typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
      void decoded.then(() => resolve(img));
    };
    if (img.complete) {
      if (img.naturalWidth > 0) ok();
      else reject(new Error(`image failed: ${img.currentSrc || img.src}`));
      return;
    }
    img.addEventListener('load', ok, { once: true });
    img.addEventListener('error', () => reject(new Error(`image failed: ${img.currentSrc || img.src}`)), { once: true });
  });
}

function fromUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return settle(img);
}

/** The preloaded element if the page has one, otherwise the listed addresses in order. */
async function obtain(elementId: string, urls: readonly string[]): Promise<HTMLImageElement> {
  const host = document.getElementById(elementId);
  const preloaded = host instanceof HTMLImageElement ? host : (host?.querySelector('img') ?? null);
  if (preloaded) {
    try {
      return await settle(preloaded);
    } catch {
      /* fall through to our own copies */
    }
  }
  let lastError: unknown = new Error('no image address');
  for (const url of urls) {
    try {
      return await fromUrl(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * An ImageBitmap uploads to the GPU without another decode. Raw data must not
 * be colour-managed or premultiplied; where the options are not understood the
 * plain call is tried, then the element itself is used.
 */
async function toBitmap(img: HTMLImageElement, options: ImageBitmapOptions | null): Promise<Drawable> {
  if (typeof createImageBitmap !== 'function') return img;
  try {
    return options ? await createImageBitmap(img, options) : await createImageBitmap(img);
  } catch {
    if (!options) return img;
    try {
      return await createImageBitmap(img);
    } catch {
      return img;
    }
  }
}

/**
 * @param maxWorldHeight draw the illustration no larger than this (device px); saves GPU memory on small screens
 */
export async function loadSplashImages(maxWorldHeight: number): Promise<SplashImages> {
  const [worldImg, dataImg] = await Promise.all([
    obtain(WORLD_ELEMENT_ID, [worldAvifUrl, worldWebpUrl]),
    obtain(DATA_ELEMENT_ID, [dataUrl]),
  ]);

  let worldOptions: ImageBitmapOptions | null = null;
  if (worldImg.naturalHeight > maxWorldHeight * 1.15) {
    const k = maxWorldHeight / worldImg.naturalHeight;
    worldOptions = {
      resizeWidth: Math.round(worldImg.naturalWidth * k),
      resizeHeight: Math.round(worldImg.naturalHeight * k),
      resizeQuality: 'high',
    };
  }
  const [worldBitmap, dataBitmap] = await Promise.all([
    toBitmap(worldImg, worldOptions),
    toBitmap(dataImg, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
  ]);

  const world = new ImageSource({
    resource: worldBitmap,
    alphaMode: 'no-premultiply-alpha',
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
    autoGenerateMipmaps: false,
    label: 'splash-world',
  });
  const data = new ImageSource({
    resource: dataBitmap,
    alphaMode: 'no-premultiply-alpha',
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
    autoGenerateMipmaps: false,
    label: 'splash-data',
  });
  // both are needed until the splash ends: never let the texture GC drop them mid-animation
  world.autoGarbageCollect = false;
  data.autoGarbageCollect = false;

  return {
    world,
    data,
    worldUrl: worldImg.currentSrc || worldImg.src,
    destroy() {
      world.destroy();
      data.destroy();
      for (const b of [worldBitmap, dataBitmap]) {
        if (typeof ImageBitmap !== 'undefined' && b instanceof ImageBitmap) b.close();
      }
    },
  };
}

/** Address of the illustration for the DOM-only splash: whatever the preloaded element resolved to. */
export function worldImageUrl(): string {
  const host = document.getElementById(WORLD_ELEMENT_ID);
  const img = host instanceof HTMLImageElement ? host : (host?.querySelector('img') ?? null);
  return img?.currentSrc || img?.src || worldWebpUrl;
}

/** Drop the preload elements once nobody needs their pixels any more. */
export function releasePreloadElements(): void {
  document.getElementById(WORLD_ELEMENT_ID)?.remove();
  document.getElementById(DATA_ELEMENT_ID)?.remove();
}
