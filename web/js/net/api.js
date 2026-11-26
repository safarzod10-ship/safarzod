// Client of the game backend (Cloudflare Worker). Balance, Stars top-ups and staked runs; every request carries Telegram initData.
const API_BASE = "https://hypo-bot.dvor-game.workers.dev";
const tg = () => window.Telegram && window.Telegram.WebApp;

async function call(path, body) {
  const t = tg();
  try { return await request(path, body, t); } catch (e) { throw new Error(e instanceof TypeError ? "Нет связи с сервером" : e.message); }
}
async function request(path, body, t) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-init-data": t ? t.initData : "" },
    body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({ error: "Нет связи с сервером" }));
  if (!res.ok) throw new Error(j.error || "Ошибка " + res.status);
  return j;
}

export const Api = {
  profile: null, // {balance, best, packs, stakes, reward}
  error: "",
  loading: false,
  table: [],
  async refresh() {
    const t = tg();
    if (!t || !t.initData) { this.profile = null; this.error = "Откройте игру через Telegram"; return null; }
    this.loading = true;
    try {
      const p = await call("/api/profile");
      this.profile = p; this.error = "";
      this.table = (p.reward || []).map(([min, mult]) => ({ min, mult }));
    } catch (e) { this.profile = null; this.error = e.message; }
    this.loading = false;
    return this.profile;
  },
  rewardFor(score) { let m = 0; for (const r of this.table) if (score >= r.min) m = r.mult; return m; },
  startRun(stake) { return call("/api/run/start", { stake }); },
  finishRun(runId, score) { return call("/api/run/finish", { runId, score }); },
  // Telegram Stars invoice; resolves "paid" | "cancelled" | "failed" | "pending"
  async topUp(amount) {
    const { link } = await call("/api/topup", { amount });
    const t = tg();
    if (!t || !t.openInvoice) { window.open(link, "_blank"); return "pending"; }
    return new Promise((resolve) => t.openInvoice(link, resolve));
  },
};

// A run is one life in the Neon District: it starts when a room begins after the menu or a retry and ends on death or quit.
// Score (the original HUD has none): kills * 100 + rooms cleared * 300.
export const Run = {
  stake: 0, active: null, kills: 0, rooms: 0, last: null,
  get score() { return this.kills * 100 + this.rooms * 300; },
  async begin() {
    if (this.active) return;
    this.kills = 0; this.rooms = 0; this.last = null;
    this.active = { runId: null, stake: this.stake, pending: true };
    if (!Api.profile) return;
    const run = this.active;
    try {
      const r = await call("/api/run/start", { stake: this.stake });
      run.runId = r.runId;
      if (typeof r.balance === "number") Api.profile.balance = r.balance;
    } catch (e) { run.error = e.message; }
    run.pending = false;
  },
  kill() { if (this.active) this.kills++; },
  roomCleared() { if (this.active) this.rooms++; },
  async end() {
    const run = this.active;
    if (!run) return null;
    this.active = null;
    const score = this.score;
    this.last = { score, stake: run.stake, mult: null, payout: null };
    if (!run.runId) return this.last;
    try {
      const r = await call("/api/run/finish", { runId: run.runId, score });
      Object.assign(this.last, { mult: r.mult, payout: r.payout });
      if (Api.profile) { Api.profile.balance = r.balance; Api.profile.best = r.best; }
    } catch (e) { this.last.error = e.message; }
    return this.last;
  },
};
