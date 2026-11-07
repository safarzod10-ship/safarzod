import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SEC = 24 * 60 * 60;

export function validateInitData(initData, botToken, { maxAgeSec = MAX_AGE_SEC, now = Date.now() } = {}) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get('user') ?? 'null');
    if (!user || !Number.isSafeInteger(user.id)) return null;
    return { ...user, startParam: params.get('start_param') ?? '', authDate };
  } catch {
    return null;
  }
}

export function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}
