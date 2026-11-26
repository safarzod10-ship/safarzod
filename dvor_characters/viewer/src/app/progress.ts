/**
 * Player progress: trophies -> rank (everyone starts at Бронза III with 0), experience -> level,
 * the game balance (монеты, кристаллы), match history. Kept in localStorage on this device (no server yet).
 *
 * Coins per match: win 40, draw 20, loss 15, +5 per knock-out. Crystals: +5 for every new level,
 * +10 for every new rank. Start: 100 coins, 0 crystals.
 *
 * Trophies per match: win +28 (+2 per knock-out, max +8), draw +6, loss -12 (never below the floor of
 * the current league: Бронза 0, Серебро 300, Золото 800...). The rank also sets how good the bots are
 * (game/match.ts: skill 0..1).
 */
export interface Rank { name: string; tier: string; min: number; color: string; dark: string }

const LEAGUES = [
  { tier: 'Бронза', min: 0, color: '#c98b55', dark: '#6e4426' },
  { tier: 'Серебро', min: 300, color: '#c4cad2', dark: '#5b6068' },
  { tier: 'Золото', min: 800, color: '#f1c24b', dark: '#8a6413' },
  { tier: 'Платина', min: 1500, color: '#7fd6cf', dark: '#2f6f6a' },
  { tier: 'Алмаз', min: 2400, color: '#8fb6ff', dark: '#2f4f99' },
];
const STEP: Record<string, number> = { Бронза: 100, Серебро: 165, Золото: 230, Платина: 300, Алмаз: 400 };

/** Бронза III, II, I, Серебро III ... Алмаз I, then «Царь двора». */
export const RANKS: Rank[] = [
  ...LEAGUES.flatMap((l) => ['III', 'II', 'I'].map((n, i) => ({ name: `${l.tier} ${n}`, tier: l.tier, min: l.min + i * STEP[l.tier], color: l.color, dark: l.dark }))),
  { name: 'Царь двора', tier: 'Царь двора', min: 3600, color: '#ff9b45', dark: '#7a3a0b' },
];

export interface MatchRecord { t: number; hero: string; result: 'win' | 'lose' | 'draw'; score: [number, number]; kills: number; deaths: number; dealt: number; trophies: number; xp: number }
export type Stat = 'hp' | 'dmg' | 'speed';
export type Upgrades = Record<Stat, number>;   // 0..MAX_UPGRADE per stat
export interface Profile {
  trophies: number; xp: number; coins: number; gems: number; games: number; wins: number; kills: number; best: number;
  history: MatchRecord[];
  storySeen: boolean;
  chosen: string | null;        // the first hero, picked once for good
  owned: string[];              // heroes the player can play (the chosen one + bought ones)
  upgrades: Record<string, Upgrades>;
}

const KEY = 'dvor.profile.v1';
const fresh = (): Profile => ({ trophies: 0, xp: 0, coins: 100, gems: 0, games: 0, wins: 0, kills: 0, best: 0, history: [],
  storySeen: false, chosen: null, owned: [], upgrades: {} });

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p.trophies === 'number') return { ...fresh(), ...p };
  } catch { /* private mode / broken data */ }
  return fresh();
}
function save(p: Profile): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }
function change(f: (p: Profile) => void): Profile { const p = loadProfile(); f(p); save(p); return p; }

// ------------------------------------------------------------------ heroes: first pick, purchases, upgrades
export const HERO_PRICE = 50000;
export const MAX_UPGRADE = 5;
/** Coins for the next level of one stat: 1 -> 200, 2 -> 500, 3 -> 1000, 4 -> 2000, 5 -> 4000. */
export const UPGRADE_COST = [200, 500, 1000, 2000, 4000];
/** Per level: +6 % health, +6 % damage (and healing), +2.5 % speed. */
export const UPGRADE_STEP: Upgrades = { hp: 0.06, dmg: 0.06, speed: 0.025 };

export const markStorySeen = (): Profile => change((p) => { p.storySeen = true; });
export function chooseFirst(hero: string): Profile {
  return change((p) => { if (!p.chosen) { p.chosen = hero; p.owned = [hero]; } });
}
export function buyHero(hero: string): Profile | null {
  const p = loadProfile();
  if (p.owned.includes(hero) || p.coins < HERO_PRICE) return null;
  return change((q) => { q.coins -= HERO_PRICE; q.owned.push(hero); });
}
export const upgradesOf = (p: Profile, hero: string): Upgrades => {
  const u = p.upgrades[hero];
  return { hp: u?.hp ?? 0, dmg: u?.dmg ?? 0, speed: u?.speed ?? 0 };
};
export function upgrade(hero: string, stat: Stat): Profile | null {
  const p = loadProfile(), u = upgradesOf(p, hero), lv = u[stat];
  if (!p.owned.includes(hero) || lv >= MAX_UPGRADE || p.coins < UPGRADE_COST[lv]) return null;
  return change((q) => { q.coins -= UPGRADE_COST[lv]; q.upgrades[hero] = { ...u, [stat]: lv + 1 }; });
}
/** Multipliers for the match (game/match.ts). */
export function boostOf(hero: string): Upgrades {
  const u = upgradesOf(loadProfile(), hero);
  return { hp: 1 + u.hp * UPGRADE_STEP.hp, dmg: 1 + u.dmg * UPGRADE_STEP.dmg, speed: 1 + u.speed * UPGRADE_STEP.speed };
}

export const rankOf = (trophies: number): Rank => [...RANKS].reverse().find((r) => trophies >= r.min) ?? RANKS[0];
export const nextRank = (trophies: number): Rank | null => RANKS.find((r) => r.min > trophies) ?? null;
const leagueFloor = (trophies: number): number => [...LEAGUES].reverse().find((l) => trophies >= l.min)?.min ?? 0;

/** Level n needs 150 * n * (n + 1) / 2 XP in total: 150, 450, 900, 1500 ... */
export const xpFor = (level: number): number => (150 * level * (level - 1)) / 2;
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  while (xp >= xpFor(level + 1)) level++;
  return { level, into: xp - xpFor(level), need: xpFor(level + 1) - xpFor(level) };
}

/** Bot skill for the player's rank: 0 at Бронза III, 1 at Алмаз and above. */
export const botSkill = (trophies: number): number => Math.max(0, Math.min(1, trophies / 2400));

export interface Reward { trophies: number; xp: number; coins: number; gems: number; before: Profile; after: Profile; rankUp: Rank | null; levelUp: number | null }

export function applyResult(hero: string, r: { winner: 0 | 1 | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number } }): Reward {
  const before = loadProfile();
  const res = r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw';
  let dt = res === 'win' ? 28 + Math.min(8, r.you.kills * 2) : res === 'draw' ? 6 : -12;
  if (dt < 0) dt = Math.max(dt, leagueFloor(before.trophies) - before.trophies);
  const xp = (res === 'win' ? 120 : res === 'draw' ? 70 : 50) + r.you.kills * 15 + Math.round(r.you.dealt / 400);
  const coins = (res === 'win' ? 40 : res === 'draw' ? 20 : 15) + r.you.kills * 5;
  const after: Profile = {
    ...before,
    coins: before.coins + coins,
    trophies: before.trophies + dt,
    xp: before.xp + xp,
    games: before.games + 1,
    wins: before.wins + (res === 'win' ? 1 : 0),
    kills: before.kills + r.you.kills,
    best: Math.max(before.best, before.trophies + dt),
    history: [{ t: Date.now(), hero, result: res as MatchRecord['result'], score: r.score, kills: r.you.kills, deaths: r.you.deaths, dealt: r.you.dealt, trophies: dt, xp }, ...before.history].slice(0, 20),
  };
  const r0 = rankOf(before.trophies), r1 = rankOf(after.trophies);
  const l0 = levelOf(before.xp).level, l1 = levelOf(after.xp).level;
  const gems = (l1 - l0) * 5 + (r1.min > r0.min ? 10 : 0);
  after.gems = before.gems + gems;
  save(after);
  return { trophies: dt, xp, coins, gems, before, after, rankUp: r1.min > r0.min ? r1 : null, levelUp: l1 > l0 ? l1 : null };
}
