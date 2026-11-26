// Telegram bot + Mini App backend on Cloudflare Workers.
// The mini app itself is static (GitHub Pages, WEBAPP_URL); this Worker is its API and the bot.
// Bindings: DB (D1), BOT_TOKEN (secret), WEBHOOK_SECRET (secret), SETUP_KEY (secret), WEBAPP_URL (var).
// Routes: POST /api/* -> game API (Telegram initData required, CORS for the mini app origin);
// POST /webhook -> Telegram updates (payments, /start); GET /setup?key=SETUP_KEY -> register webhook and menu button.

const PACKS = [50, 100, 250, 500];                        // Stars top-up packs
const STAKES = [0, 10, 25, 50];
const REWARD = [[0, 0], [1500, 0.5], [3000, 1], [6000, 1.5], [10000, 2], [16000, 3]]; // [min score, multiplier]
const MAX_POINTS_PER_SEC = 400;                           // sanity limit for a submitted score

let CORS = {};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Telegram Mini App initData check (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
async function checkInitData(initData, token) {
  if (!initData || !token) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash"); if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac("WebAppData", token);
  if (hex(await hmac(secret, dcs)) !== hash) return null;
  const age = Date.now() / 1000 - Number(p.get("auth_date") || 0);
  if (age > 86400) return null;
  try { return JSON.parse(p.get("user")); } catch { return null; }
}

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, balance INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0, created INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, payload TEXT, created INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, stake INTEGER NOT NULL, started INTEGER NOT NULL, finished INTEGER, score INTEGER, payout INTEGER)"),
  ]);
}
async function user(env, u) {
  await env.DB.prepare("INSERT INTO users (id, name, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(u.id, u.first_name || "", Date.now()).run();
  return env.DB.prepare("SELECT id, balance, best FROM users WHERE id = ?").bind(u.id).first();
}
const multFor = (score) => { let m = 0; for (const [min, k] of REWARD) if (score >= min) m = k; return m; };

async function api(path, req, env) {
  const u = await checkInitData(req.headers.get("x-telegram-init-data"), env.BOT_TOKEN);
  if (!u) return json({ error: "Откройте игру через Telegram" }, 401);
  const body = await req.json().catch(() => ({}));
  const me = await user(env, u);

  if (path === "/api/profile") return json({ balance: me.balance, best: me.best, packs: PACKS, stakes: STAKES, reward: REWARD });

  if (path === "/api/topup") {
    const amount = Number(body.amount);
    if (!PACKS.includes(amount)) return json({ error: "Неверная сумма" }, 400);
    const link = await tg(env, "createInvoiceLink", {
      title: `${amount} ⭐ на игровой баланс`, description: "Пополнение баланса в игре", payload: `topup:${u.id}:${amount}:${crypto.randomUUID()}`,
      provider_token: "", currency: "XTR", prices: [{ label: `${amount} ⭐`, amount }],
    });
    return json({ link });
  }

  if (path === "/api/run/start") {
    const stake = Number(body.stake);
    if (!STAKES.includes(stake)) return json({ error: "Неверная ставка" }, 400);
    const id = crypto.randomUUID();
    const res = await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").bind(stake, u.id, stake),
      env.DB.prepare("INSERT INTO runs (id, user_id, stake, started) SELECT ?, ?, ?, ? WHERE changes() = 1").bind(id, u.id, stake, Date.now()),
    ]);
    if (!res[1].meta.changes) return json({ error: "Недостаточно звёзд" }, 402);
    const b = await env.DB.prepare("SELECT balance FROM users WHERE id = ?").bind(u.id).first();
    return json({ runId: id, balance: b.balance });
  }

  if (path === "/api/run/finish") {
    const run = await env.DB.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").bind(String(body.runId), u.id).first();
    if (!run || run.finished) return json({ error: "Забег не найден" }, 404);
    const secs = (Date.now() - run.started) / 1000;
    let score = Math.max(0, Math.floor(Number(body.score) || 0));
    if (score > secs * MAX_POINTS_PER_SEC) score = 0;          // impossible score for the time played: no payout
    const mult = multFor(score), payout = Math.floor(run.stake * mult);
    const done = await env.DB.prepare("UPDATE runs SET finished = ?, score = ?, payout = ? WHERE id = ? AND finished IS NULL").bind(Date.now(), score, payout, run.id).run();
    if (done.meta.changes) await env.DB.prepare("UPDATE users SET balance = balance + ?, best = MAX(best, ?) WHERE id = ?").bind(payout, score, u.id).run();
    const b = await env.DB.prepare("SELECT balance, best FROM users WHERE id = ?").bind(u.id).first();
    return json({ mult, payout, balance: b.balance, best: b.best });
  }
  return json({ error: "not found" }, 404);
}

async function webhook(req, env, app) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const up = await req.json();
  if (up.pre_checkout_query) {
    const q = up.pre_checkout_query, parts = String(q.invoice_payload).split(":");
    const ok = parts[0] === "topup" && Number(parts[1]) === q.from.id && Number(parts[2]) === q.total_amount && q.currency === "XTR";
    await tg(env, "answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "Платёж не распознан" });
    return new Response("ok");
  }
  const m = up.message;
  if (m && m.successful_payment) {
    const sp = m.successful_payment;
    await user(env, m.from);
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO payments (charge_id, user_id, amount, payload, created) VALUES (?, ?, ?, ?, ?)")
      .bind(sp.telegram_payment_charge_id, m.from.id, sp.total_amount, sp.invoice_payload, Date.now()).run();
    if (ins.meta.changes) await env.DB.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(sp.total_amount, m.from.id).run();
    await tg(env, "sendMessage", { chat_id: m.chat.id, text: `Зачислено ${sp.total_amount} ⭐` });
    return new Response("ok");
  }
  if (m && m.text) {
    const cmd = m.text.split(/[\s@]/)[0];
    if (cmd === "/paysupport") await tg(env, "sendMessage", { chat_id: m.chat.id, text: "Вопросы по оплате: напишите сюда, ответим в течение 24 часов." });
    else await tg(env, "sendMessage", { chat_id: m.chat.id, text: "Играть:", reply_markup: { inline_keyboard: [[{ text: "▶ Играть", web_app: { url: app } }]] } });
  }
  return new Response("ok");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = url.origin, app = env.WEBAPP_URL;
    CORS = { "access-control-allow-origin": new URL(app).origin, "access-control-allow-headers": "content-type, x-telegram-init-data", "access-control-allow-methods": "POST, OPTIONS", "vary": "origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/health") { await ensureSchema(env); return json({ ok: true, bot: !!env.BOT_TOKEN }); }
      if (url.pathname === "/setup") {
        if (url.searchParams.get("key") !== env.SETUP_KEY) return new Response("forbidden", { status: 403 });
        await ensureSchema(env);
        await tg(env, "setWebhook", { url: origin + "/webhook", secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "pre_checkout_query"], drop_pending_updates: true });
        await tg(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "Играть", web_app: { url: app } } });
        await tg(env, "setMyCommands", { commands: [{ command: "start", description: "Играть" }, { command: "paysupport", description: "Помощь с оплатой" }] });
        const me = await tg(env, "getMe", {});
        return json({ ok: true, bot: "@" + me.username, webapp: app });
      }
      if (req.method === "POST" && url.pathname === "/webhook") return await webhook(req, env, app);
      if (req.method === "POST" && url.pathname.startsWith("/api/")) return await api(url.pathname, req, env);
      return new Response("not found", { status: 404 });
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
