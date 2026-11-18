// Fails if anything that looks like a secret is tracked in git or present in the client build.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\bsk_(?:live|us|eu)[-_][A-Za-z0-9_-]{10,}/, 'stream key'],
  [/\blive_[0-9]{6,}_[A-Za-z0-9]{20,}/, 'stream key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/^(?:ADMIN_TOKEN|SECRET_KEY|KICK_CLIENT_SECRET)=(?!\$\()\S{8,}/m, 'filled secret in env file'],
  [/xi-api-key|sk-ant-[A-Za-z0-9]/, 'API key'],
];
const ALLOW = [/tests\//, /tools\/check-secrets\.mjs$/];
const files = [];
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  /* not a git checkout */
}
for (const f of tracked) {
  if (ALLOW.some((a) => a.test(f))) continue;
  if (/\.(png|jpe?g|ogg|wav|woff2?|ico|sqlite)$/i.test(f)) continue;
  files.push(f);
}
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
for (const f of walk('dist/client')) if (/\.(js|html|css|json)$/.test(f)) files.push(f);
const bad = [];
for (const f of files) {
  let txt;
  try {
    txt = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [re, what] of PATTERNS) if (re.test(txt)) bad.push(`${f}: ${what}`);
}
for (const f of tracked) if (/(^|\/)(\.env|.*\.sqlite|.*\.db)$/.test(f) && !f.endsWith('.env.example')) bad.push(`${f}: must not be committed`);
if (bad.length) {
  console.error('Possible secrets found:\n' + bad.map((b) => ' - ' + b).join('\n'));
  process.exit(1);
}
console.log(`secret scan ok (${files.length} files)`);
