import { useState } from "react";
import { ApiError, api, newIdempotencyKey } from "../api";
import { useApp } from "../AppContext";
import { formatDateTime, formatStars } from "../format";
import { confirmDialog, haptic } from "../telegram";
import type { Withdrawal, WithdrawalStatus, WithdrawalsResponse } from "../types";
import { Badge, Button, EmptyState, ErrorState, InfoRow, Loader, Notice, Screen, Section, clearResourceCache, useResource } from "../ui";

const TONE: Record<WithdrawalStatus, "neutral" | "pending" | "success" | "danger"> = {
  pending: "pending",
  approved: "pending",
  completed: "success",
  rejected: "danger",
  failed: "danger",
};

function compare(a: string, b: string): number {
  return Number(a) - Number(b);
}

export function WithdrawScreen() {
  const { config } = useApp();
  const data = useResource("withdrawals", () => api.get<WithdrawalsResponse>("/withdrawals"));
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = async () => {
    if (!selected || !data.data) return;
    const ok = await confirmDialog(`Создать заявку на вывод ${formatStars(selected)}? Сумма будет зарезервирована до рассмотрения заявки.`);
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.post<Withdrawal>("/withdrawals", { amount: selected }, { "Idempotency-Key": newIdempotencyKey() });
      haptic("success");
      setMessage({ tone: "ok", text: `Заявка №${created.id} создана. Мы сообщим о результате в чате с ботом.` });
      setSelected(null);
      clearResourceCache("home");
      await data.reload();
    } catch (err) {
      haptic("error");
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Не удалось создать заявку." });
    } finally {
      setBusy(false);
    }
  };

  const available = data.data?.balance.available ?? "0";

  return (
    <Screen title="Вывод" back="/">
      {!data.data && data.error && <ErrorState error={data.error} onRetry={() => void data.reload()} />}
      {!data.data && !data.error && <Loader />}
      {data.data && (
        <>
          <section className="balance balance-compact">
            <span className="balance-label">Доступно к выводу</span>
            <span className="balance-total">{formatStars(data.data.balance.available)}</span>
          </section>
          <div className="group">
            <InfoRow label="Общий баланс" value={formatStars(data.data.balance.total)} />
            <InfoRow label="В ожидании" value={formatStars(data.data.balance.pending)} />
            <InfoRow label="На выводе" value={formatStars(data.data.balance.withdrawing)} />
          </div>

          {!data.data.enabled ? (
            <Notice>{data.data.disabled_reason ?? "Вывод временно недоступен."}</Notice>
          ) : (
            <Section title="Сумма вывода">
              {data.data.options.length === 0 ? (
                <p className="section-text">Сейчас нет доступных вариантов вывода.</p>
              ) : (
                <div className="chips" role="radiogroup" aria-label="Сумма вывода">
                  {data.data.options.map((option) => {
                    const affordable = compare(option, available) <= 0;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected === option}
                        disabled={!affordable}
                        className={selected === option ? "chip chip-active" : "chip"}
                        onClick={() => {
                          haptic("select");
                          setSelected(option);
                        }}
                      >
                        {formatStars(option)}
                      </button>
                    );
                  })}
                </div>
              )}
              {data.data.options.length > 0 && data.data.options.every((option) => compare(option, available) > 0) && (
                <p className="section-text">Недостаточно доступных средств для минимальной суммы вывода.</p>
              )}
              <p className="hint">
                Заявку рассматривает администратор. {config.stars_are_internal ? "Внутренние баллы ⭐ выплачиваются в Telegram Stars только после одобрения. " : ""}
                Результат придёт сообщением в чате с ботом.
              </p>
              {message && <p className={message.tone === "ok" ? "hint" : "form-error"}>{message.text}</p>}
              <Button block disabled={!selected} loading={busy} onClick={() => void submit()}>
                {selected ? `Вывести ${formatStars(selected)}` : "Выберите сумму"}
              </Button>
            </Section>
          )}

          <Section title="Заявки">
            {data.data.items.length === 0 ? (
              <EmptyState title="Заявок пока нет" />
            ) : (
              <ul className="list">
                {data.data.items.map((item) => (
                  <li key={item.id} className="op-row">
                    <div className="op-main">
                      <span className="op-title">Заявка №{item.id}</span>
                      {item.comment && <span className="op-reason">{item.comment}</span>}
                      <span className="op-date">{formatDateTime(item.created_at)}</span>
                    </div>
                    <div className="op-side">
                      <span className="op-amount">{formatStars(item.amount)}</span>
                      <Badge tone={TONE[item.status]}>{item.status_label}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
