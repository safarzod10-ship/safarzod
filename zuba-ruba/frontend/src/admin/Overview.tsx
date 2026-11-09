import { api } from "../api";
import { formatRub, isNegative } from "../format";
import type { AdminOverview } from "../types";
import { Loader, Notice, Section, useResource } from "../ui";
import { AdminError, Stat } from "./Admin";

export function AdminOverviewView() {
  const data = useResource("admin:overview", () => api.get<AdminOverview>("/admin/overview"));
  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loader />;
  const d = data.data;
  return (
    <>
      {d.warning && <Notice tone="warning">{d.warning}</Notice>}
      <Section title="Пользователи" flush>
        <div className="stats">
          <Stat label="Всего" value={d.users_total} />
          <Stat label="Активны за сутки" value={d.users_active_24h} />
          <Stat label="Новые за сутки" value={d.users_new_24h} />
        </div>
      </Section>
      <Section title="Задания" flush>
        <div className="stats">
          <Stat label="Выполнено" value={d.tasks_completed} />
          <Stat label="Оплачено" value={d.tasks_paid} />
          <Stat label="Ожидают" value={d.tasks_waiting} />
          <Stat label="Спорные" value={d.tasks_disputed} tone={d.tasks_disputed > 0 ? "danger" : undefined} />
          <Stat label="Активные бусты" value={d.boosts_active} />
        </div>
      </Section>
      <Section title="Деньги" flush>
        <div className="stats">
          <Stat label="Доход Flyer" value={formatRub(d.income)} />
          <Stat label="Расходы на награды" value={formatRub(d.reward_expenses)} />
          <Stat label="Чистая прибыль" value={formatRub(d.net_profit)} tone={isNegative(d.net_profit) ? "danger" : undefined} />
        </div>
      </Section>
    </>
  );
}
