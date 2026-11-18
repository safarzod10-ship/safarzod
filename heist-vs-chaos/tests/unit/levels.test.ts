import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/shared/levels/campaign.js';
import { validateCampaign } from '../../src/shared/levels/validate.js';
import { applyOutcome, chooseWinner, decisionsForLevel, freshRun, outcomeFor } from '../../src/shared/engine.js';

describe('campaign data', () => {
  const { reports, errors } = validateCampaign(LEVELS);
  it('has 30 valid levels', () => {
    expect(errors).toEqual([]);
    expect(LEVELS).toHaveLength(30);
  });
  it('decision counts follow the bands', () => {
    for (const l of LEVELS) expect(l.beats.length).toBe(decisionsForLevel(l.n));
  });
  it('every level has a zero-damage perfect path (whole campaign beatable without gifts)', () => {
    for (const r of reports) {
      let run = freshRun();
      const lvl = LEVELS[r.n - 1]!;
      r.perfectPath.forEach((id, i) => {
        const o = lvl.beats[i]!.options.find((x) => x.id === id)!;
        const out = outcomeFor(o, run);
        expect(out.damage).toBe(0);
        run = applyOutcome(run, out, false).run;
      });
      expect(run.carrying).toBe(true);
      expect(run.hp).toBe(3);
    }
  });
  it('late levels are less forgiving', () => {
    expect(reports[0]!.worstCaseMistakesToLose).toBe(3);
    expect(reports[29]!.worstCaseMistakesToLose).toBe(2);
  });
});

describe('winner selection', () => {
  it('picks majority, random tie among leaders, random when empty', () => {
    expect(chooseWinner({ a: 2, b: 1 }, ['a', 'b'], ['a', 'b'], () => 0.9)).toEqual({ id: 'a', mode: 'chat' });
    expect(chooseWinner({ a: 2, b: 2, c: 0 }, ['a', 'b', 'c'], ['a', 'b', 'c'], () => 0.99)).toEqual({ id: 'b', mode: 'tie' });
    expect(chooseWinner({}, ['a', 'b', 'c'], ['c'], () => 0.1)).toEqual({ id: 'c', mode: 'auto' });
  });
});
