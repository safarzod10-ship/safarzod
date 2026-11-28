/**
 * One small world-sized texture (coarse grid resolution) shared by the fog and
 * the terrain shader:
 *   R  distance from the continent, 0 on it, 1 = FOG.range wu out at sea
 *   G  "inlandness": 0 at sea and on the coast, 1 well inside the continent.
 *      Tells fresh water (rivers, lakes) from the sea so only the sea gets surf.
 */
import { BufferImageSource } from 'pixi.js';
import { COARSE_NODES, fogDistanceByte, type WorldFields } from './generation/WorldFields.ts';

/** inland e mapped to 0..1 over [0, INLAND_RANGE]. */
const INLAND_RANGE = 0.12;

export function createCoastTexture(world: WorldFields): BufferImageSource {
  const n = COARSE_NODES;
  const pixels = new Uint8Array(n * n * 4);
  const dist = world.coastDist.data;
  const inland = world.inland.data;
  for (let k = 0; k < n * n; k++) {
    pixels[k * 4] = fogDistanceByte(dist[k]);
    const v = inland[k] / INLAND_RANGE;
    pixels[k * 4 + 1] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    pixels[k * 4 + 3] = 255;
  }
  return new BufferImageSource({
    resource: pixels,
    width: n,
    height: n,
    format: 'rgba8unorm',
    alphaMode: 'no-premultiply-alpha',
    addressMode: 'clamp-to-edge',
    scaleMode: 'linear',
    autoGenerateMipmaps: false,
  });
}
