// Client side of the game API. The server (Cloudflare Worker, same origin) keeps the balance,
// takes stakes, pays out and sells Stars through the bot. Every request carries Telegram initData.
const Api = (() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  let table = [];
  async function call(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-init-data": tg ? tg.initData : "" },
      body: JSON.stringify(body || {}),
    });
    const j = await res.json().catch(() => ({ error: "Нет связи с сервером" }));
    if (!res.ok) throw new Error(j.error || "Ошибка " + res.status);
    return j;
  }
  const rewardFor = (score) => { let m = 0; for (const r of table) if (score >= r.min) m = r.mult; return m; };
  return {
    demo: false,
    get table() { return table; },
    rewardFor,
    async getProfile() {
      const p = await call("/api/profile");
      table = p.reward.map(([min, mult]) => ({ min, mult }));
      return p;
    },
    async startRun(stake) { return call("/api/run/start", { stake }); },
    async finishRun(runId, stake, score, log) { return call("/api/run/finish", { runId, score, log }); },
    // Opens the Telegram Stars payment sheet; resolves with "paid" | "cancelled" | "failed" | "pending".
    async topUp(amount) {
      const { link } = await call("/api/topup", { amount });
      if (!tg || !tg.openInvoice) { window.open(link, "_blank"); return "pending"; }
      return new Promise((resolve) => tg.openInvoice(link, resolve));
    },
  };
})();
