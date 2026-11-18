import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Db } from '../../src/server/db.js';
import { DEFAULT_TIMINGS, GameRuntime, type Clock } from '../../src/server/runtime.js';
import { getLevel } from '../../src/shared/levels/campaign.js';
import { outcomeFor } from '../../src/shared/engine.js';

class FakeClock implements Clock {
  t = 1_800_000_000_000;
  m = 0;
  now() {
    return this.t;
  }
  mono() {
    return this.m;
  }
  advance(ms: number) {
    this.t += ms;
    this.m += ms;
  }
}

const T = DEFAULT_TIMINGS;

function setup(file = ':memory:', clock = new FakeClock(), rand = () => 0) {
  const db = new Db(file);
  const rt = new GameRuntime(db, clock, rand, T);
  return { db, rt, clock };
}

function step(rt: GameRuntime, clock: FakeClock, ms: number) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.advance(Math.min(100, end - clock.t));
    rt.tick();
  }
}

function toVote(rt: GameRuntime, clock: FakeClock) {
  step(rt, clock, T.introMs + 50);
  expect(rt.state.phase).toBe('vote');
}

function bestNumber(rt: GameRuntime): number {
  const s = rt.state;
  const beat = getLevel(s.level).beats[s.vote!.beatIndex]!;
  let best = 0;
  let bestScore = Infinity;
  s.vote!.order.forEach((id, i) => {
    const o = beat.options.find((x) => x.id === id)!;
    const out = outcomeFor(o, s.run);
    const score = out.damage * 10 + (out.alarm ?? 0);
    if (score < bestScore) {
      bestScore = score;
      best = i + 1;
    }
  });
  return best;
}

describe('voting', () => {
  it('majority wins, one vote per viewer, revote replaces', () => {
    const { rt, clock, db } = setup();
    toVote(rt, clock);
    const v = rt.state.vote!;
    expect(rt.castVote('a', 'a', 1, clock.t)).toBe('ok');
    expect(rt.castVote('a', 'a', 2, clock.t)).toBe('replaced');
    expect(rt.castVote('b', 'b', 2, clock.t)).toBe('ok');
    expect(rt.castVote('c', 'c', 3, clock.t)).toBe('ok');
    expect(rt.tally().counts[v.order[1]!]).toBe(2);
    expect(rt.tally().voters).toBe(3);
    step(rt, clock, T.voteMs + T.graceMs + 100);
    expect(rt.state.phase).toBe('resolve');
    expect(rt.state.resolution!.optionId).toBe(v.order[1]);
    expect(rt.state.resolution!.mode).toBe('chat');
    const rows = db.sql.prepare('SELECT COUNT(*) AS n FROM resolutions').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('empty vote -> AUTO MODE random among available options', () => {
    const { rt, clock } = setup(':memory:', new FakeClock(), () => 0.99);
    toVote(rt, clock);
    const order = rt.state.vote!.order;
    step(rt, clock, T.voteMs + T.graceMs + 100);
    expect(rt.state.resolution!.mode).toBe('auto');
    expect(rt.state.resolution!.optionId).toBe(order[order.length - 1]);
    expect(rt.publicState().autoMode).toBe(true);
  });

  it('tie is broken randomly among leaders only', () => {
    const { rt, clock } = setup(':memory:', new FakeClock(), () => 0.99);
    toVote(rt, clock);
    const order = rt.state.vote!.order;
    rt.castVote('a', 'a', 1, clock.t);
    rt.castVote('b', 'b', 2, clock.t);
    step(rt, clock, T.voteMs + T.graceMs + 100);
    expect(rt.state.resolution!.mode).toBe('tie');
    expect(rt.state.resolution!.optionId).toBe(order[1]);
  });

  it('rejects invalid numbers, stale and late messages; accepts a vote sent at the boundary', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    const v = rt.state.vote!;
    expect(rt.castVote('x', 'x', 7, clock.t)).toBe('invalid-option');
    expect(rt.castVote('x', 'x', 0, clock.t)).toBe('invalid-option');
    // message written during the previous phase arrives now
    expect(rt.castVote('old', 'old', 1, v.openedAt - 5000, clock.t)).toBe('stale');
    step(rt, clock, T.voteMs);
    // sent exactly at the deadline, arrives within the grace window
    expect(rt.castVote('edge', 'edge', 2, v.endsAt, clock.t + 200)).toBe('ok');
    // sent after the deadline
    expect(rt.castVote('late', 'late', 1, v.endsAt + 1000, clock.t + 300)).toBe('late');
    step(rt, clock, T.graceMs + 200);
    expect(rt.state.resolution!.optionId).toBe(v.order[1]);
    // votes after closing never leak into the next decision
    expect(rt.castVote('after', 'after', 1, clock.t)).toBe('no-vote');
  });

  it('old votes do not carry into the next decision', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    rt.castVote('a', 'a', bestNumber(rt), clock.t);
    step(rt, clock, T.voteMs + T.graceMs + T.resolveMs + 2000);
    expect(rt.state.phase).toBe('vote');
    expect(rt.state.beatIndex).toBe(1);
    expect(rt.tally().voters).toBe(0);
    // a message created before this vote opened (delayed delivery) is stale
    expect(rt.castVote('a', 'a', 1, rt.state.vote!.openedAt - 3000, clock.t)).toBe('stale');
  });
});

describe('progress', () => {
  it('perfect votes complete level 1 and advance to level 2', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    for (let i = 0; i < 5; i++) {
      expect(rt.state.phase).toBe('vote');
      rt.castVote('v', 'v', bestNumber(rt), clock.t);
      step(rt, clock, T.voteMs + T.graceMs + 100);
      expect(rt.state.resolution!.outcome.damage).toBe(0);
      step(rt, clock, T.resolveMs + 1600);
    }
    expect(rt.state.phase).toBe('levelComplete');
    expect(rt.state.heists).toBe(1);
    step(rt, clock, T.levelCompleteMs + 100);
    expect(rt.state.level).toBe(2);
    expect(['intro', 'vote']).toContain(rt.state.phase);
    expect(rt.state.attempt).toBe(1);
  });

  it('defeat restarts the same level with a new attempt and keeps completed levels', () => {
    const { rt, clock } = setup();
    rt.state.level = 3;
    rt.state.completedThisCycle = 2;
    rt.state.run.hp = 1;
    toVote(rt, clock);
    const beat = getLevel(3).beats[0]!;
    const badIdx = rt.state.vote!.order.findIndex((id) => outcomeFor(beat.options.find((o) => o.id === id)!, rt.state.run).damage > 0);
    rt.castVote('v', 'v', badIdx + 1, clock.t);
    step(rt, clock, T.voteMs + T.graceMs + 100);
    step(rt, clock, T.resolveMs + 1600);
    expect(rt.state.phase).toBe('defeat');
    step(rt, clock, T.defeatMs + 100);
    expect(rt.state.phase).toBe('intro');
    expect(rt.state.level).toBe(3);
    expect(rt.state.attempt).toBe(2);
    expect(rt.state.run.hp).toBe(3);
    expect(rt.state.completedThisCycle).toBe(2);
    // the robot remembers the failed option for AUTO MODE
    expect(rt.state.memory[0]).toContain(rt.state.vote?.order[badIdx] ?? beat.options.find((o, i) => i >= 0 && rt.state.memory[0]!.includes(o.id))!.id);
  });

  it('after level 30 a new cycle starts', () => {
    const { rt, clock } = setup();
    rt.state.level = 30;
    rt.state.phase = 'levelComplete';
    rt.state.phaseEndsAt = clock.t;
    step(rt, clock, 200);
    expect(rt.state.phase).toBe('campaignComplete');
    step(rt, clock, T.campaignCompleteMs + 200);
    expect(rt.state.cycle).toBe(2);
    expect(rt.state.level).toBe(1);
  });
});

describe('persistence & restart', () => {
  it('restart during a vote keeps votes and gives time back; no double resolution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hvc-'));
    const file = join(dir, 'db.sqlite');
    const clock = new FakeClock();
    const a = setup(file, clock);
    toVote(a.rt, clock);
    const id = a.rt.state.vote!.id;
    a.rt.castVote('p', 'p', 2, clock.t);
    a.rt.castVote('q', 'q', 2, clock.t);
    step(a.rt, clock, T.voteMs - 2000);
    a.db.close();
    // process is down for a minute
    clock.advance(60_000);
    const b = setup(file, clock);
    expect(b.rt.state.vote!.id).toBe(id);
    expect(b.rt.tally().voters).toBe(2);
    expect(b.rt.state.vote!.endsAt - clock.t).toBeGreaterThanOrEqual(T.resumeVoteMs - 1);
    step(b.rt, clock, T.resumeVoteMs + T.graceMs + 200);
    expect(b.rt.state.resolution!.voteId).toBe(id);
    b.db.close();
    // another restart during the animation: resolution is not applied again
    const hpBefore = (JSON.parse((new Db(file).sql.prepare('SELECT json FROM game_state').get() as { json: string }).json) as { run: { hp: number } }).run.hp;
    const c = setup(file, clock);
    expect(c.rt.state.phase).toBe('resolve');
    expect(c.rt.state.run.hp).toBe(hpBefore);
    const n = c.db.sql.prepare('SELECT COUNT(*) AS n FROM resolutions WHERE vote_id = ?').get(id) as { n: number };
    expect(n.n).toBe(1);
    step(c.rt, clock, T.resolveMs + 2000);
    expect(c.rt.state.phase).toBe('vote');
    expect(c.rt.state.beatIndex).toBe(1);
  });

  it('wall-clock jumps do not end a vote early', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    rt.start(1_000_000); // init jump tracking only
    rt.stop();
    const left = rt.state.vote!.endsAt - clock.t;
    clock.t += 3_600_000; // NTP jumps one hour forward, monotonic clock does not
    rt.tick();
    expect(rt.state.phase).toBe('vote');
    expect(rt.state.vote!.endsAt - clock.t).toBe(left);
  });
});

describe('interventions', () => {
  it('SCAN applies during a vote, queues otherwise; duplicates are ignored', () => {
    const { rt, clock } = setup();
    expect(rt.state.phase).toBe('intro');
    expect(rt.submitIntervention('e1', 'SCAN', 'host', 'test', true)).toBe('queued');
    expect(rt.submitIntervention('e1', 'SCAN', 'host', 'test', true)).toBe('duplicate');
    toVote(rt, clock);
    expect(rt.state.vote!.scan).not.toBeNull();
    expect(rt.queuedRows()).toHaveLength(0);
  });

  it('SHIELD absorbs exactly one mistake', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    expect(rt.submitIntervention('s1', 'SHIELD', 'host', 'test', true)).toBe('applied');
    expect(rt.submitIntervention('s2', 'SHIELD', 'host', 'test', true)).toBe('queued');
    const beat = getLevel(1).beats[0]!;
    const bad = rt.state.vote!.order.findIndex((id) => outcomeFor(beat.options.find((o) => o.id === id)!, rt.state.run).damage > 0);
    rt.castVote('v', 'v', bad + 1, clock.t);
    step(rt, clock, T.voteMs + T.graceMs + 100);
    expect(rt.state.resolution!.shieldUsed).toBe(true);
    expect(rt.state.run.hp).toBe(3);
    // the queued second shield becomes active now that the first was consumed
    rt.processQueue();
    expect(rt.state.shield).toBe(true);
  });

  it('REVOTE clears votes once per decision, old messages are rejected', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    rt.castVote('a', 'a', 1, clock.t);
    step(rt, clock, 10_000);
    const oldId = rt.state.vote!.id;
    expect(rt.submitIntervention('r1', 'REVOTE', 'host', 'test', true)).toBe('applied');
    expect(rt.state.vote!.id).not.toBe(oldId);
    expect(rt.tally().voters).toBe(0);
    expect(rt.state.vote!.endsAt - clock.t).toBe(T.voteMs);
    expect(rt.castVote('a', 'a', 1, clock.t - 4000, clock.t)).toBe('stale');
    expect(rt.submitIntervention('r2', 'REVOTE', 'host', 'test', true)).toBe('queued');
  });

  it('REVIVE only in the knockout window, once per level; otherwise waits', () => {
    const { rt, clock } = setup();
    expect(rt.submitIntervention('rv1', 'REVIVE', 'fan', 'kick', false)).toBe('queued');
    rt.state.run.hp = 1;
    toVote(rt, clock);
    const beat = getLevel(1).beats[0]!;
    const bad = rt.state.vote!.order.findIndex((id) => outcomeFor(beat.options.find((o) => o.id === id)!, rt.state.run).damage > 0);
    rt.castVote('v', 'v', bad + 1, clock.t);
    step(rt, clock, T.voteMs + T.graceMs + T.resolveMs + 2000);
    // queued revive fired automatically at the knockout and continued with the next decision
    expect(rt.state.reviveUsed).toBe(true);
    expect(rt.state.phase).toBe('vote');
    expect(rt.state.beatIndex).toBe(1);
    expect(rt.state.run.hp).toBe(2);
    expect(rt.state.attempt).toBe(1);
  });

  it('CHAOS twists the current vote but never resolves it', () => {
    const { rt, clock } = setup();
    toVote(rt, clock);
    expect(rt.submitIntervention('c1', 'CHAOS', 'host', 'test', true)).toBe('applied');
    expect(rt.state.vote!.chaos).not.toBeNull();
    expect(rt.state.phase).toBe('vote');
    expect(rt.submitIntervention('c2', 'CHAOS', 'host', 'test', true)).toBe('queued');
  });

  it('paid events survive a restart and are applied exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hvc-'));
    const file = join(dir, 'db.sqlite');
    const clock = new FakeClock();
    const a = setup(file, clock);
    a.rt.submitIntervention('kick:abc', 'SCAN', 'fan', 'kick', false);
    expect(a.rt.queuedRows()).toHaveLength(1);
    a.db.close();
    const b = setup(file, clock);
    expect(b.rt.submitIntervention('kick:abc', 'SCAN', 'fan', 'kick', false)).toBe('duplicate');
    toVote(b.rt, clock);
    expect(b.rt.state.vote!.scan?.by).toBe('@fan');
    const n = b.db.sql.prepare("SELECT COUNT(*) AS n FROM interventions WHERE status='applied'").get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('long run', () => {
  it('5 simulated hours of AUTO MODE: bounded memory, tables and queue', () => {
    const { rt, clock, db } = setup(':memory:', new FakeClock(), Math.random);
    const fiveHours = 5 * 3600_000;
    let ticks = 0;
    while (ticks * 250 < fiveHours) {
      clock.advance(250);
      rt.tick();
      ticks++;
      if (ticks % 14400 === 0) db.prune(clock.t);
    }
    const s = rt.publicState();
    expect(s.notices.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(rt.state).length).toBeLessThan(20_000);
    const votes = db.sql.prepare('SELECT COUNT(*) AS n FROM votes').get() as { n: number };
    expect(votes.n).toBe(0);
    const res = db.sql.prepare('SELECT COUNT(*) AS n FROM resolutions').get() as { n: number };
    expect(res.n).toBeGreaterThan(300);
    // the campaign progresses even without viewers (robot memory avoids known traps)
    expect(rt.state.level + (rt.state.cycle - 1) * 30).toBeGreaterThan(3);
  });
});
