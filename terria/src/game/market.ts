/** Market maths shared by the client and the server. */
import { GOODS, MARKET, type Good } from './config.ts';
import type { CityState, PriceQuote } from './types.ts';

export const round2 = (v: number): number => Math.round(v * 100) / 100;

export function quote(ref: number): PriceQuote {
  return { ref: round2(ref), buy: round2(ref * MARKET.systemSellMul), sell: round2(ref * MARKET.systemBuyMul) };
}

/** New reference price after an exchange trade of `qty` units at `unit` coins each. */
export function driftRef(res: Good, ref: number, unit: number, qty: number): number {
  const base = MARKET.base[res];
  const w = Math.min(MARKET.tradeWeightMax, (qty / 1000) * MARKET.tradeWeightPer1000);
  // a single absurd price can only pull so far: clamp the trade price first
  const u = Math.max(base * MARKET.minMul, Math.min(base * MARKET.maxMul, unit));
  const next = ref * (1 - w) + u * w;
  return Math.max(base * MARKET.minMul, Math.min(base * MARKET.maxMul, next));
}

/** System purchases also nudge the price a little (supply and demand). */
export function driftSystem(res: Good, ref: number, qty: number, side: 'buy' | 'sell'): number {
  const base = MARKET.base[res];
  const w = Math.min(0.05, (qty / 20000) * 0.05);
  const next = ref * (side === 'buy' ? 1 + w : 1 - w);
  return Math.max(base * MARKET.minMul, Math.min(base * MARKET.maxMul, next));
}

export function systemQuota(c: CityState): Record<Good, number> {
  const out = {} as Record<Good, number>;
  for (const g of GOODS) out[g] = Math.max(0, MARKET.systemBuyQuotaPerTh * c.th - (c.soldToday[g] ?? 0));
  return out;
}

export const unitPrice = (total: number, qty: number): number => (qty > 0 ? total / qty : 0);

/** Coins for `k` units of an order, rounded to cents, never more than what is left in escrow. */
export function partialTotal(total: number, qty: number, k: number): number {
  return Math.floor((total * k * 100) / qty) / 100;
}
