// WebAudio mixer: music / sfx / voice buses -> master -> limiter. Voice and alerts duck the music.
// Voice lines are chosen per game event with anti-repetition (a line is not reused for 3 minutes).

interface Manifest {
  music: string[];
  sfx: Record<string, string>;
  voice: Record<string, string[]>;
}

const IMPORTANT = new Set(['steal', 'level', 'defeat', 'campaign', 'revive']);

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private musicDuck!: GainNode;
  private sfxBus!: GainNode;
  private voiceBus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private manifest: Manifest = { music: [], sfx: {}, voice: {} };
  private lastSfx = new Map<string, number>();
  private linePlayed = new Map<string, number>();
  private lastVoiceAt = 0;
  private voiceSrc: AudioBufferSourceNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicTrack = -1;
  private activeSfx = 0;
  private levels = { master: 0.8, music: 0.45, sfx: 0.8, voice: 0.9 };
  unlocked = false;

  async init(): Promise<void> {
    try {
      const r = await fetch('/api/audio-manifest');
      if (r.ok) this.manifest = (await r.json()) as Manifest;
    } catch {
      /* silent game still works */
    }
  }

  /** Must run from a user gesture in normal browsers; the broadcast browser allows autoplay. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.connect(limiter).connect(ctx.destination);
    this.music = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.music.connect(this.musicDuck).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.voiceBus = ctx.createGain();
    this.voiceBus.connect(this.master);
    this.applyLevels();
    void ctx.resume();
    this.unlocked = ctx.state === 'running';
    ctx.onstatechange = () => (this.unlocked = ctx.state === 'running');
  }

  setLevels(l: { master: number; music: number; sfx: number; voice: number }): void {
    this.levels = l;
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.levels.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.levels.music * 0.6, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.levels.sfx * 0.7, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(this.levels.voice, t, 0.05);
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }

  private duck(seconds: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicDuck.gain.cancelScheduledValues(t);
    this.musicDuck.gain.setTargetAtTime(0.35, t, 0.08);
    this.musicDuck.gain.setTargetAtTime(1, t + seconds, 0.4);
  }

  /** Play background music track (0 = calm, 1 = escape) with a soft crossfade. */
  playMusic(track: number): void {
    if (!this.ctx || !this.manifest.music.length) return;
    const idx = Math.min(track, this.manifest.music.length - 1);
    if (idx === this.musicTrack && this.musicSrc) return;
    this.musicTrack = idx;
    const url = this.manifest.music[idx]!;
    void this.load(url).then((buf) => {
      if (!buf || !this.ctx || this.musicTrack !== idx) return;
      const old = this.musicSrc;
      const g = this.ctx.createGain();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g).connect(this.music);
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 2);
      src.start();
      this.musicSrc = src;
      if (old) {
        const og = this.ctx.createGain();
        try {
          old.disconnect();
          old.connect(og).connect(this.music);
          og.gain.setValueAtTime(1, t);
          og.gain.linearRampToValueAtTime(0, t + 2);
          old.stop(t + 2.1);
        } catch {
          /* already stopped */
        }
      }
    });
  }

  sfx(name: string, gain = 1, alert = false): void {
    if (!this.ctx) return;
    const url = this.manifest.sfx[name];
    if (!url) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 90 || this.activeSfx > 10) return;
    this.lastSfx.set(name, now);
    if (alert) this.duck(1.5);
    void this.load(url).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.buffer = buf;
      src.connect(g).connect(this.sfxBus);
      this.activeSfx++;
      src.onended = () => this.activeSfx--;
      src.start();
    });
  }

  voice(event: string): void {
    if (!this.ctx) return;
    const lines = this.manifest.voice[event];
    if (!lines?.length) return;
    const now = performance.now();
    const important = IMPORTANT.has(event);
    if (!important && (now - this.lastVoiceAt < 7000 || this.voiceSrc)) return;
    // least recently used line that was not heard in the last 3 minutes
    const fresh = lines.filter((l) => now - (this.linePlayed.get(l) ?? -1e9) > 180_000);
    if (!fresh.length && !important) return;
    const pool = fresh.length ? fresh : lines;
    const line = pool.sort((a, b) => (this.linePlayed.get(a) ?? 0) - (this.linePlayed.get(b) ?? 0))[0]!;
    this.linePlayed.set(line, now);
    this.lastVoiceAt = now;
    void this.load(line).then((buf) => {
      if (!buf || !this.ctx) return;
      if (this.voiceSrc) {
        try {
          this.voiceSrc.stop();
        } catch {
          /* ignore */
        }
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceBus);
      this.duck(buf.duration + 0.3);
      src.onended = () => {
        if (this.voiceSrc === src) this.voiceSrc = null;
      };
      this.voiceSrc = src;
      src.start();
    });
  }
}
