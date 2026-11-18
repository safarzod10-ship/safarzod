// The 30-level campaign. Each level: unique exhibit, unique room sequence and unique challenge mix.
// Difficulty ramps: single mechanics -> cross-beat dependencies (power, keycards, decoys, alert) -> 4-option combos
// with 2-damage mistakes in the endgame.
import type { Beat, Exhibit, Level, Phase, RoomStyle } from '../types.js';
import { decisionsForLevel } from '../engine.js';
import * as T from './templates.js';

type Make = (c: T.Ctx) => Beat;
type Step = [Phase, Make];

const I = (m: Make): Step => ['infiltrate', m];
const S = (m: Make): Step => ['steal', m];
const E = (m: Make): Step => ['escape', m];

const R4: T.Route[] = ['stairs', 'elevator', 'window', 'chute'];

// Preferred room styles per challenge (alternated by level for variety).
const ROOMS: Record<Beat['challenge'], RoomStyle[]> = {
  entry: ['courtyard'],
  laser: ['corridor', 'gallery'],
  camera: ['gallery', 'atrium'],
  guard: ['sculpture', 'gallery'],
  plates: ['atrium', 'gallery'],
  fusebox: ['basement', 'corridor'],
  keycard: ['office', 'library'],
  door: ['vault', 'corridor'],
  cat: ['library', 'office'],
  giftshop: ['shop', 'atrium'],
  case: ['vault', 'sculpture'],
  chase: ['stairwell', 'corridor'],
  searchlight: ['rooftop'],
  laserCam: ['gallery', 'corridor'],
  guardPlates: ['sculpture', 'atrium'],
};

export function mistakeDamage(level: number, phase: Phase): number {
  if (level >= 26) return phase === 'infiltrate' ? 1 : 2;
  if (level >= 16) return phase === 'escape' ? 2 : 1;
  return 1;
}

interface Spec {
  title: string;
  wing: string;
  exhibit: Exhibit;
  briefing: string;
  steps: Step[];
}

const ex = (name: string, shape: Exhibit['shape'], colorA: number, colorB: number): Exhibit => ({ name, shape, colorA, colorB });

const SPECS: Spec[] = [
  {
    title: 'First Night',
    wing: 'East Wing',
    exhibit: ex('The Sleepy Moon Vase', 'vase', 0xe8dcc0, 0x7fa88b),
    briefing: 'An easy start: one trick per room.',
    steps: [I((c) => T.entry(c, 'dock')), I((c) => T.laser(c, 'low')), S((c) => T.exhibitCase(c, 'motion')), E((c) => T.guard(c, 'away')), E((c) => T.chase(c, ['stairs', 'elevator', 'window'], 'stairs', 'window'))],
  },
  {
    title: 'Watching Eyes',
    wing: 'Portrait Hall',
    exhibit: ex('Crown of Seven Pears', 'crown', 0xd8b25a, 0x9fc9a8),
    briefing: 'Cameras look one way at a time.',
    steps: [I((c) => T.entry(c, 'window')), I((c) => T.camera(c, 'floor')), S((c) => T.exhibitCase(c, 'beam')), E((c) => T.laser(c, 'high')), E((c) => T.chase(c, ['stairs', 'elevator', 'window'], 'elevator', 'stairs'))],
  },
  {
    title: 'Golden Rims',
    wing: 'Mosaic Atrium',
    exhibit: ex('The Whistling Mask', 'mask', 0xc8694e, 0xe8dcc0),
    briefing: 'Pressure plates hide in plain sight.',
    steps: [I((c) => T.entry(c, 'skylight')), I((c) => T.plates(c, 2, 3)), S((c) => T.exhibitCase(c, 'beam')), E((c) => T.camera(c, 'ledge')), E((c) => T.chase(c, ['stairs', 'elevator', 'window'], 'window', 'elevator'))],
  },
  {
    title: 'Purr Patrol',
    wing: 'Old Library',
    exhibit: ex('The Golden Goose Egg', 'egg', 0xd8b25a, 0xf3ead6),
    briefing: 'Meet the museum cat. Escape over the roof.',
    steps: [I((c) => T.cat(c, false)), I((c) => T.laser(c, 'pulse')), S((c) => T.exhibitCase(c, 'motion')), E((c) => T.guard(c, 'statue')), E((c) => T.searchlight(c, 'leaving'))],
  },
  {
    title: 'Lights Out',
    wing: 'Machine Hall',
    exhibit: ex('The Mint Comet Gem', 'gem', 0x8fd3b6, 0x5e8f7a),
    briefing: 'Cutting power helps - until the backup kicks in.',
    steps: [I((c) => T.fusebox(c, false)), I((c) => T.laser(c, 'high')), S((c) => T.exhibitCase(c, 'beam')), E((c) => T.laser(c, 'low')), E((c) => T.chase(c, ['stairs', 'elevator', 'window'], 'stairs', 'window'))],
  },
  {
    title: 'The Keycard',
    wing: 'Staff Offices',
    exhibit: ex('Little Bronze Dancer', 'statuette', 0xb07a4f, 0xd8b25a),
    briefing: 'Some doors want a keycard.',
    steps: [I((c) => T.entry(c, 'dock')), I((c) => T.keycard(c, 'asleep', false)), I((c) => T.door(c, 'magnetic')), S((c) => T.exhibitCase(c, 'weight')), E((c) => T.guard(c, 'toward')), E((c) => T.chase(c, ['stairs', 'elevator', 'chute'], 'elevator', 'chute'))],
  },
  {
    title: 'Souvenir Run',
    wing: 'Gift Shop Arcade',
    exhibit: ex('Scroll of Endless Snacks', 'scroll', 0xf3ead6, 0xc8694e),
    briefing: 'A replica from the shop fools a weight sensor.',
    steps: [I((c) => T.giftshop(c, 'open')), I((c) => T.camera(c, 'both')), I((c) => T.plates(c, 0, 3)), S((c) => T.exhibitCase(c, 'weight')), E((c) => T.searchlight(c, 'coming')), E((c) => T.chase(c, ['stairs', 'window', 'chute'], 'chute', 'stairs'))],
  },
  {
    title: 'Wide Awake',
    wing: 'Reading Rooms',
    exhibit: ex('The Backwards Clock', 'clock', 0x7fa88b, 0xd8b25a),
    briefing: 'Not every fuse box is your friend. Stay quiet: alert changes the exits.',
    steps: [I((c) => T.cat(c, true)), I((c) => T.fusebox(c, true)), I((c) => T.camera(c, 'ledge')), S((c) => T.exhibitCase(c, 'motion')), E((c) => T.plates(c, 1, 3)), E((c) => T.chase(c, ['elevator', 'window', 'chute'], 'window', 'elevator'))],
  },
  {
    title: 'Four Ways',
    wing: 'Grand Gallery',
    exhibit: ex('The Jade Dragon Teapot', 'teapot', 0x7fa88b, 0xe8dcc0),
    briefing: 'Now with four choices. Read every clue.',
    steps: [I((c) => T.entry(c, 'window')), I((c) => T.laser(c, 'low', true)), I((c) => T.guard(c, 'radio', true)), S((c) => T.exhibitCase(c, 'heat', true)), E((c) => T.camera(c, 'floor', true)), E((c) => T.chase(c, R4, 'chute', 'stairs'))],
  },
  {
    title: 'Double Trouble',
    wing: 'Armory',
    exhibit: ex('Helmet of Sir Wobble', 'helmet', 0x9aa5a0, 0xc8694e),
    briefing: 'Lasers AND cameras in one room.',
    steps: [I((c) => T.keycard(c, 'stirring', true)), I((c) => T.door(c, 'brass')), I((c) => T.laserCam(c, 'low', 'floor')), S((c) => T.exhibitCase(c, 'beam', true)), E((c) => T.guardPlates(c, 'away', 2)), E((c) => T.chase(c, R4, 'stairs', 'elevator'))],
  },
  {
    title: 'Vault Fever',
    wing: 'Coin Vault',
    exhibit: ex('Coin of the Last Sunrise', 'coin', 0xd8b25a, 0xc8694e),
    briefing: 'The vault has its own lock.',
    steps: [I((c) => T.entry(c, 'skylight')), I((c) => T.fusebox(c, false)), I((c) => T.laserCam(c, 'high', 'ledge')), S((c) => T.door(c, 'magnetic')), S((c) => T.exhibitCase(c, 'motion', true)), E((c) => T.laser(c, 'pulse', true)), E((c) => T.chase(c, R4, 'elevator', 'window'))],
  },
  {
    title: 'True North',
    wing: 'Explorers Hall',
    exhibit: ex('The Honest Compass', 'compass', 0xc8694e, 0xf3ead6),
    briefing: 'The shop is barred - think around it.',
    steps: [I((c) => T.giftshop(c, 'barred')), I((c) => T.guard(c, 'statue', true)), I((c) => T.plates(c, 3, 4)), S((c) => T.camera(c, 'both', true)), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.searchlight(c, 'sweep')), E((c) => T.chase(c, R4, 'window', 'chute'))],
  },
  {
    title: 'Quiet Wishes',
    wing: 'Lantern Room',
    exhibit: ex('Lamp of Quiet Wishes', 'lamp', 0xd8b25a, 0x8fd3b6),
    briefing: 'A keycard is the quiet way into the vault.',
    steps: [I((c) => T.cat(c, true)), I((c) => T.keycard(c, 'asleep', false)), I((c) => T.camera(c, 'floor', true)), S((c) => T.door(c, 'magnetic')), S((c) => T.exhibitCase(c, 'heat', true)), E((c) => T.guardPlates(c, 'toward', 0)), E((c) => T.chase(c, ['stairs', 'elevator', 'chute'], 'chute', 'elevator'))],
  },
  {
    title: 'Starlight Strings',
    wing: 'Music Hall',
    exhibit: ex('The Starlight Harp', 'harp', 0xd8b25a, 0x7fa88b),
    briefing: 'Backup power makes the escape tricky.',
    steps: [I((c) => T.entry(c, 'dock')), I((c) => T.fusebox(c, true)), I((c) => T.laser(c, 'pulse', true)), S((c) => T.guard(c, 'toward', true)), S((c) => T.exhibitCase(c, 'beam', true)), E((c) => T.laserCam(c, 'low', 'ledge')), E((c) => T.searchlight(c, 'coming'))],
  },
  {
    title: 'Lost Islands',
    wing: 'Map Room',
    exhibit: ex('Globe of Lost Islands', 'globe', 0x8fd3b6, 0xc8694e),
    briefing: 'Everything you learned, in one night.',
    steps: [I((c) => T.keycard(c, 'asleep', true)), I((c) => T.giftshop(c, 'open')), I((c) => T.door(c, 'brass')), S((c) => T.plates(c, 1, 4)), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.camera(c, 'ledge', true)), E((c) => T.chase(c, R4, 'stairs', 'window'))],
  },
  {
    title: 'Grinning Crystal',
    wing: 'Hall of Curiosities',
    exhibit: ex('The Grinning Crystal Skull', 'skull', 0xbfe3d4, 0x8fd3b6),
    briefing: 'Escape mistakes now cost 2 HP.',
    steps: [I((c) => T.entry(c, 'window')), I((c) => T.fusebox(c, false)), I((c) => T.laserCam(c, 'low', 'floor')), S((c) => T.guardPlates(c, 'away', 0)), S((c) => T.exhibitCase(c, 'motion', true)), E((c) => T.laser(c, 'high', true)), E((c) => T.guard(c, 'radio', true)), E((c) => T.chase(c, R4, 'elevator', 'chute'))],
  },
  {
    title: 'Phoenix Rising',
    wing: 'Feather Gallery',
    exhibit: ex('The Phoenix Quill', 'feather', 0xc8694e, 0xd8b25a),
    briefing: 'A twitchy guard, a sharp drawer.',
    steps: [I((c) => T.cat(c, false)), I((c) => T.keycard(c, 'stirring', true)), I((c) => T.door(c, 'magnetic')), S((c) => T.laser(c, 'pulse', true)), S((c) => T.exhibitCase(c, 'heat', true)), E((c) => T.plates(c, 2, 4)), E((c) => T.searchlight(c, 'sweep')), E((c) => T.chase(c, R4, 'window', 'stairs'))],
  },
  {
    title: 'Tide Queen',
    wing: 'Ocean Wing',
    exhibit: ex('Ring of the Tide Queen', 'ring', 0x8fd3b6, 0xd8b25a),
    briefing: 'Barred shop, sweeping cameras, busy guards.',
    steps: [I((c) => T.giftshop(c, 'barred')), I((c) => T.camera(c, 'both', true)), I((c) => T.guard(c, 'away', true)), S((c) => T.door(c, 'brass')), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.laserCam(c, 'high', 'floor')), E((c) => T.guardPlates(c, 'toward', 1)), E((c) => T.chase(c, R4, 'chute', 'elevator'))],
  },
  {
    title: 'Twin Moons',
    wing: 'Night Sky Hall',
    exhibit: ex('The Twin-Moon Vase', 'vase', 0x5e8f7a, 0xf3ead6),
    briefing: 'An alarm-linked box guards a tile maze.',
    steps: [I((c) => T.entry(c, 'skylight')), I((c) => T.fusebox(c, true)), I((c) => T.plates(c, 0, 4)), S((c) => T.laserCam(c, 'low', 'ledge')), S((c) => T.exhibitCase(c, 'beam', true)), E((c) => T.camera(c, 'both', true)), E((c) => T.searchlight(c, 'leaving')), E((c) => T.chase(c, R4, 'stairs', 'chute'))],
  },
  {
    title: 'Paper King',
    wing: 'Royal Paper Court',
    exhibit: ex('Crown of the Paper King', 'crown', 0xf3ead6, 0xc8694e),
    briefing: 'No desk keycard tonight. Choose your door trick wisely.',
    steps: [I((c) => T.keycard(c, 'asleep', false)), I((c) => T.cat(c, true)), I((c) => T.door(c, 'magnetic')), S((c) => T.guard(c, 'statue', true)), S((c) => T.exhibitCase(c, 'motion', true)), E((c) => T.laser(c, 'low', true)), E((c) => T.guardPlates(c, 'away', 1)), E((c) => T.chase(c, R4, 'elevator', 'window'))],
  },
  {
    title: 'Laughing Owl',
    wing: 'Night Birds Gallery',
    exhibit: ex('Mask of the Laughing Owl', 'mask', 0x7fa88b, 0xd8b25a),
    briefing: 'Nine decisions. Every alert counts.',
    steps: [I((c) => T.entry(c, 'dock')), I((c) => T.fusebox(c, false)), I((c) => T.laser(c, 'high', true)), I((c) => T.camera(c, 'floor', true)), S((c) => T.door(c, 'brass')), S((c) => T.exhibitCase(c, 'heat', true)), E((c) => T.laserCam(c, 'high', 'ledge')), E((c) => T.guard(c, 'toward', true)), E((c) => T.chase(c, R4, 'window', 'elevator'))],
  },
  {
    title: 'Clockwork',
    wing: 'Automaton Hall',
    exhibit: ex('The Clockwork Egg', 'egg', 0xb07a4f, 0x8fd3b6),
    briefing: 'A shop decoy and a cranky guard.',
    steps: [I((c) => T.giftshop(c, 'open')), I((c) => T.keycard(c, 'stirring', false)), I((c) => T.door(c, 'brass')), I((c) => T.guardPlates(c, 'away', 2)), S((c) => T.camera(c, 'ledge', true)), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.plates(c, 3, 4)), E((c) => T.searchlight(c, 'coming')), E((c) => T.chase(c, R4, 'stairs', 'chute'))],
  },
  {
    title: 'Glacier Heart',
    wing: 'Frost Gallery',
    exhibit: ex('Heart of the Glacier', 'gem', 0xbfe3d4, 0x5e8f7a),
    briefing: 'Quiet entry, then the hardest tiles yet.',
    steps: [I((c) => T.cat(c, false)), I((c) => T.fusebox(c, true)), I((c) => T.laserCam(c, 'low', 'ledge')), I((c) => T.guard(c, 'radio', true)), S((c) => T.plates(c, 1, 4)), S((c) => T.exhibitCase(c, 'beam', true)), E((c) => T.laser(c, 'pulse', true)), E((c) => T.camera(c, 'both', true)), E((c) => T.chase(c, R4, 'elevator', 'stairs'))],
  },
  {
    title: 'Lost Socks',
    wing: 'Laundry Museum',
    exhibit: ex('The Saint of Lost Socks', 'statuette', 0xe8dcc0, 0x7fa88b),
    briefing: 'A keycard waits in a drawer. Do not waste it.',
    steps: [I((c) => T.entry(c, 'window')), I((c) => T.keycard(c, 'asleep', true)), I((c) => T.door(c, 'magnetic')), I((c) => T.laser(c, 'low', true)), S((c) => T.guardPlates(c, 'toward', 2)), S((c) => T.exhibitCase(c, 'motion', true)), E((c) => T.laserCam(c, 'low', 'floor')), E((c) => T.searchlight(c, 'sweep')), E((c) => T.chase(c, R4, 'chute', 'window'))],
  },
  {
    title: 'Nowhere Map',
    wing: 'Cartography Vault',
    exhibit: ex('Map Scroll to Nowhere', 'scroll', 0xd8b25a, 0x5e8f7a),
    briefing: 'Power cut early, magnetic vault later, no keycard in sight.',
    steps: [I((c) => T.giftshop(c, 'barred')), I((c) => T.fusebox(c, false)), I((c) => T.camera(c, 'both', true)), I((c) => T.laserCam(c, 'high', 'floor')), S((c) => T.door(c, 'magnetic')), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.guard(c, 'away', true)), E((c) => T.guardPlates(c, 'away', 0)), E((c) => T.chase(c, R4, 'window', 'stairs'))],
  },
  {
    title: 'Midnight Watch',
    wing: 'Clock Tower',
    exhibit: ex('The Midnight Pocket Watch', 'clock', 0xd8b25a, 0x5e8f7a),
    briefing: 'Final act. Steal and escape mistakes cost 2 HP.',
    steps: [I((c) => T.entry(c, 'skylight')), I((c) => T.cat(c, true)), I((c) => T.keycard(c, 'asleep', false)), I((c) => T.door(c, 'magnetic')), S((c) => T.laserCam(c, 'high', 'ledge')), S((c) => T.exhibitCase(c, 'heat', true)), E((c) => T.laser(c, 'pulse', true)), E((c) => T.guard(c, 'statue', true)), E((c) => T.searchlight(c, 'leaving')), E((c) => T.chase(c, R4, 'stairs', 'elevator'))],
  },
  {
    title: 'Thunder Tea',
    wing: 'Porcelain Gallery',
    exhibit: ex('The Thunder Teapot', 'teapot', 0xc8694e, 0x8fd3b6),
    briefing: 'The fuse box is a trap. The shop is your friend.',
    steps: [I((c) => T.giftshop(c, 'open')), I((c) => T.fusebox(c, true)), I((c) => T.laser(c, 'high', true)), I((c) => T.guardPlates(c, 'toward', 1)), S((c) => T.door(c, 'brass')), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.camera(c, 'floor', true)), E((c) => T.plates(c, 2, 4)), E((c) => T.laserCam(c, 'low', 'ledge')), E((c) => T.chase(c, R4, 'elevator', 'chute'))],
  },
  {
    title: 'Copper Knight',
    wing: 'Knights Hall',
    exhibit: ex('Helm of the Copper Knight', 'helmet', 0xb07a4f, 0xd8b25a),
    briefing: 'A twitchy guard sleeps next to an open drawer.',
    steps: [I((c) => T.entry(c, 'dock')), I((c) => T.keycard(c, 'stirring', true)), I((c) => T.fusebox(c, false)), I((c) => T.door(c, 'magnetic')), S((c) => T.camera(c, 'ledge', true)), S((c) => T.exhibitCase(c, 'beam', true)), E((c) => T.guardPlates(c, 'away', 1)), E((c) => T.laser(c, 'low', true)), E((c) => T.searchlight(c, 'coming')), E((c) => T.chase(c, R4, 'window', 'stairs'))],
  },
  {
    title: 'Infinity Coin',
    wing: 'Treasury',
    exhibit: ex('The Infinity Coin', 'coin', 0xbfe3d4, 0xd8b25a),
    briefing: 'The longest night yet. Patience wins.',
    steps: [I((c) => T.cat(c, false)), I((c) => T.giftshop(c, 'barred')), I((c) => T.laserCam(c, 'low', 'floor')), I((c) => T.guard(c, 'radio', true)), S((c) => T.plates(c, 3, 4)), S((c) => T.exhibitCase(c, 'weight', true)), E((c) => T.camera(c, 'both', true)), E((c) => T.laserCam(c, 'high', 'floor')), E((c) => T.guard(c, 'toward', true)), E((c) => T.chase(c, R4, 'chute', 'window'))],
  },
  {
    title: 'The Star of Everything',
    wing: 'Crown Jewel Vault',
    exhibit: ex('The Star of Everything', 'gem', 0xd8b25a, 0xc8694e),
    briefing: 'The grand finale. Every lesson counts.',
    steps: [I((c) => T.entry(c, 'window')), I((c) => T.keycard(c, 'asleep', true)), I((c) => T.fusebox(c, false)), I((c) => T.door(c, 'magnetic')), S((c) => T.laserCam(c, 'low', 'ledge')), S((c) => T.exhibitCase(c, 'motion', true)), E((c) => T.guardPlates(c, 'toward', 0)), E((c) => T.laser(c, 'high', true)), E((c) => T.searchlight(c, 'sweep')), E((c) => T.chase(c, R4, 'stairs', 'elevator'))],
  },
];

function challengeOf(make: Make): Beat['challenge'] {
  // Build once with a dummy context to read the challenge kind.
  return make({ id: 'probe', phase: 'infiltrate', room: { style: 'gallery', seed: 0, wall: 0 }, dmg: 1 }).challenge;
}

function build(): Level[] {
  return SPECS.map((spec, idx) => {
    const n = idx + 1;
    const beats = spec.steps.map(([phase, make], i) => {
      const kind = challengeOf(make);
      const styles = ROOMS[kind];
      const style = styles[(n + i) % styles.length]!;
      return make({
        id: `L${n}B${i + 1}`,
        phase,
        dmg: mistakeDamage(n, phase),
        room: { style, seed: n * 1000 + i * 37 + 11, wall: (n * 3 + i) % 6 },
      });
    });
    return { n, title: spec.title, wing: spec.wing, exhibit: spec.exhibit, briefing: spec.briefing, beats };
  });
}

export const LEVELS: Level[] = build();
export const LEVEL_COUNT = LEVELS.length;

export function getLevel(n: number): Level {
  const l = LEVELS[n - 1];
  if (!l) throw new Error(`no level ${n}`);
  return l;
}

export { decisionsForLevel };
