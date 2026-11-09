import { useState } from "react";
import { api } from "../api";
import { formatDateTime } from "../format";
import { haptic } from "../telegram";
import type { AdminCompletion, AdminTasks } from "../types";
import { EmptyState, Loader, PromptSheet, Section, useResource } from "../ui";
import { AdminError } from "./Admin";
import { CompletionList } from "./CompletionList";

export function AdminTasksView() {
  const data = useResource("admin:tasks", () => api.get<AdminTasks>("/admin/tasks"));
  const [resolving, setResolving] = useState<{ item: AdminCompletion; action: "confirm" | "cancel" } | null>(null);

  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loader />;
  const d = data.data;

  return (
    <>
      <Section title="По типам" flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Вып.</th>
                <th>Опл.</th>
                <th>Ожид.</th>
                <th>Отм.</th>
                <th>Проверки</th>
              </tr>
            </thead>
            <tbody>
              {d.by_type.map((row) => (
                <tr key={row.type}>
                  <td>{row.label}</td>
                  <td>{row.completed}</td>
                  <td>{row.paid}</td>
                  <td>{row.waiting}</td>
                  <td>{row.cancelled}</td>
                  <td>
                    {row.checks_success}/{row.checks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Спорные · ${d.disputed.length}`}>
        {d.disputed.length ? (
          <CompletionList items={d.disputed} showUser onResolve={(item, action) => setResolving({ item, action })} />
        ) : (
          <EmptyState title="Спорных случаев нет" />
        )}
      </Section>

      <Section title={`Неоплаченные · ${d.unpaid.length}`}>
        {d.unpaid.length ? <CompletionList items={d.unpaid} showUser /> : <EmptyState title="Все задания оплачены" />}
      </Section>

      <Section title="Ошибки Flyer">
        {d.flyer_errors.length === 0 ? (
          <EmptyState title="Ошибок нет" />
        ) : (
          <ul className="list">
            {d.flyer_errors.map((err, index) => (
              <li key={`${err.created_at}-${index}`} className="op-row">
                <div className="op-main">
                  <span className="op-title mono">{err.method}</span>
                  <span className="op-reason">{err.error}</span>
                </div>
                <span className="op-date">{formatDateTime(err.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="История статусов">
        {d.history.length === 0 ? (
          <EmptyState title="Проверок пока не было" />
        ) : (
          <ul className="list">
            {d.history.map((row, index) => (
              <li key={`${row.created_at}-${index}`} className="op-row">
                <div className="op-main">
                  <span className="op-title">
                    {row.flyer_status ?? "ошибка"} · {sourceLabel(row.source)}
                  </span>
                  <span className="op-reason mono ellipsis">
                    {row.user_id} · {row.signature}
                  </span>
                </div>
                <span className="op-date">{formatDateTime(row.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PromptSheet
        open={resolving !== null}
        title={resolving?.action === "confirm" ? "Подтвердить награду" : "Отменить награду"}
        label="Комментарий (сохраняется в журнале)"
        confirmText={resolving?.action === "confirm" ? "Подтвердить" : "Отменить награду"}
        danger={resolving?.action === "cancel"}
        onCancel={() => setResolving(null)}
        onSubmit={async (note) => {
          if (!resolving) return;
          await api.post(`/admin/completions/${resolving.item.id}/resolve`, { action: resolving.action, note });
          haptic("success");
          setResolving(null);
          await data.reload();
        }}
      />
    </>
  );
}

function sourceLabel(source: string): string {
  if (source === "user") return "пользователь";
  if (source === "job") return "автопроверка";
  if (source === "webhook") return "вебхук";
  return source;
}
