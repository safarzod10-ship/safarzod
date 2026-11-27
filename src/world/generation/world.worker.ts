/**
 * World worker: generates the world and bakes terrain chunks off the main
 * thread, so panning never waits for terrain work.
 */
import { bakeChunk } from '../terrain/chunkBaker.ts';
import { generateWorld } from './generateWorld.ts';
import type { WorldFields } from './WorldFields.ts';
import type { WorkerRequest, WorkerResponse } from './worldProtocol.ts';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

let world: WorldFields | null = null;

ctx.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      let last = 0;
      world = generateWorld(msg.params, (value) => {
        if (value - last >= 0.04) {
          last = value;
          ctx.postMessage({ type: 'progress', value });
        }
      });
      // The worker keeps its own arrays; the main thread gets copies.
      const src = world.toRaw();
      const raw = {
        ...src,
        e: src.e.slice(),
        relief: src.relief.slice(),
        forest: src.forest.slice(),
        moist: src.moist.slice(),
        meadow: src.meadow.slice(),
        coastDist: src.coastDist.slice(),
      };
      ctx.postMessage({ type: 'ready', raw }, [
        raw.e.buffer,
        raw.relief.buffer,
        raw.forest.buffer,
        raw.moist.buffer,
        raw.meadow.buffer,
        raw.coastDist.buffer,
      ]);
    } else if (msg.type === 'bake') {
      if (!world) throw new Error('bake before init');
      const t0 = performance.now();
      const pixels = bakeChunk(world, msg.level, msg.cx, msg.cy);
      ctx.postMessage({ type: 'baked', id: msg.id, pixels, ms: performance.now() - t0 }, [pixels.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
