import { useMemo, useState } from "react";
import { ApiError, api, newIdempotencyKey } from "../api";
import { formatDate, formatDateTime, formatStars } from "../format";
import { navigate } from "../router";
import { confirmDialog, haptic, openExternal } from "../telegram";
import type { OperationKind } from "../types";
import { PromptSheet, useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { CompletionList, StatusTag } from "./CompletionList";
import { DataTable, GiftThumb, Kpi, Panel, Segmented, downloadExport, userName } from "./kit";
import type { AdminUserCard } from "./types";

const AMOUNT_RE = /^-?\d+(\.\d{1,3})?$/;

const KIND_LABEL: Record<OperationKind, string> = {
  case_reward: "Кейс",
  boost_reward: "Буст",
  referral_reward: "Реферал",
  reversal: "Отмена",
  adjustment: "Корректировка",
  withdrawal: "Вывод",
};

const OP_TONE: Record<string, string> = { pending: "warn", completed: "ok", cancelled: "danger", failed: "danger" };
const OP_STATUS: Record<string, string> = { pending: "В ожидании", completed: "Зачислено", cancelled: "Отменено", failed: "Не выполнено" };
const WD_TONE: Record<string, string> = { pending: "warn", approved: "warn", completed: "ok", rejected: "danger", failed: "danger" };

type Tab = "operations" | "cases" | "tasks" | "referrals" | "boosts" | "withdrawals";

export function AdminUserCardView({ id }: { id: string }) {
  const card = useResource(`admin:user:${id}`, () => api.get<AdminUserCard>(`/admin/users/${encodeURIComponent(id)}`));
  const [blockOpen, setBlockOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("operations");
  const [kind, setKind] = useState<OperationKind | "all">("all");

  const operations = useMemo(
    () => (card.data ? card.data.operations.filter((op) => kind === "all" || op.kind === kind) : []),
    [card.data, kind],
  );

  if (!card.data) return card.error ? <AdminError error={card.error} onRetry={() => void card.reload()} /> : <Loading />;
  const d = card.data;
  const { user } = d;

  const post = async (body: Record<string, unknown>) => {
    await api.post(`/admin/users/${user.id}/block`, body);
    haptic("success");
    await card.reload();
  };

  const normalized = amount.trim().replace(",", ".").replace(/^\+/, "");
  const amountValid = AMOUNT_RE.test(normalized) && Number(normalized) !== 0;

  const adjust = async () => {
    if (!amountValid || !reason.trim()) return;
    const sign = normalized.startsWith("-") ? "Списать" : "Начислить";
    if (!(await confirmDialog(`${sign} ${formatStars(normalized.replace("-", ""))} пользователю ${user.id}? Причина: ${reason.trim()}`))) return;
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

  const counts: Record<Tab, number> = {
    operations: d.operations.length,
    cases: d.cases.length,
    tasks: d.completions.length,
    referrals: d.referrals.length,
    boosts: d.boosts.length,
    withdrawals: d.withdrawals.length,
  };

  return (
    <div className="adm-stack">
      <button type="button" className="adm-link adm-back" onClick={() => navigate("/admin/users")}>
        ← Все пользователи
      </button>

      <Panel className="adm-profile">
        <div className="adm-profile-head">
          <div className="adm-avatar" aria-hidden="true">
            {(user.first_name || user.username || "?").charAt(0).toUpperCase()}
          </div>
          <div className="adm-profile-main">
            <h2 className="adm-profile-name">{[user.first_name, user.last_name].filter(Boolean).join(" ") || userName(user)}</h2>
            <p className="adm-muted">
              {user.username ? `@${user.username} · ` : ""}
              <span className="adm-mono">{user.id}</span>
            </p>
            <div className="adm-tags">
              {user.is_blocked && <StatusTag tone="danger">Заблокирован</StatusTag>}
              {user.is_suspicious && <StatusTag tone="warn">Подозрительный</StatusTag>}
              {user.bot_blocked && <StatusTag tone="neutral">Бот остановлен</StatusTag>}
              {!user.onboarded && <StatusTag tone="neutral">Не прошёл приветствие</StatusTag>}
            </div>
          </div>
          <div className="adm-actions adm-profile-actions">
            {user.username && (
              <button type="button" className="adm-ghost" onClick={() => openExternal(`https://t.me/${user.username}`)}>
                Написать
              </button>
            )}
            <button type="button" className="adm-ghost" onClick={() => void downloadExport("operations", user.id)}>
              Операции CSV
            </button>
            <button
              type="button"
              className="adm-ghost"
              onClick={async () => {
                const text = user.is_suspicious
                  ? "Снять отметку? Действия пользователя снова будут учитываться в реферальной программе."
                  : "Отметить как подозрительный? Его задания перестанут приносить реферальные кейсы пригласившему.";
                if (await confirmDialog(text)) await post({ blocked: user.is_blocked, reason: user.block_reason ?? "", suspicious: !user.is_suspicious });
              }}
            >
              {user.is_suspicious ? "Снять «подозрительный»" : "Подозрительный"}
            </button>
            {user.is_blocked ? (
              <button
                type="button"
                className="adm-btn"
                onClick={async () => {
                  if (await confirmDialog("Разблокировать пользователя?")) await post({ blocked: false, reason: "" });
                }}
              >
                Разблокировать
              </button>
            ) : (
              <button type="button" className="adm-btn adm-btn-danger" onClick={() => setBlockOpen(true)}>
                Заблокировать
              </button>
            )}
          </div>
        </div>
        {user.is_blocked && user.block_reason && <div className="adm-alert">Причина блокировки: {user.block_reason}</div>}
        <dl className="adm-facts">
          <div>
            <dt>Регистрация</dt>
            <dd>{formatDate(user.registered_at)}</dd>
          </div>
          <div>
            <dt>Был в сети</dt>
            <dd>{formatDateTime(user.last_seen_at)}</dd>
          </div>
          <div>
            <dt>Язык</dt>
            <dd>{user.language_code ?? "—"}</dd>
          </div>
          <div>
            <dt>Пригласил</dt>
            <dd>
              {d.referrer ? (
                <button type="button" className="adm-link" onClick={() => navigate(`/admin/users/${d.referrer?.id}`)}>
                  {userName(d.referrer)}
                </button>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="adm-kpis adm-kpis-4">
        <Kpi label="Доступно" value={formatStars(user.available)} />
        <Kpi label="В ожидании" value={formatStars(user.pending)} />
        <Kpi label="На выводе" value={formatStars(user.withdrawing)} />
        <Kpi label="Заработано всего" value={formatStars(user.earned)} tone="accent" />
      </div>

      <div className="adm-grid adm-grid-side">
        <div className="adm-stack">
          <Segmented<Tab>
            label="Данные пользователя"
            value={tab}
            onChange={setTab}
            options={[
              { value: "operations", label: `Операции ${counts.operations}` },
              { value: "cases", label: `Кейсы ${counts.cases}` },
              { value: "tasks", label: `Задания ${counts.tasks}` },
              { value: "referrals", label: `Рефералы ${counts.referrals}` },
              { value: "boosts", label: `Бусты ${counts.boosts}` },
              { value: "withdrawals", label: `Выводы ${counts.withdrawals}` },
            ]}
          />
          {tab === "operations" && (
            <Panel
              title="Операции"
              aside={
                <select className="adm-input adm-select" value={kind} onChange={(event) => setKind(event.target.value as OperationKind | "all")} aria-label="Тип операции">
                  <option value="all">Все типы</option>
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              }
            >
              <DataTable
                rows={operations}
                rowKey={(row) => row.id}
                empty="Операций нет"
                columns={[
                  {
                    key: "title",
                    label: "Операция",
                    primary: true,
                    render: (row) => (
                      <span className="adm-stack-xs">
                        <span>{row.title}</span>
                        {row.reason && <span className="adm-muted">{row.reason}</span>}
                      </span>
                    ),
                  },
                  { key: "kind", label: "Тип", hideOnMobile: true, render: (row) => KIND_LABEL[row.kind] },
                  { key: "status", label: "Статус", render: (row) => <StatusTag tone={OP_TONE[row.status] ?? "neutral"}>{OP_STATUS[row.status] ?? row.status}</StatusTag> },
                  { key: "amount", label: "Сумма", align: "right", render: (row) => <span className="adm-num">{formatStars(row.amount, { sign: row.direction === "in" ? "+" : "-" })}</span> },
                  { key: "date", label: "Дата", render: (row) => formatDateTime(row.created_at) },
                ]}
              />
            </Panel>
          )}
          {tab === "cases" && (
            <Panel title="Кейсы">
              <DataTable
                rows={d.cases}
                rowKey={(row) => row.id}
                empty="Кейсов нет"
                columns={[
                  { key: "label", label: "Источник", primary: true, render: (row) => row.label },
                  { key: "state", label: "Статус", render: (row) => <StatusTag tone={row.state === "cancelled" ? "danger" : row.state === "ready" ? "neutral" : "ok"}>{row.status_label}</StatusTag> },
                  { key: "amount", label: "Приз", align: "right", render: (row) => formatStars(row.amount) },
                  { key: "date", label: "Открыт", render: (row) => formatDateTime(row.opened_at ?? row.created_at) },
                ]}
              />
            </Panel>
          )}
          {tab === "tasks" && (
            <Panel title="Задания">
              <CompletionList items={d.completions} empty="Заданий нет" />
            </Panel>
          )}
          {tab === "referrals" && (
            <Panel title="Приглашённые">
              <DataTable
                rows={d.referrals}
                rowKey={(row) => row.id}
                onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
                empty="Нет приглашённых"
                columns={[
                  { key: "user", label: "Пользователь", primary: true, render: (row) => userName(row) },
                  { key: "date", label: "Регистрация", render: (row) => formatDate(row.registered_at) },
                  { key: "tasks", label: "Подтв. заданий", align: "right", render: (row) => row.confirmed_tasks },
                ]}
              />
            </Panel>
          )}
          {tab === "boosts" && (
            <Panel title="Бусты">
              <DataTable
                rows={d.boosts}
                rowKey={(row) => row.id}
                empty="Бустов нет"
                columns={[
                  { key: "channel", label: "Канал", primary: true, render: (row) => row.channel || "—" },
                  {
                    key: "status",
                    label: "Статус",
                    render: (row) => (
                      <StatusTag tone={row.status === "active" ? "ok" : "neutral"}>{row.status === "active" ? "Активен" : row.status === "pending" ? "Ожидает" : "Завершён"}</StatusTag>
                    ),
                  },
                  { key: "periods", label: "Периодов", align: "right", render: (row) => row.periods_paid },
                  { key: "rewarded", label: "Начислено", align: "right", render: (row) => formatStars(row.rewarded) },
                  { key: "next", label: "След. проверка", hideOnMobile: true, render: (row) => formatDateTime(row.next_check_at) },
                ]}
              />
            </Panel>
          )}
          {tab === "withdrawals" && (
            <Panel title="Заявки на вывод">
              <DataTable
                rows={d.withdrawals}
                rowKey={(row) => row.id}
                empty="Заявок нет"
                columns={[
                  {
                    key: "gift",
                    label: "Подарок",
                    primary: true,
                    render: (row) => (
                      <span className="adm-gift-cell">
                        <GiftThumb giftId={row.gift_id} emoji={row.gift_emoji} size={32} />
                        <span>
                          {row.gift_name ?? "Подарок"} · №{row.id}
                        </span>
                      </span>
                    ),
                  },
                  { key: "status", label: "Статус", render: (row) => <StatusTag tone={WD_TONE[row.status] ?? "neutral"}>{row.status_label}</StatusTag> },
                  { key: "amount", label: "Сумма", align: "right", render: (row) => formatStars(row.amount) },
                  { key: "date", label: "Создана", render: (row) => formatDateTime(row.created_at) },
                ]}
              />
            </Panel>
          )}
        </div>

        <Panel title="Корректировка баланса" className="adm-sticky">
          <p className="adm-note">Положительная сумма — начисление, отрицательная — списание с доступного баланса. Причина обязательна и попадает в журнал.</p>
          <label className="adm-field">
            <span>Сумма, ⭐</span>
            <input className="adm-input" inputMode="decimal" placeholder="0.5 или -0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="adm-field">
            <span>Причина</span>
            <textarea className="adm-input adm-textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {amount && !amountValid && <p className="adm-error">Введите сумму с точностью до 0,001.</p>}
          {message && <p className={message.tone === "ok" ? "adm-ok" : "adm-error"}>{message.text}</p>}
          <button type="button" className="adm-btn adm-btn-block" disabled={!amountValid || !reason.trim() || adjusting} onClick={() => void adjust()}>
            {adjusting ? "Проводим…" : "Провести корректировку"}
          </button>
        </Panel>
      </div>

      <PromptSheet
        open={blockOpen}
        title="Блокировка пользователя"
        label="Причина блокировки"
        confirmText="Заблокировать"
        danger
        onCancel={() => setBlockOpen(false)}
        onSubmit={async (value) => {
          await post({ blocked: true, reason: value });
          setBlockOpen(false);
        }}
      />
    </div>
  );
}
