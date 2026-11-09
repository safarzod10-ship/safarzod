import { api } from "../api";
import { formatDateTime, formatRub, formatStars, isNegative } from "../format";
import { navigate } from "../router";
import { useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { DataTable, Kpi, Panel } from "./kit";
import type { AdminFinance } from "./types";

function Line({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={strong ? "adm-line adm-line-strong" : "adm-line"}>
      <span className="adm-stack-xs">
        <span>{label}</span>
        {hint && <span className="adm-muted">{hint}</span>}
      </span>
      <span className="adm-num">{value}</span>
    </div>
  );
}

export function AdminFinanceView() {
  const data = useResource("admin:finance", () => api.get<AdminFinance>("/admin/finance"));
  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loading />;
  const d = data.data;
  const pending = d.withdrawals.filter((w) => w.status === "pending" || w.status === "approved").length;

  return (
    <div className="adm-stack">
      {d.warning && <div className="adm-alert">{d.warning}</div>}
      <div className="adm-kpis">
        <Kpi label="Подтверждённый доход" value={formatRub(d.income_confirmed)} />
        <Kpi label="Расходы на награды" value={formatRub(d.reward_expenses)} />
        <Kpi label="Обязательства" value={formatRub(d.liabilities)} hint="балансы и неоткрытые кейсы" />
        <Kpi label="Чистая прибыль" value={formatRub(d.net_profit)} tone={isNegative(d.net_profit) ? "danger" : "positive"} />
      </div>
      <div className="adm-grid adm-grid-2">
        <Panel title="Доход">
          <Line label="Валовый доход" value={formatRub(d.income_gross)} hint="все засчитанные задания, кроме отменённых" />
          <Line label="Подтверждённый доход" value={formatRub(d.income_confirmed)} hint="задания, оплату которых подтвердил Flyer" />
          <Line label="По ценам Flyer" value={formatRub(d.income_flyer_reported)} hint="сумма поля price подтверждённых заданий" />
          <Line label="Порог вывода из Flyer" value={formatRub(d.flyer_withdraw_threshold)} />
        </Panel>
        <Panel title="Расходы и резервы">
          <Line label="Награды выплачены" value={formatRub(d.reward_expenses)} />
          <Line label="Реферальные кейсы" value={formatRub(d.referral_expenses)} />
          <Line label="Ожидаемые начисления" value={formatRub(d.rewards_pending)} hint="награды в периоде удержания" />
          <Line label="Неоткрытые кейсы" value={formatRub(d.unopened_cases)} />
          <Line label="Комиссии вывода Flyer" value={formatRub(d.commissions)} hint="оценка по порогу вывода" />
          <Line label="Чистая прибыль" value={formatRub(d.net_profit)} strong />
        </Panel>
      </div>
      <div className="adm-grid adm-grid-2">
        <Panel
          title="Звёзды бота"
          aside={
            <button type="button" className="adm-link" onClick={() => navigate("/admin/withdrawals")}>
              Выводы →
            </button>
          }
        >
          <Line label="Баланс бота" value={d.bot_star_balance === null ? "недоступно" : formatStars(String(d.bot_star_balance))} />
          <Line label="Заявок в очереди" value={String(pending)} />
        </Panel>
        <Panel title="Корректировки и отмены">
          <DataTable
            rows={d.adjustments}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/admin/users/${row.user_id}`)}
            empty="Корректировок не было"
            columns={[
              {
                key: "reason",
                label: "Основание",
                primary: true,
                render: (row) => (
                  <span className="adm-stack-xs">
                    <span>{row.reason || row.title}</span>
                    <span className="adm-muted">
                      пользователь {row.user_id}
                      {row.admin_id ? ` · админ ${row.admin_id}` : ""}
                    </span>
                  </span>
                ),
              },
              { key: "amount", label: "Сумма", align: "right", render: (row) => <span className="adm-num">{formatStars(row.amount, { sign: row.direction === "in" ? "+" : "-" })}</span> },
              { key: "date", label: "Дата", render: (row) => formatDateTime(row.created_at) },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
