import { useRef, useState } from "react";
import { ApiError, api, newIdempotencyKey } from "../api";
import { DepositSheet } from "../components/DepositSheet";
import { Roulette, tierOf, type RouletteHandle } from "../components/Roulette";
import { formatNumber } from "../format";
import { IconPlus } from "../icons";
import { Amount, Star } from "../stars";
import { haptic } from "../telegram";
import type { PaidCatalog, PaidOpenResult, PaidTier } from "../types";
import { Button, ErrorState, Loader, clearResourceCache, useResource } from "../ui";

const TIER_NAMES: Record<number, string> = { 1: "Стартовый", 5: "Серебряный", 25: "Золотой", 100: "Легендарный" };
const STACK: Record<number, number> = { 1: 1, 5: 2, 25: 3, 100: 4 };

export function CaseShop() {
  const catalog = useResource("paid-cases", () => api.get<PaidCatalog>("/paid-cases"));
  const roulette = useRef<RouletteHandle>(null);
  const [price, setPrice] = useState(5);
  const [busy, setBusy] = useState(false);
  const [won, setWon] = useState<{ prize: string; price: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState(false);

  if (!catalog.data) return catalog.error ? <ErrorState error={catalog.error} onRetry={() => void catalog.reload()} /> : <Loader />;
  const data = catalog.data;
  const tier = data.tiers.find((item) => item.price === price) ?? data.tiers[0]!;
  const available = Number(data.balance.available);
  const short = Math.ceil(Math.max(0, tier.price - available));

  const select = (next: PaidTier) => {
    if (busy || next.price === price) return;
    haptic("select");
    setPrice(next.price);
    setWon(null);
    setError(null);
  };

  const open = async () => {
    if (busy) return;
    haptic("medium");
    setBusy(true);
    setWon(null);
    setError(null);
    try {
      const result = await api.post<PaidOpenResult>(`/paid-cases/${tier.price}/open`, {}, { "Idempotency-Key": newIdempotencyKey() });
      catalog.setData({ ...data, balance: { ...data.balance, available: String(Number(data.balance.available) - tier.price) } });
      await roulette.current?.spin(result.prize);
      haptic(Number(result.prize) >= result.price ? "success" : "light");
      setWon({ prize: result.prize, price: result.price });
      catalog.setData({ ...data, balance: result.balance, tiers: result.tiers });
      clearResourceCache("home");
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось открыть кейс.");
      void catalog.reload();
    } finally {
      setBusy(false);
    }
  };

  const afterDeposit = async () => {
    const before = Number(data.balance.available);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const fresh = await api.get<PaidCatalog>("/paid-cases").catch(() => null);
      if (fresh) {
        catalog.setData(fresh);
        if (Number(fresh.balance.available) > before) break;
      }
    }
    clearResourceCache("home");
  };

  const multiplier = won ? Number(won.prize) / won.price : 0;

  return (
    <div className="shop">
      <div className="shop-balance">
        <div>
          <span className="shop-balance-label">Баланс</span>
          <Amount value={data.balance.available} size={18} className="shop-balance-value" />
        </div>
        <button
          type="button"
          className="shop-topup"
          onClick={() => {
            haptic("light");
            setDeposit(true);
          }}
        >
          <IconPlus size={18} /> Пополнить
        </button>
      </div>

      <div className="tiers" role="radiogroup" aria-label="Выбор кейса">
        {data.tiers.map((item) => (
          <button
            key={item.price}
            type="button"
            role="radio"
            aria-checked={item.price === price}
            className={`tier tier-${item.price}${item.price === price ? " tier-active" : ""}`}
            onClick={() => select(item)}
          >
            <span className="tier-stack" aria-hidden="true">
              {Array.from({ length: STACK[item.price] ?? 1 }, (_, index) => (
                <Star key={index} size={22} />
              ))}
            </span>
            <span className="tier-name">{TIER_NAMES[item.price] ?? "Кейс"}</span>
            <span className="tier-bottom">
              <span className="tier-price">
                {item.price}
                <Star size={14} />
              </span>
              <span className="tier-max">
                до {formatNumber(item.max)}
                <Star size={11} />
              </span>
            </span>
          </button>
        ))}
      </div>

      <section className="roulette shop-roulette" aria-label="Открытие кейса">
        <Roulette key={tier.price} ref={roulette} table={tier.prizes} label={`Призы кейса за ${tier.price} звёзд`} />
        <div className="roulette-panel">
          {won && (
            <div className="shop-won" role="status">
              <Amount value={won.prize} sign="+" size={24} className="shop-won-amount" />
              {multiplier >= 1 && <span className="shop-won-mult">×{formatNumber(String(Math.round(multiplier * 10) / 10))}</span>}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {available >= tier.price || busy ? (
            <Button variant="accent" block disabled={busy} onClick={() => void open()}>
              {busy ? "Открываем…" : won ? `Ещё раз за ${tier.price} ⭐` : `Открыть за ${tier.price} ⭐`}
            </Button>
          ) : (
            <Button variant="primary" block onClick={() => setDeposit(true)}>
              Пополнить на {short} ⭐
            </Button>
          )}
        </div>
      </section>

      <details className="shop-odds">
        <summary>Шансы кейса за {tier.price} ⭐</summary>
        <ul className="chances">
          {[...tier.prizes]
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .map((row) => (
              <li key={row.amount} className={`chance chance-${tierOf(row.amount, tier.prizes)}`}>
                <span className="chance-amount">
                  {formatNumber(row.amount)}
                  <Star size={14} />
                </span>
                <span className="chance-bar">
                  <span style={{ width: `${Math.max(4, Number(row.chance))}%` }} />
                </span>
                <span className="chance-value">{formatNumber(row.chance)}%</span>
              </li>
            ))}
        </ul>
        <p className="hint">
          Призовой фонд — 80% стоимости всех открытых кейсов. Приз не может быть больше фонда: сейчас доступны призы до {formatNumber(tier.max_now)} ⭐.
        </p>
      </details>

      <DepositSheet open={deposit} suggested={short > 0 ? Math.max(short, 10) : 50} onClose={() => setDeposit(false)} onPaid={() => void afterDeposit()} />
    </div>
  );
}
