// Automatic campaign validation: structure, fairness and reachability of every level.
import type { Level, RunState } from '../types.js';
import { applyOutcome, decisionsForLevel, freshRun, hintFor, outcomeFor } from '../engine.js';

export interface LevelReport {
  n: number;
  decisions: number;
  optionsPerBeat: number[];
  reachableStates: number;
  perfectPath: string[];
  perfectRunAlarm: number;
  worstCaseMistakesToLose: number;
  errors: string[];
}

const key = (i: number, r: RunState) => `${i}|${r.hp}|${r.alarm}|${[...r.items].sort().join(',')}|${[...r.flags].sort().join(',')}|${r.carrying ? 1 : 0}`;

export function validateLevel(level: Level): LevelReport {
  const errors: string[] = [];
  const want = decisionsForLevel(level.n);
  if (level.beats.length !== want) errors.push(`expected ${want} decisions, got ${level.beats.length}`);

  // Phase order: infiltrate+ -> steal+ -> escape+
  const order = { infiltrate: 0, steal: 1, escape: 2 } as const;
  let last = 0;
  const seen = new Set<string>();
  for (const b of level.beats) {
    const o = order[b.phase];
    if (o < last) errors.push(`${b.id}: phase ${b.phase} out of order`);
    last = o;
    seen.add(b.phase);
  }
  for (const p of ['infiltrate', 'steal', 'escape']) if (!seen.has(p)) errors.push(`missing phase ${p}`);
  const cases = level.beats.filter((b) => b.challenge === 'case');
  if (cases.length !== 1) errors.push(`expected exactly one exhibit case, got ${cases.length}`);
  else if (cases[0]!.phase !== 'steal') errors.push('exhibit case must be in the steal phase');
  const lastSteal = [...level.beats].reverse().find((b) => b.phase === 'steal');
  if (lastSteal && lastSteal.challenge !== 'case') errors.push('last steal beat must be the exhibit case');

  for (const b of level.beats) {
    const n = b.options.length;
    if (n < 3 || n > 4) errors.push(`${b.id}: ${n} options`);
    if (level.n <= 5 && n !== 3) errors.push(`${b.id}: early levels must have 3 options`);
    const ids = new Set(b.options.map((o) => o.id));
    if (ids.size !== n) errors.push(`${b.id}: duplicate option ids`);
    for (const o of b.options) {
      if (o.label.length > 26) errors.push(`${b.id}/${o.id}: label too long (${o.label.length})`);
      const lastRule = o.rules[o.rules.length - 1];
      if (!lastRule || lastRule.when) errors.push(`${b.id}/${o.id}: needs an unconditional fallback rule`);
      for (const r of o.rules) {
        if (r.out.damage < 0 || r.out.damage > 2) errors.push(`${b.id}/${o.id}: damage out of range`);
        if (r.out.ok && r.out.damage > 0) errors.push(`${b.id}/${o.id}: ok outcome with damage`);
        if (!r.out.text) errors.push(`${b.id}/${o.id}: missing outcome text`);
      }
    }
    const lastHint = b.hints[b.hints.length - 1];
    if (!lastHint || lastHint.when || !lastHint.text) errors.push(`${b.id}: needs a default hint`);
  }

  // Exhaustive exploration of every reachable state.
  const memo = new Map<string, number>(); // state -> min damage to finish
  let reachable = 0;
  let minMistakesToLose = Infinity;
  const visit = (i: number, run: RunState, mistakes: number): number => {
    if (run.hp <= 0) {
      minMistakesToLose = Math.min(minMistakesToLose, mistakes);
      return Infinity;
    }
    if (i >= level.beats.length) {
      if (!run.carrying) errors.push('reached the exit without the exhibit');
      return 0;
    }
    const k = key(i, run);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;
    reachable++;
    const b = level.beats[i]!;
    if (!hintFor(b, run)) errors.push(`${b.id}: no hint for state ${k}`);
    let best = Infinity;
    let anySafe = false;
    let anyMistake = false;
    for (const o of b.options) {
      const out = outcomeFor(o, run);
      if (out.damage === 0) anySafe = true;
      if (!out.ok) anyMistake = true;
      const next = applyOutcome(run, out, false);
      const rest = visit(i + 1, next.run, mistakes + (out.damage > 0 ? 1 : 0));
      best = Math.min(best, out.damage + rest);
    }
    if (!anySafe) errors.push(`${b.id}: no zero-damage option in state ${k}`);
    if (!anyMistake && !run.flags.includes('powerCut') && b.challenge !== 'fusebox' && b.challenge !== 'keycard' && b.challenge !== 'giftshop')
      errors.push(`${b.id}: no wrong choice at all in state ${k} (not a real decision)`);
    memo.set(k, best);
    return best;
  };
  const start = freshRun();
  const best = visit(0, start, 0);
  if (best !== 0) errors.push(`no perfect (zero-damage) path; best = ${best}`);

  // Reconstruct a perfect path: prefer zero damage, then lowest alarm.
  const path: string[] = [];
  let run = start;
  for (let i = 0; i < level.beats.length && run.hp > 0; i++) {
    const b = level.beats[i]!;
    let pick: string | null = null;
    let pickRun: RunState | null = null;
    let pickScore = Infinity;
    for (const o of b.options) {
      const out = outcomeFor(o, run);
      const next = applyOutcome(run, out, false).run;
      const rest = memo.get(key(i + 1, next)) ?? (i + 1 >= level.beats.length ? 0 : Infinity);
      const score = (out.damage + rest) * 10 + (out.alarm ?? 0);
      if (score < pickScore) {
        pickScore = score;
        pick = o.id;
        pickRun = next;
      }
    }
    path.push(pick!);
    run = pickRun!;
  }

  return {
    n: level.n,
    decisions: level.beats.length,
    optionsPerBeat: level.beats.map((b) => b.options.length),
    reachableStates: reachable,
    perfectPath: path,
    perfectRunAlarm: run.alarm,
    worstCaseMistakesToLose: minMistakesToLose,
    errors: [...new Set(errors)],
  };
}

export function signature(level: Level): string {
  return level.beats.map((b) => `${b.room.style}:${b.challenge}:${JSON.stringify(b.cue)}:${b.options.length}`).join('|');
}

export function validateCampaign(levels: Level[]): { reports: LevelReport[]; errors: string[] } {
  const errors: string[] = [];
  if (levels.length !== 30) errors.push(`expected 30 levels, got ${levels.length}`);
  levels.forEach((l, i) => {
    if (l.n !== i + 1) errors.push(`level index mismatch at ${i}`);
  });
  const uniq = (what: string, vals: string[]) => {
    const s = new Set(vals);
    if (s.size !== vals.length) errors.push(`duplicate ${what}`);
  };
  uniq('titles', levels.map((l) => l.title));
  uniq('exhibits', levels.map((l) => l.exhibit.name));
  uniq('wings', levels.map((l) => l.wing));
  uniq('level layouts', levels.map(signature));
  const challengeSets = levels.map((l) => l.beats.map((b) => b.challenge).join(','));
  uniq('challenge sequences', challengeSets);
  if (!levels.slice(8).some((l) => l.beats.some((b) => b.options.length === 4))) errors.push('4-option decisions never appear');
  const reports = levels.map(validateLevel);
  for (const r of reports) for (const e of r.errors) errors.push(`L${r.n}: ${e}`);
  return { reports, errors };
}
