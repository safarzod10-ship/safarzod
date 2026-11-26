export interface Rank { name: string; tier: string; min: number; color: string; dark: string }

const LEAGUES = [
  { tier: 'Бронза', min: 0, color: '#c98b55', dark: '#6e4426' },
  { tier: 'Серебро', min: 300, color: '#c4cad2', dark: '#5b6068' },
  { tier: 'Золото', min: 800, color: '#f1c24b', dark: '#8a6413' },
  { tier: 'Платина', min: 1500, color: '#7fd6cf', dark: '#2f6f6a' },
  { tier: 'Алмаз', min: 2400, color: '#8fb6ff', dark: '#2f4f99' },
];
const STEP: Record<string, number> = { Бронза: 100, Серебро: 165, Золото: 230, Платина: 300, Алмаз: 400 };

export const RANKS: Rank[] = [
  ...LEAGUES.flatMap((l) => ['III', 'II', 'I'].map((n, i) => ({ name: `${l.tier} ${n}`, tier: l.tier, min: l.min + i * STEP[l.tier], color: l.color, dark: l.dark }))),
  { name: 'Царь двора', tier: 'Царь двора', min: 3600, color: '#ff9b45', dark: '#7a3a0b' },
];

export interface MatchRecord { t: number; hero: string; result: 'win' | 'lose' | 'draw'; score: [number, number]; kills: number; deaths: number; dealt: number; trophies: number }
export type Stat = 'hp' | 'dmg' | 'speed' | 'ability';
export type Upgrades = Record<Stat, number>;
export interface Profile {
  trophies: number; coins: number; gems: number; games: number; wins: number; kills: number; best: number;
  history: MatchRecord[];
  storySeen: boolean;
  chosen: string | null;
  owned: string[];
  upgrades: Record<string, Upgrades>;
  perks?: Perks;
  updatedAt: number;
}
export interface Perks { immortal?: boolean; noCooldown?: boolean; damage?: number }

const KEY = 'dvor.profile.v1';
const fresh = (): Profile => ({ trophies: 0, coins: 100, gems: 0, games: 0, wins: 0, kills: 0, best: 0, history: [],
  storySeen: false, chosen: null, owned: [], upgrades: {}, updatedAt: 0 });

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p.trophies === 'number') return { ...fresh(), ...p };
  } catch {}
  return fresh();
}

let onSave: ((p: Profile) => void) | null = null;
export const setSaveHook = (f: (p: Profile) => void): void => { onSave = f; };
function save(p: Profile): void {
  p.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  onSave?.(p);
}

export function restoreProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...fresh(), ...p })); } catch {}
}
function change(f: (p: Profile) => void): Profile { const p = loadProfile(); f(p); save(p); return p; }

export const HERO_PRICE = 50000;
export const STATS: Stat[] = ['hp', 'dmg', 'speed', 'ability'];
export const MAX_UPGRADE = 30;

export const upgradeCost = (level: number): number => 10 * level + 10;

export const UPGRADE_STEP: Upgrades = { hp: 0.02, dmg: 0.02, speed: 0.006, ability: 0.01 };

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
  const u = p.upgrades[hero] as Partial<Upgrades> | undefined;

  const old = u && u.ability === undefined ? 1 : 0;
  const lv = (v: number | undefined) => Math.max(1, Math.min(MAX_UPGRADE, (v ?? 0) + old || 1));
  return { hp: lv(u?.hp), dmg: lv(u?.dmg), speed: lv(u?.speed), ability: lv(u?.ability) };
};

export const heroLevel = (u: Upgrades): number => Math.min(MAX_UPGRADE, Math.floor(STATS.reduce((a, k) => a + u[k], 0) / STATS.length + 0.5));
export const heroLevelOf = (hero: string): number => heroLevel(upgradesOf(loadProfile(), hero));
export function upgrade(hero: string, stat: Stat): Profile | null {
  const p = loadProfile(), u = upgradesOf(p, hero), lv = u[stat];
  if (!p.owned.includes(hero) || lv >= MAX_UPGRADE || p.coins < upgradeCost(lv)) return null;
  return change((q) => { q.coins -= upgradeCost(lv); q.upgrades[hero] = { ...u, [stat]: lv + 1 }; });
}

export function boostOf(hero: string): { hp: number; dmg: number; speed: number; cd: number; immortal?: boolean; noCd?: boolean; dmgFlat?: number } {
  const p = loadProfile(), u = upgradesOf(p, hero), k = p.perks;
  return { hp: 1 + (u.hp - 1) * UPGRADE_STEP.hp, dmg: 1 + (u.dmg - 1) * UPGRADE_STEP.dmg,
    speed: 1 + (u.speed - 1) * UPGRADE_STEP.speed, cd: 1 - (u.ability - 1) * UPGRADE_STEP.ability,
    ...(k ? { immortal: !!k.immortal, noCd: !!k.noCooldown, dmgFlat: k.damage || undefined } : {}) };
}

export const rankOf = (trophies: number): Rank => [...RANKS].reverse().find((r) => trophies >= r.min) ?? RANKS[0];
export const nextRank = (trophies: number): Rank | null => RANKS.find((r) => r.min > trophies) ?? null;
const leagueFloor = (trophies: number): number => [...LEAGUES].reverse().find((l) => trophies >= l.min)?.min ?? 0;

export const botSkill = (trophies: number): number => Math.max(0, Math.min(1, trophies / 2400));

export interface Reward { trophies: number; coins: number; gems: number; before: Profile; after: Profile; rankUp: Rank | null }

export function applyResult(hero: string, r: { winner: 0 | 1 | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number } }): Reward {
  const before = loadProfile();
  const res = r.winner === 0 ? 'win' : r.winner === 1 ? 'lose' : 'draw';
  let dt = res === 'win' ? 28 + Math.min(8, r.you.kills * 2) : res === 'draw' ? 6 : -12;
  if (dt < 0) dt = Math.max(dt, leagueFloor(before.trophies) - before.trophies);
  const coins = (res === 'win' ? 40 : res === 'draw' ? 20 : 15) + r.you.kills * 5;
  const after: Profile = {
    ...before,
    coins: before.coins + coins,
    trophies: before.trophies + dt,
    games: before.games + 1,
    wins: before.wins + (res === 'win' ? 1 : 0),
    kills: before.kills + r.you.kills,
    best: Math.max(before.best, before.trophies + dt),
    history: [{ t: Date.now(), hero, result: res as MatchRecord['result'], score: r.score, kills: r.you.kills, deaths: r.you.deaths, dealt: r.you.dealt, trophies: dt }, ...before.history].slice(0, 20),
  };
  const r0 = rankOf(before.trophies), r1 = rankOf(after.trophies);
  const gems = r1.min > r0.min ? 10 : 0;
  after.gems = before.gems + gems;
  save(after);
  return { trophies: dt, coins, gems, before, after, rankUp: r1.min > r0.min ? r1 : null };
}
