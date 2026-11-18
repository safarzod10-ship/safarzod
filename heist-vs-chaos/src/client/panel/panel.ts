import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import './panel.css';

type Json = Record<string, unknown>;
const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtDur = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const ago = (t: number | null | undefined) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago` : 'never');

const TOKEN_KEY = 'hvc-host-token';
let token = '';
try {
  const hash = new URLSearchParams(location.hash.slice(1));
  const t = hash.get('t');
  if (t) {
    localStorage.setItem(TOKEN_KEY, t);
    history.replaceState(null, '', location.pathname);
  }
  token = localStorage.getItem(TOKEN_KEY) ?? '';
} catch {
  /* private mode: token lives only in memory */
}

function toast(msg: string, bad = false): void {
  const t = $('#toast');
  t.textContent = msg;
  t.className = bad ? 'bad' : '';
  setTimeout(() => t.classList.add('hidden'), 3500);
}

async function api(path: string, body?: Json): Promise<Json> {
  const r = await fetch(`/api/admin/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : null,
  });
  if (r.status === 401) {
    showLogin('Wrong or expired token.');
    throw new Error('unauthorized');
  }
  const j = (await r.json().catch(() => ({}))) as Json;
  if (!r.ok) throw new Error(String(j.error ?? `HTTP ${r.status}`));
  return j;
}

function showLogin(err = ''): void {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#login-err').textContent = err;
}

$('#login-btn').addEventListener('click', () => {
  token = $<HTMLInputElement>('#token').value.trim();
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  void refresh(true);
});

let formsFilled = false;
let last: Json | null = null;

function kv(rows: [string, string][]): string {
  return rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join('');
}

function badge(label: string, cls: string): string {
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

async function refresh(first = false): Promise<void> {
  if (!token) return showLogin();
  let st: Json;
  try {
    st = await api('status');
  } catch (e) {
    if ((e as Error).message !== 'unauthorized') $('#badges').innerHTML = badge('server unreachable', 'bad');
    return;
  }
  last = st;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const g = st.game as Json;
  const b = st.broadcast as Json | null;
  const k = st.kick as Json;
  const run = g.run as Json;

  const bState = b ? String(b.state) : 'unavailable';
  $('#badges').innerHTML =
    badge(`stream: ${bState}`, bState === 'live' ? 'ok' : bState === 'retrying' || bState === 'starting' ? 'warn' : bState === 'failed' ? 'bad' : '') +
    badge(`kick: ${String(k.state)}`, k.state === 'connected' ? 'ok' : k.state === 'error' ? 'bad' : 'warn') +
    (g.autoMode ? badge('AUTO MODE', 'warn') : '');

  if (b) {
    const rem = b.remainingSeconds === null ? '24/7 mode' : fmtDur(Number(b.remainingSeconds));
    $('#stream-kv').innerHTML = kv([
      ['State', `${esc(b.state)}${b.nextRetryInSeconds !== null ? ` (retry in ${b.nextRetryInSeconds}s)` : ''}`],
      ['Target', b.target === 'null' ? 'encoder test (no upload)' : 'Kick'],
      ['Streamed', fmtDur(Number(b.usedSeconds))],
      ['Remaining', rem],
      ['Quality', `${esc(b.profileLabel)}${b.autoProfile ? ' · auto' : ''}`],
      ['Encoder', `${Number(b.fps).toFixed(0)} fps · ${Number(b.speed).toFixed(2)}x · ${b.bitrateKbps} kbps`],
      ['Game page', b.pageConnected ? 'connected' : 'not connected'],
      ['Kick sees live', k.isLive === null ? 'unknown' : k.isLive ? 'YES' : 'no'],
      ['Stream key', b.streamKeySet ? 'saved' : 'missing'],
      ['Last problem', esc(b.lastError ?? b.stopReason ?? '-')],
    ]);
  } else $('#stream-kv').innerHTML = kv([['Streaming', 'tools not installed on this host']]);

  $('#game-kv').innerHTML = kv([
    ['Level', `${g.level}/30 · ${esc(g.levelTitle)}`],
    ['Phase', `${esc(g.phase)}${g.paused ? ' (PAUSED)' : ''}`],
    ['Decision', `${Number(g.beatIndex) + 1}`],
    ['HP / alert', `${run.hp}/${run.maxHp} · ${run.alarm}`],
    ['Attempt', String(g.attempt)],
    ['Heists', String(g.heists)],
    ['Auto mode', g.autoMode ? esc(g.autoReason) : 'off'],
    ['Server', `up ${fmtDur(Number(st.uptime))} · ${(st.memory as Json).rssMb} MB · v${esc(st.version)}`],
  ]);
  const vote = g.vote as Json | null;
  if (vote) {
    const tally = (vote.tally as Json).counts as Record<string, number>;
    const left = Math.max(0, Math.round((Number(vote.endsAt) - Number(g.serverNow)) / 1000));
    $('#tally').innerHTML = `<b>Vote · ${left}s left</b>` + (vote.order as string[]).map((id, i) => `<div>#${i + 1} ${esc(id)} <b>${tally[id] ?? 0}</b></div>`).join('');
  } else $('#tally').innerHTML = '';

  $('#iv-list').innerHTML = (st.interventions as Json[])
    .map((r) => `<li><b>${esc(r.type)}</b> ${r.test ? 'TEST' : '@' + esc(r.sender)} · ${esc(r.status)} ${r.result ? '· ' + esc(r.result) : ''}</li>`)
    .join('');

  const counters = k.counters as Json;
  $('#kick-kv').innerHTML = kv([
    ['Status', esc(k.state)],
    ['Channel', esc(k.channel) + (k.broadcasterUserId ? ` (#${k.broadcasterUserId})` : '')],
    ['App keys', k.configured ? 'saved' : 'missing'],
    ['Webhook URL', `<code>${esc(k.webhookUrl ?? 'set PUBLIC_URL on the server')}</code>`],
    ['Subscriptions', esc((k.subscriptions as string[]).join(', ') || '-')],
    ['Last event', ago(k.lastEventAt as number | null)],
    ['Last chat', ago(k.lastChatAt as number | null)],
    ['Votes / dupes / bad sig', `${counters.accepted} / ${counters.duplicates} / ${counters.badSignature}`],
    ['Gift effects', k.giftsEnabled ? 'ON' : 'off'],
    ['Last problem', esc(k.lastError ?? '-')],
  ]);

  $('#errors').innerHTML = (st.errors as Json[]).map((e) => `<li><span>${new Date(Number(e.at)).toLocaleTimeString()}</span> <b>${esc(e.source)}</b> ${esc(e.message)}</li>`).join('') || '<li>No problems recorded.</li>';

  if (!formsFilled || first) {
    formsFilled = true;
    const sel = $<HTMLSelectElement>('#profile');
    sel.innerHTML = (st.profiles as Json[]).map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    if (b) {
      sel.value = String(b.profile);
      $<HTMLInputElement>('#autoprof').checked = !!b.autoProfile;
      $<HTMLSelectElement>('#mode').value = String(b.mode);
      $<HTMLInputElement>('#hours').value = String(Number(b.budgetSeconds) / 3600);
      $<HTMLSelectElement>('#target').value = String(b.target);
    }
    $<HTMLInputElement>('#kchan').value = String(k.channel);
    $<HTMLInputElement>('#gifts').checked = !!k.giftsEnabled;
    renderRules(k.giftRules as { minKicks: number; type: string }[]);
    renderVolume(g.audio as Record<string, number>);
  }
}

function renderRules(rules: { minKicks: number; type: string }[]): void {
  $('#rules').innerHTML = rules
    .map((r, i) => `<label class="rule">${esc(r.type)} from <input type="number" min="1" data-rule="${i}" data-type="${esc(r.type)}" value="${r.minKicks}"> Kicks</label>`)
    .join('');
}

function renderVolume(a: Record<string, number>): void {
  $('#vol').innerHTML = ['master', 'music', 'sfx', 'voice']
    .map((k) => `<label class="vol">${k}<input type="range" min="0" max="1" step="0.05" data-vol="${k}" value="${a[k] ?? 0.8}"></label>`)
    .join('');
  document.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((inp) =>
    inp.addEventListener('change', () => {
      void api('audio', { [inp.dataset.vol!]: Number(inp.value) }).then(() => toast('Volume saved'), (e: Error) => toast(e.message, true));
    }),
  );
}

async function act(name: string): Promise<void> {
  const confirmType = (what: string) => prompt(`Type RESET to ${what}`) === 'RESET';
  switch (name) {
    case 'stream-start':
      await api('broadcast/start', {});
      return toast('Stream starting… it takes ~10 s to go live.');
    case 'stream-stop':
      if (!confirm('Stop the stream?')) return;
      await api('broadcast/stop', {});
      return toast('Stream stopped.');
    case 'stream-save': {
      const body: Json = {
        profile: $<HTMLSelectElement>('#profile').value,
        autoProfile: $<HTMLInputElement>('#autoprof').checked,
        mode: $<HTMLSelectElement>('#mode').value,
        budgetHours: Number($<HTMLInputElement>('#hours').value) || 5,
        target: $<HTMLSelectElement>('#target').value,
      };
      const url = $<HTMLInputElement>('#rtmp').value.trim();
      const key = $<HTMLInputElement>('#skey').value.trim();
      if (url) body.rtmpUrl = url;
      if (key) body.streamKey = key;
      await api('broadcast/config', body);
      $<HTMLInputElement>('#skey').value = '';
      return toast('Stream settings saved.');
    }
    case 'budget-reset':
      if (!confirmType('reset the streamed-hours counter')) return;
      await api('broadcast/reset-budget', { confirm: 'RESET' });
      return toast('Hour counter reset.');
    case 'pause':
      await api('game/pause', {});
      return toast('Paused.');
    case 'resume':
      await api('game/resume', {});
      return toast('Resumed.');
    case 'restart-level':
      if (!confirm('Restart the current level? Completed levels stay saved.')) return;
      await api('game/restart-level', {});
      return toast('Level restarted.');
    case 'reset':
      if (!confirmType('erase ALL campaign progress (a backup is made first)')) return;
      await api('game/reset', { confirm: 'RESET' });
      return toast('Progress reset. Backup saved.');
    case 'restart-server':
      if (!confirm('Restart the game service? The game continues from its saved state.')) return;
      await api('server/restart', {});
      return toast('Restarting… the panel reconnects by itself.');
    case 'backup': {
      const r = await api('backup', {});
      return toast(`Backup saved: ${String(r.file)}`);
    }
    case 'kick-reconnect':
      await api('kick/reconnect', {});
      return toast('Reconnecting to Kick…');
    case 'kick-save': {
      const body: Json = { channel: $<HTMLInputElement>('#kchan').value.trim() };
      const id = $<HTMLInputElement>('#kid').value.trim();
      const sec = $<HTMLInputElement>('#ksecret').value.trim();
      if (id) body.clientId = id;
      if (sec) body.clientSecret = sec;
      await api('kick/config', body);
      $<HTMLInputElement>('#kid').value = '';
      $<HTMLInputElement>('#ksecret').value = '';
      return toast('Kick settings saved. Connecting…');
    }
    case 'gifts-save': {
      const rules = [...document.querySelectorAll<HTMLInputElement>('[data-rule]')].map((i) => ({ minKicks: Math.max(1, Number(i.value) || 1), type: i.dataset.type! }));
      await api('kick/config', { giftsEnabled: $<HTMLInputElement>('#gifts').checked, giftRules: rules });
      return toast('Gift effects saved.');
    }
    case 'logout':
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      token = '';
      return showLogin();
  }
}

document.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-iv]');
  if (!btn) return;
  btn.setAttribute('disabled', '');
  const p = btn.dataset.iv
    ? api('intervention', { type: btn.dataset.iv }).then((r) => toast(`${btn.dataset.iv}: ${String(r.result)}`))
    : act(btn.dataset.act!);
  void p
    .catch((e: Error) => e.message !== 'unauthorized' && toast(e.message, true))
    .finally(() => {
      btn.removeAttribute('disabled');
      void refresh();
    });
});

void refresh(true);
setInterval(() => {
  if (document.visibilityState === 'visible' && token) void refresh();
}, 2000);
void last;
