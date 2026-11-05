// Procedural robo-cheetah sound (Web Audio API, no files): purr, growl, electric
// charge, pounce whoosh, two claw slashes, landings, dash, roar, servos.
// The same graph runs live or in an OfflineAudioContext (WAV for the video).

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
  const r = rng(seed), sr = ac.sampleRate;
  const b = ac.createBuffer(1, Math.floor(sr * seconds), sr), d = b.getChannelData(0);
  let i = 0;
  while (i < d.length) {
    i += Math.floor(sr / density * (0.2 + r() * 1.6));
    const amp = (0.3 + r() * 0.7) * (r() < 0.5 ? -1 : 1), len = Math.floor(sr * (0.001 + r() * 0.003));
    for (let j = 0; j < len && i + j < d.length; j++) d[i + j] += amp * Math.exp(-j / (len * 0.25)) * (r() * 2 - 1);
  }
  return b;
}
function impulse(ac, seconds, seed) {
  const r = rng(seed), n = Math.floor(ac.sampleRate * seconds);
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, 3.4); }
  return b;
}
function shaper(ac, drive) {
  const s = ac.createWaveShaper(), n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  s.curve = c; s.oversample = '4x'; return s;
}
function auto(param, t0, pts) {
  param.cancelScheduledValues(0);
  param.setValueAtTime(pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
}

export function scheduleCheetahSound(ac, out, t0) {
  const end = t0 + SEQ_DURATION + 0.5;
  const N = noiseBuffer(ac, 3, 13);
  const noise = (rate = 1) => { const s = ac.createBufferSource(); s.buffer = N; s.loop = true; s.playbackRate.value = rate; s.start(t0); s.stop(end); return s; };
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(end); return o; };
  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7, g = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };

  const master = gain(0.8);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const bus = gain(1), verb = ac.createConvolver(); verb.buffer = impulse(ac, 1.3, 6);
  const wet = gain(0.18);
  bus.connect(comp); bus.connect(verb); verb.connect(wet); wet.connect(comp);
  comp.connect(master); master.connect(limiter); limiter.connect(out);
  const robot = (input, outGain, ringF) => {
    const ring = gain(0.6), r = osc('sine', ringF), d = gain(0.4); r.connect(d); d.connect(ring.gain);
    const comb = ac.createDelay(0.05); comb.delayTime.value = 0.0036;
    const fb = gain(0.55), wc = gain(0.5);
    input.connect(ring); ring.connect(outGain); ring.connect(comb); comb.connect(fb); fb.connect(comb); comb.connect(wc); wc.connect(outGain);
  };

  // ---------- mechanical purr while calm
  {
    const n = noise(0.6), lp = filt('lowpass', 260, 1), am = gain(0.5), lfo = osc('sine', 24), lg = gain(0.5);
    lfo.connect(lg); lg.connect(am.gain);
    const g = gain(0); n.connect(lp); lp.connect(am); am.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [0.05, 0.35], [0.85, 0.3], [1.05, 0], [6.6, 0], [6.9, 0.25], [7.5, 0]]);
  }
  // ---------- stalking growl
  {
    const o = osc('sawtooth', 120), o2 = osc('sawtooth', 121.6);
    const am = gain(0.55), lfo = osc('sine', 30), lg = gain(0.45); lfo.connect(lg); lg.connect(am.gain);
    const lp = filt('lowpass', 900, 1.3), g = gain(0);
    o.connect(am); o2.connect(am); am.connect(lp); robot(lp, g, 150); g.connect(bus);
    auto(o.frequency, t0, [[T.stalk, 100], [2.5, 140]]);
    auto(o2.frequency, t0, [[T.stalk, 101.5], [2.5, 142]]);
    auto(g.gain, t0, [[0, 0], [T.stalk, 0], [1.6, 0.3], [2.5, 0.36], [2.62, 0]]);
  }
  // ---------- electric charge: buzzing crackle rising
  {
    const o = osc('sawtooth', 60), am = gain(0.5), lfo = osc('square', 18), lg = gain(0.5);
    lfo.connect(lg); lg.connect(am.gain); auto(lfo.frequency, t0, [[T.charge, 12], [2.6, 44]]);
    const bp = filt('bandpass', 1200, 1.2), g = gain(0);
    auto(bp.frequency, t0, [[T.charge, 700], [2.6, 3200]]);
    o.connect(am); am.connect(bp); bp.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [T.charge, 0], [2.5, 0.3], [2.62, 0], [3.5, 0], [3.6, 0.12], [4.4, 0]]);
    const cs = ac.createBufferSource(); cs.buffer = crackleBuffer(ac, 3, 31, 45); cs.start(t0 + T.charge); cs.stop(end);
    const ch = filt('highpass', 2000), cg = gain(0);
    auto(cg.gain, t0, [[0, 0], [T.charge, 0], [2.55, 0.5], [3.6, 0.35], [4.4, 0]]);
    cs.connect(ch); ch.connect(cg); cg.connect(bus);
  }
  // ---------- whooshes (pounce + dash back)
  const whoosh = (ts, dur, vol) => {
    const n = noise(1.2), bp = filt('bandpass', 400, 1.1), g = gain(0);
    auto(bp.frequency, t0, [[ts, 300], [ts + dur * 0.5, 2600], [ts + dur, 700]]);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + dur * 0.4, vol], [ts + dur, 0]]);
    n.connect(bp); bp.connect(g); g.connect(bus);
  };
  whoosh(T.pounce - 0.04, 0.36, 0.7);
  whoosh(T.dashBack, 0.34, 0.55);
  // ---------- landings (metal thud)
  const thud = (ts, vol) => {
    const o = osc('sine', 90), g = gain(0);
    auto(o.frequency, t0, [[ts, 130], [ts + 0.15, 45]]);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.005, vol], [ts + 0.22, 0]]);
    o.connect(g); g.connect(bus);
    [1, 2.7, 5.2].forEach((m, i) => { const p = osc('triangle', 330 * m), pg = gain(0); auto(pg.gain, t0, [[0, 0], [ts, 0], [ts + 0.003, vol * 0.25 / (i + 1)], [ts + 0.14, 0]]); p.connect(pg); pg.connect(bus); });
  };
  thud(T.land, 0.8);
  thud(T.home, 0.6);
  // ---------- claw slashes: metallic "shing" + electric zap
  const shing = (ts) => {
    const n = noise(1.5), hp = filt('highpass', 3000), bp = filt('bandpass', 6500, 3), g = gain(0);
    auto(g.gain, t0, [[0, 0], [ts - 0.01, 0], [ts + 0.01, 0.8], [ts + 0.22, 0]]);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus);
    [3100, 4650, 7300].forEach((f, i) => { const o = osc('sine', f), og = gain(0); auto(og.gain, t0, [[0, 0], [ts, 0], [ts + 0.004, 0.16 / (i + 1)], [ts + 0.5 / (i + 1), 0]]); o.connect(og); og.connect(bus); });
    const z = osc('sawtooth', 1800), zl = filt('lowpass', 6000), zg = gain(0);
    auto(z.frequency, t0, [[ts, 2400], [ts + 0.12, 200]]);
    auto(zg.gain, t0, [[0, 0], [ts, 0], [ts + 0.005, 0.28], [ts + 0.14, 0]]);
    z.connect(zl); zl.connect(zg); zg.connect(bus);
  };
  shing(T.slash1);
  shing(T.slash2);
  // ---------- roar
  {
    const f = [[T.roar, 160], [5.15, 240], [5.5, 210], [5.85, 150]];
    const am = gain(0.55), lfo = osc('sine', 34), lg = gain(0.45); lfo.connect(lg); lg.connect(am.gain);
    [['sawtooth', 1], ['sawtooth', 1.013], ['square', 0.5], ['sawtooth', 2.02]].forEach(([type, m], i) => {
      const o = osc(type, 200 * m); auto(o.frequency, t0, f.map(([t, v]) => [t, v * m]));
      const g = gain([0.5, 0.45, 0.3, 0.2][i]); o.connect(g); g.connect(am);
    });
    const n = noise(1), bp = filt('bandpass', 1500, 0.6), ng = gain(0.8); n.connect(bp); bp.connect(ng); ng.connect(am);
    const drive = shaper(ac, 3), lp = filt('lowpass', 3200), f1 = filt('peaking', 800, 1.4, 7), f2 = filt('peaking', 1800, 2, 5), g = gain(0);
    am.connect(drive); drive.connect(lp); lp.connect(f1); f1.connect(f2); robot(f2, g, 180); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [5.0, 0], [5.15, 0.42], [5.55, 0.36], [5.85, 0]]);
  }
  // ---------- servos
  const servo = (ts, dur, f0, f1, vol) => {
    const o = osc('sawtooth', f0), bp = filt('bandpass', 1500, 1.6), g = gain(0);
    auto(o.frequency, t0, [[ts, f0], [ts + dur * 0.5, f1], [ts + dur, f1 * 0.92]]);
    o.connect(bp); bp.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.05, vol], [ts + dur - 0.06, vol * 0.8], [ts + dur, 0]]);
  };
  servo(0.9, 0.3, 800, 1200, 0.05);
  servo(1.25, 0.45, 420, 600, 0.06);
  servo(5.9, 1.0, 600, 900, 0.05);
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
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return data.buffer;
}


export class CheetahAudio {
  constructor() { this.ac = null; }
  play(delay = 0.05) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ac) this.ac = new AC();
    if (this.ac.state === 'suspended') this.ac.resume();
    scheduleCheetahSound(this.ac, this.ac.destination, this.ac.currentTime + delay);
  }
  async renderWavBase64(lead = 0, tail = 0.8) {
    const sr = 44100;
    const oac = new OfflineAudioContext(2, Math.ceil(sr * (lead + SEQ_DURATION + tail)), sr);
    scheduleCheetahSound(oac, oac.destination, lead);
    const bytes = new Uint8Array(encodeWav(await oac.startRendering()));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}
