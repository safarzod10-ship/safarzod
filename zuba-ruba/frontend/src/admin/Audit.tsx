import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { formatDateTime } from "../format";
import type { AuditEntry, Page } from "../types";
import { Button, EmptyState, Loader } from "../ui";
import { AdminError } from "./Admin";

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
  "broadcast.create": "Создание рассылки",
  "broadcast.send": "Запуск рассылки",
  "broadcast.cancel": "Отмена рассылки",
};

function details(value: AuditEntry["details"]): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return Object.entries(value)
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function AdminAuditView() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async (from: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<Page<AuditEntry>>(`/admin/audit${from ? `?cursor=${encodeURIComponent(from)}` : ""}`);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setDone(!page.next_cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "internal", "Не удалось загрузить журнал."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  if (items.length === 0 && error) return <AdminError error={error} onRetry={() => void load(null)} />;
  if (items.length === 0 && loading) return <Loader />;
  if (items.length === 0 && done) return <EmptyState title="Журнал пуст" text="Здесь будут все административные действия." />;

  return (
    <>
      <ul className="list">
        {items.map((entry) => (
          <li key={entry.id} className="op-row">
            <div className="op-main">
              <span className="op-title">{ACTIONS[entry.action] ?? entry.action}</span>
              <span className="op-reason">
                Админ {entry.admin_id}
                {entry.target ? ` · ${entry.target}` : ""}
              </span>
              {details(entry.details) && <span className="op-reason mono wrap">{details(entry.details)}</span>}
            </div>
            <span className="op-date">{formatDateTime(entry.created_at)}</span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error center">{error.message}</p>}
      {!done && (
        <div className="more">
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void load(cursor)}>
            Показать ещё
          </Button>
        </div>
      )}
    </>
  );
}
