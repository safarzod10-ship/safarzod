// Generates ALL built-in audio from scratch (no third-party samples, no licensing questions):
//  - two music loops synthesized in code, - sound effects synthesized in code,
//  - robot voice lines rendered with espeak-ng (GPL tool; its output is free to use) + FFmpeg robot filter.
// Output: public/audio/{music,sfx,voice}/*.ogg + manifest.json. Requires: ffmpeg, espeak-ng.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SR = 44100;
const OUT = resolve('public/audio');
const TMP = join(tmpdir(), 'hvc-audio');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
for (const d of ['music', 'sfx', 'voice']) mkdirSync(join(OUT, d), { recursive: true });

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function wav(path: string, ch: Float32Array[]): void {
  const n = ch[0]!.length;
  const nc = ch.length;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * nc * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * nc * 2, 28);
  buf.writeUInt16LE(nc * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * nc * 2, 40);
  let peak = 0;
  for (const c of ch) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ch[c]![i]! * g)) * 32767), 44 + (i * nc + c) * 2);
  writeFileSync(path, buf);
}

function toOgg(src: string, dst: string, q = 4): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libvorbis', '-q:a', String(q), dst]);
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------------------- music

function music(name: string, bpm: number, chords: number[][], bars: number, tense: boolean): void {
  const beat = 60 / bpm;
  const len = Math.round(bars * 4 * beat * SR);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const add = (i: number, v: number, pan = 0) => {
    if (i < 0 || i >= len) return;
    L[i]! += v * (1 - pan) * 0.5 + v * 0.5 * (pan < 0 ? 1 : 1 - pan);
    R[i]! += v * (1 + pan) * 0.5 + v * 0.5 * (pan > 0 ? 1 : 1 + pan);
  };
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % chords.length]!;
    const t0 = Math.round(bar * 4 * beat * SR);
    const barLen = Math.round(4 * beat * SR);
    // warm pad (detuned triangles, slow attack/release)
    for (const [k, m] of chord.entries()) {
      for (const det of [-0.12, 0.1]) {
        const f = mtof(m + det);
        for (let i = 0; i < barLen; i++) {
          const t = i / SR;
          const env = Math.min(1, t / 0.6) * Math.min(1, (barLen - i) / SR / 0.5);
          const ph = (f * t) % 1;
          const tri = 4 * Math.abs(ph - 0.5) - 1;
          add(t0 + i, tri * 0.035 * env, k % 2 ? 0.3 : -0.3);
        }
      }
    }
    // bass
    const root = chord[0]! - 12;
    const steps = tense ? 8 : 2;
    for (let s = 0; s < steps; s++) {
      const st = t0 + Math.round((s * 4 * beat * SR) / steps);
      const dur = Math.round(((4 * beat) / steps) * SR * 0.9);
      const f = mtof(root);
      for (let i = 0; i < dur; i++) {
        const t = i / SR;
        add(st + i, Math.sin(2 * Math.PI * f * t) * 0.16 * Math.exp(-t * (tense ? 6 : 1.5)));
      }
    }
    // plucked arpeggio (soft sine + decay), pentatonic-ish over chord tones
    const notes = tense ? 8 : 6;
    for (let s = 0; s < notes; s++) {
      if (!tense && rnd() < 0.25) continue;
      const st = t0 + Math.round((s * 4 * beat * SR) / notes);
      const m = chord[(s * 2 + bar) % chord.length]! + 12 + (rnd() < 0.3 ? 12 : 0);
      const f = mtof(m);
      const dur = Math.round(SR * 0.9);
      const pan = rnd() * 1.2 - 0.6;
      for (let i = 0; i < dur; i++) {
        const t = i / SR;
        add(st + i, (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * 0.06 * Math.exp(-t * 4.5), pan);
      }
    }
    // soft percussion: brushed hats + felt kick
    for (let s = 0; s < 8; s++) {
      const st = t0 + Math.round((s * beat * SR) / 2);
      const hat = Math.round(SR * 0.08);
      const amp = s % 2 ? 0.035 : 0.02;
      for (let i = 0; i < hat; i++) add(st + i, (rnd() * 2 - 1) * amp * Math.exp(-i / SR / 0.02), 0.2);
      if (s % 4 === 0 || (tense && s % 2 === 0)) {
        for (let i = 0; i < SR * 0.25; i++) {
          const t = i / SR;
          add(st + i, Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 30)) * t) * 0.22 * Math.exp(-t * 12));
        }
      }
    }
  }
  // gentle loop crossfade so the seam is invisible
  const xf = Math.round(SR * 0.05);
  for (let i = 0; i < xf; i++) {
    const g = i / xf;
    L[i]! *= g;
    R[i]! *= g;
    L[len - 1 - i]! *= g;
    R[len - 1 - i]! *= g;
  }
  const w = join(TMP, `${name}.wav`);
  wav(w, [L, R]);
  toOgg(w, join(OUT, 'music', `${name}.ogg`), 5);
}

// ------------------------------------------------------------------------------------------ sfx

type Gen = (t: number, i: number) => number;
function sfx(name: string, dur: number, gen: Gen): void {
  const n = Math.round(dur * SR);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = gen(i / SR, i);
  // short fade out
  for (let i = 0; i < Math.min(400, n); i++) a[n - 1 - i]! *= i / 400;
  const w = join(TMP, `${name}.wav`);
  wav(w, [a]);
  toOgg(w, join(OUT, 'sfx', `${name}.ogg`), 4);
}
const sin = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
const noise = () => rnd() * 2 - 1;
const env = (t: number, a: number, d: number) => Math.min(1, t / a) * Math.exp(-t / d);
const notes = (seq: [number, number][], t: number, wave: (f: number, t: number) => number = sin) => {
  let v = 0;
  for (const [m, st] of seq) if (t >= st) v += wave(mtof(m), t - st) * env(t - st, 0.005, 0.18);
  return v;
};

function makeSfx(): void {
  sfx('step', 0.12, (t) => noise() * env(t, 0.002, 0.02) * 0.5 + sin(90, t) * env(t, 0.002, 0.03));
  sfx('success', 0.7, (t) => notes([[76, 0], [79, 0.08], [84, 0.16]], t) * 0.5);
  sfx('zap', 0.6, (t) => (Math.sign(sin(80 + 900 * Math.exp(-t * 6), t)) * 0.3 + noise() * 0.4) * env(t, 0.003, 0.15));
  sfx('alarm', 1.4, (t) => Math.sign(sin(t % 0.5 < 0.25 ? 880 : 660, t)) * 0.18 * Math.min(1, t / 0.02) * Math.min(1, (1.4 - t) / 0.1));
  sfx('trap', 0.8, (t) => (noise() * 0.5 * env(t, 0.002, 0.05) + sin(120 * (1 - t * 0.5), t) * env(t, 0.01, 0.25)));
  sfx('thud', 0.5, (t) => sin(70 + 40 * Math.exp(-t * 20), t) * env(t, 0.002, 0.12) + noise() * env(t, 0.001, 0.02) * 0.3);
  sfx('meow', 0.8, (t) => sin(600 + 300 * Math.sin(t * 6) - t * 200, t) * Math.sin(Math.PI * Math.min(1, t / 0.8)) * 0.4 * (1 + 0.3 * sin(1200, t)));
  sfx('shield', 0.9, (t) => (sin(523 + t * 400, t) + sin(784 + t * 400, t)) * env(t, 0.02, 0.35) * 0.35);
  sfx('click', 0.08, (t) => noise() * env(t, 0.0005, 0.008));
  sfx('lever', 0.5, (t) => noise() * env(t, 0.001, 0.03) * 0.6 + (t > 0.18 ? noise() * env(t - 0.18, 0.001, 0.02) * 0.8 + sin(150, t) * env(t - 0.18, 0.001, 0.06) : 0));
  sfx('pickup', 0.45, (t) => notes([[84, 0], [91, 0.07]], t, (f, x) => Math.sign(sin(f, x)) * 0.3) * 0.6);
  sfx('clang', 0.6, (t) => (sin(320, t) + sin(737, t) * 0.6 + sin(1250, t) * 0.3) * env(t, 0.001, 0.12) * 0.5);
  sfx('beep', 0.35, (t) => (t < 0.12 ? sin(1320, t) : t > 0.16 ? sin(1760, t) : 0) * 0.35);
  sfx('unlock', 0.5, (t) => noise() * env(t, 0.001, 0.015) + (t > 0.25 ? noise() * env(t - 0.25, 0.001, 0.02) + sin(260, t) * env(t - 0.25, 0.001, 0.08) : 0));
  sfx('coin', 0.6, (t) => (sin(1976, t) + sin(2637, t) * 0.6) * env(t, 0.001, 0.15) * 0.4);
  sfx('fan', 1.0, (t) => noise() * 0.25 * Math.sin(Math.PI * t) * (0.6 + 0.4 * sin(30, t)));
  sfx('swap', 0.5, (t) => noise() * 0.2 * Math.sin(Math.PI * t * 2) + sin(400 + 400 * t, t) * env(t, 0.05, 0.2) * 0.3);
  sfx('steal', 1.3, (t) => notes([[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [88, 0.5]], t, (f, x) => sin(f, x) + 0.4 * sin(f * 2, x)) * 0.4);
  sfx('ding', 0.9, (t) => (sin(1046, t) + sin(1318, t)) * env(t, 0.002, 0.3) * 0.3);
  sfx('vote_open', 0.6, (t) => notes([[67, 0], [72, 0.1]], t) * 0.45);
  sfx('tick', 0.1, (t) => sin(1500, t) * env(t, 0.001, 0.02) * 0.6);
  sfx('result', 0.6, (t) => (sin(110, t) * env(t, 0.003, 0.15) + noise() * env(t, 0.001, 0.05) * 0.3) * 0.9);
  sfx('level_complete', 2.4, (t) =>
    notes([[72, 0], [76, 0.15], [79, 0.3], [84, 0.45], [79, 0.75], [84, 0.9], [88, 1.05], [91, 1.25]], t, (f, x) => sin(f, x) + 0.35 * sin(f * 2, x)) * 0.35,
  );
  sfx('defeat', 1.6, (t) => sin(400 * Math.exp(-t * 1.2), t) * env(t, 0.01, 0.8) * 0.4 + Math.sign(sin(60, t)) * env(t, 0.01, 0.3) * 0.08);
  sfx('whoosh', 0.9, (t) => noise() * Math.sin(Math.PI * Math.min(1, t / 0.9)) * 0.35);
}

// ---------------------------------------------------------------------------------------- voice

const LINES: Record<string, string[]> = {
  intro: ['Okay team. New museum, new plan.', 'Lights low. Wheels quiet. Let us go.', 'Another night, another treasure.', 'I can do this. Probably.'],
  vote: ['Hmm. Which way, chat?', 'Your call, chat.', 'Read the clue, then vote!', 'I trust you. Mostly.', 'Numbers in chat, please!'],
  success: ['Smooth!', 'Nailed it.', 'Like a shadow.', 'Too easy.', 'Beep boop, perfect.'],
  hurt: ['Ouch!', 'That tickled. Not really.', 'My circuits!', 'Ow, ow, ow.', 'Note to self: bad idea.'],
  noisy: ['Oops. That was loud.', 'Shh, shh, shh!', 'Did anyone hear that?'],
  steal: ['Got it!', 'The prize is mine!', 'Treasure acquired!', 'Shiny! Now run!'],
  escape: ['Time to run!', 'Exit, exit, exit!', 'Alarm mode! Move it!'],
  defeat: ['Rebooting.', 'System down. Trying again.', 'I will be back.'],
  level: ['Heist complete!', 'Another one for the collection!', 'Easy money. Well, no money.'],
  campaign: ['We stole the whole museum! Again!', 'Thirty treasures! You are amazing, chat.'],
  shield: ['Shield up!', 'Blocked it!'],
  scan: ['Scanning. Beep.', 'Scanner says: look at this.'],
  revive: ['I am back online!', 'Fresh batteries!'],
  chaos: ['Uh oh. Chaos!', 'What is happening?'],
  auto: ['Nobody voting? I will pick.', 'Robot instinct it is.', 'Quiet chat. I decide.'],
  revote: ['Wait, wait. Vote again!', 'Do over!'],
};

function makeVoice(manifest: Record<string, string[]>): void {
  for (const [ev, lines] of Object.entries(LINES)) {
    manifest[ev] = [];
    lines.forEach((text, i) => {
      const raw = join(TMP, `v-${ev}-${i}.wav`);
      execFileSync('espeak-ng', ['-v', 'en-us+Annie', '-p', '62', '-s', '155', '-a', '160', '-w', raw, text]);
      const out = `${ev}-${i + 1}.ogg`;
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', raw,
        '-af', 'asetrate=22050*1.12,aresample=44100,highpass=f=140,lowpass=f=7500,chorus=0.7:0.9:35|45:0.35|0.3:0.3|0.4:1.8|1.2,aecho=0.85:0.5:18:0.2,volume=1.6,alimiter=limit=0.9',
        '-c:a', 'libvorbis', '-q:a', '4', join(OUT, 'voice', out),
      ]);
      manifest[ev]!.push(`/audio/voice/${out}`);
    });
  }
}

function main(): void {
  for (const tool of ['ffmpeg', 'espeak-ng']) {
    try {
      execFileSync(tool, [tool === 'ffmpeg' ? '-version' : '--version'], { stdio: 'ignore' });
    } catch {
      console.error(`${tool} is required`);
      process.exit(1);
    }
  }
  // C major-ish lounge loop and a tense A minor escape loop
  music('calm', 84, [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 69]], 16, false);
  music('escape', 112, [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], 16, true);
  makeSfx();
  const voice: Record<string, string[]> = {};
  makeVoice(voice);
  const sfxNames = ['step', 'success', 'zap', 'alarm', 'trap', 'thud', 'meow', 'shield', 'click', 'lever', 'pickup', 'clang', 'beep', 'unlock', 'coin', 'fan', 'swap', 'steal', 'ding', 'vote_open', 'tick', 'result', 'level_complete', 'defeat', 'whoosh'];
  const manifest = {
    generated: 'tools/gen-audio.ts - all sounds synthesized, voices by espeak-ng',
    music: ['/audio/music/calm.ogg', '/audio/music/escape.ogg'],
    sfx: Object.fromEntries(sfxNames.filter((n) => existsSync(join(OUT, 'sfx', `${n}.ogg`))).map((n) => [n, `/audio/sfx/${n}.ogg`])),
    voice,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  rmSync(TMP, { recursive: true, force: true });
  console.log(`audio generated: ${Object.keys(manifest.sfx).length} sfx, ${Object.values(voice).flat().length} voice lines, 2 music loops`);
}

main();
