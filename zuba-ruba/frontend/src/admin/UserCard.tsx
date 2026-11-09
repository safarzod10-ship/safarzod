import { useState } from "react";
import { ApiError, api, newIdempotencyKey } from "../api";
import { OperationList } from "../components/OperationList";
import { formatDate, formatDateTime, formatStars } from "../format";
import { navigate } from "../router";
import { confirmDialog, haptic } from "../telegram";
import type { AdminUserCard } from "../types";
import { Badge, Button, EmptyState, InfoRow, Loader, Notice, PromptSheet, Section, useResource } from "../ui";
import { AdminError } from "./Admin";
import { CompletionList } from "./CompletionList";

const AMOUNT_RE = /^-?\d+(\.\d{1,3})?$/;

export function AdminUserCardView({ id }: { id: string }) {
  const card = useResource(`admin:user:${id}`, () => api.get<AdminUserCard>(`/admin/users/${encodeURIComponent(id)}`));
  const [blockOpen, setBlockOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!card.data) return card.error ? <AdminError error={card.error} onRetry={() => void card.reload()} /> : <Loader />;
  const { user } = card.data;

  const toggleBlock = async (blocked: boolean, blockReason: string) => {
    await api.post(`/admin/users/${user.id}/block`, { blocked, reason: blockReason });
    haptic("success");
    setBlockOpen(false);
    await card.reload();
  };

  const normalized = amount.trim().replace(",", ".").replace(/^\+/, "");
  const amountValid = AMOUNT_RE.test(normalized) && Number(normalized) !== 0;

  const adjust = async () => {
    if (!amountValid || !reason.trim()) return;
    const sign = normalized.startsWith("-") ? "Списать" : "Начислить";
    const ok = await confirmDialog(`${sign} ${formatStars(normalized.replace("-", ""))} пользователю ${user.id}? Причина: ${reason.trim()}`);
    if (!ok) return;
    setAdjusting(true);
    setMessage(null);
    try {
      await api.post(`/admin/users/${user.id}/adjust`, { amount: normalized, reason: reason.trim() }, { "Idempotency-Key": newIdempotencyKey() });
      haptic("success");
      setAmount("");
      setReason("");
      setMessage({ tone: "ok", text: "Корректировка проведена и записана в журнал." });
      await card.reload();
    } catch (err) {
      haptic("error");
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Не удалось провести корректировку." });
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <>
      <button type="button" className="link-btn back-link" onClick={() => navigate("/admin/users")}>
        ← Все пользователи
      </button>
      <div className="admin-user-head">
        <span className="profile-title">
          {[user.first_name, user.last_name].filter(Boolean).join(" ")}
          {user.username ? ` · @${user.username}` : ""}
        </span>
        {user.is_blocked && <Badge tone="danger">Заблокирован</Badge>}
        {user.is_suspicious && <Badge tone="pending">Подозрительный</Badge>}
      </div>
      {user.is_blocked && user.block_reason && <Notice>Причина блокировки: {user.block_reason}</Notice>}

      <div className="group">
        <InfoRow label="Telegram ID" value={user.id} mono />
        <InfoRow label="Регистрация" value={formatDate(user.registered_at)} />
        <InfoRow label="Последний вход" value={formatDateTime(user.last_seen_at)} />
        <InfoRow label="Язык" value={user.language_code ?? "—"} />
        <InfoRow label="Пригласил" value={user.referrer_id ?? "—"} mono />
        <InfoRow label="Доступно" value={formatStars(user.available)} />
        <InfoRow label="В ожидании" value={formatStars(user.pending)} />
        <InfoRow label="На выводе" value={formatStars(user.withdrawing)} />
      </div>

      <div className="stack">
        {user.is_blocked ? (
          <Button
            variant="secondary"
            block
            onClick={async () => {
              if (await confirmDialog("Разблокировать пользователя?")) await toggleBlock(false, "");
            }}
          >
            Разблокировать
          </Button>
        ) : (
          <Button variant="danger" block onClick={() => setBlockOpen(true)}>
            Заблокировать
          </Button>
        )}
        <Button
          variant="secondary"
          block
          onClick={async () => {
            const text = user.is_suspicious
              ? "Снять отметку? Действия пользователя снова будут учитываться в реферальной программе."
              : "Отметить как подозрительный? Его задания перестанут приносить реферальные кейсы пригласившему.";
            if (!(await confirmDialog(text))) return;
            await api.post(`/admin/users/${user.id}/block`, { blocked: user.is_blocked, reason: user.block_reason ?? "", suspicious: !user.is_suspicious });
            haptic("success");
            await card.reload();
          }}
        >
          {user.is_suspicious ? "Снять отметку «подозрительный»" : "Отметить как подозрительный"}
        </Button>
      </div>

      <Section title="Корректировка баланса">
        <p className="section-text">Положительная сумма — начисление, отрицательная — списание. Причина обязательна и сохраняется в журнале.</p>
        <label className="field">
          <span className="field-label">Сумма, ⭐</span>
          <input className="input" inputMode="decimal" placeholder="Например, 0.5 или -0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Причина</span>
          <textarea className="input textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {amount && !amountValid && <p className="form-error">Введите сумму с точностью до 0,001.</p>}
        {message && <p className={message.tone === "ok" ? "hint" : "form-error"}>{message.text}</p>}
        <Button block loading={adjusting} disabled={!amountValid || !reason.trim()} onClick={() => void adjust()}>
          Провести корректировку
        </Button>
      </Section>

      <Section title="Операции">
        {card.data.operations.length ? <OperationList items={card.data.operations} /> : <EmptyState title="Операций нет" />}
      </Section>

      <Section title={`Рефералы · ${card.data.referrals.length}`}>
        {card.data.referrals.length === 0 ? (
          <EmptyState title="Нет приглашённых" />
        ) : (
          <ul className="list">
            {card.data.referrals.map((ref) => (
              <li key={ref.id}>
                <button type="button" className="user-row" onClick={() => navigate(`/admin/users/${ref.id}`)}>
                  <div className="op-main">
                    <span className="op-title">
                      {ref.first_name}
                      {ref.username ? ` · @${ref.username}` : ""}
                    </span>
                    <span className="op-date">{formatDate(ref.registered_at)}</span>
                  </div>
                  <span className="op-date">Подтв. заданий: {ref.confirmed_tasks}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Задания">
        {card.data.completions.length ? <CompletionList items={card.data.completions} /> : <EmptyState title="Заданий нет" />}
      </Section>

      <Section title="Бусты">
        {card.data.boosts.length === 0 ? (
          <EmptyState title="Бустов нет" />
        ) : (
          <ul className="list">
            {card.data.boosts.map((boost) => (
              <li key={boost.id} className="admin-item">
                <div className="admin-item-head">
                  <span className="op-title">{boost.channel}</span>
                  <Badge tone={boost.status === "active" ? "success" : "neutral"}>{boost.status === "active" ? "Активен" : "Завершён"}</Badge>
                </div>
                <div className="kv">
                  <span>Назначен</span>
                  <span>{formatDateTime(boost.assigned_at)}</span>
                  <span>Последняя проверка</span>
                  <span>{formatDateTime(boost.last_check_at)}</span>
                  <span>Следующая проверка</span>
                  <span>{formatDateTime(boost.next_check_at)}</span>
                  <span>Оплачено периодов</span>
                  <span>{boost.periods_paid}</span>
                  <span>Начислено</span>
                  <span>{formatStars(boost.rewarded)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Заявки на вывод">
        {card.data.withdrawals.length === 0 ? (
          <EmptyState title="Заявок нет" />
        ) : (
          <ul className="list">
            {card.data.withdrawals.map((w) => (
              <li key={w.id} className="op-row">
                <div className="op-main">
                  <span className="op-title">Заявка №{w.id}</span>
                  {w.comment && <span className="op-reason">{w.comment}</span>}
                  <span className="op-date">{formatDateTime(w.created_at)}</span>
                </div>
                <div className="op-side">
                  <span className="op-amount">{formatStars(w.amount)}</span>
                  <span className="op-date">{w.status_label}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PromptSheet
        open={blockOpen}
        title="Блокировка пользователя"
        label="Причина блокировки"
        confirmText="Заблокировать"
        danger
        onCancel={() => setBlockOpen(false)}
        onSubmit={(value) => toggleBlock(true, value)}
      />
    </>
  );
}
