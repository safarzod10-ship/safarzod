// Challenge templates. Each template turns a few visible cue parameters into a fully specified beat
// (options + deterministic rules + hints). Outcomes depend ONLY on visible cues and visible run state
// (items, power flag, alert level), so a careful viewer can always reason out a safe choice.
import type { Beat, BeatOption, Cond, HintRule, Outcome, Phase, RoomSpec, Anim } from '../types.js';

export interface Ctx {
  id: string;
  phase: Phase;
  room: RoomSpec;
  /** Damage of an ordinary mistake for this beat. */
  dmg: number;
}

const ok = (text: string, extra: Partial<Outcome> = {}): Outcome => ({ ok: true, damage: 0, text, anim: 'success', ...extra });
const bad = (dmg: number, text: string, anim: Anim, extra: Partial<Outcome> = {}): Outcome => ({
  ok: false,
  damage: dmg,
  // Being seen or caught raises the museum's alert level.
  alarm: anim === 'spotted' || anim === 'caught' || anim === 'alarm' || anim === 'meow' ? 1 : 0,
  text,
  anim,
  ...extra,
});
const noisy = (text: string, extra: Partial<Outcome> = {}): Outcome => ({ ok: false, damage: 0, alarm: 1, text, anim: 'alarm', ...extra });

const POWER: Cond = { flag: 'powerCut' };

function opt(id: string, label: string, action: BeatOption['action'], spot: BeatOption['spot'], rules: BeatOption['rules']): BeatOption {
  return { id, label, action, spot, rules };
}

function beat(ctx: Ctx, challenge: Beat['challenge'], cue: Beat['cue'], hints: HintRule[], options: BeatOption[]): Beat {
  return { id: ctx.id, phase: ctx.phase, challenge, cue, room: ctx.room, hints, options };
}

/** Power cut only matters before the escape: the alarm restores backup power when the exhibit leaves its case. */
function powerRule(ctx: Ctx, text: string): BeatOption['rules'] {
  return ctx.phase === 'escape' ? [] : [{ when: POWER, out: ok(text) }];
}
function powerHint(ctx: Ctx, text: string): HintRule[] {
  return ctx.phase === 'escape' ? [] : [{ when: POWER, text }];
}

// ---------------------------------------------------------------------------------------------

export type EntryWay = 'skylight' | 'window' | 'dock';
export function entry(ctx: Ctx, safe: EntryWay): Beat {
  const d = ctx.dmg;
  const desc: Record<EntryWay, [string, string]> = {
    skylight: ['Skylight: dry and unlatched', 'Skylight: wet and slippery'],
    window: ['Window: sensor unplugged', 'Window: sensor blinking red'],
    dock: ['Dock: empty and dark', 'Dock: guard on a coffee break'],
  };
  const ways: EntryWay[] = ['skylight', 'window', 'dock'];
  const hint = ways.map((w) => desc[w][w === safe ? 0 : 1]).join(' · ');
  return beat(ctx, 'entry', { safe }, [{ text: hint }], [
    opt('skylight', 'Rope down the skylight', 'rope', 'top', [
      safe === 'skylight' ? { out: ok('A silent drop onto the gallery floor.') } : { out: bad(d, 'Slippery glass! A clumsy crash landing.', 'fall') },
    ]),
    opt('window', 'Climb in the window', 'climb', 'left', [
      safe === 'window' ? { out: ok('The window slides open without a sound.') } : { out: bad(d, 'The window sensor bites with a shock!', 'zap') },
    ]),
    opt('dock', 'Sneak via the dock', 'sneak', 'right', [
      safe === 'dock' ? { out: ok('Rolling in past empty crates.') } : { out: bad(d, 'The guard spills coffee - and spots you!', 'spotted') },
    ]),
  ]);
}

export type LaserMode = 'low' | 'high' | 'pulse';
export function laser(ctx: Ctx, mode: LaserMode, four = false): Beat {
  const d = ctx.dmg;
  const right: Record<LaserMode, string> = { low: 'jump', high: 'slide', pulse: 'wait' };
  const mk = (id: string, label: string, action: BeatOption['action'], good: string, fail: string) =>
    opt(id, label, action, 'floor', [
      ...powerRule(ctx, 'The lasers are dark. Easy stroll.'),
      right[mode] === id ? { out: ok(good) } : { out: bad(d, fail, 'zap') },
    ]);
  const hints: HintRule[] = [
    ...powerHint(ctx, 'Power is OFF - every laser is dark.'),
    ...(ctx.phase === 'escape' ? [{ when: POWER, text: 'Backup power! ' + laserHint(mode) }] : []),
    { text: laserHint(mode) },
  ];
  const options = [
    mk('jump', 'Jump over', 'jump', 'A springy hop clears the beams.', 'Beams at head height - zapped mid-jump!'),
    mk('slide', 'Slide under', 'slide', 'A smooth slide beneath the beams.', 'Beams near the floor - zapped while sliding!'),
    mk('wait', 'Wait for a gap', 'wait', 'Beams blink off. Through the gap!', 'These beams never blink. Zap!'),
  ];
  if (four) {
    options.push(
      opt('walk', 'Walk straight through', 'walk', 'floor', [
        ...powerRule(ctx, 'No power, no lasers. Walking tall.'),
        { out: bad(d, 'Walking into live lasers. Ouch!', 'zap') },
      ]),
    );
  }
  return beat(ctx, 'laser', { mode }, hints, options);
}
function laserHint(mode: LaserMode): string {
  return mode === 'low'
    ? 'Red beams hum at ankle height.'
    : mode === 'high'
      ? 'Beams hang at head height. The floor is clear.'
      : 'The beams blink on and off. Count the gaps.';
}

export type CamZone = 'floor' | 'ledge' | 'both';
export function camera(ctx: Ctx, zone: CamZone, four = false): Beat {
  const d = ctx.dmg;
  const right: Record<CamZone, string> = { floor: 'ledge', ledge: 'floor', both: 'box' };
  const mk = (id: string, label: string, action: BeatOption['action'], spot: BeatOption['spot'], good: string) =>
    opt(id, label, action, spot, [
      ...powerRule(ctx, 'The camera is off. Nobody is watching.'),
      right[zone] === id ? { out: ok(good) } : { out: bad(d, 'The camera turns - flash! Spotted!', 'spotted') },
    ]);
  const text: Record<CamZone, string> = {
    floor: 'The camera stares at the floor path.',
    ledge: 'The camera watches the high ledge.',
    both: 'The camera sweeps floor AND ledge. Need cover.',
  };
  const options = [
    mk('floor', 'Sneak along the floor', 'sneak', 'floor', 'Low and quiet under the lens.'),
    mk('ledge', 'Climb the ledge', 'climb', 'ledge', 'Tiptoeing along the high ledge, unseen.'),
    mk('box', 'Hide in a crate', 'hide', 'box', 'Crate mode. The camera sees only a box.'),
  ];
  if (four) {
    options.push(
      opt('walk', 'Stroll right past', 'walk', 'mid', [
        ...powerRule(ctx, 'Dead camera, happy robot.'),
        { out: bad(d, 'Smile for the camera... alarm!', 'spotted') },
      ]),
    );
  }
  return beat(ctx, 'camera', { zone }, [...powerHint(ctx, 'Power is OFF - the camera is dark.'), { text: text[zone] }], options);
}

export type GuardMode = 'toward' | 'away' | 'statue' | 'radio';
export function guard(ctx: Ctx, mode: GuardMode, four = false): Beat {
  const d = ctx.dmg;
  const right: Record<GuardMode, string> = { toward: 'statue', away: 'tiptoe', statue: 'shadow', radio: 'coin' };
  const text: Record<GuardMode, string> = {
    toward: 'A guard walks YOUR way. A big statue offers cover.',
    away: 'The guard strolls away toward the statue, back turned.',
    statue: 'The guard polishes the statue, flashlight sweeping the path.',
    radio: 'The guard stands still, humming to the radio. Coins jingle on the floor.',
  };
  const fails: Record<string, string> = {
    statue: 'The guard comes right to the statue. Busted!',
    tiptoe: 'Tiptoeing into the flashlight beam. Caught!',
    shadow: 'Waiting too long - the guard turns back. Spotted!',
    coin: 'The guard picks up the coin... and looks straight at you.',
  };
  const mk = (id: string, label: string, action: BeatOption['action'], spot: BeatOption['spot'], good: string) =>
    opt(id, label, action, spot, [right[mode] === id ? { out: ok(good) } : { out: bad(d, fails[id]!, id === 'tiptoe' ? 'caught' : 'spotted') }]);
  const options = [
    mk('statue', 'Hide behind the statue', 'hide', 'statue', 'Statue mode. The guard walks right by.'),
    mk('tiptoe', 'Tiptoe behind the guard', 'tiptoe', 'guard', 'Quiet steps right behind the guard.'),
    mk('shadow', 'Wait in the shadows', 'wait', 'shadow', 'Patience. The guard leaves, the path clears.'),
  ];
  if (four) options.push(mk('coin', 'Toss a coin to distract', 'toss', 'mid', 'Clink! The guard wanders off after the coin.'));
  return beat(ctx, 'guard', { mode }, [{ text: text[mode] }], options);
}

export function plates(ctx: Ctx, safe: number, rows: 3 | 4): Beat {
  const d = ctx.dmg;
  const names = rows === 3 ? ['Back row', 'Middle row', 'Front row'] : ['Back row', 'Inner back', 'Inner front', 'Front row'];
  const options = names.map((n, i) =>
    opt(`row${i}`, `Cross on ${n.toLowerCase()}`, 'tiptoe', `row${i}` as BeatOption['spot'], [
      i === safe ? { out: ok('Clean tiles all the way. Nothing clicks.') } : { out: bad(d, 'Click! A pressure plate drops a net!', 'trap') },
    ]),
  );
  return beat(ctx, 'plates', { safe, rows }, [{ text: 'Pressure plates have gold rims. Find the row with none.' }], options);
}

export function fusebox(ctx: Ctx, linked: boolean): Beat {
  const d = ctx.dmg;
  return beat(
    ctx,
    'fusebox',
    { linked },
    [
      { when: POWER, text: 'The power is already off on this floor.' },
      {
        text: linked
          ? 'A red tag: ALARM-LINKED. Cutting it rings the bells.'
          : 'An old fuse box powers this floor\'s lasers and cameras.',
      },
    ],
    [
      opt('cut', 'Cut the power', 'cut', 'mid', [
        { when: POWER, out: ok('Already dark. Nothing more to cut.') },
        linked
          ? { out: noisy('Power dies - and the linked alarm wails!') }
          : { out: ok('Click. Lasers and cameras go dark!', { set: ['powerCut'] }) },
      ]),
      opt('leave', 'Leave it alone', 'leave', 'right', [{ out: ok('Better safe. Moving on.') }]),
      opt('overload', 'Overload the fuses', 'overload', 'mid', [{ out: bad(d, 'KZZT! The fuses explode in your face!', 'sparks') }]),
    ],
  );
}

export function keycard(ctx: Ctx, guardState: 'asleep' | 'stirring', desk: boolean): Beat {
  const d = ctx.dmg;
  const hint =
    (guardState === 'asleep' ? 'A snoring guard, keycard on the belt. ' : 'A twitchy, half-awake guard. ') +
    (desk ? 'A keycard glints in an open drawer.' : 'The desk drawer is shut and rusty.');
  return beat(ctx, 'keycard', { guard: guardState, desk }, [{ when: { has: 'keycard' }, text: 'You already carry a keycard. ' + hint }, { text: hint }], [
    opt('lift', "Lift the guard's keycard", 'grab', 'guard', [
      guardState === 'asleep'
        ? { out: ok('Snagged the keycard mid-snore!', { gain: ['keycard'] }) }
        : { out: bad(d, 'The guard swats you awake-ish!', 'caught') },
    ]),
    opt('desk', 'Search the desk', 'search', 'desk', [
      desk ? { out: ok('Keycard acquired from the drawer.', { gain: ['keycard'] }) } : { out: noisy('Empty drawer... with a LOUD squeak.') },
    ]),
    opt('skip', 'Move on', 'walk', 'right', [{ out: ok('No time for souvenirs.') }]),
  ]);
}

export function door(ctx: Ctx, lock: 'brass' | 'magnetic'): Beat {
  const d = ctx.dmg;
  const lockHint = lock === 'brass' ? 'An old brass lock - pickable.' : 'A magnetic lock - no keyhole to pick.';
  return beat(
    ctx,
    'door',
    { lock },
    [
      { when: { has: 'keycard' }, text: `${lockHint} You carry a keycard.` },
      { text: `${lockHint} You have NO keycard. The vent is noisy.` },
    ],
    [
      opt('swipe', 'Swipe a keycard', 'swipe', 'door', [
        { when: { has: 'keycard' }, out: ok('Beep. Green light. Welcome in.') },
        { out: bad(d, 'No keycard! The reader zaps your hand.', 'zap') },
      ]),
      opt('pick', 'Pick the lock', 'pick', 'door', [
        lock === 'brass' ? { out: ok('Click-clack. The old lock gives way.') } : { out: bad(d, 'Picking a magnet lock? It shocks you!', 'zap') },
      ]),
      opt('vent', 'Crawl the vent', 'vent', 'vent', [{ out: noisy('Clang, clang, clang... noisy, but you are through.') }]),
    ],
  );
}

export function cat(ctx: Ctx, awake: boolean): Beat {
  const d = ctx.dmg;
  return beat(
    ctx,
    'cat',
    { awake },
    [{ text: awake ? 'The museum cat is WIDE awake, tail twitching.' : 'The museum cat is fast asleep on a cushion.' }],
    [
      opt('tiptoe', 'Tiptoe past the cat', 'tiptoe', 'mid', [
        awake ? { out: bad(d, 'MEOW! The cat pounces on your antenna!', 'meow') } : { out: ok('Not a whisker moves.') },
      ]),
      opt('yarn', 'Toss a yarn ball', 'toss', 'left', [
        awake ? { out: ok('The cat chases the yarn. Path clear!') } : { out: noisy('The yarn bonks the sleeping cat. MEOW!') },
      ]),
      opt('shelves', 'Climb over the shelves', 'climb', 'ledge', [{ out: bad(d, 'Wobbly shelves! Down you tumble.', 'fall') }]),
    ],
  );
}

export function giftshop(ctx: Ctx, gate: 'open' | 'barred'): Beat {
  const d = ctx.dmg;
  return beat(
    ctx,
    'giftshop',
    { gate },
    [
      {
        text:
          gate === 'open'
            ? 'The gift shop is open. Plaster replicas weigh just like the real thing.'
            : 'Gift shop gate is barred and wired. Replicas sit right behind the bars.',
      },
    ],
    [
      opt('walk', 'Walk in, grab a replica', 'grab', 'mid', [
        gate === 'open' ? { out: ok('A perfect decoy replica. Into the backpack!', { gain: ['decoy'] }) } : { out: bad(d, 'The wired gate zaps you!', 'zap') },
      ]),
      opt('reach', 'Reach through the bars', 'grab', 'left', [
        gate === 'barred'
          ? { out: ok('Long robot arm, one decoy replica!', { gain: ['decoy'] }) }
          : { out: noisy('No bars here - you knock over a display. CRASH!') },
      ]),
      opt('skip', 'Skip the shop', 'walk', 'right', [{ out: ok('No shopping on the job.') }]),
    ],
  );
}

export type Sensor = 'weight' | 'beam' | 'motion' | 'heat';
export function exhibitCase(ctx: Ctx, sensor: Sensor, four = false): Beat {
  const d = ctx.dmg;
  const right: Record<Sensor, string> = { weight: 'swap', beam: 'mirror', motion: 'wait', heat: 'cool' };
  const text: Record<Sensor, string> = {
    weight: 'A scale sensor: replace the exhibit with equal weight.',
    beam: 'A light beam crosses the case. Bounce it away.',
    motion: 'A motion eye blinks off every few seconds.',
    heat: 'A heat sensor: a warm robot will trip it.',
  };
  const goods: Record<string, string> = {
    swap: 'Swapped! The scale never noticed.',
    mirror: 'The mirror bends the beam. The prize is yours!',
    wait: 'The eye blinks off - grab!',
    cool: 'Fan on full blast. Cool robot, cool heist.',
  };
  const mk = (id: string, label: string, action: BeatOption['action']) => {
    const rules: BeatOption['rules'] = [];
    if (right[sensor] === id) {
      if (id === 'swap') {
        rules.push({ when: { has: 'decoy' }, out: ok('The decoy weighs exactly the same. Perfect swap!', { carry: true }) });
        rules.push({ out: noisy('Your backpack is a bit light... beep! Grabbed anyway.', { carry: true }) });
      } else rules.push({ out: ok(goods[id]!, { carry: true }) });
    } else rules.push({ out: bad(d, 'Wrong trick! The case zaps you - but you grab the prize.', 'zap', { carry: true }) });
    return opt(id, label, action, 'case', rules);
  };
  const options = [mk('swap', 'Swap the weight', 'swap'), mk('mirror', 'Angle a mirror', 'mirror'), mk('wait', 'Wait for the blink', 'wait')];
  if (four) options.push(mk('cool', 'Cool down with the fan', 'cool'));
  const hints: HintRule[] =
    sensor === 'weight'
      ? [
          { when: { has: 'decoy' }, text: text.weight + ' You carry a decoy.' },
          { text: text.weight + ' No decoy - the backpack will do, noisily.' },
        ]
      : [{ text: text[sensor] }];
  return beat(ctx, 'case', { sensor }, hints, options);
}

export type Route = 'stairs' | 'elevator' | 'window' | 'chute';
const ROUTE_LABEL: Record<Route, string> = { stairs: 'Run down the stairs', elevator: 'Take the elevator', window: 'Jump out the window', chute: 'Dive down the chute' };
const ROUTE_FREE: Record<Route, string> = { stairs: 'Stairs: quiet', elevator: 'Lift: empty, waiting', window: 'Window: soft awning below', chute: 'Chute: open' };
const ROUTE_BLOCK: Record<Route, string> = { stairs: 'Stairs: boots stomping', elevator: 'Lift: guard inside', window: 'Window: barred', chute: 'Chute: jammed' };

/** Escape choice. `free` is the open route while alert < 2; with alert 2+ guards reroute and only `freeIfAlarm` stays open. */
export function chase(ctx: Ctx, routes: Route[], free: Route, freeIfAlarm: Route): Beat {
  const d = ctx.dmg;
  const hintFor = (open: Route) => routes.map((r) => (r === open ? ROUTE_FREE[r] : ROUTE_BLOCK[r])).join(' · ');
  const action: Record<Route, BeatOption['action']> = { stairs: 'stairs', elevator: 'elevator', window: 'window', chute: 'chute' };
  const options = routes.map((r) =>
    opt(r, ROUTE_LABEL[r], action[r], r, [
      { when: { alarmAtLeast: 2 }, out: r === freeIfAlarm ? ok('A clean getaway route!') : bad(d, 'Guards everywhere! Grabbed!', 'caught') },
      { out: r === free ? ok('A clean getaway route!') : bad(d, 'Guards waiting there! Grabbed!', 'caught') },
    ]),
  );
  return beat(
    ctx,
    'chase',
    { routes: routes.join(','), free, freeIfAlarm },
    [{ when: { alarmAtLeast: 2 }, text: 'HIGH ALERT! ' + hintFor(freeIfAlarm) }, { text: hintFor(free) }],
    options,
  );
}

export type BeamMode = 'leaving' | 'coming' | 'sweep';
export function searchlight(ctx: Ctx, mode: BeamMode): Beat {
  const d = ctx.dmg;
  const right: Record<BeamMode, string> = { leaving: 'sprint', coming: 'duck', sweep: 'pipe' };
  const text: Record<BeamMode, string> = {
    leaving: 'The searchlight swings AWAY across the roof.',
    coming: 'The searchlight swings TOWARD you. A chimney is close.',
    sweep: 'Two searchlights sweep the whole roof. A drainpipe hangs at the edge.',
  };
  const mk = (id: string, label: string, action: BeatOption['action'], spot: BeatOption['spot'], good: string) =>
    opt(id, label, action, spot, [right[mode] === id ? { out: ok(good) } : { out: bad(d, 'Lit up like a stage star! Spotted!', 'spotted') }]);
  return beat(ctx, 'searchlight', { mode }, [{ text: text[mode] }], [
    mk('sprint', 'Sprint across now', 'run', 'right', 'Across the roof behind the beam!'),
    mk('duck', 'Duck behind the chimney', 'hide', 'statue', 'The light passes over the chimney.'),
    mk('pipe', 'Slide down the drainpipe', 'pipe', 'pipe', 'Whee! Down the drainpipe, out of sight.'),
  ]);
}

export function laserCam(ctx: Ctx, laserMode: 'low' | 'high', zone: 'floor' | 'ledge'): Beat {
  const d = ctx.dmg;
  const move = laserMode === 'low' ? 'jump' : 'slide';
  const path = zone === 'floor' ? 'ledge' : 'floor';
  const mk = (m: 'jump' | 'slide', p: 'floor' | 'ledge') =>
    opt(`${m}-${p}`, `${m === 'jump' ? 'Jump' : 'Slide'} along the ${p}`, m, p, [
      ...powerRule(ctx, 'Power is off. Lasers and camera are dark.'),
      m === move && p === path
        ? { out: ok('Right height, right path. Flawless!') }
        : p !== path
          ? { out: bad(d, 'The camera catches you mid-move!', 'spotted') }
          : { out: bad(d, 'Wrong height - the laser zaps you!', 'zap') },
    ]);
  return beat(
    ctx,
    'laserCam',
    { laser: laserMode, zone },
    [...powerHint(ctx, 'Power is OFF - lasers and camera are dark.'), { text: `${laserHint(laserMode)} The camera watches the ${zone}.` }],
    [mk('jump', 'floor'), mk('slide', 'floor'), mk('jump', 'ledge'), mk('slide', 'ledge')],
  );
}

export function guardPlates(ctx: Ctx, g: 'toward' | 'away', safe: number): Beat {
  const d = ctx.dmg;
  const names = ['Back row', 'Middle row', 'Front row'];
  const options = names.map((n, i) =>
    opt(`row${i}`, `Cross on ${n.toLowerCase()}`, 'tiptoe', `row${i}` as BeatOption['spot'], [
      g === 'toward'
        ? { out: bad(d, 'The guard is coming this way - spotted on the tiles!', 'spotted') }
        : i === safe
          ? { out: ok('Clean tiles, quiet steps. Perfect.') }
          : { out: bad(d, 'Click! A pressure plate drops a net!', 'trap') },
    ]),
  );
  options.push(
    opt('statue', 'Hide behind the statue', 'hide', 'statue', [
      g === 'toward' ? { out: ok('Frozen behind the statue. The guard walks by.') } : { out: bad(d, 'The guard heads to the statue. Busted!', 'spotted') },
    ]),
  );
  return beat(
    ctx,
    'guardPlates',
    { guard: g, safe },
    [{ text: (g === 'toward' ? 'A guard walks YOUR way! ' : 'The guard strolls away toward the statue. ') + 'Gold-rimmed tiles are plates.' }],
    options,
  );
}
