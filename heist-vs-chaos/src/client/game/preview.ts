// Builds synthetic states for the QA preview mode (?preview=L,B[,option]). Never used on stream.
import type { PublicState, RunState } from '../../shared/types.js';
import { applyOutcome, freshRun, outcomeFor } from '../../shared/engine.js';
import { getLevel } from '../../shared/levels/campaign.js';

export function previewStates(level: number, beatIndex: number, optionId?: string): { vote: PublicState; resolve: PublicState | null } {
  const lvl = getLevel(level);
  const bi = Math.min(beatIndex, lvl.beats.length - 1);
  let run: RunState = freshRun();
  for (let i = 0; i < bi; i++) {
    const b = lvl.beats[i]!;
    const best = [...b.options].sort((a, c) => score(a) - score(c))[0]!;
    run = applyOutcome(run, outcomeFor(best, run), false).run;
    function score(o: (typeof b.options)[number]) {
      const out = outcomeFor(o, run);
      return out.damage * 10 + (out.alarm ?? 0) - (out.gain?.length ?? 0) - (out.set?.length ?? 0);
    }
  }
  const now = Date.now();
  const beat = lvl.beats[bi]!;
  const base: PublicState = {
    rev: 1,
    serverNow: now,
    cycle: 1,
    level,
    levelTitle: lvl.title,
    attempt: 1,
    heists: level - 1,
    bestLevel: level - 1,
    completedThisCycle: level - 1,
    phase: 'vote',
    phaseStartedAt: now,
    phaseEndsAt: now + 30000,
    beatIndex: bi,
    run,
    shield: false,
    reviveUsed: false,
    vote: {
      id: `preview-${level}-${bi}`,
      beatIndex: bi,
      openedAt: now,
      endsAt: now + 30000,
      order: beat.options.map((o) => o.id),
      revoted: false,
      scan: null,
      chaos: null,
      tally: { counts: Object.fromEntries(beat.options.map((o, i) => [o.id, (i * 3 + level) % 5])), voters: 7 },
      recent: [{ name: 'viewer_one', n: 2 }, { name: 'paper_fan', n: 1 }],
    },
    resolution: null,
    autoMode: false,
    autoReason: '',
    chatOnline: true,
    memory: {},
    queue: [],
    notices: [],
    audio: { master: 0, music: 0, sfx: 0, voice: 0 },
    paused: false,
  };
  if (!optionId) return { vote: base, resolve: null };
  const opt = beat.options.find((o) => o.id === optionId) ?? beat.options[0]!;
  const out = outcomeFor(opt, run);
  const applied = applyOutcome(run, out, false);
  const resolve: PublicState = {
    ...base,
    phase: 'resolve',
    phaseEndsAt: now + 7500,
    run: applied.run,
    vote: null,
    resolution: {
      voteId: base.vote!.id,
      beatIndex: bi,
      optionId: opt.id,
      number: beat.options.indexOf(opt) + 1,
      mode: 'chat',
      tally: base.vote!.tally,
      outcome: out,
      shieldUsed: false,
      extraDamage: 0,
      startedAt: now,
    },
  };
  return { vote: base, resolve };
}
