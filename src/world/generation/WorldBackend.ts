/**
 * Where the heavy, deterministic world work runs.
 *
 *  - WorkerBackend      preferred: a dedicated Web Worker.
 *  - MainThreadBackend  fallback when workers are unavailable (strict CSP,
 *                       exotic WebViews): same code, time-sliced per frame.
 *
 * Both return identical data; callers only see the WorldBackend interface.
 */
import { bakeChunkSteps } from '../terrain/chunkBaker.ts';
import { generateWorldSteps } from './generateWorld.ts';
import { WorldFields } from './WorldFields.ts';
import type { WorldParams } from './WorldParams.ts';
import type { WorkerRequest, WorkerResponse } from './worldProtocol.ts';

export interface BakeResult {
  pixels: Uint8Array;
  /** CPU time spent baking, ms. */
  ms: number;
}

export interface WorldBackend {
  readonly mode: 'worker' | 'main-thread';
  /** Generate the world. Resolves with fields usable on the main thread. */
  init(params: WorldParams, onProgress: (p: number) => void): Promise<WorldFields>;
  /** Bake one terrain chunk. Calls are queued and served one at a time. */
  bake(level: number, cx: number, cy: number): Promise<BakeResult>;
  destroy(): void;
}

const FRAME_BUDGET_MS = 5;

/** Runs generator-based jobs a few milliseconds per frame. */
class Slicer {
  private jobs: { it: Generator<unknown, unknown, void>; done: (v: unknown) => void; fail: (e: unknown) => void }[] = [];
  private scheduled = false;

  run<T>(it: Generator<unknown, T, void>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ it, done: resolve as (v: unknown) => void, fail: reject });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // One slice per frame while visible; timers keep hidden tabs progressing.
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) {
      requestAnimationFrame(() => this.tick());
    } else {
      setTimeout(() => this.tick(), 0);
    }
  }

  private tick(): void {
    this.scheduled = false;
    const job = this.jobs[0];
    if (!job) return;
    const start = performance.now();
    try {
      do {
        const r = job.it.next();
        if (r.done) {
          this.jobs.shift();
          job.done(r.value);
          break;
        }
      } while (performance.now() - start < FRAME_BUDGET_MS);
    } catch (err) {
      this.jobs.shift();
      job.fail(err);
    }
    if (this.jobs.length) this.schedule();
  }
}

export class MainThreadBackend implements WorldBackend {
  readonly mode = 'main-thread' as const;
  private world: WorldFields | null = null;
  private slicer = new Slicer();

  async init(params: WorldParams, onProgress: (p: number) => void): Promise<WorldFields> {
    const steps = generateWorldSteps(params);
    const reporting = (function* (): Generator<void, WorldFields, void> {
      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        onProgress(r.value);
        yield;
      }
    })();
    this.world = await this.slicer.run(reporting);
    return this.world;
  }

  async bake(level: number, cx: number, cy: number): Promise<BakeResult> {
    if (!this.world) throw new Error('bake before init');
    const t0 = performance.now();
    const pixels = await this.slicer.run(bakeChunkSteps(this.world, level, cx, cy));
    return { pixels, ms: performance.now() - t0 };
  }

  destroy(): void {
    this.world = null;
  }
}

export class WorkerBackend implements WorldBackend {
  readonly mode = 'worker' as const;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: BakeResult) => void; reject: (e: Error) => void }>();
  private initHandlers: { resolve: (w: WorldFields) => void; reject: (e: Error) => void; progress: (p: number) => void } | null =
    null;

  constructor() {
    this.worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      ev.preventDefault?.();
      this.failAll(new Error(ev.message || 'world worker failed'));
    };
    this.worker.onmessageerror = () => this.failAll(new Error('world worker message error'));
  }

  init(params: WorldParams, onProgress: (p: number) => void): Promise<WorldFields> {
    return new Promise<WorldFields>((resolve, reject) => {
      this.initHandlers = { resolve, reject, progress: onProgress };
      this.post({ type: 'init', params });
    });
  }

  bake(level: number, cx: number, cy: number): Promise<BakeResult> {
    return new Promise<BakeResult>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'bake', id, level, cx, cy });
    });
  }

  destroy(): void {
    this.worker.terminate();
    this.failAll(new Error('world backend destroyed'));
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }

  private onMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'progress':
        this.initHandlers?.progress(msg.value);
        break;
      case 'ready': {
        const h = this.initHandlers;
        this.initHandlers = null;
        h?.resolve(new WorldFields(msg.raw));
        break;
      }
      case 'baked': {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve({ pixels: msg.pixels, ms: msg.ms });
        break;
      }
      case 'error':
        this.failAll(new Error(msg.message));
        break;
    }
  }

  private failAll(err: Error): void {
    this.initHandlers?.reject(err);
    this.initHandlers = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

/**
 * Generate the world with the best available backend. If the worker cannot be
 * created or dies during generation, transparently retries on the main thread.
 */
export async function startWorld(
  params: WorldParams,
  onProgress: (p: number) => void,
  options: { forceMainThread?: boolean } = {},
): Promise<{ backend: WorldBackend; world: WorldFields }> {
  if (!options.forceMainThread && typeof Worker !== 'undefined') {
    let backend: WorkerBackend | null = null;
    try {
      backend = new WorkerBackend();
      const world = await backend.init(params, onProgress);
      return { backend, world };
    } catch (err) {
      backend?.destroy();
      console.warn('[world] worker unavailable, using main thread:', err);
    }
  }
  const backend = new MainThreadBackend();
  const world = await backend.init(params, onProgress);
  return { backend, world };
}
