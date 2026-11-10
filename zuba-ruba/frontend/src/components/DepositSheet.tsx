import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { Star } from "../stars";
import { haptic, payInvoice } from "../telegram";
import { Button, Sheet } from "../ui";

const PRESETS = [10, 50, 100, 250, 500, 1000];

export function DepositSheet({ open, suggested, onClose, onPaid }: { open: boolean; suggested?: number; onClose: () => void; onPaid: () => void }) {
  const [amount, setAmount] = useState(String(suggested ?? 50));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(String(suggested && suggested > 0 ? Math.max(suggested, 1) : 50));
      setError(null);
    }
  }, [open, suggested]);

  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= 1 && value <= 10000;

  const pay = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await api.post<{ url: string }>("/deposits", { stars: value });
      const status = await payInvoice(invoice.url);
      if (status === "paid") {
        haptic("success");
        onPaid();
        onClose();
      } else if (status === "failed") {
        haptic("error");
        setError("Оплата не прошла. Попробуй ещё раз.");
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось выставить счёт.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()}>
      <h3 className="sheet-title">Пополнить баланс</h3>
      <p className="deposit-lead">Оплата звёздами Telegram. Звёзды сразу появятся на балансе.</p>
      <div className="deposit-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={value === preset ? "deposit-preset deposit-preset-active" : "deposit-preset"}
            onClick={() => {
              haptic("select");
              setAmount(String(preset));
            }}
          >
            {preset}
            <Star size={14} />
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Своя сумма</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, "").slice(0, 5))} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <Button variant="accent" block loading={busy} disabled={!valid} onClick={() => void pay()}>
        {valid ? `Оплатить ${value} ⭐` : "Введите сумму от 1 до 10 000"}
      </Button>
    </Sheet>
  );
}
