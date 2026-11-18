// Pure, deterministic game rules. No I/O, no clocks. Randomness is injected.
import type { Beat, BeatOption, Cond, Outcome, RunState, ScanInfo } from './types.js';

export const MAX_HP = 3;

export function freshRun(): RunState {
  return { hp: MAX_HP, maxHp: MAX_HP, items: [], flags: [], alarm: 0, carrying: false };
}

export function evalCond(c: Cond | undefined, run: RunState): boolean {
  if (!c) return true;
  if (c.has && !run.items.includes(c.has)) return false;
  if (c.lacks && run.items.includes(c.lacks)) return false;
  if (c.flag && !run.flags.includes(c.flag)) return false;
  if (c.noFlag && run.flags.includes(c.noFlag)) return false;
  if (c.alarmAtLeast !== undefined && run.alarm < c.alarmAtLeast) return false;
  if (c.alarmBelow !== undefined && run.alarm >= c.alarmBelow) return false;
  return true;
}

export function outcomeFor(opt: BeatOption, run: RunState): Outcome {
  for (const r of opt.rules) {
    if (evalCond(r.when, run)) return r.out;
  }
  throw new Error(`option ${opt.id} has no matching rule`);
}

export function hintFor(beat: Beat, run: RunState): string {
  for (const h of beat.hints) {
    if (evalCond(h.when, run)) return h.text;
  }
  return '';
}

export interface Applied {
  run: RunState;
  damage: number;
  shieldUsed: boolean;
}

/** Apply an outcome. A shield absorbs all damage of one harmful outcome. Extra damage (CHAOS patrol) only applies to mistakes. */
export function applyOutcome(run: RunState, out: Outcome, shield: boolean, extraDamage = 0): Applied {
  let damage = out.damage > 0 ? out.damage + extraDamage : 0;
  let shieldUsed = false;
  if (damage > 0 && shield) {
    damage = 0;
    shieldUsed = true;
  }
  const items = [...run.items];
  for (const g of out.gain ?? []) if (!items.includes(g)) items.push(g);
  const flags = [...run.flags];
  for (const f of out.set ?? []) if (!flags.includes(f)) flags.push(f);
  return {
    run: {
      ...run,
      hp: Math.max(0, run.hp - damage),
      items,
      flags,
      alarm: Math.min(3, run.alarm + (out.alarm ?? 0)),
      carrying: run.carrying || !!out.carry,
    },
    damage,
    shieldUsed,
  };
}

export function scanInfo(beat: Beat, run: RunState): ScanInfo {
  const info: ScanInfo = {};
  for (const o of beat.options) {
    const out = outcomeFor(o, run);
    info[o.id] = {
      damage: out.damage,
      ok: out.ok,
      note: out.damage > 0 ? `-${out.damage} HP` : out.ok ? 'SAFE' : `ALERT +${out.alarm ?? 0}`,
    };
  }
  return info;
}

/** Choose the winning option. counts: option id -> votes. `available` is the candidate set when nobody voted. */
export function chooseWinner(
  counts: Record<string, number>,
  allIds: string[],
  available: string[],
  rand: () => number,
): { id: string; mode: 'chat' | 'auto' | 'tie' } {
  let best = 0;
  for (const id of allIds) best = Math.max(best, counts[id] ?? 0);
  if (best === 0) {
    const pool = available.length > 0 ? available : allIds;
    return { id: pool[Math.floor(rand() * pool.length) % pool.length]!, mode: 'auto' };
  }
  const leaders = allIds.filter((id) => (counts[id] ?? 0) === best);
  if (leaders.length === 1) return { id: leaders[0]!, mode: 'chat' };
  return { id: leaders[Math.floor(rand() * leaders.length) % leaders.length]!, mode: 'tie' };
}

/** Deterministic PRNG (mulberry32) for seeded decoration / tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function decisionsForLevel(n: number): number {
  if (n <= 5) return 5;
  if (n <= 10) return 6;
  if (n <= 15) return 7;
  if (n <= 20) return 8;
  if (n <= 25) return 9;
  return 10;
}
