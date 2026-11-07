import { EventEmitter } from 'node:events';

const API = 'https://toncenter.com/api/v2';

export const parseMemo = (text) => {
  const m = /^\s*(?:ra[-\s]?)?(\d{1,15})\s*$/i.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
};

export class GramWatcher extends EventEmitter {
  constructor({
    store,
    wallet,
    apiKey = '',
    minDeposit = 100_000_000,
    refPercent = 0,
    fetchImpl = fetch,
    intervalMs = 10_000,
  }) {
    super();
    this.store = store;
    this.wallet = wallet;
    this.apiKey = apiKey;
    this.minDeposit = minDeposit;
    this.refPercent = refPercent;
    this.fetch = fetchImpl;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (!this.wallet || this.timer) return;
    this.timer = setInterval(() => this.poll().catch((e) => console.error('gram:', e.message)), this.intervalMs);
    this.timer.unref?.();
    this.poll().catch((e) => console.error('gram:', e.message));
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const url = `${API}/getTransactions?address=${encodeURIComponent(this.wallet)}&limit=50&archival=true`;
      const res = await this.fetch(url, {
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return this.process(data.result);
    } finally {
      this.busy = false;
    }
  }

  process(transactions) {
    if (this.store.getSetting('gram_last_lt') === null) {
      const top = transactions.reduce(
        (m, tx) => (BigInt(tx.transaction_id.lt) > m ? BigInt(tx.transaction_id.lt) : m),
        0n,
      );
      this.store.setSetting('gram_last_lt', String(top));
      return 0;
    }
    const last = BigInt(this.store.getSetting('gram_last_lt'));
    let max = last;
    let credited = 0;
    const list = [...transactions].sort((a, b) => (BigInt(a.transaction_id.lt) < BigInt(b.transaction_id.lt) ? -1 : 1));
    for (const tx of list) {
      const lt = BigInt(tx.transaction_id.lt);
      if (lt <= last) continue;
      if (lt > max) max = lt;
      const msg = tx.in_msg;
      if (!msg?.source || msg.bounced) continue;
      const amount = Number(msg.value);
      if (!Number.isSafeInteger(amount) || amount < this.minDeposit) continue;
      const userId = parseMemo(msg.message);
      if (!userId) {
        this.emit('unmatched', { hash: tx.transaction_id.hash, amount, sender: msg.source, memo: msg.message ?? '' });
        continue;
      }
      const user = this.store.creditGramDeposit({
        hash: tx.transaction_id.hash,
        userId,
        amount,
        sender: msg.source,
        lt: String(lt),
        refPercent: this.refPercent,
      });
      if (user) {
        credited++;
        this.emit('deposit', { user, amount });
      } else if (!this.store.getUser(userId)) {
        this.emit('unmatched', { hash: tx.transaction_id.hash, amount, sender: msg.source, memo: msg.message ?? '' });
      }
    }
    if (max > last) this.store.setSetting('gram_last_lt', String(max));
    return credited;
  }
}
