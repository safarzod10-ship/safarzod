// Web Audio: decoded buffers for effects, streamed <audio> elements for long tracks.
const LONG = new Set(["Akari_Calm_ChineseStreet", "Casualty_LOOP_1", "Casualty_LOOP_2", "Casualty_LOOP_3", "Cyberpunk_ChineseStreet", "Cyberpunk_ChineseStreet_Alternative",
  "Cyberpunk_ExclusionZone", "Cyberpunk_Industrial", "Cyberpunk_Lab", "Cyberpunk_Prison", "Cyberpunk_Race", "Cyberpunk_SnowCity", "Cyberpunk_SnowCity_Alternative", "Cyberpunk_Stealth",
  "derrickmckinnon-muscle-truck-241621"]);

export const Audio = {
  ctx: null,
  buffers: {},
  loading: {},
  master: null,
  sfxGain: null,
  musicGain: null,
  voices: [],
  muted: false,
  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
    const unlock = () => {
      if (this.ctx.state !== "running") this.ctx.resume();
    };
    for (const ev of ["pointerdown", "keydown", "touchstart", "touchend", "mousedown"]) window.addEventListener(ev, unlock, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  },
  isLong(name) { return LONG.has(name); },
  clipName(ref) { return ref && ref.startsWith("A:") ? ref.slice(2) : ref; },
  load(name) {
    name = this.clipName(name);
    if (!name || !this.ctx || LONG.has(name)) return Promise.resolve(null);
    if (this.buffers[name]) return Promise.resolve(this.buffers[name]);
    if (!this.loading[name]) {
      this.loading[name] = fetch("audio/" + name + ".mp3").then((r) => r.arrayBuffer())
        .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
        .then((b) => (this.buffers[name] = b))
        .catch(() => null);
    }
    return this.loading[name];
  },
  length(name) {
    const b = this.buffers[this.clipName(name)];
    return b ? b.duration : 0.3;
  },
  play(name, volume = 1, pitch = 1) {
    name = this.clipName(name);
    if (!this.ctx || !name) return;
    const b = this.buffers[name];
    if (!b) { this.load(name); return; }
    this.voices = this.voices.filter((v) => !v.ended);
    if (this.voices.length >= 24) { try { this.voices[0].src.stop(); } catch (e) { } this.voices.shift(); }
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = pitch;
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g); g.connect(this.sfxGain);
    const v = { src, ended: false };
    src.onended = () => (v.ended = true);
    src.start();
    this.voices.push(v);
    return v;
  },
  // streamed track element routed through Web Audio so volume works on iOS
  track(name) {
    const el = document.createElement("audio");
    el.src = "audio/" + name + ".mp3";
    el.loop = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    const t = { el, name, gain: null, volume: 0, playing: false };
    if (this.ctx) {
      try {
        const node = this.ctx.createMediaElementSource(el);
        t.gain = this.ctx.createGain(); t.gain.gain.value = 0;
        node.connect(t.gain); t.gain.connect(this.musicGain);
      } catch (e) { t.gain = null; }
    }
    t.setVolume = (v) => {
      t.volume = v;
      if (t.gain) t.gain.gain.value = v; else el.volume = Math.max(0, Math.min(1, v));
    };
    t.play = () => { t.playing = true; const p = el.play(); if (p && p.catch) p.catch(() => (t.playing = false)); };
    t.stop = () => { t.playing = false; el.pause(); };
    t.restart = () => { el.currentTime = 0; t.play(); };
    return t;
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; },
};
