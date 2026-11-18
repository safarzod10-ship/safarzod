// Server-side broadcast pipeline: Xvfb (virtual screen) + PulseAudio (virtual sound card) + Chromium (game page)
// + FFmpeg (x11grab + pulse -> H.264/AAC -> RTMPS). Supervised with bounded retries and exponential backoff.
// Streamed time is persisted so the first-stream limit (5 h) survives restarts.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db.js';
import type { ErrorLog, SecretStore } from '../secrets.js';
import { scrub, registerSecret } from '../secrets.js';

export type ProfileId = 'hd30' | 'hd24' | 'sd30' | 'sd24';
export interface Profile {
  id: ProfileId;
  w: number;
  h: number;
  fps: number;
  kbps: number;
  preset: string;
  label: string;
}
export const PROFILES: Profile[] = [
  { id: 'hd30', w: 1280, h: 720, fps: 30, kbps: 3000, preset: 'veryfast', label: '720p 30 fps' },
  { id: 'hd24', w: 1280, h: 720, fps: 24, kbps: 2500, preset: 'superfast', label: '720p 24 fps (lighter)' },
  { id: 'sd30', w: 960, h: 540, fps: 30, kbps: 2000, preset: 'veryfast', label: '540p 30 fps' },
  { id: 'sd24', w: 854, h: 480, fps: 24, kbps: 1500, preset: 'superfast', label: '480p 24 fps (safest)' },
];
const CAPTURE_W = 1280;
const CAPTURE_H = 720;

export type Mode = 'limited' | 'continuous';

interface Settings {
  desired: 'running' | 'stopped';
  mode: Mode;
  budgetSeconds: number;
  usedSeconds: number;
  rtmpUrl: string;
  profile: ProfileId;
  autoProfile: boolean;
  target: 'kick' | 'null';
}

export interface BroadcastStatus {
  state: 'stopped' | 'starting' | 'live' | 'retrying' | 'failed';
  desired: 'running' | 'stopped';
  target: 'kick' | 'null';
  mode: Mode;
  budgetSeconds: number;
  usedSeconds: number;
  remainingSeconds: number | null;
  profile: ProfileId;
  profileLabel: string;
  autoProfile: boolean;
  fps: number;
  speed: number;
  bitrateKbps: number;
  uptimeSeconds: number;
  restartsLastHalfHour: number;
  nextRetryInSeconds: number | null;
  lastError: string | null;
  streamKeySet: boolean;
  rtmpUrlSet: boolean;
  pageConnected: boolean;
  stopReason: string | null;
}

const DEFAULTS: Settings = {
  desired: 'stopped',
  mode: 'limited',
  budgetSeconds: 5 * 3600,
  usedSeconds: 0,
  rtmpUrl: '',
  profile: 'hd30',
  autoProfile: true,
  target: 'kick',
};

const BACKOFF = [5, 15, 30, 60, 120, 300];
const MAX_FAILURES = 6;
const FAILURE_WINDOW_MS = 30 * 60_000;

export interface BroadcastOptions {
  pageUrl: string;
  chromium: string;
  ffmpeg: string;
  xvfb: string;
  pulseaudio: string;
  display: number;
  runDir: string;
}

export class BroadcastSupervisor {
  private s: Settings;
  private procs: Record<string, ChildProcess | undefined> = {};
  private status: Omit<BroadcastStatus, 'desired' | 'mode' | 'budgetSeconds' | 'usedSeconds' | 'remainingSeconds' | 'profile' | 'profileLabel' | 'autoProfile' | 'streamKeySet' | 'rtmpUrlSet' | 'target' | 'pageConnected'>;
  private failures: number[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private retryAt = 0;
  private accTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private lastProgressAt = 0;
  private lastOutUs = 0;
  private slowSince = 0;
  private stopping = false;
  private gen = 0;
  private launchTimers: NodeJS.Timeout[] = [];
  private launchedAt = 0;
  private sessionId: number | null = null;
  pageConnectedAt = 0;
  pageConnected = false;
  private pageMissingSince = 0;

  constructor(
    private db: Db,
    private secrets: SecretStore,
    private errors: ErrorLog,
    private o: BroadcastOptions,
  ) {
    this.s = { ...DEFAULTS, ...db.getJson<Partial<Settings>>('broadcast', {}) };
    registerSecret(this.secrets.get('stream_key'));
    this.status = { state: 'stopped', fps: 0, speed: 0, bitrateKbps: 0, uptimeSeconds: 0, restartsLastHalfHour: 0, nextRetryInSeconds: null, lastError: null, stopReason: null };
  }

  private save(): void {
    this.db.setJson('broadcast', this.s);
  }

  getStatus(): BroadcastStatus {
    const now = Date.now();
    const prof = PROFILES.find((p) => p.id === this.s.profile)!;
    this.failures = this.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    return {
      ...this.status,
      uptimeSeconds: this.startedAt && this.status.state === 'live' ? Math.round((now - this.startedAt) / 1000) : 0,
      restartsLastHalfHour: this.failures.length,
      nextRetryInSeconds: this.retryTimer ? Math.max(0, Math.round((this.retryAt - now) / 1000)) : null,
      desired: this.s.desired,
      target: this.s.target,
      mode: this.s.mode,
      budgetSeconds: this.s.budgetSeconds,
      usedSeconds: Math.round(this.s.usedSeconds),
      remainingSeconds: this.s.mode === 'limited' ? Math.max(0, Math.round(this.s.budgetSeconds - this.s.usedSeconds)) : null,
      profile: this.s.profile,
      profileLabel: prof.label,
      autoProfile: this.s.autoProfile,
      streamKeySet: this.secrets.has('stream_key'),
      rtmpUrlSet: !!this.s.rtmpUrl,
      pageConnected: this.pageConnected,
    };
  }

  configure(input: { rtmpUrl?: string; streamKey?: string; profile?: ProfileId; autoProfile?: boolean; mode?: Mode; budgetHours?: number; target?: 'kick' | 'null' }): void {
    if (input.rtmpUrl !== undefined) this.s.rtmpUrl = normalizeIngest(input.rtmpUrl);
    if (input.streamKey) this.secrets.set('stream_key', input.streamKey.trim());
    if (input.profile) this.s.profile = input.profile;
    if (input.autoProfile !== undefined) this.s.autoProfile = input.autoProfile;
    if (input.mode) this.s.mode = input.mode;
    if (input.budgetHours !== undefined) this.s.budgetSeconds = Math.round(input.budgetHours * 3600);
    if (input.target) this.s.target = input.target;
    this.save();
  }

  resetBudget(): void {
    this.s.usedSeconds = 0;
    this.save();
  }

  /** Resume after a process restart if the owner left the stream running. */
  resume(): void {
    if (this.s.desired === 'running') this.launch('resume after restart');
  }

  start(): { ok: boolean; error?: string } {
    if (this.s.target === 'kick') {
      if (!this.s.rtmpUrl || !this.secrets.has('stream_key')) return { ok: false, error: 'Set the Kick stream URL and stream key first.' };
      if (!/^rtmps?:\/\//i.test(this.s.rtmpUrl)) return { ok: false, error: 'Stream URL must start with rtmps:// or rtmp://' };
    }
    if (this.budgetExhausted()) return { ok: false, error: 'The limited stream budget is used up. Reset it or switch to 24/7 mode.' };
    if (this.s.desired === 'running' && (this.status.state === 'live' || this.status.state === 'starting' || this.status.state === 'retrying')) return { ok: true };
    this.failures = [];
    this.status.stopReason = null;
    this.s.desired = 'running';
    this.save();
    this.launch('start');
    return { ok: true };
  }

  stop(reason = 'stopped by host'): void {
    this.s.desired = 'stopped';
    this.save();
    this.clearRetry();
    this.killAll();
    this.status.state = 'stopped';
    this.status.stopReason = reason;
  }

  private budgetExhausted(): boolean {
    return this.s.mode === 'limited' && this.s.usedSeconds >= this.s.budgetSeconds;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private spawnLogged(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
    const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', (e) => this.onProcExit(name, p, `${name} failed to start: ${e.message}`));
    p.on('exit', (code, signal) => this.onProcExit(name, p, `${name} exited (code ${code ?? '-'}, signal ${signal ?? '-'})`));
    let tail = '';
    p.stderr?.on('data', (d: Buffer) => {
      tail = (tail + d.toString()).slice(-2000);
      (p as ChildProcess & { tail?: string }).tail = tail;
    });
    this.procs[name] = p;
    return p;
  }

  private launch(why: string): void {
    this.clearRetry();
    this.killAll();
    this.stopping = false;
    const gen = ++this.gen;
    this.launchedAt = Date.now();
    this.status.state = 'starting';
    this.status.lastError = null;
    const prof = PROFILES.find((p) => p.id === this.s.profile)!;
    const pulseDir = join(this.o.runDir, 'pulse');
    const chromeDir = join(this.o.runDir, 'chrome');
    rmSync(chromeDir, { recursive: true, force: true });
    mkdirSync(pulseDir, { recursive: true });
    mkdirSync(chromeDir, { recursive: true });
    const display = `:${this.o.display}`;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: this.o.runDir,
      DISPLAY: display,
      PULSE_SERVER: `unix:${join(pulseDir, 'native')}`,
      XDG_RUNTIME_DIR: pulseDir,
      LANG: 'C.UTF-8',
    };
    rmSync(`/tmp/.X${this.o.display}-lock`, { force: true });
    this.spawnLogged('xvfb', this.o.xvfb, [display, '-screen', '0', `${CAPTURE_W}x${CAPTURE_H}x24`, '-nolisten', 'tcp', '-dpi', '96'], env);
    this.spawnLogged('pulse', this.o.pulseaudio, [
      '-n',
      '--daemonize=no',
      '--exit-idle-time=-1',
      '--disallow-exit',
      '--log-target=stderr',
      '-L',
      `module-native-protocol-unix auth-anonymous=1 socket=${join(pulseDir, 'native')}`,
      '-L',
      'module-null-sink sink_name=heist rate=48000 sink_properties=device.description=heist',
      '-L',
      'module-always-sink',
    ], env);
    const startChrome = () => {
      if (this.stopping || gen !== this.gen) return;
      this.spawnLogged('chromium', this.o.chromium, [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--kiosk',
        `--window-size=${CAPTURE_W},${CAPTURE_H}`,
        '--window-position=0,0',
        '--autoplay-policy=no-user-gesture-required',
        `--user-data-dir=${chromeDir}`,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=Translate,MediaRouter',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--password-store=basic',
        this.o.pageUrl,
      ], env);
    };
    const startFfmpeg = () => {
      if (this.stopping || gen !== this.gen) return;
      const g = prof.fps * 2;
      const vf = prof.w !== CAPTURE_W ? ['-vf', `scale=${prof.w}:${prof.h}:flags=bilinear`] : [];
      const out =
        this.s.target === 'null'
          ? ['-f', 'null', '-']
          : ['-rw_timeout', '15000000', '-f', 'flv', `${normalizeIngest(this.s.rtmpUrl)}/${this.secrets.get('stream_key') ?? ''}`];
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
        '-thread_queue_size', '1024', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(prof.fps), '-video_size', `${CAPTURE_W}x${CAPTURE_H}`, '-i', `${display}.0+0,0`,
        '-thread_queue_size', '1024', '-f', 'pulse', '-i', 'heist.monitor',
        ...vf,
        '-c:v', 'libx264', '-preset', prof.preset, '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-r', String(prof.fps), '-g', String(g), '-keyint_min', String(g), '-sc_threshold', '0',
        '-b:v', `${prof.kbps}k`, '-minrate', `${prof.kbps}k`, '-maxrate', `${prof.kbps}k`, '-bufsize', `${prof.kbps * 2}k`, '-x264-params', 'nal-hrd=cbr',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        ...out,
      ];
      const ff = this.spawnLogged('ffmpeg', this.o.ffmpeg, args, env);
      let buf = '';
      ff.stdout?.on('data', (d: Buffer) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          this.onProgressLine(line);
        }
      });
      this.startedAt = Date.now();
      this.lastProgressAt = Date.now();
      this.lastOutUs = 0;
      this.slowSince = 0;
      this.sessionId = Number(this.db.sql.prepare('INSERT INTO broadcast_sessions (started_at) VALUES (?)').run(Date.now()).lastInsertRowid);
    };
    // Give X and Pulse a moment, then the browser, then the encoder (page needs to load first).
    this.launchTimers.push(setTimeout(startChrome, 1500), setTimeout(startFfmpeg, 6000));
    this.errors.add('broadcast', `pipeline launch (${why}) with profile ${prof.id}, target ${this.s.target}`);
    if (!this.accTimer) this.accTimer = setInterval(() => this.watchdog(), 5000);
  }

  private onProgressLine(line: string): void {
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const k = line.slice(0, eq);
    const v = line.slice(eq + 1);
    if (k === 'fps') this.status.fps = Number(v) || 0;
    else if (k === 'speed') this.status.speed = Number.parseFloat(v) || 0;
    else if (k === 'bitrate') this.status.bitrateKbps = Math.round(Number.parseFloat(v) || 0);
    else if (k === 'out_time_us' || k === 'out_time_ms') {
      const us = Number(v);
      if (Number.isFinite(us) && us > this.lastOutUs) {
        const deltaS = (us - this.lastOutUs) / 1e6;
        if (this.lastOutUs > 0 && deltaS < 30) this.s.usedSeconds += this.s.target === 'kick' ? deltaS : 0;
        this.lastOutUs = us;
        this.lastProgressAt = Date.now();
        if (this.status.state !== 'live') {
          this.status.state = 'live';
          this.failures = this.failures.filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
        }
      }
    }
  }

  private watchdog(): void {
    const now = Date.now();
    if (this.s.desired !== 'running') return;
    if (this.status.state === 'starting' && this.launchedAt && now - this.launchedAt > 70_000) {
      this.restartAfterFailure('stream did not start within 70 s (page or ingest not reachable)');
      return;
    }
    if (this.status.state === 'live') {
      this.save(); // persist usedSeconds regularly
      if (this.sessionId) this.db.sql.prepare('UPDATE broadcast_sessions SET seconds = ? WHERE id = ?').run(Math.round((now - this.startedAt) / 1000), this.sessionId);
      if (this.budgetExhausted()) {
        this.stop('5-hour limit reached');
        this.errors.add('broadcast', 'Stream stopped: limited-mode budget reached.');
        return;
      }
      if (now - this.lastProgressAt > 20_000) {
        this.restartAfterFailure('encoder stalled (no progress for 20 s)');
        return;
      }
      // Page watchdog: the broadcast page must stay connected to the game server.
      if (!this.pageConnected) {
        if (!this.pageMissingSince) this.pageMissingSince = now;
        else if (now - this.pageMissingSince > 45_000) {
          this.pageMissingSince = 0;
          this.restartAfterFailure('game page disconnected for 45 s');
          return;
        }
      } else this.pageMissingSince = 0;
      // Automatic profile step-down when the encoder cannot keep real time.
      if (this.status.speed > 0 && this.status.speed < 0.95 && now - this.startedAt > 30_000) {
        if (!this.slowSince) this.slowSince = now;
        else if (now - this.slowSince > 60_000 && this.s.autoProfile) {
          const idx = PROFILES.findIndex((p) => p.id === this.s.profile);
          const next = PROFILES[idx + 1];
          if (next) {
            this.s.profile = next.id;
            this.save();
            this.errors.add('broadcast', `encoder too slow (speed ${this.status.speed}x) - switching to ${next.label}`);
            this.launch('profile step-down');
          }
          this.slowSince = 0;
        }
      } else this.slowSince = 0;
    }
  }

  private onProcExit(name: string, proc: ChildProcess, msg: string): void {
    if (this.stopping || this.s.desired !== 'running') return;
    // Ignore exits of processes we already replaced or killed on purpose.
    if (this.procs[name] !== proc) return;
    this.procs[name] = undefined;
    const tail = scrub(((proc as ChildProcess & { tail?: string }).tail ?? '').split('\n').slice(-4).join(' | '));
    this.restartAfterFailure(`${msg}${tail ? ` - ${tail}` : ''}`);
  }

  private restartAfterFailure(reason: string): void {
    const now = Date.now();
    const clean = scrub(reason).slice(0, 400);
    this.status.lastError = clean;
    this.errors.add('broadcast', clean);
    this.killAll();
    this.failures = [...this.failures.filter((t) => now - t < FAILURE_WINDOW_MS), now];
    if (this.failures.length >= MAX_FAILURES) {
      this.s.desired = 'stopped';
      this.save();
      this.status.state = 'failed';
      this.status.stopReason = `gave up after ${MAX_FAILURES} failures in 30 minutes - press START to try again`;
      this.errors.add('broadcast', this.status.stopReason);
      return;
    }
    const delay = BACKOFF[Math.min(this.failures.length - 1, BACKOFF.length - 1)]! * 1000;
    this.status.state = 'retrying';
    this.retryAt = now + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.s.desired === 'running') this.launch('retry');
    }, delay);
  }

  private killAll(): void {
    this.stopping = true;
    this.gen++;
    for (const t of this.launchTimers) clearTimeout(t);
    this.launchTimers = [];
    if (this.sessionId) {
      this.db.sql
        .prepare('UPDATE broadcast_sessions SET ended_at = ?, seconds = ?, end_reason = ? WHERE id = ?')
        .run(Date.now(), this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0, this.status.stopReason ?? this.status.lastError ?? 'restart', this.sessionId);
      this.sessionId = null;
    }
    for (const name of ['ffmpeg', 'chromium', 'pulse', 'xvfb']) {
      const p = this.procs[name];
      this.procs[name] = undefined;
      if (p && p.exitCode === null) {
        p.kill('SIGTERM');
        setTimeout(() => {
          if (p.exitCode === null) p.kill('SIGKILL');
        }, 3000).unref();
      }
    }
    this.status.fps = 0;
    this.status.speed = 0;
    this.status.bitrateKbps = 0;
    this.save();
  }

  shutdown(): void {
    // Keep `desired` so the stream resumes after a restart.
    this.clearRetry();
    if (this.accTimer) clearInterval(this.accTimer);
    this.accTimer = null;
    this.killAll();
  }
}

/** Kick ingest (AWS IVS) needs the ":443/app" application path; the dashboard URL is often copied without it. */
export function normalizeIngest(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  const m = /^(rtmps?):\/\/([^/:]+)(:\d+)?(\/.*)?$/i.exec(u);
  if (m && /\.live-video\.net$/i.test(m[2]!) && (!m[4] || m[4] === '/')) {
    u = `${m[1]!.toLowerCase()}://${m[2]}${m[3] ?? (m[1]!.toLowerCase() === 'rtmps' ? ':443' : '')}/app`;
  }
  return u;
}
