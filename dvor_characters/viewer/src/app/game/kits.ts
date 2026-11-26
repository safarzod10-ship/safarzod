/**
 * Hero kits for the match prototype. All numbers in one place (metres, seconds, HP) so balance can be
 * tuned without touching code. Starting values from the design discussion, not yet play-tested.
 */
import type { HeroId } from '../data';

export interface Kit {
  hp: number;
  speed: number;              // m/s (foot-matched Run speed)
  armor: number;              // share of incoming damage blocked
  attack:
    | { kind: 'gun'; range: number; dmg: number; cd: number; speed: number; heatMax: number; cool: number }
    | { kind: 'melee'; range: number; arcDeg: number; dmg: number; cd: number; knockEvery: number; knock: number }
    | { kind: 'records'; range: number; dmg: number; cd: number; speed: number; count: number; spreadDeg: number; bounces: number };
  a1: { name: string; cd: number };
  a2: { name: string; cd: number };
  // ability parameters
  turret?: { dur: number; range: number; dmg: number; rate: number; hp: number; place: number };
  smoke?: { dur: number; r: number; slow: number; throw: number };
  door?: { dur: number; width: number };
  ram?: { dist: number; stun: number; dmg: number };
  spurt?: { dashes: number; dist: number; gap: number; dmg: number };
  wave?: { r: number; push: number; dmg: number };
  outOfCombatBoost?: number;  // speed bonus after 2 s without fighting
}

export const DASH = { dist: 3, time: 0.2, cd: 6 };
export const RESPAWN_S = 3;
export const REGEN = { delay: 3, perSec: 0.1 };
export const MATCH = { seconds: 120, target: 100, zone: { x: -0.14, z: -0.5, r: 2.5 }, pointsPerSec: 2 };

export const KITS: Record<HeroId, Kit> = {
  technik: {
    hp: 4800, speed: 2.35, armor: 0,
    attack: { kind: 'gun', range: 7, dmg: 500, cd: 0.5, speed: 18, heatMax: 6, cool: 1.5 },
    a1: { name: 'Турель', cd: 14 }, a2: { name: 'Дымовая шашка', cd: 12 },
    turret: { dur: 8, range: 6, dmg: 250, rate: 2, hp: 1500, place: 2.2 },
    smoke: { dur: 5, r: 2.5, slow: 0.3, throw: 4.5 },
  },
  tank: {
    hp: 5600, speed: 1.78, armor: 0.15,
    attack: { kind: 'melee', range: 2, arcDeg: 75, dmg: 1100, cd: 0.85, knockEvery: 3, knock: 1.5 },
    a1: { name: 'Гаражная дверь', cd: 12 }, a2: { name: 'Таран', cd: 10 },
    door: { dur: 4, width: 1.5 },
    ram: { dist: 4, stun: 0.5, dmg: 400 },
  },
  sprinter: {
    hp: 4400, speed: 2.72, armor: 0,
    attack: { kind: 'records', range: 5.5, dmg: 380, cd: 0.65, speed: 12, count: 2, spreadDeg: 11, bounces: 1 },
    a1: { name: 'Спурт', cd: 10 }, a2: { name: 'На всю громкость', cd: 14 },
    spurt: { dashes: 3, dist: 3, gap: 0.45, dmg: 500 },
    wave: { r: 3, push: 2, dmg: 200 },
    outOfCombatBoost: 0.25,
  },
};
