/**
 * Client game state: the server's city, the locally predicted city
 * (server state + queued actions replayed with the shared rules), the region
 * mask and the server clock. City actions are batched: applied locally at
 * once, sent together every ~1.5 s with one op id, retried with the same op
 * on network errors (the server ignores a repeated op).
 */
import { ERRORS, advance, applyAction, decodeMask, type RegionMask } from '../game/rules.ts';
import type { Action, ActionResult, CityResponse, CityState } from '../game/types.ts';
import { ApiError, SERVER_ERRORS, type Api } from './api.ts';
import { uuid } from './dom.ts';

type Listener = () => void;

export function errorText(code: string, fallback?: string): string {
  return ERRORS[code] ?? SERVER_ERRORS[code] ?? fallback ?? 'Что-то пошло не так';
}

export class Store {
  readonly api: Api;
  user: { id: number; name: string } = { id: 0, name: '' };
  /** Predicted city (what the UI shows). */
  city: CityState | null = null;
  mask: RegionMask | null = null;
  /** serverTime - Date.now() */
  private offset = 0;
  private server: CityState | null = null;
  private queue: Action[] = [];
  private inflight: { op: string; actions: Action[] } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 0;
  private readonly listeners = new Set<Listener>();
  private readonly errorListeners = new Set<(msg: string) => void>();
  /** Bumped whenever the city's layout (buildings / land) may have changed. */
  layoutVersion = 0;
  private lastLayoutKey = '';

  constructor(api: Api) {
    this.api = api;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onError(l: (msg: string) => void): () => void {
    this.errorListeners.add(l);
    return () => this.errorListeners.delete(l);
  }
  private emit(): void {
    if (this.city) {
      const key = `${this.city.owned.length}:${this.city.ownedCount}:${this.city.buildings.map((b) => `${b.id}.${b.lvl}.${b.until ? 1 : 0}`).join(',')}:${this.city.th}`;
      if (key !== this.lastLayoutKey) {
        this.lastLayoutKey = key;
        this.layoutVersion++;
      }
    }
    for (const l of this.listeners) l();
  }
  error(msg: string): void {
    for (const l of this.errorListeners) l(msg);
  }

  setClock(serverTime: number): void {
    this.offset = serverTime - Date.now();
  }

  async loadMask(regionId: number): Promise<void> {
    if (this.mask?.id === regionId) return;
    this.mask = decodeMask(await this.api.region(regionId));
  }

  /** Accept a server city and replay what has not been confirmed yet. */
  setServer(city: CityState, serverTime: number): void {
    this.setClock(serverTime);
    this.server = city;
    this.rebuild();
  }

  private rebuild(): void {
    if (!this.server) return;
    const c = structuredClone(this.server);
    const now = this.now();
    if (this.mask) {
      for (const a of [...(this.inflight?.actions ?? []), ...this.queue]) applyAction(c, a, this.mask, now);
      advance(c, now, this.mask);
    }
    this.city = c;
    this.emit();
  }

  /** Move the predicted economy forward (call every second or so). */
  tick(): void {
    if (!this.city || !this.mask) return;
    advance(this.city, this.now(), this.mask);
    this.emit();
  }

  /**
   * Do something to the city. Applied locally at once; the result says if the
   * rules allow it. `urgent` sends without waiting for more actions.
   */
  act(a: Action, urgent = false): ActionResult {
    if (!this.city || !this.mask) return { ok: false, error: 'no_city' };
    const r = applyAction(this.city, a, this.mask, this.now());
    if (!r.ok) {
      this.emit();
      return r;
    }
    this.queue.push(a);
    this.emit();
    this.schedule(urgent ? 0 : 1500);
    return r;
  }

  private schedule(ms: number): void {
    if (this.inflight) return;
    globalThis.clearTimeout(this.timer);
    this.timer = globalThis.setTimeout(() => void this.flush(), ms);
  }

  /** Send everything queued now; resolves when the server has confirmed it. */
  async flush(): Promise<void> {
    globalThis.clearTimeout(this.timer);
    if (this.inflight) {
      await this.waitIdle();
      if (!this.queue.length) return;
    }
    if (!this.queue.length) return;
    this.inflight = { op: uuid(), actions: this.queue };
    this.queue = [];
    await this.send();
  }

  private idleWaiters: (() => void)[] = [];
  private waitIdle(): Promise<void> {
    if (!this.inflight) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async send(): Promise<void> {
    const batch = this.inflight!;
    try {
      const res: CityResponse = await this.api.actions(batch.op, batch.actions);
      this.inflight = null;
      this.retryMs = 0;
      const failed = (res.results ?? []).filter((r): r is { ok: false; error: string } => !r.ok);
      if (failed.length) this.error(errorText(failed[0].error));
      this.setServer(res.city, res.serverTime);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // the server refused the whole batch: drop it and show its state
        this.inflight = null;
        this.error(errorText(err.code, err.message));
        await this.refresh().catch(() => undefined);
      } else {
        // network: same op again later
        this.retryMs = Math.min(15000, this.retryMs ? this.retryMs * 2 : 1500);
        globalThis.setTimeout(() => void this.send(), this.retryMs);
        return;
      }
    }
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
    if (this.queue.length) this.schedule(300);
  }

  async refresh(): Promise<void> {
    const me = await this.api.me();
    this.user = me.user;
    if (me.city) {
      await this.loadMask(me.city.regionId);
      this.setServer(me.city, me.serverTime);
    }
  }

  /** For market / shop calls that return a whole city. */
  async run(call: () => Promise<CityResponse>): Promise<boolean> {
    await this.flush();
    try {
      const res = await call();
      this.setServer(res.city, res.serverTime);
      return true;
    } catch (err) {
      this.error(err instanceof ApiError ? errorText(err.code, err.message) : 'Нет связи с сервером');
      return false;
    }
  }

  get pending(): boolean {
    return !!this.inflight || this.queue.length > 0;
  }
}
