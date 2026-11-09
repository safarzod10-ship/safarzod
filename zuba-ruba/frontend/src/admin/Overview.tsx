import { useState } from "react";
import { api } from "../api";
import { formatDateTime, formatNumber, formatRub, formatStars, isNegative } from "../format";
import { navigate } from "../router";
import { useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { BarChart, DataTable, Kpi, Panel, Segmented, userName } from "./kit";
import type { AdminAnalytics, AdminOverview, FeedEvent, SeriesKey } from "./types";

const CHARTS: { key: SeriesKey; label: string; unit?: string; note?: string }[] = [
  { key: "new_users", label: "Новые пользователи" },
  { key: "active_users", label: "Активные", note: "Проверили задание, открыли кейс или подали заявку на вывод" },
  { key: "task_checks", label: "Проверки заданий" },
  { key: "completions", label: "Засчитанные задания" },
  { key: "confirmed", label: "Подтверждённые задания" },
  { key: "cancelled", label: "Отменённые задания" },
  { key: "cases_opened", label: "Открытые кейсы" },
  { key: "rewards", label: "Начислено наград", unit: "⭐" },
  { key: "payouts", label: "Выведено подарками", unit: "⭐" },
];

const EVENT_LABEL: Record<FeedEvent["kind"], string> = {
  withdrawal: "Вывод",
  dispute: "Спор",
  flyer_error: "Ошибка Flyer",
};

export function AdminOverviewView() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const overview = useResource("admin:overview", () => api.get<AdminOverview>("/admin/overview"));
  const analytics = useResource(`admin:analytics:${days}`, () => api.get<AdminAnalytics>(`/admin/analytics?days=${days}`));

  if (!overview.data) return overview.error ? <AdminError error={overview.error} onRetry={() => void overview.reload()} /> : <Loading />;
  const o = overview.data;
  const a = analytics.data;
  const funnelTop = a?.funnel[0]?.count ?? 0;

  return (
    <div className="adm-stack">
      {o.warning && <div className="adm-alert">{o.warning}</div>}
      <div className="adm-kpis">
        <Kpi label="Пользователей" value={formatNumber(o.users_total)} hint={`+${formatNumber(o.users_new_24h)} за сутки`} />
        <Kpi label="Активны за сутки" value={formatNumber(o.users_active_24h)} />
        <Kpi label="Заданий оплачено" value={formatNumber(o.tasks_paid)} hint={`из ${formatNumber(o.tasks_completed)} засчитанных`} />
        <Kpi label="Ждут оплаты" value={formatNumber(o.tasks_waiting)} hint={o.tasks_disputed ? `${o.tasks_disputed} на ручной проверке` : "споров нет"} tone={o.tasks_disputed ? "accent" : undefined} />
        <Kpi label="Активных бустов" value={formatNumber(o.boosts_active)} />
        <Kpi label="Доход подтверждён" value={formatRub(o.income)} />
        <Kpi label="Расходы на награды" value={formatRub(o.reward_expenses)} />
        <Kpi label="Чистая прибыль" value={formatRub(o.net_profit)} tone={isNegative(o.net_profit) ? "danger" : "positive"} />
      </div>

      <div className="adm-section-bar">
        <h2 className="adm-h2">Динамика</h2>
        <Segmented
          label="Период"
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: "7 дней" },
            { value: 30, label: "30 дней" },
            { value: 90, label: "90 дней" },
          ]}
        />
      </div>
      {!a ? (
        analytics.error ? <AdminError error={analytics.error} onRetry={() => void analytics.reload()} /> : <Loading />
      ) : (
        <>
          <div className="adm-grid adm-grid-3">
            {CHARTS.map((chart) => {
              const series = a.series[chart.key];
              return (
                <Panel
                  key={chart.key}
                  title={chart.label}
                  aside={
                    <span className="adm-total">
                      {chart.unit ? formatStars(String(series.total)) : formatNumber(String(series.total))}
                    </span>
                  }
                >
                  <BarChart dates={a.dates} values={series.points.map(Number)} unit={chart.unit} />
                  {chart.note && <p className="adm-note">{chart.note}</p>}
                </Panel>
              );
            })}
          </div>

          <div className="adm-grid adm-grid-2">
            <Panel title="Воронка новых пользователей" aside={<span className="adm-muted">за {days} дн.</span>}>
              <ol className="adm-funnel">
                {a.funnel.map((step, index) => {
                  const share = funnelTop ? Math.round((step.count / funnelTop) * 100) : 0;
                  const prev = index > 0 ? a.funnel[index - 1].count : step.count;
                  const conv = prev ? Math.round((step.count / prev) * 100) : 0;
                  return (
                    <li key={step.key} className="adm-funnel-step">
                      <div className="adm-funnel-head">
                        <span>{step.label}</span>
                        <span className="adm-num">
                          {formatNumber(step.count)}
                          {index > 0 && <span className="adm-muted"> · {conv}%</span>}
                        </span>
                      </div>
                      <div className="adm-meter">
                        <span style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Panel>
            <Panel title="Последние события">
              {a.events.length === 0 ? (
                <div className="adm-empty">Событий пока нет</div>
              ) : (
                <ul className="adm-feed">
                  {a.events.map((event, index) => (
                    <li key={`${event.kind}-${event.at}-${index}`} className="adm-feed-item">
                      <span className={`adm-tag adm-tag-${event.kind}`}>{EVENT_LABEL[event.kind]}</span>
                      <div className="adm-feed-main">
                        <span className="adm-feed-title">{event.title}</span>
                        {event.status && <span className="adm-muted adm-clip">{event.status}</span>}
                      </div>
                      <div className="adm-feed-side">
                        {event.user_id ? (
                          <button type="button" className="adm-link" onClick={() => navigate(`/admin/users/${event.user_id}`)}>
                            {event.username ? `@${event.username}` : event.user_id}
                          </button>
                        ) : null}
                        <span className="adm-muted">{formatDateTime(event.at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="adm-grid adm-grid-2">
            <Panel title="Лучшие пригласившие">
              <DataTable
                rows={a.top_referrers}
                rowKey={(row) => row.id}
                onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
                empty="Рефералов пока нет"
                columns={[
                  { key: "user", label: "Пользователь", primary: true, render: (row) => userName(row) },
                  { key: "invited", label: "Пригласил", align: "right", render: (row) => formatNumber(row.invited) },
                  { key: "confirmed", label: "Заданий друзей", align: "right", render: (row) => formatNumber(row.confirmed_tasks) },
                  { key: "cases", label: "Кейсов", align: "right", render: (row) => formatNumber(row.referral_cases) },
                ]}
              />
            </Panel>
            <Panel title="Больше всех заработали">
              <DataTable
                rows={a.top_earners}
                rowKey={(row) => row.id}
                onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
                empty="Начислений пока нет"
                columns={[
                  { key: "user", label: "Пользователь", primary: true, render: (row) => userName(row) },
                  { key: "earned", label: "Заработано", align: "right", render: (row) => formatStars(row.earned) },
                  { key: "available", label: "Доступно", align: "right", render: (row) => formatStars(row.available) },
                ]}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
