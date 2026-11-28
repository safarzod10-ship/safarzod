/**
 * Small per-isolate TTL cache. The Cache API does nothing on *.workers.dev,
 * so shared read-mostly answers (world summary, public cities) are kept here.
 */
const store = new Map<string, { until: number; value: unknown }>();
const MAX = 512;

export async function cached<T>(key: string, ttlMs: number, now: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const value = await load();
  store.set(key, { until: now + ttlMs, value });
  if (store.size > MAX) store.delete(store.keys().next().value as string);
  return value;
}

export function invalidate(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
