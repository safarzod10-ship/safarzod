// Entry point: wires config, storage, runtime, Kick, broadcast and the HTTP server; handles graceful shutdown.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { Db } from './db.js';
import { DEFAULT_TIMINGS, GameRuntime, systemClock, type Timings } from './runtime.js';
import { ErrorLog, SecretStore, registerSecret, scrub } from './secrets.js';
import { KickIntegration } from './kick/kick.js';
import { BroadcastSupervisor } from './broadcast/supervisor.js';
import { buildApp } from './app.js';

function which(cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readVersion(): string {
  for (const rel of ['../../../package.json', '../../package.json']) {
    try {
      return (JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { version: string }).version;
    } catch {
      /* try next */
    }
  }
  return 'dev';
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  registerSecret(cfg.ADMIN_TOKEN);
  registerSecret(cfg.SECRET_KEY);
  const version = readVersion();

  const db = new Db(cfg.dbFile);
  const secrets = new SecretStore(db, cfg.SECRET_KEY);
  const errors = new ErrorLog();
  const timings: Timings = cfg.FAST_TIMINGS
    ? { introMs: 1500, voteMs: 4000, graceMs: 300, resolveMs: 2500, defeatMs: 3000, levelCompleteMs: 2000, campaignCompleteMs: 2000, resumeVoteMs: 3000 }
    : DEFAULT_TIMINGS;
  const runtime = new GameRuntime(db, systemClock, Math.random, timings);
  runtime.on('error', (e: unknown) => errors.add('game', e instanceof Error ? e.message : String(e)));
  runtime.on('log', (m: string) => errors.add('game', m));

  const kick = new KickIntegration(db, secrets, runtime, errors, {
    channel: cfg.KICK_CHANNEL,
    ...(cfg.PUBLIC_URL ? { publicUrl: cfg.PUBLIC_URL } : {}),
    apiBase: cfg.KICK_API_BASE,
    idBase: cfg.KICK_ID_BASE,
  });

  const toolsOk = [cfg.CHROMIUM_PATH, cfg.FFMPEG_PATH, cfg.XVFB_PATH, cfg.PULSEAUDIO_PATH].every(which);
  const broadcast = toolsOk
    ? new BroadcastSupervisor(db, secrets, errors, {
        pageUrl: cfg.BROADCAST_PAGE_URL ?? `http://127.0.0.1:${cfg.PORT}/?broadcast=1`,
        chromium: cfg.CHROMIUM_PATH,
        ffmpeg: cfg.FFMPEG_PATH,
        xvfb: cfg.XVFB_PATH,
        pulseaudio: cfg.PULSEAUDIO_PATH,
        display: cfg.DISPLAY_NUM,
        runDir: join(cfg.DATA_DIR, 'run'),
      })
    : null;
  if (!broadcast) errors.add('broadcast', 'Broadcast tools (chromium, ffmpeg, Xvfb, pulseaudio) not found - streaming disabled on this host.');

  let shuttingDown = false;
  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.stop();
    kick.stop();
    broadcast?.shutdown();
    await app.close().catch(() => undefined);
    db.close();
    process.exit(code);
  };

  const app = await buildApp({
    db,
    runtime,
    kick,
    broadcast,
    errors,
    adminToken: cfg.ADMIN_TOKEN,
    clientDir: cfg.CLIENT_DIR,
    customAudioDir: cfg.customAudioDir,
    backupDir: cfg.backupDir,
    trustProxy: cfg.TRUST_PROXY,
    logLevel: cfg.LOG_LEVEL,
    version,
    onRestartRequested: () => void shutdown(0),
  });

  runtime.start();
  kick.start();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  broadcast?.resume();

  // Housekeeping: prune bounded tables hourly, daily backup.
  const hourly = setInterval(() => {
    try {
      db.prune(Date.now());
    } catch (e) {
      errors.add('db', String(e));
    }
  }, 3600_000);
  hourly.unref();
  const daily = setInterval(() => {
    try {
      db.backup(cfg.backupDir, new Date(), 14);
    } catch (e) {
      errors.add('db', `backup failed: ${String(e)}`);
    }
  }, 24 * 3600_000);
  daily.unref();

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('uncaughtException', (e) => {
    console.error(scrub(String(e?.stack ?? e)));
    void shutdown(1);
  });
  process.on('unhandledRejection', (e) => {
    errors.add('process', scrub(String(e)));
  });
}

main().catch((e) => {
  console.error(scrub(String(e instanceof Error ? e.message : e)));
  process.exit(1);
});
