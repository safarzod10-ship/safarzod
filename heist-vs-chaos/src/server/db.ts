// SQLite storage (node:sqlite, no native build step) with ordered, idempotent migrations.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MIGRATIONS: string[] = [
  // 1: core tables
  `CREATE TABLE game_state (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE votes (vote_id TEXT NOT NULL, voter_id TEXT NOT NULL, option_id TEXT NOT NULL, name TEXT NOT NULL, sent_at INTEGER NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY (vote_id, voter_id));
   CREATE TABLE resolutions (vote_id TEXT PRIMARY KEY, level INTEGER NOT NULL, beat INTEGER NOT NULL, option_id TEXT NOT NULL, mode TEXT NOT NULL, voters INTEGER NOT NULL, damage INTEGER NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE interventions (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, source TEXT NOT NULL, sender TEXT NOT NULL, test INTEGER NOT NULL, status TEXT NOT NULL, result TEXT, received_at INTEGER NOT NULL, applied_at INTEGER);
   CREATE INDEX interventions_status ON interventions(status, seq);
   CREATE TABLE processed_events (event_id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
   CREATE INDEX processed_events_at ON processed_events(received_at);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE gifts (event_id TEXT PRIMARY KEY, sender TEXT NOT NULL, amount INTEGER NOT NULL, name TEXT NOT NULL, mapped_type TEXT, at INTEGER NOT NULL);`,
  // 2: broadcast session log
  `CREATE TABLE broadcast_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, ended_at INTEGER, seconds INTEGER NOT NULL DEFAULT 0, end_reason TEXT);`,
];

export class Db {
  readonly sql: DatabaseSync;
  constructor(readonly file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const row = this.sql.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    const current = row.v ?? 0;
    MIGRATIONS.forEach((m, i) => {
      const version = i + 1;
      if (version <= current) return;
      this.tx(() => {
        this.sql.exec(m);
        this.sql.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
      });
    });
  }

  private depth = 0;
  /** Run fn inside a transaction (nested calls join the outer transaction). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.sql.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      this.sql.exec('COMMIT');
      return r;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }

  getSetting(key: string): string | null {
    const r = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }
  setSetting(key: string, value: string): void {
    this.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  deleteSetting(key: string): void {
    this.sql.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
  getJson<T>(key: string, fallback: T): T {
    const v = this.getSetting(key);
    if (v === null) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  setJson(key: string, value: unknown): void {
    this.setSetting(key, JSON.stringify(value));
  }

  /** Remove bounded-growth tables' old rows. */
  prune(now: number): void {
    const week = 7 * 24 * 3600 * 1000;
    this.sql.prepare('DELETE FROM processed_events WHERE received_at < ?').run(now - week);
    this.sql.prepare('DELETE FROM votes WHERE received_at < ?').run(now - 24 * 3600 * 1000);
    this.sql.prepare('DELETE FROM resolutions WHERE at < ?').run(now - 30 * 24 * 3600 * 1000);
    this.sql.prepare("DELETE FROM interventions WHERE status = 'applied' AND applied_at < ?").run(now - 30 * 24 * 3600 * 1000);
    this.sql.prepare('DELETE FROM gifts WHERE at < ?').run(now - 90 * 24 * 3600 * 1000);
  }

  /** Consistent online snapshot. Keeps the newest `keep` backups. */
  backup(dir: string, now: Date, keep = 7, kind: 'daily' | 'manual' = 'daily'): string {
    mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const target = join(dir, `heist-${kind}-${stamp}.sqlite`);
    this.sql.prepare('VACUUM INTO ?').run(target);
    const re = new RegExp(`^heist-${kind}-.*\\.sqlite$`);
    const files = readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) rmSync(join(dir, old.f), { force: true });
    return target;
  }

  /** Newest backup time of a kind (0 if none). */
  lastBackupAt(dir: string, kind = 'daily'): number {
    try {
      return Math.max(0, ...readdirSync(dir).filter((f) => f.startsWith(`heist-${kind}-`)).map((f) => statSync(join(dir, f)).mtimeMs));
    } catch {
      return 0;
    }
  }

  close(): void {
    this.sql.close();
  }
}
