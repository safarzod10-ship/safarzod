import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { formatDateTime } from "../format";
import { AdminError, Loading } from "./Admin";
import { DataTable, Panel, useDebounced } from "./kit";
import type { AuditEntry, AuditPage } from "./types";

const ACTIONS: Record<string, string> = {
  "settings.update": "Изменение настроек",
  "user.block": "Блокировка",
  "user.unblock": "Разблокировка",
  "user.suspicious": "Отметка «подозрительный»",
  "user.trusted": "Снята отметка «подозрительный»",
  "balance.adjust": "Корректировка баланса",
  "completion.confirm": "Подтверждение задания",
  "completion.cancel": "Отмена задания",
  "withdrawal.approve": "Одобрение вывода",
  "withdrawal.reject": "Отклонение вывода",
  "withdrawal.completed": "Вывод выполнен",
  "withdrawal.failed": "Вывод не выполнен",
  "withdrawal.uncertain": "Отправка не подтверждена Telegram",
  "withdrawal.manual_complete": "Вывод подтверждён вручную",
  "stars.topup_created": "Создан счёт на пополнение",
  "stars.topup_paid": "Баланс бота пополнен",
  "broadcast.create": "Создание рассылки",
  "broadcast.send": "Запуск рассылки",
  "broadcast.cancel": "Отмена рассылки",
};

function details(value: AuditEntry["details"]): string {
  if (!value || Object.keys(value).length === 0) return "";
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== "")
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function AdminAuditView() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ actions: string[]; admins: number[] }>({ actions: [], admins: [] });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [admin, setAdmin] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());

  const load = useCallback(
    async (from: string | null) => {
      const search = new URLSearchParams();
      if (from) search.set("cursor", from);
      if (action) search.set("action", action);
      if (admin) search.set("admin_id", admin);
      if (q) search.set("q", q);
      setLoading(true);
      try {
        const page = await api.get<AuditPage>(`/admin/audit?${search}`);
        setItems((current) => (from ? [...current, ...page.items] : page.items));
        setCursor(page.next_cursor);
        setMeta({ actions: page.actions ?? [], admins: page.admins ?? [] });
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, "internal", "Не удалось загрузить журнал."));
      } finally {
        setLoading(false);
      }
    },
    [action, admin, q],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (error && items.length === 0) return <AdminError error={error} onRetry={() => void load(null)} />;

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <input className="adm-input adm-search" type="search" placeholder="Поиск по объекту и деталям" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск в журнале" />
        <select className="adm-input adm-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Действие">
          <option value="">Все действия</option>
          {meta.actions.map((value) => (
            <option key={value} value={value}>
              {ACTIONS[value] ?? value}
            </option>
          ))}
        </select>
        {meta.admins.length > 1 && (
          <select className="adm-input adm-select" value={admin} onChange={(e) => setAdmin(e.target.value)} aria-label="Администратор">
            <option value="">Все администраторы</option>
            {meta.admins.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
      </div>
      <Panel title="Действия администраторов">
        {loading && items.length === 0 ? (
          <Loading />
        ) : (
          <DataTable
            rows={items}
            rowKey={(row) => row.id}
            empty="Записей нет"
            columns={[
              {
                key: "action",
                label: "Действие",
                primary: true,
                render: (row) => (
                  <span className="adm-stack-xs">
                    <span>{ACTIONS[row.action] ?? row.action}</span>
                    {details(row.details) && <span className="adm-muted adm-clip-2">{details(row.details)}</span>}
                  </span>
                ),
              },
              { key: "target", label: "Объект", render: (row) => <span className="adm-mono">{row.target || "—"}</span> },
              { key: "admin", label: "Админ", hideOnMobile: true, render: (row) => <span className="adm-mono">{row.admin_id}</span> },
              { key: "date", label: "Время", render: (row) => formatDateTime(row.created_at) },
            ]}
          />
        )}
        {cursor && (
          <div className="adm-pager">
            <button type="button" className="adm-ghost" disabled={loading} onClick={() => void load(cursor)}>
              {loading ? "Загружаем…" : "Показать ещё"}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
