/**
 * Deploy helper for environments without a Cloudflare API token (the upload
 * itself only needs the short-lived JWT of an assets upload session).
 *
 *   node tools/deploy/assets.mjs manifest dist > manifest.json
 *       -> { "/index.html": { hash, size }, ... } for "Create Worker Assets Upload Session"
 *   node tools/deploy/assets.mjs upload dist <accountId> <session.json>
 *       -> uploads the requested buckets, prints the completion JWT
 *
 * Normal deploys just run `npx wrangler deploy` with CLOUDFLARE_API_TOKEN set.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let files = function (dir) {
  return walk(dir).map((p) => {
    const buf = readFileSync(p);
    const b64 = buf.toString('base64');
    const ext = extname(p);
    const hash = createHash('sha256').update(b64 + ext.slice(1)).digest('hex').slice(0, 32);
    return { path: '/' + relative(dir, p).split('\\').join('/'), size: buf.length, hash, b64, type: TYPES[ext] ?? 'application/octet-stream' };
  });
}

const [, , cmd, dir, accountId, sessionFile] = process.argv;
// With BUILD_ID set, asset hashes are sha256(buildId + path): a fresh id per
// deploy uploads every file again, and the manifest can be rebuilt from the
// list of paths and sizes alone (compact form for the "compact" command).
const BUILD_ID = process.env.BUILD_ID;
if (BUILD_ID) {
  const orig = files;
  files = (d) => orig(d).map((f) => ({ ...f, hash: createHash('sha256').update(BUILD_ID + f.path).digest('hex').slice(0, 32) }));
}
if (cmd === 'compact') {
  // { other: [[path, size]...], regions: [size of /regions/0.json ...], index: size of /regions/index.json }
  const all = files(dir);
  const regions = [];
  const other = [];
  for (const f of all) {
    const m = /^\/regions\/(\d+)\.json$/.exec(f.path);
    if (m) regions[Number(m[1])] = f.size;
    else other.push([f.path, f.size]);
  }
  process.stdout.write(JSON.stringify({ other, regions }));
} else if (cmd === 'manifest') {
  const m = {};
  for (const f of files(dir)) m[f.path] = { hash: f.hash, size: f.size };
  process.stdout.write(JSON.stringify(m));
} else if (cmd === 'upload') {
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  const byHash = new Map(files(dir).map((f) => [f.hash, f]));
  let jwt = session.jwt;
  for (const bucket of session.buckets ?? []) {
    const form = new FormData();
    for (const h of bucket) {
      const f = byHash.get(h);
      if (!f) throw new Error('unknown hash ' + h);
      form.append(h, new File([f.b64], h, { type: f.type }));
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/assets/upload?base64=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.jwt}` },
      body: form,
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(`upload failed ${res.status}: ${JSON.stringify(body.errors)}`);
    if (body.result?.jwt) jwt = body.result.jwt;
    process.stderr.write(`uploaded ${bucket.length} files\n`);
  }
  process.stdout.write(jwt);
} else {
  console.error('usage: assets.mjs manifest <dir> | upload <dir> <accountId> <session.json>');
  process.exit(1);
}
