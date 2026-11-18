// Shared, serialisable game types. Used by the server (authoritative) and the client (render only).

export type Phase = 'infiltrate' | 'steal' | 'escape';
export type Item = 'keycard' | 'decoy';
export type Flag = 'powerCut';

export type Challenge =
  | 'entry'
  | 'laser'
  | 'camera'
  | 'guard'
  | 'plates'
  | 'fusebox'
  | 'keycard'
  | 'door'
  | 'cat'
  | 'giftshop'
  | 'case'
  | 'chase'
  | 'searchlight'
  | 'laserCam'
  | 'guardPlates';

/** Physical action the robot performs for an option. The renderer animates each one differently. */
export type Action =
  | 'rope'
  | 'climb'
  | 'sneak'
  | 'jump'
  | 'slide'
  | 'wait'
  | 'walk'
  | 'hide'
  | 'tiptoe'
  | 'cut'
  | 'leave'
  | 'overload'
  | 'grab'
  | 'search'
  | 'swipe'
  | 'pick'
  | 'vent'
  | 'toss'
  | 'swap'
  | 'mirror'
  | 'cool'
  | 'run'
  | 'elevator'
  | 'window'
  | 'chute'
  | 'stairs'
  | 'pipe';

export type Anim =
  | 'success'
  | 'zap'
  | 'spotted'
  | 'caught'
  | 'trap'
  | 'sparks'
  | 'alarm'
  | 'fall'
  | 'meow';

export interface Cond {
  has?: Item;
  lacks?: Item;
  flag?: Flag;
  noFlag?: Flag;
  alarmAtLeast?: number;
  alarmBelow?: number;
}

export interface Outcome {
  ok: boolean;
  damage: number;
  alarm?: number;
  gain?: Item[];
  set?: Flag[];
  carry?: boolean;
  text: string;
  anim: Anim;
}

export interface OptionRule {
  when?: Cond;
  out: Outcome;
}

/** Spot = where in the room the action takes place (renderer target). */
export type Spot =
  | 'top'
  | 'left'
  | 'mid'
  | 'right'
  | 'floor'
  | 'ledge'
  | 'statue'
  | 'shadow'
  | 'vent'
  | 'row0'
  | 'row1'
  | 'row2'
  | 'row3'
  | 'box'
  | 'desk'
  | 'guard'
  | 'door'
  | 'case'
  | 'stairs'
  | 'elevator'
  | 'window'
  | 'chute'
  | 'pipe';

export interface BeatOption {
  id: string;
  label: string;
  action: Action;
  spot: Spot;
  rules: OptionRule[];
}

export interface HintRule {
  when?: Cond;
  text: string;
}

export type RoomStyle =
  | 'gallery'
  | 'corridor'
  | 'atrium'
  | 'vault'
  | 'library'
  | 'sculpture'
  | 'rooftop'
  | 'basement'
  | 'courtyard'
  | 'office'
  | 'shop'
  | 'stairwell';

export interface RoomSpec {
  style: RoomStyle;
  /** Deterministic decoration seed. */
  seed: number;
  /** Wall palette index into the art palette table. */
  wall: number;
}

export interface Beat {
  id: string;
  phase: Phase;
  challenge: Challenge;
  /** Visible cue parameters (renderer). The server never hides outcome-relevant state. */
  cue: Record<string, string | number | boolean>;
  room: RoomSpec;
  hints: HintRule[];
  options: BeatOption[];
}

export type ExhibitShape =
  | 'vase'
  | 'crown'
  | 'mask'
  | 'egg'
  | 'gem'
  | 'statuette'
  | 'scroll'
  | 'clock'
  | 'teapot'
  | 'helmet'
  | 'coin'
  | 'compass'
  | 'lamp'
  | 'harp'
  | 'globe'
  | 'skull'
  | 'feather'
  | 'ring';

export interface Exhibit {
  name: string;
  shape: ExhibitShape;
  colorA: number;
  colorB: number;
}

export interface Level {
  n: number;
  title: string;
  wing: string;
  exhibit: Exhibit;
  /** Damage of an ordinary mistake per phase (decreasing margin for error). */
  beats: Beat[];
  briefing: string;
}

export interface RunState {
  hp: number;
  maxHp: number;
  items: Item[];
  flags: Flag[];
  alarm: number;
  carrying: boolean;
}

export type InterventionType = 'SCAN' | 'SHIELD' | 'REVOTE' | 'REVIVE' | 'CHAOS';
export const INTERVENTIONS: InterventionType[] = ['SCAN', 'SHIELD', 'REVOTE', 'REVIVE', 'CHAOS'];
export type ChaosKind = 'blackout' | 'shuffle' | 'rush' | 'patrol';

export type GamePhase =
  | 'intro'
  | 'vote'
  | 'resolve'
  | 'defeat'
  | 'levelComplete'
  | 'campaignComplete';

export interface Tally {
  /** option id -> votes */
  counts: Record<string, number>;
  voters: number;
}

export interface ScanInfo {
  /** option id -> predicted damage (0 = safe) and short note */
  [optionId: string]: { damage: number; ok: boolean; note: string };
}

export interface VoteView {
  id: string;
  beatIndex: number;
  openedAt: number;
  endsAt: number;
  /** display order: number (1-based index) -> option id */
  order: string[];
  revoted: boolean;
  scan: { by: string; info: ScanInfo } | null;
  chaos: { kind: ChaosKind; by: string; until: number } | null;
  tally: Tally;
  recent: { name: string; n: number }[];
}

export interface ResolutionView {
  voteId: string;
  beatIndex: number;
  optionId: string;
  number: number;
  mode: 'chat' | 'auto' | 'tie';
  tally: Tally;
  outcome: Outcome;
  shieldUsed: boolean;
  extraDamage: number;
  startedAt: number;
}

export interface Notice {
  id: number;
  at: number;
  kind: 'intervention' | 'system' | 'gift' | 'queue';
  text: string;
  test: boolean;
}

export interface PublicState {
  rev: number;
  serverNow: number;
  cycle: number;
  level: number;
  levelTitle: string;
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
  vote: VoteView | null;
  resolution: ResolutionView | null;
  autoMode: boolean;
  autoReason: string;
  chatOnline: boolean;
  /** option ids the robot remembers as failed in earlier attempts of this level (per beat). */
  memory: Record<number, string[]>;
  queue: { type: InterventionType; by: string; test: boolean; wait: string }[];
  notices: Notice[];
  audio: { master: number; music: number; sfx: number; voice: number };
  paused: boolean;
}
