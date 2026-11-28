/**
 * PixiJS application set-up.
 *
 * WebGL only: the terrain and fog use GLSL programs (WebGL 2 with automatic
 * WebGL 1 fallback). WebGPU is deliberately not requested - it is not yet
 * reliably available in Android WebViews, which are the primary target.
 */
import 'pixi.js/unsafe-eval'; // no `new Function` at runtime: works under strict CSP
import { Application } from 'pixi.js';
import { FOG, RENDER } from '../core/config.ts';

export interface RendererInfo {
  app: Application;
  /** e.g. "webgl2" / "webgl1". */
  api: string;
  gpu: string;
  maxTextureSize: number;
  lowMemory: boolean;
}

export function pickResolution(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(RENDER.minResolution, Math.min(RENDER.maxResolution, dpr));
}

export async function createRenderer(host: HTMLElement): Promise<RendererInfo> {
  const app = new Application();
  await app.init({
    preference: ['webgl'],
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    resolution: pickResolution(),
    autoDensity: true,
    antialias: false,
    background: FOG.colorHex,
    powerPreference: 'high-performance',
    hello: false,
  });
  host.appendChild(app.canvas);
  app.canvas.style.display = 'block';

  const gl = (app.renderer as unknown as { gl: WebGLRenderingContext | WebGL2RenderingContext }).gl;
  const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  let gpu = 'unknown';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* blocked for privacy: fine */
  }
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    app,
    api: isGl2 ? 'webgl2' : 'webgl1',
    gpu,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    lowMemory: typeof deviceMemory === 'number' && deviceMemory <= 4,
  };
}
