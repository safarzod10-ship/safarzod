/**
 * Hero kits for the match. All numbers in one place (metres, seconds, HP) so balance can be tuned
 * without touching code. Tuned with bot-only simulations (scripts/balance.mjs); the results are in
 * docs/BALANCE.md. Bots are not people: confirm with play tests.
 */
import type { HeroId } from '../data';

export type AbilityKey = 'turret' | 'smoke' | 'door' | 'ram' | 'spurt' | 'wave' | 'mine' | 'pierce' | 'heal' | 'hospital';

export interface Kit {
  hp: number;
  speed: number;              // m/s on the ground
  armor: number;              // share of incoming damage blocked
  attack:
    | { kind: 'gun'; range: number; dmg: number; cd: number; speed: number; heatMax: number; cool: number }
    | { kind: 'melee'; range: number; arcDeg: number; dmg: number; cd: number; knockEvery: number; knock: number }
    | { kind: 'records'; range: number; dmg: number; cd: number; speed: number; count: number; spreadDeg: number; bounces: number }
    | { kind: 'rifle'; range: number; dmg: number; cd: number; speed: number }
    | { kind: 'darts'; range: number; dmg: number; cd: number; speed: number };
  a1: { name: string; cd: number; key: AbilityKey };    // the hero's one ability (one button)
  a2?: { name: string; cd: number; key: AbilityKey };   // unused now: every hero has one ability
  // ability parameters
  turret?: { dur: number; range: number; dmg: number; rate: number; hp: number; place: number };
  smoke?: { dur: number; r: number; slow: number; throw: number };
  door?: { dur: number; width: number };
  ram?: { dist: number; stun: number; dmg: number };
  spurt?: { dashes: number; dist: number; gap: number; dmg: number };
  wave?: { r: number; push: number; dmg: number };
  mine?: { dur: number; r: number; dmg: number; stun: number; arm: number; place: number };
  pierce?: { range: number; dmg: number; delay: number; speed: number };
  heal?: { r: number; amount: number };
  hospital?: { r: number; dur: number; hps: number; throw: number };
  outOfCombatBoost?: number;  // speed bonus after 2 s without fighting
}

export const DASH = { dist: 3, time: 0.2, cd: 6 };
export const TEAM_SIZE = 2;   // 2 на 2
export const RESPAWN_S = 3;
export const REGEN = { delay: 3, perSec: 0.1 };
export const MATCH = { seconds: 120, target: 100, zone: { x: -0.14, z: -0.5, r: 2.5 }, pointsPerSec: 2 };

/** Each hero: an automatic attack and ONE ability (smoke, door, wave, mine and field hospital were dropped). */
export const KITS: Record<HeroId, Kit> = {
  technik: {
    hp: 5100, speed: 2.4, armor: 0,
    attack: { kind: 'gun', range: 6.5, dmg: 480, cd: 0.5, speed: 18, heatMax: 6, cool: 1.5 },
    a1: { name: 'Турель', cd: 14, key: 'turret' },
    turret: { dur: 8, range: 5.5, dmg: 230, rate: 2, hp: 1200, place: 2.2 },
  },
  tank: {
    hp: 5400, speed: 1.9, armor: 0.15,
    attack: { kind: 'melee', range: 2, arcDeg: 75, dmg: 1000, cd: 0.85, knockEvery: 3, knock: 1.5 },
    a1: { name: 'Таран', cd: 8, key: 'ram' },
    ram: { dist: 4.5, stun: 0.5, dmg: 400 },
  },
  sprinter: {
    hp: 4300, speed: 2.75, armor: 0,
    attack: { kind: 'records', range: 5.5, dmg: 370, cd: 0.65, speed: 12, count: 2, spreadDeg: 11, bounces: 1 },
    a1: { name: 'Спурт', cd: 10, key: 'spurt' },
    spurt: { dashes: 3, dist: 3, gap: 0.45, dmg: 450 },
    outOfCombatBoost: 0.25,
  },
  sniper: {
    hp: 4400, speed: 2.3, armor: 0,
    attack: { kind: 'rifle', range: 8.5, dmg: 1200, cd: 1.3, speed: 30 },
    a1: { name: 'Бронебойный', cd: 10, key: 'pierce' },
    pierce: { range: 12, dmg: 1500, delay: 0.35, speed: 40 },
  },
  medic: {
    hp: 4300, speed: 2.6, armor: 0,
    attack: { kind: 'darts', range: 5.5, dmg: 400, cd: 0.55, speed: 16 },
    a1: { name: 'Аптечка', cd: 11, key: 'heal' },
    heal: { r: 3.5, amount: 1700 },
  },
};
