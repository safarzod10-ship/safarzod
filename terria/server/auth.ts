/**
 * Telegram Mini App initData verification (WebCrypto, works in Workers and Node).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
 *
 * data_check_string = every received field except `hash`, sorted by key,
 * "key=value" joined by "\n". Some clients' docs also drop `signature`; both
 * variants are accepted.
 */

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

async function hmacKey(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function secretKey(botToken: string): Promise<CryptoKey> {
  let k = keyCache.get(botToken);
  if (!k) {
    k = (async () => {
      const base = await hmacKey(enc.encode('WebAppData'));
      const secret = await crypto.subtle.sign('HMAC', base, enc.encode(botToken));
      return hmacKey(secret);
    })();
    keyCache.set(botToken, k);
  }
  return k;
}

function hex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Constant-time string compare. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  return hex(await crypto.subtle.sign('HMAC', await secretKey(botToken), enc.encode(check)));
}

/**
 * Returns the user when the signature is valid and not older than maxAgeSec,
 * otherwise null.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec = 24 * 3600,
): Promise<TgUser | null> {
  if (!initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of params) if (k !== 'hash') fields[k] = v;
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;

  let ok = same(await signInitData(fields, botToken), hash);
  if (!ok && 'signature' in fields) {
    const { signature: _drop, ...rest } = fields;
    ok = same(await signInitData(rest, botToken), hash);
  }
  if (!ok) return null;
  try {
    const user = JSON.parse(fields.user ?? 'null') as TgUser | null;
    if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id)) return null;
    return user;
  } catch {
    return null;
  }
}

export function displayName(u: TgUser): string {
  const n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return (n || u.username || `Игрок ${u.id}`).slice(0, 48);
}
