// Secret handling: AES-256-GCM at rest in SQLite, plus a global scrubber that removes known secret values
// from anything that is logged or shown in the owner panel.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Db } from './db.js';

const known = new Set<string>();

export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 6) known.add(value);
}

export function scrub(text: string): string {
  let out = text;
  for (const s of known) {
    if (out.includes(s)) out = out.split(s).join('***');
  }
  // Generic patterns: bearer tokens, rtmp keys in URLs, query tokens.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***');
  out = out.replace(/(rtmps?:\/\/[^\s'"]+\/)([A-Za-z0-9_\-.]{8,})/gi, '$1***');
  out = out.replace(/([?&](?:token|key|secret|code|access_token|refresh_token|client_secret)=)[^&\s]+/gi, '$1***');
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export class SecretStore {
  private key: Buffer;
  constructor(
    private db: Db,
    secretKeyB64: string,
  ) {
    this.key = Buffer.from(secretKeyB64, 'base64');
    if (this.key.length !== 32) throw new Error('SECRET_KEY must decode to 32 bytes');
    // Pre-register stored secrets so the scrubber knows them from the start.
    const rows = this.db.sql.prepare("SELECT key FROM settings WHERE key LIKE 'secret:%'").all() as { key: string }[];
    for (const r of rows) registerSecret(this.get(r.key.slice(7)));
  }

  set(name: string, value: string): void {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(value, 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    this.db.setSetting(`secret:${name}`, Buffer.concat([iv, tag, enc]).toString('base64'));
    registerSecret(value);
  }

  get(name: string): string | null {
    const raw = this.db.getSetting(`secret:${name}`);
    if (!raw) return null;
    try {
      const buf = Buffer.from(raw, 'base64');
      const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  delete(name: string): void {
    this.db.deleteSetting(`secret:${name}`);
  }
}

/** Bounded in-memory list of recent problems for the owner panel (already scrubbed). */
export class ErrorLog {
  private items: { at: number; source: string; message: string }[] = [];
  constructor(private max = 100) {}
  add(source: string, message: string): void {
    this.items.unshift({ at: Date.now(), source, message: scrub(message).slice(0, 500) });
    if (this.items.length > this.max) this.items.length = this.max;
  }
  list(): { at: number; source: string; message: string }[] {
    return this.items.slice(0, 50);
  }
}
