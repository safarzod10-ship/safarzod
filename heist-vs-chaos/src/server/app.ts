// HTTP + WebSocket server. Public: game page, read-only state, Kick webhook. Owner: /api/admin/* (bearer token).
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import type { GameRuntime } from './runtime.js';
import type { KickIntegration } from './kick/kick.js';
import type { BroadcastSupervisor } from './broadcast/supervisor.js';
import { PROFILES } from './broadcast/supervisor.js';
import { safeEqual, scrub, type ErrorLog } from './secrets.js';
import type { Db } from './db.js';
import { INTERVENTIONS } from '../shared/types.js';

export interface AppDeps {
  db: Db;
  runtime: GameRuntime;
  kick: KickIntegration;
  broadcast: BroadcastSupervisor | null;
  errors: ErrorLog;
  adminToken: string;
  clientDir: string;
  customAudioDir: string;
  backupDir: string;
  trustProxy: boolean;
  logLevel: string;
  version: string;
  onRestartRequested?: () => void;
}

const MAX_WS = 300;

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: d.trustProxy,
    bodyLimit: 64 * 1024,
    logger: {
      level: d.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["kick-event-signature"]'], censor: '***' },
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, url: scrub(req.url.split('#')[0] ?? ''), ip: req.ip }),
      },
    },
    routerOptions: { maxParamLength: 200 },
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message?: string; code?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) {
      d.errors.add('http', `${req.method} ${scrub(req.url)}: ${e.message ?? 'error'}`);
      req.log.error({ err: scrub(String(e.message)) }, 'request failed');
    }
    void reply.code(status).send({ error: status >= 500 ? 'internal error' : (e.message ?? 'bad request') });
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 } });

  // ---------------------------------------------------------------- public

  app.get('/healthz', async () => {
    d.db.sql.prepare('SELECT 1').get();
    return { ok: true, version: d.version, phase: d.runtime.state.phase, uptime: Math.round(process.uptime()) };
  });

  app.get('/api/state', async () => d.runtime.publicState());

  app.get('/api/audio-manifest', async () => audioManifest(d.clientDir, d.customAudioDir));

  const sockets = new Set<WebSocket>();
  const broadcastSockets = new Set<WebSocket>();
  let pending: NodeJS.Timeout | null = null;
  const pushState = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = JSON.stringify({ t: 'state', s: d.runtime.publicState() });
      for (const ws of sockets) if (ws.readyState === 1 && ws.bufferedAmount < 512 * 1024) ws.send(msg);
    }, 80);
  };
  d.runtime.on('state', pushState);
  const heartbeat = setInterval(() => {
    const msg = JSON.stringify({ t: 'time', now: Date.now() });
    for (const ws of sockets) {
      const w = ws as WebSocket & { alive?: boolean };
      if (w.alive === false) {
        ws.terminate();
        continue;
      }
      w.alive = false;
      ws.ping();
      if (ws.readyState === 1) ws.send(msg);
    }
    if (d.broadcast) d.broadcast.pageConnected = broadcastSockets.size > 0;
  }, 5000);
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const ws of sockets) ws.terminate();
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (sockets.size >= MAX_WS) {
      socket.close(1013, 'busy');
      return;
    }
    const isBroadcast = (req.query as Record<string, string>)?.broadcast === '1';
    const w = socket as WebSocket & { alive?: boolean };
    w.alive = true;
    sockets.add(socket);
    if (isBroadcast) {
      broadcastSockets.add(socket);
      if (d.broadcast) d.broadcast.pageConnected = true;
    }
    socket.on('pong', () => (w.alive = true));
    socket.on('message', (m) => {
      // Clients only send keep-alives; anything else is ignored.
      if (m.toString().length > 64) socket.close(1009, 'too big');
      else w.alive = true;
    });
    socket.on('close', () => {
      sockets.delete(socket);
      broadcastSockets.delete(socket);
      if (d.broadcast) d.broadcast.pageConnected = broadcastSockets.size > 0;
    });
    socket.send(JSON.stringify({ t: 'state', s: d.runtime.publicState() }));
  });

  // Kick webhook: raw body needed for signature verification.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/webhooks/kick', async (req, reply) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      try {
        const r = await d.kick.handleWebhook(req.headers, raw);
        return reply.code(r.code).send({ result: r.body });
      } catch (e) {
        d.errors.add('kick', `webhook processing failed: ${e instanceof Error ? e.message : String(e)}`);
        return reply.code(500).send({ result: 'error' });
      }
    });
  });

  // ---------------------------------------------------------------- admin

  const failures = new Map<string, { n: number; until: number }>();
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = req.ip;
    const f = failures.get(ip);
    const now = Date.now();
    if (f && f.until > now) return reply.code(429).send({ error: 'too many attempts, wait a minute' });
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token || !safeEqual(token, d.adminToken)) {
      const n = (f && f.until > now - 60_000 ? f.n : 0) + 1;
      failures.set(ip, { n, until: n >= 8 ? now + 60_000 : 0 });
      if (failures.size > 5000) failures.clear();
      return reply.code(401).send({ error: 'unauthorized' });
    }
    failures.delete(ip);
  };

  await app.register(async (admin) => {
    admin.addHook('onRequest', auth);

    admin.get('/api/admin/status', async () => ({
      version: d.version,
      game: d.runtime.publicState(),
      broadcast: d.broadcast?.getStatus() ?? null,
      broadcastAvailable: !!d.broadcast,
      profiles: PROFILES.map((p) => ({ id: p.id, label: p.label })),
      kick: d.kick.status,
      errors: d.errors.list(),
      interventions: d.runtime.recentInterventions(15).map((r) => ({
        type: r.type,
        sender: r.sender,
        test: !!r.test,
        status: r.status,
        result: r.result,
        at: r.received_at,
      })),
      memory: { rssMb: Math.round(process.memoryUsage().rss / 1e6), heapMb: Math.round(process.memoryUsage().heapUsed / 1e6) },
      uptime: Math.round(process.uptime()),
    }));

    const parse = <T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) {
        void reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        return null;
      }
      return r.data;
    };

    admin.post('/api/admin/intervention', async (req, reply) => {
      const b = parse(z.object({ type: z.enum(INTERVENTIONS as [string, ...string[]]) }), req.body, reply);
      if (!b) return;
      const r = d.runtime.submitIntervention(`test:${randomUUID()}`, b.type as (typeof INTERVENTIONS)[number], 'HOST', 'test', true);
      return { result: r };
    });

    admin.post('/api/admin/audio', async (req, reply) => {
      const v = z.number().min(0).max(1);
      const b = parse(z.object({ master: v.optional(), music: v.optional(), sfx: v.optional(), voice: v.optional() }), req.body, reply);
      if (!b) return;
      d.runtime.setAudio(Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)));
      return { ok: true };
    });

    admin.post('/api/admin/game/pause', async () => (d.runtime.setPaused(true), { ok: true }));
    admin.post('/api/admin/game/resume', async () => (d.runtime.setPaused(false), { ok: true }));
    admin.post('/api/admin/game/restart-level', async () => (d.runtime.restartLevel(), { ok: true }));
    admin.post('/api/admin/game/reset', async (req, reply) => {
      const b = parse(z.object({ confirm: z.literal('RESET') }), req.body, reply);
      if (!b) return;
      d.db.backup(d.backupDir, new Date(), 14);
      d.runtime.resetProgress();
      return { ok: true };
    });
    admin.post('/api/admin/server/restart', async () => {
      setTimeout(() => d.onRestartRequested?.(), 300);
      return { ok: true, note: 'The service restarts in a few seconds; the game resumes from its saved state.' };
    });
    admin.post('/api/admin/backup', async () => ({ file: d.db.backup(d.backupDir, new Date(), 14).split('/').pop() }));

    admin.post('/api/admin/broadcast/config', async (req, reply) => {
      const b = parse(
        z.object({
          rtmpUrl: z.string().max(300).regex(/^(rtmps?:\/\/[^\s]+)?$/, 'must start with rtmps://').optional(),
          streamKey: z.string().min(8).max(300).regex(/^\S+$/).optional(),
          profile: z.enum(['hd30', 'hd24', 'sd30', 'sd24']).optional(),
          autoProfile: z.boolean().optional(),
          mode: z.enum(['limited', 'continuous']).optional(),
          budgetHours: z.number().min(0.25).max(48).optional(),
          target: z.enum(['kick', 'null']).optional(),
        }),
        req.body,
        reply,
      );
      if (!b) return;
      if (!d.broadcast) return reply.code(409).send({ error: 'broadcast tools are not installed on this host' });
      d.broadcast.configure(b);
      return { ok: true };
    });
    admin.post('/api/admin/broadcast/start', async (_req, reply) => {
      if (!d.broadcast) return reply.code(409).send({ error: 'broadcast tools are not installed on this host' });
      const r = d.broadcast.start();
      return r.ok ? { ok: true } : reply.code(409).send({ error: r.error });
    });
    admin.post('/api/admin/broadcast/stop', async (_req, reply) => {
      if (!d.broadcast) return reply.code(409).send({ error: 'broadcast tools are not installed on this host' });
      d.broadcast.stop();
      return { ok: true };
    });
    admin.post('/api/admin/broadcast/reset-budget', async (req, reply) => {
      const b = parse(z.object({ confirm: z.literal('RESET') }), req.body, reply);
      if (!b || !d.broadcast) return;
      d.broadcast.resetBudget();
      return { ok: true };
    });

    admin.post('/api/admin/kick/config', async (req, reply) => {
      const b = parse(
        z.object({
          clientId: z.string().min(4).max(200).regex(/^\S+$/).optional(),
          clientSecret: z.string().min(8).max(300).regex(/^\S+$/).optional(),
          channel: z.string().regex(/^[A-Za-z0-9_-]{1,25}$/).optional(),
          giftsEnabled: z.boolean().optional(),
          giftRules: z
            .array(z.object({ minKicks: z.number().int().min(1).max(1_000_000), type: z.enum(INTERVENTIONS as [string, ...string[]]) }))
            .max(10)
            .optional(),
        }),
        req.body,
        reply,
      );
      if (!b) return;
      d.kick.configure(b as Parameters<KickIntegration['configure']>[0]);
      return { ok: true };
    });
    admin.post('/api/admin/kick/reconnect', async () => {
      d.kick.kick();
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- static

  if (existsSync(d.customAudioDir) || (mkdirSafe(d.customAudioDir) && existsSync(d.customAudioDir))) {
    await app.register(fastifyStatic, { root: d.customAudioDir, prefix: '/audio-custom/', decorateReply: false, index: false, list: false, dotfiles: 'deny' });
  }
  if (existsSync(d.clientDir)) {
    await app.register(fastifyStatic, { root: resolve(d.clientDir), prefix: '/', index: ['index.html'], list: false, dotfiles: 'deny' });
    app.get('/panel', async (_req, reply) => reply.redirect('/panel/'));
  }

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not found' }));
  return app;
}

function mkdirSafe(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

const AUDIO_EXT = /\.(ogg|mp3|wav|m4a|opus)$/i;

/** Built-in manifest merged with owner-supplied files in DATA_DIR/custom-audio/{music,sfx,voice}. */
export function audioManifest(clientDir: string, customDir: string): { music: string[]; sfx: Record<string, string>; voice: Record<string, string[]> } {
  const base = join(clientDir, 'audio', 'manifest.json');
  const m = existsSync(base)
    ? (JSON.parse(readFileSync(base, 'utf8')) as { music: string[]; sfx: Record<string, string>; voice: Record<string, string[]> })
    : { music: [], sfx: {}, voice: {} };
  const list = (sub: string) => {
    try {
      return readdirSync(join(customDir, sub)).filter((f) => AUDIO_EXT.test(f) && !f.startsWith('.'));
    } catch {
      return [];
    }
  };
  const customMusic = list('music').map((f) => `/audio-custom/music/${encodeURIComponent(f)}`);
  if (customMusic.length) m.music = customMusic;
  for (const f of list('sfx')) m.sfx[f.replace(AUDIO_EXT, '')] = `/audio-custom/sfx/${encodeURIComponent(f)}`;
  // voice files: <event>.ogg or <event>-<n>.ogg replace the built-in lines for that event
  const custom: Record<string, string[]> = {};
  for (const f of list('voice')) {
    const ev = f.replace(AUDIO_EXT, '').replace(/-\d+$/, '');
    (custom[ev] ??= []).push(`/audio-custom/voice/${encodeURIComponent(f)}`);
  }
  for (const [ev, files] of Object.entries(custom)) m.voice[ev] = files;
  return m;
}
