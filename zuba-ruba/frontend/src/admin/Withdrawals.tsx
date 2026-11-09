import { useState } from "react";
import { ApiError, api } from "../api";
import { formatDateTime, formatNumber, formatStars } from "../format";
import { navigate } from "../router";
import { confirmDialog, haptic } from "../telegram";
import { PromptSheet, useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { StatusTag } from "./CompletionList";
import { DataTable, GiftThumb, Kpi, Pager, Panel, Segmented, openInvoice, userName } from "./kit";
import type { AdminStars, AdminWithdrawal, AdminWithdrawalQueue, WithdrawalTab } from "./types";

const TONE: Record<string, string> = { pending: "warn", approved: "warn", completed: "ok", rejected: "danger", failed: "danger" };
const PRESETS = [100, 500, 1000, 2500];

export function AdminWithdrawalsView() {
  const [tab, setTab] = useState<WithdrawalTab>("pending");
  const [page, setPage] = useState(1);
  const queue = useResource(`admin:withdrawals:${tab}:${page}`, () => api.get<AdminWithdrawalQueue>(`/admin/withdrawals?tab=${tab}&page=${page}`));
  const stars = useResource("admin:stars", () => api.get<AdminStars>("/admin/stars"));
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ item: AdminWithdrawal; mode: "reject" | "complete" } | null>(null);
  const [amount, setAmount] = useState("500");
  const [topupState, setTopupState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);

  const reloadAll = async () => {
    await Promise.all([queue.reload(), stars.reload()]);
  };

  const approve = async (item: AdminWithdrawal) => {
    if (!(await confirmDialog(`Отправить «${item.gift_name ?? "Подарок"}» (${formatStars(item.amount)}) пользователю ${userName(item)}? Звёзды спишутся с баланса бота.`))) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.post(`/admin/withdrawals/${item.id}/approve`, { comment: "" });
      haptic("success");
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось отправить подарок.");
    } finally {
      setBusy(null);
      await reloadAll();
    }
  };

  const topup = async () => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1 || value > 100000) {
      setTopupState({ tone: "error", text: "Введите целое число от 1 до 100 000." });
      return;
    }
    setTopupBusy(true);
    setTopupState(null);
    try {
      const invoice = await api.post<{ url: string }>("/admin/stars/topup", { amount: value });
      const status = await openInvoice(invoice.url);
      if (status === "paid") {
        haptic("success");
        setTopupState({ tone: "ok", text: `Оплачено ${formatStars(String(value))}. Баланс обновится в течение минуты.` });
      } else if (status === "external") {
        setTopupState({ tone: "ok", text: "Счёт открыт в Telegram. После оплаты обновите страницу." });
      } else if (status === "failed") {
        setTopupState({ tone: "error", text: "Оплата не прошла." });
      }
      await stars.reload();
    } catch (err) {
      setTopupState({ tone: "error", text: err instanceof ApiError ? err.message : "Не удалось создать счёт." });
    } finally {
      setTopupBusy(false);
    }
  };

  const q = queue.data;
  const s = stars.data;
  const balance = q?.bot_star_balance ?? s?.balance ?? null;
  const short = balance !== null && q ? q.pending_stars - balance : 0;

  return (
    <div className="adm-stack">
      <div className="adm-grid adm-grid-side">
        <div className="adm-stack">
          {short > 0 && (
            <div className="adm-alert">
              На балансе бота не хватает {formatStars(String(short))} для заявок в очереди. Пополните баланс, иначе Telegram отклонит отправку подарков.
            </div>
          )}
          {error && <div className="adm-alert">{error}</div>}
          <Segmented<WithdrawalTab>
            label="Статус заявок"
            value={tab}
            onChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            options={[
              { value: "pending", label: `Новые ${q?.counts.pending ?? ""}`.trim() },
              { value: "processing", label: `Не подтверждены ${q?.counts.processing ?? ""}`.trim() },
              { value: "done", label: "Обработанные" },
            ]}
          />
          <Panel title={tab === "pending" ? "Ждут отправки" : tab === "processing" ? "Отправка не подтверждена Telegram" : "История"}>
            {tab === "processing" && <p className="adm-note">Проверьте историю подарков бота в Telegram. Если подарок дошёл — подтвердите вручную, если нет — верните звёзды пользователю.</p>}
            {!q ? (
              queue.error ? <AdminError error={queue.error} onRetry={() => void queue.reload()} /> : <Loading />
            ) : (
              <>
                <DataTable<AdminWithdrawal>
                  rows={q.items}
                  rowKey={(row) => row.id}
                  empty={tab === "done" ? "Обработанных заявок нет" : "Очередь пуста"}
                  columns={[
                    {
                      key: "gift",
                      label: "Подарок",
                      primary: true,
                      render: (row) => (
                        <span className="adm-gift-cell">
                          <GiftThumb giftId={row.gift_id} emoji={row.gift_emoji} size={40} />
                          <span className="adm-stack-xs">
                            <span>{row.gift_name ?? "Подарок"}</span>
                            <span className="adm-muted">№{row.id}</span>
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: "user",
                      label: "Пользователь",
                      render: (row) => (
                        <button
                          type="button"
                          className="adm-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/admin/users/${row.user_id}`);
                          }}
                        >
                          {userName({ id: row.user_id, username: row.username, first_name: row.first_name })}
                        </button>
                      ),
                    },
                    { key: "amount", label: "Сумма", align: "right", render: (row) => <span className="adm-num">{formatStars(row.amount)}</span> },
                    { key: "date", label: tab === "done" ? "Обработана" : "Создана", render: (row) => formatDateTime(tab === "done" ? row.updated_at : row.created_at) },
                    {
                      key: "status",
                      label: "Статус",
                      render: (row) => (
                        <span className="adm-stack-xs">
                          <StatusTag tone={TONE[row.status] ?? "neutral"}>{row.status_label}</StatusTag>
                          {(row.comment || row.error) && <span className="adm-muted adm-clip">{row.comment || row.error}</span>}
                        </span>
                      ),
                    },
                    ...(tab === "done"
                      ? []
                      : [
                          {
                            key: "actions",
                            wide: true,
                            label: "Действия",
                            render: (row: AdminWithdrawal) => (
                              <span className="adm-actions">
                                {row.status === "pending" ? (
                                  <button type="button" className="adm-btn adm-btn-sm" disabled={busy !== null} onClick={() => void approve(row)}>
                                    {busy === row.id ? "Отправляем…" : "Отправить"}
                                  </button>
                                ) : (
                                  <button type="button" className="adm-btn adm-btn-sm" disabled={busy !== null} onClick={() => setPrompt({ item: row, mode: "complete" })}>
                                    Подарок дошёл
                                  </button>
                                )}
                                <button type="button" className="adm-btn adm-btn-sm adm-btn-danger" disabled={busy !== null} onClick={() => setPrompt({ item: row, mode: "reject" })}>
                                  {row.status === "pending" ? "Отклонить" : "Вернуть звёзды"}
                                </button>
                              </span>
                            ),
                          },
                        ]),
                  ]}
                />
                <Pager page={page} pages={q.pages} onChange={setPage} />
              </>
            )}
          </Panel>
        </div>

        <div className="adm-stack">
          <Panel title="Звёзды бота">
            <div className="adm-kpis adm-kpis-2">
              <Kpi label="Баланс бота" value={balance === null ? "—" : formatStars(String(balance))} tone={short > 0 ? "danger" : "accent"} />
              <Kpi label="В очереди" value={formatStars(String(q?.pending_stars ?? s?.pending_withdrawals ?? 0))} />
              <Kpi label="Пополнено" value={formatStars(String(s?.topped_up ?? 0))} />
              <Kpi label="Отправлено подарками" value={formatStars(String(s?.gifted ?? 0))} />
            </div>
            {q?.auto && <p className="adm-note">Включена автоматическая отправка: новые заявки уходят без одобрения, пока на балансе хватает звёзд.</p>}
          </Panel>
          <Panel title="Пополнить баланс">
            <p className="adm-note">Счёт в звёздах Telegram оплачивается с вашего аккаунта и зачисляется на баланс бота. С этого баланса отправляются подарки.</p>
            <div className="adm-chips">
              {PRESETS.map((preset) => (
                <button key={preset} type="button" className={String(preset) === amount ? "adm-chip adm-chip-active" : "adm-chip"} onClick={() => setAmount(String(preset))}>
                  {formatNumber(preset)}
                </button>
              ))}
            </div>
            <label className="adm-field">
              <span>Сумма, ⭐</span>
              <input className="adm-input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            </label>
            {topupState && <p className={topupState.tone === "ok" ? "adm-ok" : "adm-error"}>{topupState.text}</p>}
            <button type="button" className="adm-btn adm-btn-accent adm-btn-block" disabled={topupBusy || !amount} onClick={() => void topup()}>
              {topupBusy ? "Создаём счёт…" : `Пополнить на ${formatStars(amount || "0")}`}
            </button>
          </Panel>
          <Panel title="Последние пополнения">
            <DataTable
              rows={s?.topups ?? []}
              rowKey={(row) => row.id}
              empty="Пополнений пока не было"
              columns={[
                { key: "amount", label: "Сумма", primary: true, render: (row) => formatStars(String(row.amount)) },
                { key: "status", label: "Статус", render: (row) => <StatusTag tone={row.status === "paid" ? "ok" : "neutral"}>{row.status === "paid" ? "Оплачен" : "Создан"}</StatusTag> },
                { key: "date", label: "Дата", render: (row) => formatDateTime(row.paid_at ?? row.created_at) },
              ]}
            />
          </Panel>
        </div>
      </div>

      <PromptSheet
        open={prompt !== null}
        title={prompt?.mode === "complete" ? "Подтвердить отправку" : prompt?.item.status === "pending" ? "Отклонить заявку" : "Вернуть звёзды"}
        label={prompt?.mode === "complete" ? "Как подтверждена отправка" : "Причина (увидит пользователь)"}
        confirmText={prompt?.mode === "complete" ? "Подтвердить" : "Вернуть звёзды"}
        danger={prompt?.mode === "reject"}
        onCancel={() => setPrompt(null)}
        onSubmit={async (comment) => {
          if (!prompt) return;
          await api.post(`/admin/withdrawals/${prompt.item.id}/${prompt.mode}`, { comment });
          haptic("success");
          setPrompt(null);
          await reloadAll();
        }}
      />
    </div>
  );
}
