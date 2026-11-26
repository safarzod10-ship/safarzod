/**
 * The ДВОР server (Cloudflare Worker, dvor_characters/server/worker.js): players' leaderboard.
 * Writes only after a match (and the server keeps at most one per 20 s per player); the top list is
 * cached at the edge for a minute, so the free plan is plenty.
 */
import { initData } from './tg';
import type { Profile } from './progress';
import { heroLevelOf } from './progress';

export const SERVER = 'https://dvor-server.dvor-game.workers.dev';

export interface TopPlayer { name: string; trophies: number; hero: string | null; level: number }

export async function fetchTop(): Promise<TopPlayer[]> {
  const r = await fetch(`${SERVER}/api/top`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).players as TopPlayer[];
}

/** Sends the player's progress (only inside Telegram: the server checks Telegram's signature). */
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
    try { localStorage.setItem('dvor.place', String(rank)); } catch { /* ignore */ }
    return rank;
  } catch { return null; }
}
export const lastPlace = (): number | null => { try { const v = Number(localStorage.getItem('dvor.place')); return v > 0 ? v : null; } catch { return null; } };

// A game opened from a game message (inline «вызов» or /play in a group) carries ?g=<signed token>;
// its results go to that chat's high-score table.
const GKEY = 'dvor.g';
try {
  const g = new URLSearchParams(location.search).get('g');
  if (g) sessionStorage.setItem(GKEY, g);
} catch { /* ignore */ }
const gameToken = (): string | null => { try { return sessionStorage.getItem(GKEY); } catch { return null; } };

export async function postGameScore(p: Profile, hero: string): Promise<void> {
  const g = gameToken();
  if (!g) return;
  try {
    await fetch(`${SERVER}/api/game-score`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ g, trophies: p.trophies, hero, level: heroLevelOf(hero) }),
    });
  } catch { /* offline: next match */ }
}
