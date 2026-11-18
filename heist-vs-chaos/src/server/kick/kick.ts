// Kick integration via the official public API (docs.kick.com):
//  - App access token (OAuth client_credentials) - no broadcaster login required for event subscriptions.
//  - Webhook subscriptions for chat.message.sent, kicks.gifted, livestream.status.updated.
//  - RSA-SHA256 signature verification against Kick's published public key.
//  - Replay protection (persistent message-id dedupe), channel check, timestamp sanity, periodic re-subscribe.
import { verify } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { SecretStore, ErrorLog } from '../secrets.js';
import { scrub } from '../secrets.js';
import type { GameRuntime } from '../runtime.js';
import type { InterventionType } from '../../shared/types.js';
import { INTERVENTIONS } from '../../shared/types.js';

export const EVENTS = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'kicks.gifted', version: 1 },
  { name: 'livestream.status.updated', version: 1 },
] as const;

const UserSchema = z.object({ user_id: z.number().int(), username: z.string().max(64) }).passthrough();
const ChatSchema = z.object({
  message_id: z.string().max(128),
  broadcaster: UserSchema,
  sender: UserSchema,
  content: z.string().max(2000),
  created_at: z.string().max(64).optional(),
});
const GiftSchema = z.object({
  broadcaster: UserSchema,
  sender: UserSchema,
  gift: z.object({ amount: z.number().int().min(0).max(10_000_000), name: z.string().max(100).default('Kicks') }).passthrough(),
  created_at: z.string().max(64).optional(),
});
const LiveSchema = z.object({ broadcaster: UserSchema, is_live: z.boolean() }).passthrough();

export interface GiftRule {
  minKicks: number;
  type: InterventionType;
}
export const DEFAULT_GIFT_RULES: GiftRule[] = [
  { minKicks: 1, type: 'SCAN' },
  { minKicks: 50, type: 'SHIELD' },
  { minKicks: 100, type: 'REVOTE' },
  { minKicks: 250, type: 'CHAOS' },
  { minKicks: 500, type: 'REVIVE' },
];

export interface KickStatus {
  configured: boolean;
  channel: string;
  broadcasterUserId: number | null;
  token: 'missing' | 'ok' | 'error';
  subscriptions: string[];
  state: 'not-configured' | 'connecting' | 'connected' | 'error';
  lastEventAt: number | null;
  lastChatAt: number | null;
  lastError: string | null;
  webhookUrl: string | null;
  isLive: boolean | null;
  liveCheckedAt: number | null;
  giftsEnabled: boolean;
  giftRules: GiftRule[];
  counters: { accepted: number; duplicates: number; badSignature: number; wrongChannel: number; stale: number };
}

export type WebhookResult = { code: number; body: string };

export function verifyKickSignature(publicKeyPem: string, messageId: string, timestamp: string, rawBody: Buffer, signatureB64: string): boolean {
  try {
    const signed = Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), rawBody]);
    return verify('sha256', signed, publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function parseVote(content: string): number | null {
  const m = /^\s*!?([1-4])\s*$/.exec(content);
  return m ? Number(m[1]) : null;
}

export function cleanName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 25) || 'viewer';
}

type Fetch = typeof fetch;

export class KickIntegration {
  status: KickStatus;
  private token: { value: string; exp: number } | null = null;
  private publicKey: { pem: string; at: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private backoffMs = 0;
  private nextRunAt = 0;

  constructor(
    private db: Db,
    private secrets: SecretStore,
    private runtime: GameRuntime,
    private errors: ErrorLog,
    private opts: { channel: string; publicUrl?: string; apiBase: string; idBase: string; now?: () => number; fetch?: Fetch },
  ) {
    const saved = db.getJson<{ giftsEnabled?: boolean; giftRules?: GiftRule[]; channel?: string; broadcasterUserId?: number }>('kick', {});
    this.status = {
      configured: false,
      channel: saved.channel ?? opts.channel,
      broadcasterUserId: saved.broadcasterUserId ?? null,
      token: 'missing',
      subscriptions: [],
      state: 'not-configured',
      lastEventAt: null,
      lastChatAt: null,
      lastError: null,
      webhookUrl: opts.publicUrl ? `${opts.publicUrl.replace(/\/$/, '')}/webhooks/kick` : null,
      isLive: null,
      liveCheckedAt: null,
      giftsEnabled: saved.giftsEnabled ?? false,
      giftRules: saved.giftRules ?? DEFAULT_GIFT_RULES,
      counters: { accepted: 0, duplicates: 0, badSignature: 0, wrongChannel: 0, stale: 0 },
    };
    this.refreshConfigured();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  private get f(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  private refreshConfigured(): void {
    this.status.configured = this.secrets.has('kick_client_id') && this.secrets.has('kick_client_secret');
    if (!this.status.configured) {
      this.status.state = 'not-configured';
      this.status.token = 'missing';
    }
    this.syncRuntime();
  }

  private syncRuntime(): void {
    const online = this.status.state === 'connected';
    this.runtime.chatOnline = online;
    this.runtime.chatStatusText = online ? 'Kick chat connected' : 'Kick chat not connected';
  }

  private saveSettings(): void {
    this.db.setJson('kick', {
      giftsEnabled: this.status.giftsEnabled,
      giftRules: this.status.giftRules,
      channel: this.status.channel,
      broadcasterUserId: this.status.broadcasterUserId,
    });
  }

  configure(input: { clientId?: string; clientSecret?: string; channel?: string; giftsEnabled?: boolean; giftRules?: GiftRule[] }): void {
    if (input.clientId) this.secrets.set('kick_client_id', input.clientId);
    if (input.clientSecret) this.secrets.set('kick_client_secret', input.clientSecret);
    if (input.channel && input.channel !== this.status.channel) {
      this.status.channel = input.channel;
      this.status.broadcasterUserId = null;
    }
    if (input.giftsEnabled !== undefined) this.status.giftsEnabled = input.giftsEnabled;
    if (input.giftRules) this.status.giftRules = [...input.giftRules].sort((a, b) => a.minKicks - b.minKicks);
    this.token = null;
    this.saveSettings();
    this.refreshConfigured();
    this.kick();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.now() >= this.nextRunAt) void this.maintain();
    }, 5000);
    void this.maintain();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** Run maintenance as soon as possible (after config change / manual reconnect). */
  kick(): void {
    this.backoffMs = 0;
    this.nextRunAt = 0;
    void this.maintain();
  }

  private running = false;
  /** Ensure token, channel id and subscriptions. Backs off exponentially on failure (max 15 min). */
  async maintain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.refreshConfigured();
      if (!this.status.configured) return;
      if (this.status.state !== 'connected') this.status.state = 'connecting';
      await this.ensureToken();
      await this.ensureChannel();
      await this.ensureSubscriptions();
      await this.checkLive();
      this.status.state = 'connected';
      this.status.lastError = null;
      this.backoffMs = 0;
      this.nextRunAt = this.now() + 5 * 60_000;
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e));
      this.status.state = 'error';
      this.status.lastError = msg;
      this.errors.add('kick', msg);
      this.backoffMs = Math.min(15 * 60_000, this.backoffMs ? this.backoffMs * 2 : 30_000);
      this.nextRunAt = this.now() + this.backoffMs;
    } finally {
      this.running = false;
      this.syncRuntime();
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.token.exp > this.now() + 60_000) return this.token.value;
    const id = this.secrets.get('kick_client_id');
    const secret = this.secrets.get('kick_client_secret');
    if (!id || !secret) throw new Error('Kick client id/secret missing');
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
    const r = await this.f(`${this.opts.idBase}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      this.status.token = 'error';
      throw new Error(`Kick token request failed: HTTP ${r.status}`);
    }
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('Kick token response without access_token');
    this.token = { value: j.access_token, exp: this.now() + Math.max(300, j.expires_in ?? 3600) * 1000 };
    this.status.token = 'ok';
    return j.access_token;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    const r = await this.f(`${this.opts.apiBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) this.token = null;
    if (!r.ok && r.status !== 204) throw new Error(`Kick API ${method} ${path.split('?')[0]} failed: HTTP ${r.status}`);
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  }

  private async ensureChannel(): Promise<void> {
    if (this.status.broadcasterUserId) return;
    const j = await this.api<{ data: { broadcaster_user_id: number; slug: string }[] }>('GET', `/public/v1/channels?slug=${encodeURIComponent(this.status.channel)}`);
    const ch = j.data?.find((c) => c.slug.toLowerCase() === this.status.channel.toLowerCase());
    if (!ch) throw new Error(`Kick channel "${this.status.channel}" not found`);
    this.status.broadcasterUserId = ch.broadcaster_user_id;
    this.saveSettings();
  }

  private async ensureSubscriptions(): Promise<void> {
    const bid = this.status.broadcasterUserId!;
    const j = await this.api<{ data: { id: string; event: string; broadcaster_user_id: number; method: string }[] }>(
      'GET',
      `/public/v1/events/subscriptions?broadcaster_user_id=${bid}`,
    );
    const have = new Set((j.data ?? []).filter((s) => s.broadcaster_user_id === bid).map((s) => s.event));
    const missing = EVENTS.filter((e) => !have.has(e.name));
    if (missing.length) {
      const res = await this.api<{ data: { name: string; error?: string | null }[] }>('POST', '/public/v1/events/subscriptions', {
        broadcaster_user_id: bid,
        events: missing.map((e) => ({ name: e.name, version: e.version })),
        method: 'webhook',
      });
      const failed = (res.data ?? []).filter((d) => d.error);
      if (failed.length) throw new Error(`Kick subscription errors: ${failed.map((d) => `${d.name}: ${d.error}`).join(', ')}`);
      for (const m of missing) have.add(m.name);
    }
    this.status.subscriptions = [...have].sort();
  }

  async checkLive(): Promise<boolean | null> {
    try {
      const j = await this.api<{ data: { stream?: { is_live?: boolean } }[] }>('GET', `/public/v1/channels?slug=${encodeURIComponent(this.status.channel)}`);
      this.status.isLive = !!j.data?.[0]?.stream?.is_live;
      this.status.liveCheckedAt = this.now();
      return this.status.isLive;
    } catch (e) {
      this.errors.add('kick', `live check failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private async getPublicKey(force = false): Promise<string> {
    if (!force && this.publicKey && this.now() - this.publicKey.at < 6 * 3600_000) return this.publicKey.pem;
    const r = await this.f(`${this.opts.apiBase}/public/v1/public-key`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Kick public key fetch failed: HTTP ${r.status}`);
    const j = (await r.json()) as { data?: { public_key?: string } };
    const pem = j.data?.public_key;
    if (!pem || !pem.includes('BEGIN PUBLIC KEY')) throw new Error('Kick public key missing');
    this.publicKey = { pem, at: this.now() };
    return pem;
  }

  /** Inject a key (tests). */
  setPublicKey(pem: string): void {
    this.publicKey = { pem, at: this.now() };
  }

  async handleWebhook(headers: Record<string, string | string[] | undefined>, raw: Buffer): Promise<WebhookResult> {
    const h = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const id = h('kick-event-message-id');
    const ts = h('kick-event-message-timestamp');
    const sig = h('kick-event-signature');
    const type = h('kick-event-type');
    if (!id || !ts || !sig || !type || id.length > 128 || ts.length > 64 || sig.length > 2048 || type.length > 64) {
      return { code: 400, body: 'missing headers' };
    }
    let pem: string;
    try {
      pem = await this.getPublicKey();
    } catch (e) {
      this.errors.add('kick', e instanceof Error ? e.message : String(e));
      return { code: 503, body: 'key unavailable' };
    }
    let valid = verifyKickSignature(pem, id, ts, raw, sig);
    if (!valid && this.publicKey && this.now() - this.publicKey.at > 60_000) {
      // The key may have rotated: refresh once and retry.
      try {
        pem = await this.getPublicKey(true);
        valid = verifyKickSignature(pem, id, ts, raw, sig);
      } catch {
        /* keep invalid */
      }
    }
    if (!valid) {
      this.status.counters.badSignature++;
      return { code: 401, body: 'bad signature' };
    }
    const sentAt = Date.parse(ts);
    if (!Number.isFinite(sentAt) || sentAt < this.now() - 24 * 3600_000) {
      this.status.counters.stale++;
      return { code: 200, body: 'too old, ignored' };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return { code: 400, body: 'bad json' };
    }
    // Idempotency: the message id and its effect are committed in ONE transaction. A redelivery (or a
    // retry after a crash) is acknowledged without effect; a failed processing rolls back and can be retried.
    return this.db.tx(() => {
      const ins = this.db.sql.prepare('INSERT OR IGNORE INTO processed_events (event_id, type, received_at) VALUES (?, ?, ?)').run(id, type, this.now());
      if (ins.changes === 0) {
        this.status.counters.duplicates++;
        return { code: 200, body: 'duplicate' };
      }
      this.status.lastEventAt = this.now();
      return this.dispatch(id, type, payload, sentAt);
    });
  }

  private checkChannel(bid: number): boolean {
    if (this.status.broadcasterUserId !== null && bid !== this.status.broadcasterUserId) {
      this.status.counters.wrongChannel++;
      return false;
    }
    return true;
  }

  private dispatch(id: string, type: string, payload: unknown, headerTs: number): WebhookResult {
    if (type === 'chat.message.sent') {
      const p = ChatSchema.safeParse(payload);
      if (!p.success) return { code: 400, body: 'bad payload' };
      if (!this.checkChannel(p.data.broadcaster.user_id)) return { code: 200, body: 'other channel' };
      this.status.lastChatAt = this.now();
      if (this.status.state !== 'connected' && this.status.configured) {
        this.status.state = 'connected';
        this.syncRuntime();
      }
      const n = parseVote(p.data.content);
      if (n === null) return { code: 200, body: 'not a vote' };
      const sentAt = p.data.created_at ? Date.parse(p.data.created_at) : headerTs;
      const r = this.runtime.castVote(`kick:${p.data.sender.user_id}`, cleanName(p.data.sender.username), n, sentAt, this.now());
      this.status.counters.accepted++;
      return { code: 200, body: `vote ${r}` };
    }
    if (type === 'kicks.gifted') {
      const p = GiftSchema.safeParse(payload);
      if (!p.success) return { code: 400, body: 'bad payload' };
      if (!this.checkChannel(p.data.broadcaster.user_id)) return { code: 200, body: 'other channel' };
      const sender = cleanName(p.data.sender.username);
      const amount = p.data.gift.amount;
      const rule = this.status.giftsEnabled ? [...this.status.giftRules].reverse().find((r) => amount >= r.minKicks && INTERVENTIONS.includes(r.type)) : undefined;
      this.db.sql
        .prepare('INSERT OR IGNORE INTO gifts (event_id, sender, amount, name, mapped_type, at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, sender, amount, p.data.gift.name.slice(0, 100), rule?.type ?? null, this.now());
      if (rule) {
        const res = this.runtime.submitIntervention(`kick:${id}`, rule.type, sender, 'kick', false);
        return { code: 200, body: `gift ${rule.type} ${res}` };
      }
      this.runtime.pushNotice('gift', `Thank you @${sender} for ${amount} Kicks!`);
      return { code: 200, body: 'gift thanked' };
    }
    if (type === 'livestream.status.updated') {
      const p = LiveSchema.safeParse(payload);
      if (!p.success) return { code: 400, body: 'bad payload' };
      if (!this.checkChannel(p.data.broadcaster.user_id)) return { code: 200, body: 'other channel' };
      this.status.isLive = p.data.is_live;
      this.status.liveCheckedAt = this.now();
      return { code: 200, body: 'ok' };
    }
    return { code: 200, body: 'ignored type' };
  }
}
