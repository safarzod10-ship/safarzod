// Backend layer of the mini app.
//
// DEMO mode (default): balance and runs live in the browser (localStorage), Stars are not real.
// REAL mode: set API_BASE to your server. The server must
//   - check Telegram initData (HMAC with the bot token) on every request,
//   - keep the balance, take the stake in startRun and pay out in finishRun,
//   - recompute the reward itself from the run log (never trust a score sent by the client),
//   - sell Stars through the bot (createInvoiceLink, currency "XTR").
// The game only calls the four functions below, so switching modes does not touch game.js.

const API_BASE = "";           // e.g. "https://api.example.com" — empty = demo mode
const DEMO_START_BALANCE = 500;

// Reward multiplier by score. Shown in the menu; in REAL mode the server's table is authoritative.
const REWARD_TABLE = [
  { min: 0,     mult: 0 },
  { min: 1500,  mult: 0.5 },
  { min: 3000,  mult: 1 },
  { min: 6000,  mult: 1.5 },
  { min: 10000, mult: 2 },
  { min: 16000, mult: 3 },
];

const Api = (() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("nb_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("nb_" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const rewardFor = (score) => { let m = 0; for (const r of REWARD_TABLE) if (score >= r.min) m = r.mult; return m; };

  async function call(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": tg ? tg.initData : "" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error("api " + path + " " + res.status);
    return res.json();
  }

  return {
    demo: !API_BASE,
    rewardFor,
    table: REWARD_TABLE,

    async getProfile() {
      if (API_BASE) return call("/profile");
      return { balance: store.get("balance", DEMO_START_BALANCE), best: store.get("best", 0) };
    },

    // Takes the stake. Returns a run id the server uses to match the result.
    async startRun(stake) {
      if (API_BASE) return call("/run/start", { stake });
      const bal = store.get("balance", DEMO_START_BALANCE);
      if (stake > bal) throw new Error("Недостаточно звёзд");
      store.set("balance", bal - stake);
      return { runId: Date.now().toString(36), balance: bal - stake };
    },

    // Sends the result (score + compact event log for server-side checks). Returns the payout.
    async finishRun(runId, stake, score, log) {
      if (API_BASE) return call("/run/finish", { runId, score, log });
      const mult = rewardFor(score);
      const payout = Math.floor(stake * mult);
      const bal = store.get("balance", DEMO_START_BALANCE) + payout;
      store.set("balance", bal);
      const best = Math.max(store.get("best", 0), score);
      store.set("best", best);
      return { mult, payout, balance: bal, best };
    },

    // Demo top-up so the balance never gets stuck at zero while testing.
    async demoRefill() { if (!API_BASE) { store.set("balance", DEMO_START_BALANCE); } return this.getProfile(); },
  };
})();
