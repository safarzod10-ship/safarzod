const SOURCES = [
  {
    url: 'https://tonapi.io/v2/rates?tokens=ton&currencies=usd',
    read: (d) => d?.rates?.TON?.prices?.USD,
  },
  {
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    read: (d) => d?.['the-open-network']?.usd,
  },
];

export function exchangeRates(gramUsd, { starBuyUsd, starSellUsd, spread }) {
  const mid = gramUsd / ((starBuyUsd + starSellUsd) / 2);
  return {
    game: Math.max(1, Math.round(mid)),
    gramToStars: Math.max(1, Math.floor((gramUsd / starBuyUsd) * (1 - spread))),
    starsToGram: Math.max(1, Math.ceil(gramUsd / starSellUsd / (1 - spread))),
  };
}

export class PriceFeed {
  constructor({ store, fallbackUsd, star, fetchImpl = fetch, intervalMs = 10 * 60_000 }) {
    this.store = store;
    this.fallbackUsd = fallbackUsd;
    this.star = star;
    this.fetch = fetchImpl;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.apply(this.usd());
  }

  usd() {
    return Number(this.store.getSetting('gram_usd')) || this.fallbackUsd;
  }

  rates() {
    return exchangeRates(this.usd(), this.star);
  }

  apply(usd) {
    this.store.setSetting('gram_usd', String(usd));
    this.store.setRate(this.rates().game);
  }

  async refresh() {
    for (const src of SOURCES) {
      try {
        const res = await this.fetch(src.url, { signal: AbortSignal.timeout(10_000) });
        const usd = Number(src.read(await res.json()));
        if (Number.isFinite(usd) && usd > 0.01 && usd < 10_000) {
          this.apply(usd);
          return usd;
        }
      } catch {}
    }
    return null;
  }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}
