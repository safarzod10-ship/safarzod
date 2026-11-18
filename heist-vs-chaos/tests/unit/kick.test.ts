import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { Db } from '../../src/server/db.js';
import { GameRuntime, DEFAULT_TIMINGS } from '../../src/server/runtime.js';
import { ErrorLog, SecretStore, scrub, registerSecret } from '../../src/server/secrets.js';
import { KickIntegration, parseVote } from '../../src/server/kick/kick.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

function setup() {
  const db = new Db(':memory:');
  let now = Date.now();
  const clock = { now: () => now, mono: () => now };
  const rt = new GameRuntime(db, clock, () => 0, DEFAULT_TIMINGS);
  const secrets = new SecretStore(db, randomBytes(32).toString('base64'));
  const kick = new KickIntegration(db, secrets, rt, new ErrorLog(), {
    channel: 'safarzod',
    apiBase: 'https://kick.invalid',
    idBase: 'https://id.kick.invalid',
    now: () => now,
    fetch: (async () => {
      throw new Error('network disabled in tests');
    }) as typeof fetch,
  });
  kick.setPublicKey(pem);
  kick.status.broadcasterUserId = 139575365;
  return { db, rt, kick, advance: (ms: number) => (now += ms), now: () => now };
}

function signed(body: object, id = 'msg-' + Math.random(), key = privateKey, ts = new Date().toISOString()) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = sign('sha256', Buffer.concat([Buffer.from(`${id}.${ts}.`), raw]), key).toString('base64');
  return {
    raw,
    headers: { 'kick-event-message-id': id, 'kick-event-message-timestamp': ts, 'kick-event-signature': sig, 'kick-event-type': 'chat.message.sent', 'kick-event-version': '1' },
  };
}

let fakeNow = Date.now();
const chat = (content: string, user = 1, broadcaster = 139575365) => ({
  message_id: 'm' + Math.random(),
  broadcaster: { user_id: broadcaster, username: 'safarzod' },
  sender: { user_id: user, username: `viewer${user}` },
  content,
  created_at: new Date(fakeNow).toISOString(),
});

function openVote(x: ReturnType<typeof setup>) {
  x.advance(DEFAULT_TIMINGS.introMs + 10);
  x.rt.tick();
  fakeNow = x.now() + 100;
  expect(x.rt.state.phase).toBe('vote');
}

describe('kick webhooks', () => {
  it('accepts a correctly signed chat vote', async () => {
    const x = setup();
    openVote(x);
    const m = signed(chat('2'));
    const r = await x.kick.handleWebhook(m.headers, m.raw);
    expect(r.code).toBe(200);
    expect(x.rt.tally().voters).toBe(1);
  });

  it('rejects a bad signature, wrong key and tampered body', async () => {
    const x = setup();
    openVote(x);
    const m = signed(chat('1'), 'id1', other);
    expect((await x.kick.handleWebhook(m.headers, m.raw)).code).toBe(401);
    const n = signed(chat('1'));
    expect((await x.kick.handleWebhook(n.headers, Buffer.from(n.raw.toString().replace('"1"', '"3"')))).code).toBe(401);
    expect(x.rt.tally().voters).toBe(0);
  });

  it('ignores another channel and duplicate deliveries', async () => {
    const x = setup();
    openVote(x);
    const m = signed(chat('1', 5, 999));
    expect((await x.kick.handleWebhook(m.headers, m.raw)).body).toBe('other channel');
    const d = signed(chat('1', 6), 'dup-1');
    await x.kick.handleWebhook(d.headers, d.raw);
    expect((await x.kick.handleWebhook(d.headers, d.raw)).body).toBe('duplicate');
    expect(x.kick.status.counters.duplicates).toBe(1);
  });

  it('rejects missing headers and malformed JSON', async () => {
    const x = setup();
    expect((await x.kick.handleWebhook({}, Buffer.from('{}'))).code).toBe(400);
    const id = 'bad-json';
    const ts = new Date().toISOString();
    const raw = Buffer.from('{not json');
    const sig = sign('sha256', Buffer.concat([Buffer.from(`${id}.${ts}.`), raw]), privateKey).toString('base64');
    const r = await x.kick.handleWebhook({ 'kick-event-message-id': id, 'kick-event-message-timestamp': ts, 'kick-event-signature': sig, 'kick-event-type': 'chat.message.sent' }, raw);
    expect(r.code).toBe(400);
  });

  it('gift with effects disabled is thanked, enabled maps to a queued intervention once', async () => {
    const x = setup();
    const gift = { broadcaster: { user_id: 139575365, username: 's' }, sender: { user_id: 9, username: 'Big<Fan>' }, gift: { amount: 100, name: 'Rage Quit' } };
    const g1 = signed(gift, 'g1');
    g1.headers['kick-event-type'] = 'kicks.gifted';
    expect((await x.kick.handleWebhook(g1.headers, g1.raw)).body).toBe('gift thanked');
    x.kick.status.giftsEnabled = true;
    const g2 = signed(gift, 'g2');
    g2.headers['kick-event-type'] = 'kicks.gifted';
    expect((await x.kick.handleWebhook(g2.headers, g2.raw)).body).toMatch(/gift REVOTE queued/);
    expect((await x.kick.handleWebhook(g2.headers, g2.raw)).body).toBe('duplicate');
    expect(x.rt.queuedRows()).toHaveLength(1);
    expect(x.rt.queuedRows()[0]!.sender).toBe('BigFan');
  });

  it('parses only clean vote messages', () => {
    expect(parseVote('2')).toBe(2);
    expect(parseVote(' 4 ')).toBe(4);
    expect(parseVote('!3')).toBe(3);
    expect(parseVote('5')).toBeNull();
    expect(parseVote('2 please')).toBeNull();
    expect(parseVote('12')).toBeNull();
  });
});

describe('secrets', () => {
  it('scrubs registered secrets and generic token shapes', () => {
    registerSecret('live_abcdefgh12345');
    expect(scrub('key=live_abcdefgh12345 ok')).not.toContain('live_abcdefgh12345');
    expect(scrub('Authorization: Bearer abc.def.ghijklmnop')).toBe('Authorization: Bearer ***');
    expect(scrub('rtmps://x.live-video.net:443/app/sk_us-west-2_ABCDEFGHIJ')).toBe('rtmps://x.live-video.net:443/app/***');
  });
  it('encrypts at rest', () => {
    const db = new Db(':memory:');
    const s = new SecretStore(db, randomBytes(32).toString('base64'));
    s.set('stream_key', 'super-secret-key-1');
    expect(db.getSetting('secret:stream_key')).not.toContain('super-secret');
    expect(s.get('stream_key')).toBe('super-secret-key-1');
  });
});
