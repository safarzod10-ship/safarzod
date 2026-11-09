import { useState } from "react";
import { api } from "../api";
import { formatDateTime, formatRub, formatStars, isNegative } from "../format";
import { navigate } from "../router";
import { confirmDialog, haptic } from "../telegram";
import type { AdminFinance, AdminWithdrawal } from "../types";
import { Badge, Button, EmptyState, InfoRow, Loader, Notice, PromptSheet, Section, useResource } from "../ui";
import { AdminError } from "./Admin";

export function AdminFinanceView() {
  const data = useResource("admin:finance", () => api.get<AdminFinance>("/admin/finance"));
  const [rejecting, setRejecting] = useState<AdminWithdrawal | null>(null);
  const [completing, setCompleting] = useState<AdminWithdrawal | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loader />;
  const d = data.data;

  const approve = async (item: AdminWithdrawal) => {
    if (!(await confirmDialog(`Одобрить вывод ${formatStars(item.amount)} пользователю ${item.user_id}?`))) return;
    setBusy(item.id);
    setError(null);
    try {
      await api.post(`/admin/withdrawals/${item.id}/approve`, { comment: "" });
      haptic("success");
      await data.reload();
    } catch (err) {
      haptic("error");
      setError(err instanceof Error ? err.message : "Не удалось одобрить заявку.");
      await data.reload();
    } finally {
      setBusy(null);
    }
  };

  const isOpen = (w: AdminWithdrawal) => w.status === "pending" || w.status === "approved";
  const open = d.withdrawals.filter(isOpen);
  const closed = d.withdrawals.filter((w) => !isOpen(w));

  return (
    <>
      {d.warning && <Notice tone="warning">{d.warning}</Notice>}
      <Section title="Доход">
        <div className="group group-flat">
          <InfoRow label="Валовый доход" value={formatRub(d.income_gross)} />
          <InfoRow label="Подтверждённый доход" value={formatRub(d.income_confirmed)} />
          <InfoRow label="По ценам Flyer" value={formatRub(d.income_flyer_reported)} />
        </div>
      </Section>
      <Section title="Расходы и обязательства">
        <div className="group group-flat">
          <InfoRow label="Награды выплачены" value={formatRub(d.reward_expenses)} />
          <InfoRow label="Реферальные кейсы" value={formatRub(d.referral_expenses)} />
          <InfoRow label="Ожидаемые начисления" value={formatRub(d.rewards_pending)} />
          <InfoRow label="Неоткрытые кейсы" value={formatRub(d.unopened_cases)} />
          <InfoRow label="Комиссии" value={formatRub(d.commissions)} />
          <InfoRow label="Обязательства перед пользователями" value={formatRub(d.liabilities)} />
          <InfoRow label="Порог вывода из Flyer" value={formatRub(d.flyer_withdraw_threshold)} />
        </div>
      </Section>
      <div className="profit">
        <span className="balance-label">Чистая прибыль</span>
        <span className={isNegative(d.net_profit) ? "profit-value stat-danger" : "profit-value"}>{formatRub(d.net_profit)}</span>
      </div>
      <div className="group">
        <InfoRow label="Баланс Stars у бота" value={d.bot_star_balance === null ? "недоступно" : formatStars(String(d.bot_star_balance))} />
      </div>

      <Section title={`Заявки на вывод · ${open.length}`}>
        {error && <p className="form-error">{error}</p>}
        {open.length === 0 ? (
          <EmptyState title="Новых заявок нет" />
        ) : (
          <ul className="list">
            {open.map((item) => (
              <li key={item.id} className="admin-item">
                <div className="admin-item-head">
                  <button type="button" className="link-btn" onClick={() => navigate(`/admin/users/${item.user_id}`)}>
                    №{item.id} · {item.username ? `@${item.username}` : item.user_id}
                  </button>
                  <span className="op-amount">{formatStars(item.amount)}</span>
                </div>
                <span className="op-date">{formatDateTime(item.created_at)}</span>
                {item.status === "approved" && (
                  <span className="op-reason">Telegram не подтвердил отправку подарка. Проверьте историю подарков бота и завершите заявку вручную.</span>
                )}
                <div className="task-actions">
                  {item.status === "pending" ? (
                    <Button size="sm" loading={busy === item.id} disabled={busy !== null} onClick={() => void approve(item)}>
                      Одобрить
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy !== null} onClick={() => setCompleting(item)}>
                      Отправка подтверждена
                    </Button>
                  )}
                  <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setRejecting(item)}>
                    {item.status === "pending" ? "Отклонить" : "Вернуть средства"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="Обработанные заявки">
          <ul className="list">
            {closed.map((item) => (
              <li key={item.id} className="op-row">
                <div className="op-main">
                  <span className="op-title">
                    №{item.id} · {item.username ? `@${item.username}` : item.user_id}
                  </span>
                  {item.comment && <span className="op-reason">{item.comment}</span>}
                  <span className="op-date">{formatDateTime(item.updated_at)}</span>
                </div>
                <div className="op-side">
                  <span className="op-amount">{formatStars(item.amount)}</span>
                  <Badge tone={item.status === "completed" ? "success" : item.status === "approved" ? "pending" : "danger"}>{item.status_label}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Корректировки">
        {d.adjustments.length === 0 ? (
          <EmptyState title="Корректировок не было" />
        ) : (
          <ul className="list">
            {d.adjustments.map((op) => (
              <li key={op.id} className="op-row">
                <div className="op-main">
                  <span className="op-title">
                    Пользователь {op.user_id} · админ {op.admin_id}
                  </span>
                  {op.reason && <span className="op-reason">{op.reason}</span>}
                  <span className="op-date">{formatDateTime(op.created_at)}</span>
                </div>
                <span className="op-amount">{formatStars(op.amount, { sign: op.direction === "in" ? "+" : "-" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PromptSheet
        open={completing !== null}
        title="Подтвердить отправку"
        label="Как подтверждена отправка"
        confirmText="Подтвердить"
        onCancel={() => setCompleting(null)}
        onSubmit={async (comment) => {
          if (!completing) return;
          await api.post(`/admin/withdrawals/${completing.id}/complete`, { comment });
          haptic("success");
          setCompleting(null);
          await data.reload();
        }}
      />
      <PromptSheet
        open={rejecting !== null}
        title="Отклонить заявку"
        label="Причина (увидит пользователь)"
        confirmText="Отклонить"
        danger
        onCancel={() => setRejecting(null)}
        onSubmit={async (comment) => {
          if (!rejecting) return;
          await api.post(`/admin/withdrawals/${rejecting.id}/reject`, { comment });
          haptic("success");
          setRejecting(null);
          await data.reload();
        }}
      />
    </>
  );
}
