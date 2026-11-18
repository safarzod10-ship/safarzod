// Adds (or confirms) the game's site route in an existing Caddy through its local admin API.
// Run inside the Caddy container's network namespace:
//   docker run --rm --network container:<caddy> IMAGE caddy-route <host> <upstream>
// Idempotent: does nothing if the route with the same host is present. Never touches other routes.
const [host, upstream] = process.argv.slice(2);
const ADMIN = 'http://127.0.0.1:2019';
const ID = 'heist-vs-chaos-route';
if (!host || !upstream || !/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.-]+:\d+$/i.test(upstream)) {
  console.error('usage: caddy-route <host> <upstream:port>');
  process.exit(2);
}

async function call(method, path, body) {
  const r = await fetch(ADMIN + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

const route = {
  '@id': ID,
  match: [{ host: [host] }],
  handle: [
    {
      handler: 'subroute',
      routes: [
        {
          handle: [
            { handler: 'request_body', max_size: 1048576 },
            { handler: 'encode', encodings: { gzip: {} } },
            { handler: 'reverse_proxy', upstreams: [{ dial: upstream }] },
          ],
        },
      ],
    },
  ],
  terminal: true,
};

try {
  const cur = await call('GET', `/id/${ID}`);
  if (cur.ok) {
    const r = JSON.parse(cur.text);
    const same = r?.match?.[0]?.host?.[0] === host && JSON.stringify(r).includes(upstream);
    if (same) {
      console.log('route present');
      process.exit(0);
    }
    await call('DELETE', `/id/${ID}`);
  }
  const servers = await call('GET', '/config/apps/http/servers');
  if (!servers.ok) throw new Error(`cannot read Caddy servers (HTTP ${servers.status})`);
  const list = JSON.parse(servers.text) ?? {};
  const name = Object.keys(list).find((k) => (list[k].listen ?? []).some((l) => /:443$/.test(l))) ?? Object.keys(list)[0];
  if (!name) throw new Error('Caddy has no HTTP server configured');
  // Insert first so it wins over catch-all routes of the other site.
  const add = await call('PUT', `/config/apps/http/servers/${encodeURIComponent(name)}/routes/0`, route);
  if (!add.ok) throw new Error(`Caddy rejected the route (HTTP ${add.status}): ${add.text.slice(0, 300)}`);
  console.log(`route added to server ${name}`);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
