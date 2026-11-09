import { useState } from "react";
import { api } from "../api";
import { formatDateTime, formatNumber } from "../format";
import { navigate } from "../router";
import { haptic } from "../telegram";
import { PromptSheet, useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { CompletionList } from "./CompletionList";
import { DataTable, Panel, Segmented } from "./kit";
import type { AdminCompletion, AdminTasks } from "./types";

const SOURCE: Record<string, string> = { user: "пользователь", job: "автопроверка", webhook: "вебхук" };

type Tab = "disputed" | "unpaid" | "history" | "errors";

export function AdminTasksView() {
  const data = useResource("admin:tasks", () => api.get<AdminTasks>("/admin/tasks"));
  const [resolving, setResolving] = useState<{ item: AdminCompletion; action: "confirm" | "cancel" } | null>(null);
  const [tab, setTab] = useState<Tab>("disputed");

  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loading />;
  const d = data.data;

  return (
    <div className="adm-stack">
      <Panel title="По типам заданий">
        <DataTable
          rows={d.by_type}
          rowKey={(row) => row.type}
          columns={[
            { key: "label", label: "Тип", primary: true, render: (row) => row.label },
            { key: "completed", label: "Засчитано", align: "right", render: (row) => formatNumber(row.completed) },
            { key: "paid", label: "Оплачено", align: "right", render: (row) => formatNumber(row.paid) },
            { key: "waiting", label: "Ожидают", align: "right", render: (row) => formatNumber(row.waiting) },
            { key: "cancelled", label: "Отменено", align: "right", render: (row) => formatNumber(row.cancelled) },
            {
              key: "checks",
              label: "Успешных проверок",
              align: "right",
              render: (row) => `${formatNumber(row.checks_success)} из ${formatNumber(row.checks)}${row.checks ? ` · ${Math.round((row.checks_success / row.checks) * 100)}%` : ""}`,
            },
          ]}
        />
      </Panel>

      <Segmented<Tab>
        label="Списки заданий"
        value={tab}
        onChange={setTab}
        options={[
          { value: "disputed", label: `Спорные ${d.disputed.length}` },
          { value: "unpaid", label: `Ждут оплаты ${d.unpaid.length}` },
          { value: "history", label: "История проверок" },
          { value: "errors", label: `Ошибки Flyer ${d.flyer_errors.length}` },
        ]}
      />

      {tab === "disputed" && (
        <Panel title="Ручная проверка">
          <p className="adm-note">Flyer не подтвердил оплату в срок или снял ресурс. Решение сохраняется в журнале, пользователь получит уведомление.</p>
          <CompletionList items={d.disputed} showUser empty="Спорных случаев нет" onResolve={(item, action) => setResolving({ item, action })} />
        </Panel>
      )}
      {tab === "unpaid" && (
        <Panel title="Ожидают оплаты Flyer или удержания">
          <CompletionList items={d.unpaid} showUser empty="Все задания оплачены" onResolve={(item, action) => setResolving({ item, action })} />
        </Panel>
      )}
      {tab === "history" && (
        <Panel title="Последние проверки">
          <DataTable
            rows={d.history}
            rowKey={(row) => `${row.created_at}-${row.signature}-${row.source}`}
            empty="Проверок пока не было"
            columns={[
              { key: "status", label: "Ответ Flyer", primary: true, render: (row) => <span className="adm-mono">{row.flyer_status ?? "ошибка"}</span> },
              { key: "source", label: "Источник", render: (row) => SOURCE[row.source] ?? row.source },
              {
                key: "user",
                label: "Пользователь",
                render: (row) => (
                  <button type="button" className="adm-link adm-mono" onClick={() => navigate(`/admin/users/${row.user_id}`)}>
                    {row.user_id}
                  </button>
                ),
              },
              { key: "signature", label: "Signature", hideOnMobile: true, render: (row) => <span className="adm-mono adm-clip">{row.signature}</span> },
              { key: "date", label: "Время", render: (row) => formatDateTime(row.created_at) },
            ]}
          />
        </Panel>
      )}
      {tab === "errors" && (
        <Panel title="Ошибки Flyer">
          <DataTable
            rows={d.flyer_errors}
            rowKey={(row) => `${row.created_at}-${row.method}-${row.error}`}
            empty="Ошибок нет"
            columns={[
              { key: "method", label: "Метод", primary: true, render: (row) => <span className="adm-mono">{row.method}</span> },
              { key: "error", label: "Ошибка", render: (row) => <span className="adm-clip-2">{row.error}</span> },
              { key: "date", label: "Время", render: (row) => formatDateTime(row.created_at) },
            ]}
          />
        </Panel>
      )}

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
    </div>
  );
}
