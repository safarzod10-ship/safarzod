// Procedural robo-dog sound (Web Audio API, no files): growl, two robotic barks,
// laser charge-up whine, twin-beam hum, impact crackle, power-down, steam, servos.
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

export function scheduleDogSound(ac, out, t0) {
  const end = t0 + SEQ_DURATION + 0.5;
  const N = noiseBuffer(ac, 3, 9);
  const noise = (rate = 1) => { const s = ac.createBufferSource(); s.buffer = N; s.loop = true; s.playbackRate.value = rate; s.start(t0); s.stop(end); return s; };
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(t0); o.stop(end); return o; };
  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7, g = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };

  const master = gain(0.8);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  const bus = gain(1), verb = ac.createConvolver(); verb.buffer = impulse(ac, 1.2, 5);
  const wet = gain(0.18);
  bus.connect(comp); bus.connect(verb); verb.connect(wet); wet.connect(comp);
  comp.connect(master); master.connect(limiter); limiter.connect(out);

  // robot voice chain: ring modulation + short metallic comb
  const robot = (input, outGain, ringF) => {
    const ring = gain(0.6), r = osc('sine', ringF), d = gain(0.4); r.connect(d); d.connect(ring.gain);
    const comb = ac.createDelay(0.05); comb.delayTime.value = 0.0031;
    const fb = gain(0.55), wc = gain(0.5);
    input.connect(ring); ring.connect(outGain); ring.connect(comb); comb.connect(fb); fb.connect(comb); comb.connect(wc); wc.connect(outGain);
  };

  // ---------- growl (crouch, 1.6 -> 2.4) and a short growl under the charge
  {
    const o = osc('sawtooth', 92), o2 = osc('sawtooth', 93.5);
    const am = gain(0.55), lfo = osc('sine', 26), lg = gain(0.45); lfo.connect(lg); lg.connect(am.gain);
    const lp = filt('lowpass', 700, 1.4), g = gain(0);
    o.connect(am); o2.connect(am); am.connect(lp);
    robot(lp, g, 130);
    g.connect(bus);
    auto(o.frequency, t0, [[1.6, 84], [2.3, 104], [2.4, 96]]);
    auto(g.gain, t0, [[0, 0], [1.65, 0], [1.95, 0.32], [2.35, 0.36], [2.45, 0], [3.1, 0], [3.4, 0.18], [3.8, 0.2], [3.9, 0]]);
  }
  // ---------- two barks
  const bark = (ts, pitch) => {
    const o = osc('sawtooth', pitch), o2 = osc('square', pitch * 1.5);
    auto(o.frequency, t0, [[ts, pitch * 1.35], [ts + 0.05, pitch * 1.1], [ts + 0.18, pitch * 0.72]]);
    auto(o2.frequency, t0, [[ts, pitch * 2.0], [ts + 0.05, pitch * 1.6], [ts + 0.18, pitch * 1.05]]);
    const n = noise(1.1), nb = filt('bandpass', 1400, 0.8), ng = gain(0.6);
    n.connect(nb); nb.connect(ng);
    const mix = gain(1), og2 = gain(0.35);
    o.connect(mix); o2.connect(og2); og2.connect(mix); ng.connect(mix);
    const drive = shaper(ac, 2.5), f1 = filt('peaking', 900, 1.5, 8), f2 = filt('peaking', 2100, 2, 5), lp = filt('lowpass', 3800);
    mix.connect(drive); drive.connect(f1); f1.connect(f2); f2.connect(lp);
    const g = gain(0);
    robot(lp, g, 210);
    g.connect(bus);
    auto(g.gain, t0, [[0, 0], [ts - 0.005, 0], [ts + 0.015, 0.55], [ts + 0.09, 0.42], [ts + 0.2, 0]]);
  };
  bark(T.bark1, 360);
  bark(T.bark2, 400);

  // ---------- laser charge-up whine
  {
    const o = osc('sine', 220), o2 = osc('triangle', 443), g = gain(0);
    const trem = osc('sine', 8), tg = gain(0.4), tremG = gain(0.6); trem.connect(tg); tg.connect(tremG.gain);
    auto(trem.frequency, t0, [[T.charge, 6], [T.laserOn, 38]]);
    auto(o.frequency, t0, [[T.charge, 220], [T.laserOn, 1900]]);
    auto(o2.frequency, t0, [[T.charge, 443], [T.laserOn, 3820]]);
    o.connect(tremG); o2.connect(tremG); tremG.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [T.charge, 0], [T.laserOn - 0.1, 0.16], [T.laserOn + 0.02, 0]]);
  }
  // ---------- twin beam: zap onset + buzzing hum
  {
    const on = T.laserOn, off = T.laserOff;
    const z = osc('sawtooth', 2400), zg = gain(0), zl = filt('lowpass', 5000);
    auto(z.frequency, t0, [[on - 0.02, 2600], [on + 0.18, 300]]);
    auto(zg.gain, t0, [[0, 0], [on - 0.02, 0], [on, 0.35], [on + 0.2, 0]]);
    z.connect(zl); zl.connect(zg); zg.connect(bus);
    const b1 = osc('sawtooth', 110), b2 = osc('sawtooth', 165.5), b3 = osc('square', 55);
    const am = gain(0.6), lfo = osc('sine', 60), lg = gain(0.4); lfo.connect(lg); lg.connect(am.gain);
    const bp = filt('bandpass', 900, 0.9), hp = filt('highpass', 120), g = gain(0);
    [b1, b2].forEach((o) => o.connect(am)); const sg = gain(0.4); b3.connect(sg); sg.connect(am);
    am.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus);
    const hi = osc('sine', 1760), vib = osc('sine', 9), vg = gain(30); vib.connect(vg); vg.connect(hi.frequency);
    const hg = gain(0); hi.connect(hg); hg.connect(bus);
    auto(g.gain, t0, [[0, 0], [on, 0], [on + 0.08, 0.85], [off - 0.1, 0.8], [off + 0.05, 0]]);
    auto(hg.gain, t0, [[0, 0], [on, 0], [on + 0.08, 0.06], [off, 0.05], [off + 0.05, 0]]);
    // impact crackle + sizzle while the beam burns the ground
    const cs = ac.createBufferSource(); cs.buffer = crackleBuffer(ac, 3, 21, 70); cs.start(t0 + on); cs.stop(end);
    const ch = filt('highpass', 1500), cg = gain(0);
    auto(cg.gain, t0, [[0, 0], [4.35, 0], [4.55, 0.5], [5.1, 0.3], [5.55, 0.55], [off, 0.45], [off + 0.3, 0]]);
    cs.connect(ch); ch.connect(cg); cg.connect(bus);
    // power-down
    const pd = osc('sawtooth', 900), pl = filt('lowpass', 2000), pg = gain(0);
    auto(pd.frequency, t0, [[off, 900], [off + 0.45, 60]]);
    auto(pg.gain, t0, [[0, 0], [off - 0.02, 0], [off + 0.02, 0.22], [off + 0.45, 0]]);
    pd.connect(pl); pl.connect(pg); pg.connect(bus);
  }
  // ---------- steam from the eyes
  {
    const n = noise(1.3), hp = filt('highpass', 2500), bp = filt('bandpass', 5500, 0.8), g = gain(0);
    auto(g.gain, t0, [[0, 0], [5.9, 0], [6.0, 0.32], [6.5, 0.12], [7.0, 0]]);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus);
  }
  // ---------- servos + clanks (shake rattle) + happy chirp at the end
  const servo = (ts, dur, f0, f1, vol) => {
    const o = osc('sawtooth', f0), bp = filt('bandpass', 1500, 1.6), g = gain(0);
    auto(o.frequency, t0, [[ts, f0], [ts + dur * 0.5, f1], [ts + dur, f1 * 0.92]]);
    o.connect(bp); bp.connect(g); g.connect(bus);
    auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.05, vol], [ts + dur - 0.06, vol * 0.8], [ts + dur, 0]]);
  };
  servo(1.0, 0.35, 700, 1100, 0.06);  // ears perk
  servo(1.6, 0.6, 380, 560, 0.06);    // crouch
  servo(3.1, 0.3, 900, 600, 0.05);    // ears flatten
  servo(6.3, 1.0, 600, 900, 0.05);    // stands up
  const clank = (ts, f, vol) => {
    [1, 2.76, 5.4].forEach((m, i) => {
      const o = osc('triangle', f * m), g = gain(0);
      auto(g.gain, t0, [[0, 0], [ts, 0], [ts + 0.003, vol / (i + 1)], [ts + 0.16 / (1 + i * 0.6), 0]]);
      o.connect(g); g.connect(bus);
    });
  };
  for (let i = 0; i < 6; i++) clank(T.shake + 0.07 + i * 0.066, 520 + (i % 2) * 140, 0.12);
  {
    const o = osc('sine', 900), g = gain(0);
    auto(o.frequency, t0, [[7.0, 900], [7.12, 1500], [7.2, 1200], [7.32, 1800]]);
    auto(g.gain, t0, [[0, 0], [6.98, 0], [7.02, 0.12], [7.2, 0.08], [7.36, 0]]);
    o.connect(g); g.connect(bus);
  }
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

export class DogAudio {
  constructor() { this.ac = null; }
  play(delay = 0.05) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ac) this.ac = new AC();
    if (this.ac.state === 'suspended') this.ac.resume();
    scheduleDogSound(this.ac, this.ac.destination, this.ac.currentTime + delay);
  }
  async renderWavBase64(lead = 0, tail = 0.8) {
    const sr = 44100;
    const oac = new OfflineAudioContext(2, Math.ceil(sr * (lead + SEQ_DURATION + tail)), sr);
    scheduleDogSound(oac, oac.destination, lead);
    const bytes = new Uint8Array(encodeWav(await oac.startRendering()));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}
