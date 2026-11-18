// Authoritative game runtime. Owns the state machine, voting, interventions and persistence.
// Every transition that changes game results is written to SQLite in one transaction together with an
// idempotency record, so a crash/restart can never apply the same vote or paid event twice.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type {
  ChaosKind,
  GamePhase,
  InterventionType,
  Notice,
  PublicState,
  ResolutionView,
  RunState,
  Tally,
  VoteView,
} from '../shared/types.js';
import { applyOutcome, chooseWinner, freshRun, outcomeFor, scanInfo } from '../shared/engine.js';
import { LEVEL_COUNT, getLevel } from '../shared/levels/campaign.js';
import type { Db } from './db.js';

export interface Clock {
  now(): number;
  mono(): number;
}
export const systemClock: Clock = { now: () => Date.now(), mono: () => performance.now() };

export interface Timings {
  introMs: number;
  voteMs: number;
  graceMs: number;
  resolveMs: number;
  defeatMs: number;
  levelCompleteMs: number;
  campaignCompleteMs: number;
  /** After a restart an open vote gets at least this much time back. */
  resumeVoteMs: number;
}
export const DEFAULT_TIMINGS: Timings = {
  introMs: 7000,
  voteMs: 30000,
  graceMs: 1500,
  resolveMs: 7500,
  defeatMs: 15000,
  levelCompleteMs: 9000,
  campaignCompleteMs: 15000,
  resumeVoteMs: 10000,
};

interface VoteState {
  id: string;
  beatIndex: number;
  openedAt: number;
  endsAt: number;
  closeAt: number;
  order: string[];
  revoted: boolean;
  scan: VoteView['scan'];
  chaos: VoteView['chaos'];
  patrol: boolean;
  recent: { name: string; n: number }[];
}

export interface ServerState {
  v: 1;
  rev: number;
  cycle: number;
  level: number;
  attempt: number;
  heists: number;
  bestLevel: number;
  completedThisCycle: number;
  phase: GamePhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  beatIndex: number;
  run: RunState;
  shield: boolean;
  reviveUsed: boolean;
  vote: VoteState | null;
  resolution: ResolutionView | null;
  memory: Record<number, string[]>;
  voteSeq: number;
  noVoteStreak: number;
  notices: Notice[];
  noticeSeq: number;
  audio: PublicState['audio'];
  paused: boolean;
  pausedAt: number;
}

interface VoteRecord {
  optionId: string;
  name: string;
  sentAt: number;
}

export type VoteResult = 'ok' | 'replaced' | 'no-vote' | 'invalid-option' | 'stale' | 'late' | 'paused';
export type SubmitResult = 'queued' | 'applied' | 'duplicate';

export interface InterventionRow {
  seq: number;
  event_id: string;
  type: InterventionType;
  source: string;
  sender: string;
  test: number;
  status: string;
  result: string | null;
  received_at: number;
  applied_at: number | null;
}

const MAX_NOTICES = 8;
const MAX_QUEUE_VIEW = 12;

export function initialState(now: number): ServerState {
  return {
    v: 1,
    rev: 0,
    cycle: 1,
    level: 1,
    attempt: 1,
    heists: 0,
    bestLevel: 0,
    completedThisCycle: 0,
    phase: 'intro',
    phaseStartedAt: now,
    phaseEndsAt: now,
    beatIndex: 0,
    run: freshRun(),
    shield: false,
    reviveUsed: false,
    vote: null,
    resolution: null,
    memory: {},
    voteSeq: 0,
    noVoteStreak: 0,
    notices: [],
    noticeSeq: 0,
    audio: { master: 0.8, music: 0.45, sfx: 0.8, voice: 0.9 },
    paused: false,
    pausedAt: 0,
  };
}

export class GameRuntime extends EventEmitter {
  state!: ServerState;
  private votes = new Map<string, VoteRecord>();
  private timer: NodeJS.Timeout | null = null;
  private lastWall = 0;
  private lastMono = 0;
  private queueWait = new Map<number, string>();
  chatOnline = false;
  chatStatusText = 'Chat not connected';

  constructor(
    private db: Db,
    private clock: Clock = systemClock,
    private rand: () => number = Math.random,
    readonly t: Timings = DEFAULT_TIMINGS,
  ) {
    super();
    this.load();
  }

  // ------------------------------------------------------------------ persistence

  private load(): void {
    const now = this.clock.now();
    const row = this.db.sql.prepare('SELECT json FROM game_state WHERE id = 1').get() as { json: string } | undefined;
    if (!row) {
      this.state = initialState(now);
      this.enterIntro(now, false);
      this.persist();
      return;
    }
    this.state = JSON.parse(row.json) as ServerState;
    // Rebuild the in-memory tally for an open vote.
    if (this.state.vote) {
      const rows = this.db.sql
        .prepare('SELECT voter_id, option_id, name, sent_at FROM votes WHERE vote_id = ?')
        .all(this.state.vote.id) as { voter_id: string; option_id: string; name: string; sent_at: number }[];
      for (const r of rows) this.votes.set(r.voter_id, { optionId: r.option_id, name: r.name, sentAt: r.sent_at });
    }
    // Resumed after downtime: give viewers time back on an open vote instead of closing it instantly.
    const s = this.state;
    if (!s.paused && s.phase === 'vote' && s.vote && s.vote.closeAt < now + this.t.resumeVoteMs) {
      s.vote.endsAt = now + this.t.resumeVoteMs;
      s.vote.closeAt = s.vote.endsAt + this.t.graceMs;
      s.phaseEndsAt = s.vote.endsAt;
      this.notice('system', 'Server restarted - the vote continues.');
      this.persist();
    }
  }

  private persist(): void {
    this.state.rev++;
    this.db.sql
      .prepare('INSERT INTO game_state (id, rev, json, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, json = excluded.json, updated_at = excluded.updated_at')
      .run(this.state.rev, JSON.stringify(this.state), this.clock.now());
  }

  private commit(): void {
    this.persist();
    this.emit('state');
  }

  // ------------------------------------------------------------------ loop

  start(intervalMs = 200): void {
    if (this.timer) return;
    this.lastWall = this.clock.now();
    this.lastMono = this.clock.mono();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (e) {
        this.emit('error', e);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Detect wall-clock jumps (NTP corrections, manual changes) and shift deadlines so timers stay fair. */
  private compensateClockJump(): void {
    const wall = this.clock.now();
    const mono = this.clock.mono();
    if (this.lastWall !== 0) {
      const drift = wall - this.lastWall - (mono - this.lastMono);
      if (Math.abs(drift) > 2000) {
        const s = this.state;
        s.phaseStartedAt += drift;
        s.phaseEndsAt += drift;
        if (s.vote) {
          s.vote.openedAt += drift;
          s.vote.endsAt += drift;
          s.vote.closeAt += drift;
          if (s.vote.chaos) s.vote.chaos.until += drift;
        }
        if (s.resolution) s.resolution.startedAt += drift;
        this.emit('log', `clock jump of ${Math.round(drift)} ms compensated`);
        this.commit();
      }
    }
    this.lastWall = wall;
    this.lastMono = mono;
  }

  tick(): void {
    this.compensateClockJump();
    const s = this.state;
    if (s.paused) return;
    const now = this.clock.now();
    switch (s.phase) {
      case 'intro':
        if (now >= s.phaseEndsAt) this.openVote(now);
        break;
      case 'vote':
        if (s.vote && now >= s.vote.closeAt) this.closeVote(now);
        break;
      case 'resolve':
        if (now >= s.phaseEndsAt) this.afterResolve(now);
        break;
      case 'defeat':
        if (now >= s.phaseEndsAt) this.restartLevelAfterDefeat(now);
        break;
      case 'levelComplete':
        if (now >= s.phaseEndsAt) this.nextLevel(now);
        break;
      case 'campaignComplete':
        if (now >= s.phaseEndsAt) this.newCycle(now);
        break;
    }
  }

  // ------------------------------------------------------------------ transitions

  private setPhase(phase: GamePhase, now: number, ms: number): void {
    this.state.phase = phase;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + ms;
  }

  private enterIntro(now: number, commit = true): void {
    const s = this.state;
    s.beatIndex = 0;
    s.run = freshRun();
    s.vote = null;
    s.resolution = null;
    this.votes.clear();
    this.setPhase('intro', now, this.t.introMs);
    if (commit) this.commit();
  }

  private openVote(now: number): void {
    const s = this.state;
    const beat = getLevel(s.level).beats[s.beatIndex]!;
    s.voteSeq++;
    s.vote = {
      id: `c${s.cycle}-l${s.level}-a${s.attempt}-b${s.beatIndex}-v${s.voteSeq}`,
      beatIndex: s.beatIndex,
      openedAt: now,
      endsAt: now + this.t.voteMs,
      closeAt: now + this.t.voteMs + this.t.graceMs,
      order: beat.options.map((o) => o.id),
      revoted: false,
      scan: null,
      chaos: null,
      patrol: false,
      recent: [],
    };
    this.votes.clear();
    s.resolution = null;
    this.setPhase('vote', now, this.t.voteMs);
    this.db.tx(() => {
      this.commit();
      this.processQueue(now);
    });
  }

  tally(): Tally {
    const counts: Record<string, number> = {};
    for (const id of this.state.vote?.order ?? []) counts[id] = 0;
    for (const v of this.votes.values()) counts[v.optionId] = (counts[v.optionId] ?? 0) + 1;
    return { counts, voters: this.votes.size };
  }

  private closeVote(now: number): void {
    const s = this.state;
    const vote = s.vote;
    if (!vote) return;
    const exists = this.db.sql.prepare('SELECT 1 FROM resolutions WHERE vote_id = ?').get(vote.id);
    if (exists) {
      // Already resolved (should not happen; defensive idempotency).
      this.setPhase('resolve', now, 0);
      this.commit();
      return;
    }
    const level = getLevel(s.level);
    const beat = level.beats[vote.beatIndex]!;
    const tally = this.tally();
    const remembered = s.memory[vote.beatIndex] ?? [];
    const available = vote.order.filter((id) => !remembered.includes(id));
    const pick = chooseWinner(tally.counts, vote.order, available, this.rand);
    const option = beat.options.find((o) => o.id === pick.id)!;
    const outcome = outcomeFor(option, s.run);
    const extra = vote.patrol ? 1 : 0;
    const applied = applyOutcome(s.run, outcome, s.shield, extra);
    s.run = applied.run;
    if (applied.shieldUsed) {
      s.shield = false;
      this.notice('system', 'SHIELD absorbed the hit!');
    }
    if (!outcome.ok) s.memory[vote.beatIndex] = [...new Set([...remembered, option.id])];
    s.noVoteStreak = pick.mode === 'auto' ? s.noVoteStreak + 1 : 0;
    s.resolution = {
      voteId: vote.id,
      beatIndex: vote.beatIndex,
      optionId: option.id,
      number: vote.order.indexOf(option.id) + 1,
      mode: pick.mode,
      tally,
      outcome,
      shieldUsed: applied.shieldUsed,
      extraDamage: applied.damage > outcome.damage ? applied.damage - outcome.damage : 0,
      startedAt: now,
    };
    s.vote = null;
    this.votes.clear();
    const extraTime = beat.challenge === 'case' ? 1500 : 0;
    this.setPhase('resolve', now, this.t.resolveMs + extraTime);
    this.db.tx(() => {
      this.db.sql
        .prepare('INSERT INTO resolutions (vote_id, level, beat, option_id, mode, voters, damage, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(vote.id, s.level, vote.beatIndex, option.id, pick.mode, tally.voters, applied.damage, now);
      this.commit();
    });
  }

  private afterResolve(now: number): void {
    const s = this.state;
    if (s.run.hp <= 0) {
      this.setPhase('defeat', now, this.t.defeatMs);
      this.db.tx(() => {
        this.commit();
        this.processQueue(now);
      });
      return;
    }
    this.advanceBeat(now);
  }

  private advanceBeat(now: number): void {
    const s = this.state;
    s.beatIndex++;
    const level = getLevel(s.level);
    if (s.beatIndex >= level.beats.length) {
      s.heists++;
      s.completedThisCycle = Math.max(s.completedThisCycle, s.level);
      s.bestLevel = Math.max(s.bestLevel, s.level);
      s.resolution = null;
      this.setPhase('levelComplete', now, this.t.levelCompleteMs);
      this.commit();
      return;
    }
    this.openVote(now);
  }

  private restartLevelAfterDefeat(now: number): void {
    const s = this.state;
    s.attempt++;
    s.reviveUsed = false;
    this.enterIntro(now);
  }

  private nextLevel(now: number): void {
    const s = this.state;
    s.memory = {};
    s.attempt = 1;
    s.reviveUsed = false;
    if (s.level >= LEVEL_COUNT) {
      s.resolution = null;
      this.setPhase('campaignComplete', now, this.t.campaignCompleteMs);
      this.commit();
      return;
    }
    s.level++;
    this.enterIntro(now);
  }

  private newCycle(now: number): void {
    const s = this.state;
    s.cycle++;
    s.level = 1;
    s.attempt = 1;
    s.completedThisCycle = 0;
    s.memory = {};
    this.notice('system', `Campaign complete! Cycle ${s.cycle} begins.`);
    this.enterIntro(now);
  }

  // ------------------------------------------------------------------ voting

  /**
   * Register a chat vote. `sentAt` is the platform timestamp of the message, `receivedAt` our arrival time.
   * Messages written before this vote opened (previous decision, before a REVOTE) are rejected as stale.
   */
  castVote(voterId: string, name: string, num: number, sentAt: number, receivedAt = this.clock.now()): VoteResult {
    const s = this.state;
    if (s.paused) return 'paused';
    const vote = s.vote;
    if (s.phase !== 'vote' || !vote) return 'no-vote';
    if (!Number.isInteger(num) || num < 1 || num > vote.order.length) return 'invalid-option';
    // Platform timestamps can be skewed; trust our own arrival time when theirs is absurd.
    const ts = Number.isFinite(sentAt) && Math.abs(sentAt - receivedAt) < 60_000 ? sentAt : receivedAt;
    if (receivedAt < vote.openedAt || ts < vote.openedAt - 2000) return 'stale';
    if (receivedAt > vote.closeAt || ts > vote.endsAt + 500) return 'late';
    const optionId = vote.order[num - 1]!;
    const prev = this.votes.get(voterId);
    this.votes.set(voterId, { optionId, name, sentAt: ts });
    this.db.sql
      .prepare(
        'INSERT INTO votes (vote_id, voter_id, option_id, name, sent_at, received_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(vote_id, voter_id) DO UPDATE SET option_id = excluded.option_id, sent_at = excluded.sent_at, received_at = excluded.received_at',
      )
      .run(vote.id, voterId, optionId, name, ts, receivedAt);
    vote.recent = [{ name, n: num }, ...vote.recent.filter((r) => r.name !== name)].slice(0, 5);
    this.emit('state');
    return prev ? 'replaced' : 'ok';
  }

  // ------------------------------------------------------------------ interventions

  /** Persist an intervention once (idempotent by eventId) and try to apply it. */
  submitIntervention(eventId: string, type: InterventionType, sender: string, source: 'test' | 'kick', test: boolean): SubmitResult {
    const now = this.clock.now();
    return this.db.tx(() => {
      const r = this.db.sql
        .prepare("INSERT OR IGNORE INTO interventions (event_id, type, source, sender, test, status, received_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
        .run(eventId, type, source, sender, test ? 1 : 0, now);
      if (r.changes === 0) return 'duplicate';
      const seq = Number(r.lastInsertRowid);
      this.processQueue(now);
      const row = this.db.sql.prepare('SELECT status FROM interventions WHERE seq = ?').get(seq) as { status: string };
      if (row.status === 'queued') {
        this.notice('queue', `${type} from ${label(sender, test)} queued: ${this.queueWait.get(seq) ?? 'waiting'}`, test);
        this.commit();
      }
      return row.status === 'applied' ? 'applied' : 'queued';
    });
  }

  /** Why a type cannot be applied right now (null = can apply). */
  private blocker(type: InterventionType, now: number): string | null {
    const s = this.state;
    if (s.paused) return 'game paused';
    switch (type) {
      case 'SCAN':
        if (s.phase !== 'vote' || !s.vote) return 'waits for the next vote';
        if (s.vote.scan) return 'a scan is already active';
        return null;
      case 'SHIELD':
        if (s.shield) return 'waits until the current shield is used';
        if (s.phase === 'defeat' || s.phase === 'campaignComplete') return 'waits for the next level';
        return null;
      case 'REVOTE':
        if (s.phase !== 'vote' || !s.vote) return 'waits for the next vote';
        if (s.vote.revoted) return 'this vote was already restarted';
        return null;
      case 'REVIVE':
        if (s.phase !== 'defeat') return 'waits for the next knockout';
        if (s.reviveUsed) return 'one revive per level - waits for the next level';
        return null;
      case 'CHAOS':
        if (s.phase !== 'vote' || !s.vote) return 'waits for the next vote';
        if (s.vote.chaos) return 'chaos already active';
        if (s.vote.endsAt - now < 8000) return 'too late in this vote';
        return null;
    }
  }

  processQueue(now = this.clock.now()): void {
    const rows = this.db.sql.prepare("SELECT * FROM interventions WHERE status = 'queued' ORDER BY seq").all() as unknown as InterventionRow[];
    let changed = false;
    this.queueWait.clear();
    for (const row of rows) {
      const why = this.blocker(row.type, now);
      if (why) {
        this.queueWait.set(row.seq, why);
        continue;
      }
      const result = this.apply(row, now);
      this.db.sql.prepare("UPDATE interventions SET status = 'applied', result = ?, applied_at = ? WHERE seq = ?").run(result, now, row.seq);
      this.notice('intervention', `${row.type} by ${label(row.sender, !!row.test)}: ${result}`, !!row.test);
      changed = true;
    }
    if (changed) this.commit();
  }

  private apply(row: InterventionRow, now: number): string {
    const s = this.state;
    const level = getLevel(s.level);
    switch (row.type) {
      case 'SCAN': {
        const beat = level.beats[s.vote!.beatIndex]!;
        s.vote!.scan = { by: label(row.sender, !!row.test), info: scanInfo(beat, s.run) };
        return 'safe and risky moves revealed for this vote';
      }
      case 'SHIELD':
        s.shield = true;
        return 'the next mistake costs no HP';
      case 'REVOTE': {
        const v = s.vote!;
        s.voteSeq++;
        v.id = `c${s.cycle}-l${s.level}-a${s.attempt}-b${v.beatIndex}-v${s.voteSeq}`;
        v.openedAt = now;
        v.endsAt = now + this.t.voteMs;
        v.closeAt = v.endsAt + this.t.graceMs;
        v.revoted = true;
        v.recent = [];
        this.votes.clear();
        s.phaseStartedAt = now;
        s.phaseEndsAt = v.endsAt;
        return 'vote restarted - all votes cleared, vote again!';
      }
      case 'REVIVE':
        s.reviveUsed = true;
        s.run = { ...s.run, hp: Math.max(1, s.run.maxHp - 1) };
        this.advanceBeatFromRevive(now);
        return `robot rebooted with ${s.run.hp} HP`;
      case 'CHAOS': {
        const v = s.vote!;
        const kinds: ChaosKind[] = ['blackout', 'shuffle', 'rush', 'patrol'];
        const kind = kinds[createHash('sha256').update(row.event_id).digest()[0]! % kinds.length]!;
        v.chaos = { kind, by: label(row.sender, !!row.test), until: now + 12000 };
        if (kind === 'shuffle') {
          v.order = [...v.order.slice(1), v.order[0]!];
          // Existing votes keep their chosen option, only the numbers move.
        } else if (kind === 'rush') {
          v.endsAt = Math.max(now + 10000, Math.min(v.endsAt, now + Math.floor((v.endsAt - now) / 2)));
          v.closeAt = v.endsAt + this.t.graceMs;
          s.phaseEndsAt = v.endsAt;
          v.chaos.until = v.endsAt;
        } else if (kind === 'patrol') {
          v.patrol = true;
          v.chaos.until = v.endsAt;
        }
        return CHAOS_TEXT[kind];
      }
    }
  }

  private advanceBeatFromRevive(now: number): void {
    // Continue after the beat that knocked the robot out.
    const s = this.state;
    s.beatIndex++;
    const level = getLevel(s.level);
    if (s.beatIndex >= level.beats.length) {
      s.heists++;
      s.completedThisCycle = Math.max(s.completedThisCycle, s.level);
      s.bestLevel = Math.max(s.bestLevel, s.level);
      s.resolution = null;
      this.setPhase('levelComplete', now, this.t.levelCompleteMs);
      return;
    }
    // open the next vote without re-entering processQueue recursively for this same row
    const beat = level.beats[s.beatIndex]!;
    s.voteSeq++;
    s.vote = {
      id: `c${s.cycle}-l${s.level}-a${s.attempt}-b${s.beatIndex}-v${s.voteSeq}`,
      beatIndex: s.beatIndex,
      openedAt: now,
      endsAt: now + this.t.voteMs,
      closeAt: now + this.t.voteMs + this.t.graceMs,
      order: beat.options.map((o) => o.id),
      revoted: false,
      scan: null,
      chaos: null,
      patrol: false,
      recent: [],
    };
    this.votes.clear();
    s.resolution = null;
    this.setPhase('vote', now, this.t.voteMs);
  }

  queuedRows(): InterventionRow[] {
    return this.db.sql.prepare("SELECT * FROM interventions WHERE status = 'queued' ORDER BY seq LIMIT 50").all() as unknown as InterventionRow[];
  }
  recentInterventions(limit = 20): InterventionRow[] {
    return this.db.sql.prepare('SELECT * FROM interventions ORDER BY seq DESC LIMIT ?').all(limit) as unknown as InterventionRow[];
  }

  // ------------------------------------------------------------------ notices & owner actions

  notice(kind: Notice['kind'], text: string, test = false): void {
    const s = this.state;
    s.noticeSeq++;
    s.notices = [{ id: s.noticeSeq, at: this.clock.now(), kind, text, test }, ...s.notices].slice(0, MAX_NOTICES);
  }

  pushNotice(kind: Notice['kind'], text: string, test = false): void {
    this.notice(kind, text, test);
    this.commit();
  }

  setPaused(paused: boolean): void {
    const s = this.state;
    const now = this.clock.now();
    if (paused === s.paused) return;
    if (paused) {
      s.paused = true;
      s.pausedAt = now;
    } else {
      const d = now - s.pausedAt;
      s.paused = false;
      s.phaseStartedAt += d;
      s.phaseEndsAt += d;
      if (s.vote) {
        s.vote.openedAt += d;
        s.vote.endsAt += d;
        s.vote.closeAt += d;
        if (s.vote.chaos) s.vote.chaos.until += d;
      }
      if (s.resolution) s.resolution.startedAt += d;
    }
    this.commit();
  }

  setAudio(a: Partial<PublicState['audio']>): void {
    this.state.audio = { ...this.state.audio, ...a };
    this.commit();
  }

  /** Restart the current level from its intro (keeps campaign progress; counts as a new attempt). */
  restartLevel(): void {
    const s = this.state;
    s.attempt++;
    s.reviveUsed = false;
    s.paused = false;
    this.notice('system', 'Level restarted by the host.');
    this.enterIntro(this.clock.now());
  }

  /** Full reset of campaign progress. Interventions queue is preserved (paid events are never dropped). */
  resetProgress(): void {
    const now = this.clock.now();
    const keep = { audio: this.state.audio, voteSeq: this.state.voteSeq, noticeSeq: this.state.noticeSeq };
    this.state = { ...initialState(now), ...keep, rev: this.state.rev };
    this.notice('system', 'Campaign progress was reset by the host.');
    this.enterIntro(now);
  }

  // ------------------------------------------------------------------ view

  publicState(): PublicState {
    const s = this.state;
    const now = this.clock.now();
    const level = getLevel(s.level);
    const queue = this.queuedRows()
      .slice(0, MAX_QUEUE_VIEW)
      .map((r) => ({ type: r.type, by: label(r.sender, !!r.test), test: !!r.test, wait: this.queueWait.get(r.seq) ?? 'waiting' }));
    const tally = this.tally();
    const autoReason = !this.chatOnline
      ? 'Chat offline: the robot decides'
      : s.noVoteStreak > 0 && (s.phase !== 'vote' || tally.voters === 0)
        ? 'No votes: the robot decides'
        : '';
    return {
      rev: s.rev,
      serverNow: now,
      cycle: s.cycle,
      level: s.level,
      levelTitle: level.title,
      attempt: s.attempt,
      heists: s.heists,
      bestLevel: s.bestLevel,
      completedThisCycle: s.completedThisCycle,
      phase: s.phase,
      phaseStartedAt: s.phaseStartedAt,
      phaseEndsAt: s.phaseEndsAt,
      beatIndex: s.beatIndex,
      run: s.run,
      shield: s.shield,
      reviveUsed: s.reviveUsed,
      vote: s.vote
        ? {
            id: s.vote.id,
            beatIndex: s.vote.beatIndex,
            openedAt: s.vote.openedAt,
            endsAt: s.vote.endsAt,
            order: s.vote.order,
            revoted: s.vote.revoted,
            scan: s.vote.scan,
            chaos: s.vote.chaos,
            tally,
            recent: s.vote.recent,
          }
        : null,
      resolution: s.resolution,
      autoMode: autoReason !== '',
      autoReason,
      chatOnline: this.chatOnline,
      memory: s.memory,
      queue,
      notices: s.notices,
      audio: s.audio,
      paused: s.paused,
    };
  }
}

const CHAOS_TEXT: Record<ChaosKind, string> = {
  blackout: 'BLACKOUT - the hint card goes dark for 12 seconds',
  shuffle: 'SHUFFLE - option numbers moved, check before you vote',
  rush: 'RUSH - the vote timer is cut short',
  patrol: 'PATROL - an extra guard: a mistake this vote costs +1 HP',
};

export function label(sender: string, test: boolean): string {
  return test ? `${sender} (TEST)` : `@${sender}`;
}
