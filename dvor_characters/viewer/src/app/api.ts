import { initData } from './tg';
import type { Profile } from './progress';
import { heroLevelOf, loadProfile, restoreProfile, setSaveHook } from './progress';

export const SERVER = 'https://dvor-server.dvor-game.workers.dev';

export interface TopPlayer { name: string; trophies: number; hero: string | null; level: number }

export async function fetchTop(): Promise<TopPlayer[]> {
  const r = await fetch(`${SERVER}/api/top`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).players as TopPlayer[];
}

export async function postResult(p: Profile, hero: string): Promise<number | null> {
  const data = initData();
  if (!data) return null;
  try {
    const r = await fetch(`${SERVER}/api/result`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: data, trophies: p.trophies, hero, level: heroLevelOf(hero), games: p.games, wins: p.wins }),
    });
    if (!r.ok) return null;
    const rank = (await r.json()).rank as number;
    try { localStorage.setItem('dvor.place', String(rank)); } catch {}
    return rank;
  } catch { return null; }
}
export const lastPlace = (): number | null => { try { const v = Number(localStorage.getItem('dvor.place')); return v > 0 ? v : null; } catch { return null; } };

const GKEY = 'dvor.g';
try {
  const g = new URLSearchParams(location.search).get('g');
  if (g) sessionStorage.setItem(GKEY, g);
} catch {}
const gameToken = (): string | null => { try { return sessionStorage.getItem(GKEY); } catch { return null; } };

export async function postGameScore(p: Profile, hero: string): Promise<void> {
  const g = gameToken();
  if (!g) return;
  try {
    await fetch(`${SERVER}/api/game-score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ g, trophies: p.trophies, hero, level: heroLevelOf(hero) }),
    });
  } catch {}
}

const auth = (): Record<string, string> | null => {
  const d = initData();
  if (d) return { initData: d };
  const g = gameToken();
  return g ? { g } : null;
};

export async function syncOnBoot(): Promise<void> {
  const a = auth();
  if (!a) return;
  try {
    const r = await fetch(`${SERVER}/api/profile/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
    if (!r.ok) return;
    const { profile } = await r.json() as { profile: Profile | null };
    const local = loadProfile();
    if (profile && (profile.updatedAt ?? 0) > (local.updatedAt ?? 0)) restoreProfile(profile);
    else if (local.updatedAt > 0 && (!profile || local.updatedAt > (profile.updatedAt ?? 0))) queueSave(local);
  } catch {}
}

let timer = 0, pending: Profile | null = null;
function queueSave(p: Profile, delay = 1500): void {
  pending = p;
  clearTimeout(timer);
  timer = window.setTimeout(flush, delay);
}
async function flush(): Promise<void> {
  const a = auth(), p = pending;
  if (!a || !p) return;
  pending = null;
  try {
    const r = await fetch(`${SERVER}/api/profile/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...a, profile: p }) });
    const res = await r.json().catch(() => ({})) as { ok?: boolean; retry?: number };
    if (!res.ok && res.retry && !pending) queueSave(p, res.retry * 1000 + 200);
  } catch { if (!pending) queueSave(p, 10000); }
}
setSaveHook((p) => { if (auth()) queueSave(p); });
