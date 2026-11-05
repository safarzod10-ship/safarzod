// Procedural sound design with the Web Audio API (no audio files).
// The same graph is scheduled on a live AudioContext (button press) or on an
// OfflineAudioContext (to export a WAV for the video), so both are in sync
// with the animation timeline (times come from timeline.js).

import { rng } from './util.js';
import { T, SEQ_DURATION } from './timeline.js';

function noiseBuffer(ac, seconds, seed) {
  const r = rng(seed);
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}
function crackleBuffer(ac, seconds, seed, density) {
  const r = rng(seed);
  const sr = ac.sampleRate;
  const b = ac.createBuffer(1, Math.floor(sr * seconds), sr);
  const d = b.getChannelData(0);
  let i = 0;
  while (i < d.length) {
    i += Math.floor(sr / density * (0.2 + r() * 1.6));
    const amp = (0.3 + r() * 0.7) * (r() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (0.0015 + r() * 0.004));
    for (let j = 0; j < len && i + j < d.length; j++) d[i + j] += amp * Math.exp(-j / (len * 0.25)) * (r() * 2 - 1);
  }
  return b;
}
function impulse(ac, seconds, seed) {
  const r = rng(seed);
  const n = Math.floor(ac.sampleRate * seconds);
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, 3.2);
  }
  return b;
}
function shaper(ac, drive) {
  const s = ac.createWaveShaper();
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  s.curve = c; s.oversample = '4x';
  return s;
}
/** Piecewise-linear automation: pts = [[time, value], ...] relative to t0. */
function auto(param, t0, pts) {
  param.cancelScheduledValues(0);
  param.setValueAtTime(pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
}

export function scheduleDragonSound(ac, out, t0) {
  const nodes = [];
  const end = t0 + SEQ_DURATION + 0.5;
  const N = noiseBuffer(ac, 3, 7);
  const noise = (rate = 1) => {
    const s = ac.createBufferSource(); s.buffer = N; s.loop = true; s.playbackRate.value = rate;
    s.start(t0); s.stop(end); nodes.push(s); return s;
  };
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(end); nodes.push(o); return o; };
  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7, g = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };

  // master: light compression + small room reverb
  const master = gain(0.8);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const bus = gain(1);
  const verb = ac.createConvolver(); verb.buffer = impulse(ac, 1.6, 3);
  const wet = gain(0.22);
  bus.connect(comp); bus.connect(verb); verb.connect(wet); wet.connect(comp);
  comp.connect(master); master.connect(limiter); limiter.connect(out);

  // ---------- 1) low warning growl while the head goes back
  {
    const o = osc('sawtooth', 52), o2 = osc('sawtooth', 52.7);
    const lp = filt('lowpass', 260, 1.2);
    const am = gain(0.6), lfo = osc('sine', 17), lfoG = gain(0.4);
    lfo.connect(lfoG); lfoG.connect(am.gain);
    const g = gain(0);
    o.connect(am); o2.connect(am); am.connect(lp); lp.connect(g); g.connect(bus);
    auto(o.frequency, t0, [[1.0, 46], [2.2, 62], [2.4, 70]]);
    auto(o2.frequency, t0, [[1.0, 46.6], [2.2, 62.8], [2.4, 70.5]]);
    auto(g.gain, t0, [[0, 0], [1.05, 0], [1.6, 0.22], [2.25, 0.32], [2.5, 0]]);
  }

  // ---------- 2) the roar (synced with the jaw: opens 2.2 -> 2.45, closes ~3.85)
  {
    const f = [[T.jawOpen, 78], [2.42, 112], [2.62, 138], [3.0, 132], [3.45, 120], [3.8, 104], [4.05, 70]];
    const voices = [['sawtooth', 1], ['sawtooth', 1.012], ['square', 0.5], ['sawtooth', 2.03], ['triangle', 3.01]];
    const vg = [0.5, 0.45, 0.35, 0.22, 0.12];
    const am = gain(0.55), lfo = osc('sine', 31), lfoG = gain(0.45);
    lfo.connect(lfoG); lfoG.connect(am.gain);
    auto(lfo.frequency, t0, [[2.2, 24], [2.6, 34], [3.8, 27]]);
    voices.forEach(([type, mul], i) => {
      const o = osc(type, 100 * mul);
      auto(o.frequency, t0, f.map(([t, v]) => [t, v * mul]));
      const g = gain(vg[i]); o.connect(g); g.connect(am);
    });
    // breath / rasp layer
    const n = noise(1);
    const bp = filt('bandpass', 900, 0.6);
    const ng = gain(0.9); n.connect(bp); bp.connect(ng); ng.connect(am);
    const drive = shaper(ac, 3.2);
    const lp = filt('lowpass', 500, 0.9);
    auto(lp.frequency, t0, [[2.2, 400], [2.48, 2600], [3.6, 2200], [3.95, 500]]);
    const f1 = filt('peaking', 650, 1.4, 7), f2 = filt('peaking', 1150, 2, 5), f3 = filt('peaking', 2500, 2.5, 4);
    const g = gain(0);
    // robot voice: ring modulation + a short metallic comb resonance
    const ring = gain(0.6), rOsc = osc('sine', 155), rDepth = gain(0.4);
    rOsc.connect(rDepth); rDepth.connect(ring.gain);
    auto(rOsc.frequency, t0, [[2.2, 120], [2.6, 175], [3.8, 140]]);
    const comb = ac.createDelay(0.05); comb.delayTime.value = 0.0042;
    const fb = gain(0.62), wetC = gain(0.55);
    am.connect(drive); drive.connect(lp); lp.connect(f1); f1.connect(f2); f2.connect(f3); f3.connect(ring);
    ring.connect(g); ring.connect(comb); comb.connect(fb); fb.connect(comb); comb.connect(wetC); wetC.connect(g);
    g.connect(bus);
    auto(g.gain, t0, [[0, 0], [2.25, 0], [2.48, 0.42], [2.7, 0.38], [3.4, 0.34], [3.75, 0.28], [4.02, 0]]);
    // sub thump at the roar onset
    const sub = osc('sine', 60), sg = gain(0);
    auto(sub.frequency, t0, [[2.35, 70], [2.8, 42]]);
    auto(sg.gain, t0, [[0, 0], [2.36, 0], [2.42, 0.7], [2.9, 0]]);
    sub.connect(sg); sg.connect(bus);
  }

  // ---------- 3) inhale before the fire
  {
    const n = noise(0.9);
    const bp = filt('bandpass', 600, 1.4), hp = filt('highpass', 300);
    auto(bp.frequency, t0, [[T.inhale, 500], [4.45, 2600]]);
    const g = gain(0);
    auto(g.gain, t0, [[0, 0], [T.inhale, 0], [4.35, 0.45], [4.5, 0]]);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus);
  }

  // ---------- 4) fire breath
  {
    const fs = T.fireStart, fe = T.fireEnd;
    // whoosh at ignition
    const n1 = noise(1.1); const bp = filt('bandpass', 300, 0.9); const g1 = gain(0);
    auto(bp.frequency, t0, [[fs - 0.05, 250], [fs + 0.25, 3200], [fs + 0.6, 1200]]);
    auto(g1.gain, t0, [[0, 0], [fs - 0.06, 0], [fs + 0.08, 1.0], [fs + 0.6, 0.15], [fs + 0.9, 0]]);
    n1.connect(bp); bp.connect(g1); g1.connect(bus);
    // body of the flame: roaring filtered noise with flicker
    const n2 = noise(0.8); const lp = filt('lowpass', 1600, 0.8); const g2 = gain(0);
    const fl = osc('sine', 7), flG = gain(500); fl.connect(flG); flG.connect(lp.frequency);
    const flick = gain(1), fl2 = osc('sine', 13.3), fl2G = gain(0.18); fl2.connect(fl2G); fl2G.connect(flick.gain);
    auto(g2.gain, t0, [[0, 0], [fs - 0.02, 0], [fs + 0.12, 0.75], [fe - 0.3, 0.7], [fe + 0.15, 0]]);
    n2.connect(lp); lp.connect(flick); flick.connect(g2); g2.connect(bus);
    // deep rumble
    const n3 = noise(0.5); const lp3 = filt('lowpass', 150, 1); const g3 = gain(0);
    auto(g3.gain, t0, [[0, 0], [fs, 0], [fs + 0.15, 1.4], [fe - 0.2, 1.2], [fe + 0.2, 0]]);
    n3.connect(lp3); lp3.connect(g3); g3.connect(bus);
    const tone = osc('sawtooth', 48), tlp = filt('lowpass', 220), tg = gain(0);
    auto(tg.gain, t0, [[0, 0], [fs, 0], [fs + 0.15, 0.22], [fe - 0.2, 0.18], [fe + 0.1, 0]]);
    tone.connect(tlp); tlp.connect(tg); tg.connect(bus);
    // crackles
    const cs = ac.createBufferSource(); cs.buffer = crackleBuffer(ac, 4, 11, 55); cs.start(t0 + fs); cs.stop(end); nodes.push(cs);
    const chp = filt('highpass', 1100), cg = gain(0);
    auto(cg.gain, t0, [[0, 0], [fs, 0], [fs + 0.2, 0.55], [fe, 0.5], [7.2, 0]]);
    cs.connect(chp); chp.connect(cg); cg.connect(bus);
  }

  // ---------- 5) smoke puffs after the fire
  {
    const n = noise(1.3); const hp = filt('highpass', 2500, 0.7); const bp = filt('bandpass', 5200, 0.8); const g = gain(0);
    auto(g.gain, t0, [[0, 0], [6.35, 0], [6.45, 0.5], [6.75, 0.14], [6.9, 0.34], [7.35, 0]]);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus);
  }
  // ---------- 6) robot mechanics: servo whines, metal clanks, charge-up whine
  const servo = (ts, dur, f0, f1, vol) => {
    const o = osc('sawtooth', f0), o2 = osc('square', f0 * 1.5);
    const vib = osc('sine', 23), vg = gain(f0 * 0.012); vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    auto(o.frequency, t0, [[ts, f0], [ts + dur * 0.5, f1], [ts + dur, f1 * 0.92]]);
    auto(o2.frequency, t0, [[ts, f0 * 1.5], [ts + dur * 0.5, f1 * 1.5], [ts + dur, f1 * 1.38]]);
    const bp = filt('bandpass', 1400, 1.6), og = gain(0.35), g = gain(0);
    o2.connect(og); o.connect(bp); og.connect(bp); bp.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.06, vol], [ts + dur - 0.08, vol * 0.8], [ts + dur, 0]]);
  };
  servo(1.0, 0.75, 420, 760, 0.09);   // head goes back
  servo(1.3, 0.95, 300, 620, 0.08);   // wings unfold
  servo(3.9, 0.45, 520, 900, 0.07);   // head pulls back for the inhale
  servo(6.7, 1.2, 700, 380, 0.08);    // everything returns to rest
  const clank = (ts, f, vol, decay = 0.35) => {
    [1, 2.76, 5.4, 8.93].forEach((m, i) => {
      const o = osc(i % 2 ? 'triangle' : 'sine', f * m), g = gain(0);
      auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.003, vol / (i + 1)], [ts + decay / (1 + i * 0.6), 0]]);
      o.connect(g); g.connect(bus);
    });
    const n = noise(1.5), hp = filt('highpass', 3000), g = gain(0);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.002, vol * 0.8], [ts + 0.04, 0]]);
    n.connect(hp); hp.connect(g); g.connect(bus);
  };
  clank(2.3, 190, 0.32);              // wings lock open
  clank(T.jawOpen + 0.05, 240, 0.28); // jaw latch
  clank(4.08, 260, 0.22, 0.25);       // jaw half-closes
  clank(4.5, 900, 0.16, 0.12);        // igniter click
  clank(7.55, 210, 0.26);             // jaw shuts
  clank(7.85, 170, 0.2);              // wings fold home
  // charge-up whine while the reactor heats before the fire
  {
    const o = osc('sine', 300), o2 = osc('sine', 603), g = gain(0);
    auto(o.frequency, t0, [[T.inhale, 300], [4.5, 2200]]);
    auto(o2.frequency, t0, [[T.inhale, 603], [4.5, 4410]]);
    auto(g.gain, t0, [[0, 0], [T.inhale, 0], [4.4, 0.08], [4.56, 0]]);
    o.connect(g); o2.connect(g); g.connect(bus);
  }
  return nodes;
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return data.buffer;
}

export class DragonAudio {
  constructor() { this.ac = null; }
  play(delay = 0.05) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ac) this.ac = new AC();
    if (this.ac.state === 'suspended') this.ac.resume();
    scheduleDragonSound(this.ac, this.ac.destination, this.ac.currentTime + delay);
  }
  /** Render the whole soundtrack offline; `lead` = silence before the sequence. */
  async renderWavBase64(lead = 0, tail = 0.8) {
    const sr = 44100;
    const oac = new OfflineAudioContext(2, Math.ceil(sr * (lead + SEQ_DURATION + tail)), sr);
    scheduleDragonSound(oac, oac.destination, lead);
    const buf = await oac.startRendering();
    const bytes = new Uint8Array(encodeWav(buf));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}
