import { useMemo, useState } from "react";
import { ApiError, api, newIdempotencyKey } from "../api";
import { useApp } from "../AppContext";
import { formatDateTime, formatNumber } from "../format";
import { Lottie, giftAnimationUrl } from "../lottie";
import { parentOf, useRoute } from "../router";
import { Amount, Star } from "../stars";
import { confirmDialog, haptic } from "../telegram";
import type { GiftOption, Withdrawal, WithdrawalStatus, WithdrawalsResponse } from "../types";
import { Badge, Button, EmptyState, ErrorState, Loader, Notice, Screen, Section, clearResourceCache, useResource } from "../ui";

const TONE: Record<WithdrawalStatus, "neutral" | "pending" | "success" | "danger"> = {
  pending: "pending",
  approved: "pending",
  completed: "success",
  rejected: "danger",
  failed: "danger",
};

export function WithdrawScreen() {
  const { config } = useApp();
  const route = useRoute();
  const data = useResource("withdrawals", () => api.get<WithdrawalsResponse>("/withdrawals"));
  const [selected, setSelected] = useState<GiftOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const available = Number(data.data?.balance.available ?? "0");
  const groups = useMemo(() => {
    const map = new Map<number, GiftOption[]>();
    for (const option of data.data?.options ?? []) map.set(option.stars, [...(map.get(option.stars) ?? []), option]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data.data]);

  const submit = async () => {
    if (!selected) return;
    const ok = await confirmDialog(
      `Вывести «${selected.name}» за ${selected.stars} ⭐? Подарок придёт в Telegram${config.withdraw.auto ? "" : " после проверки заявки"}.`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.post<Withdrawal>("/withdrawals", { gift_id: selected.gift_id }, { "Idempotency-Key": newIdempotencyKey() });
      haptic("success");
      setMessage({ tone: "ok", text: `Заявка №${created.id} принята. Статус придёт сообщением от бота.` });
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

  return (
    <Screen title="Вывод" back={parentOf(route)}>
      {!data.data && data.error && <ErrorState error={data.error} onRetry={() => void data.reload()} />}
      {!data.data && !data.error && <Loader />}
      {data.data && (
        <>
          <div className="wd-balance">
            <div>
              <span className="wd-balance-label">Доступно к выводу</span>
              <Amount value={data.data.balance.available} size={24} className="wd-balance-value" />
            </div>
            <div className="wd-balance-side">
              <span>
                В ожидании <Amount value={data.data.balance.pending} size={12} />
              </span>
              <span>
                На выводе <Amount value={data.data.balance.withdrawing} size={12} />
              </span>
            </div>
          </div>

          {!data.data.enabled && <Notice tone="warning">{data.data.disabled_reason}</Notice>}

          {data.data.enabled && (
            <>
              <p className="wd-lead">
                Выбери подарок — он придёт тебе в Telegram. Подарок можно оставить в профиле или обменять на звёзды. Минимум —{" "}
                {config.withdraw.min_stars}
                <Star size={13} className="star-inline" />.
              </p>
              {groups.map(([stars, options]) => (
                <section key={stars} className="gift-group">
                  <h2 className="gift-group-title">
                    {stars}
                    <Star size={16} />
                    {available < stars && <span className="gift-group-need">не хватает {formatNumber(String(Math.round((stars - available) * 1000) / 1000))}</span>}
                  </h2>
                  <div className="gifts">
                    {options.map((option) => {
                      const affordable = available >= option.stars;
                      const active = selected?.gift_id === option.gift_id;
                      return (
                        <button
                          key={option.gift_id}
                          type="button"
                          className={["gift", active ? "gift-active" : "", affordable ? "" : "gift-locked"].join(" ").trim()}
                          aria-pressed={active}
                          disabled={!affordable}
                          onClick={() => {
                            haptic("select");
                            setSelected(active ? null : option);
                            setMessage(null);
                          }}
                        >
                          <Lottie src={giftAnimationUrl(option.gift_id)} size={76} play={affordable} fallback={option.emoji} />
                          <span className="gift-name">{option.name}</span>
                          <span className="gift-price">
                            {option.stars}
                            <Star size={12} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groups.length === 0 && <EmptyState title="Подарков нет" text="Telegram сейчас не предлагает подарков подходящего номинала." />}
            </>
          )}

          {message && <p className={message.tone === "ok" ? "notice notice-ok" : "form-error"}>{message.text}</p>}

          <Section title="Мои заявки">
            {data.data.items.length === 0 ? (
              <EmptyState title="Заявок пока нет" />
            ) : (
              <ul className="card-list list">
                {data.data.items.map((item) => (
                  <li key={item.id} className="op-row">
                    <span className="op-icon op-icon-gift">
                      {item.gift_id ? <Lottie src={giftAnimationUrl(item.gift_id)} size={34} play={false} frame={30} fallback={item.gift_emoji} /> : null}
                    </span>
                    <div className="op-main">
                      <span className="op-title">
                        {item.gift_name} · №{item.id}
                      </span>
                      {item.comment && <span className="op-reason">{item.comment}</span>}
                      <span className="op-date">{formatDateTime(item.created_at)}</span>
                    </div>
                    <div className="op-side">
                      <Amount value={String(item.stars)} sign="-" size={14} className="op-amount" />
                      <Badge tone={TONE[item.status]}>{item.status_label}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.data.enabled && (
            <div className="sticky-cta">
              <Button variant="accent" block loading={busy} disabled={!selected} onClick={() => void submit()}>
                {selected ? `Вывести «${selected.name}» · ${selected.stars} ⭐` : "Выбери подарок"}
              </Button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
