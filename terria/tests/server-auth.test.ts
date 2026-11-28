import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../server/auth.ts';

const TOKEN = '123456:TEST-token-not-real';
const now = 1_800_000_000;

async function initData(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const hash = await signInitData(fields, token);
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Ада', username: 'ada' });

describe('initData verification', () => {
  it('accepts a valid signature', async () => {
    const data = await initData({ auth_date: String(now - 60), query_id: 'AAE', user });
    const u = await verifyInitData(data, TOKEN, now);
    expect(u?.id).toBe(42);
    expect(u?.first_name).toBe('Ада');
  });

  it('accepts data signed with the signature field included or excluded', async () => {
    const withSig = await initData({ auth_date: String(now), user, signature: 'abc' });
    expect((await verifyInitData(withSig, TOKEN, now))?.id).toBe(42);
    const hash = await signInitData({ auth_date: String(now), user }, TOKEN);
    const p = new URLSearchParams({ auth_date: String(now), user, signature: 'abc', hash });
    expect((await verifyInitData(p.toString(), TOKEN, now))?.id).toBe(42);
  });

  it('rejects a wrong token, a tampered field and old data', async () => {
    const data = await initData({ auth_date: String(now), user });
    expect(await verifyInitData(data, '999:other', now)).toBeNull();
    expect(await verifyInitData(data.replace('42', '43'), TOKEN, now)).toBeNull();
    expect(await verifyInitData(data, TOKEN, now + 2 * 86400)).toBeNull();
    expect(await verifyInitData('', TOKEN, now)).toBeNull();
    expect(await verifyInitData('user=x', TOKEN, now)).toBeNull();
  });
});
