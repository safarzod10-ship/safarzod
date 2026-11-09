import { useRef, useState } from "react";
import { ApiError, api } from "../api";
import { formatDate, formatDateTime, formatNumber, formatStars } from "../format";
import { navigate } from "../router";
import { useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { DataTable, Pager, Panel, Segmented, downloadExport, useDebounced, userName } from "./kit";
import type { AdminUserRow, AdminUsersPage } from "./types";

type Status = "" | "blocked" | "suspicious" | "withdrawing";

export function AdminUsersView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({ key: "last_seen_at", order: "desc" });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const q = useDebounced(query.trim());
  const params = new URLSearchParams({ q, status, sort: sort.key, order: sort.order, page: String(page), per_page: "50" });
  const data = useResource(`admin:users:${params}`, () => api.get<AdminUsersPage>(`/admin/users?${params}`));
  const last = useRef<AdminUsersPage | undefined>(undefined);
  if (data.data) last.current = data.data;
  const shown = data.data ?? last.current;

  const changeSort = (key: string) => {
    setPage(1);
    setSort((current) => (current.key === key ? { key, order: current.order === "asc" ? "desc" : "asc" } : { key, order: "desc" }));
  };

  const exportUsers = async () => {
    setExporting(null);
    try {
      await downloadExport("users");
    } catch (err) {
      setExporting(err instanceof ApiError ? err.message : "Не удалось подготовить выгрузку.");
    }
  };

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <input
          className="adm-input adm-search"
          type="search"
          inputMode="search"
          placeholder="ID, @username или имя"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          aria-label="Поиск пользователей"
        />
        <Segmented
          label="Фильтр"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: "", label: "Все" },
            { value: "withdrawing", label: "С выводом" },
            { value: "suspicious", label: "Подозрительные" },
            { value: "blocked", label: "Заблокированные" },
          ]}
        />
        <button type="button" className="adm-ghost" onClick={() => void exportUsers()}>
          Выгрузить CSV
        </button>
      </div>
      {exporting && <div className="adm-alert">{exporting}</div>}
      <Panel
        title={shown ? `Найдено: ${formatNumber(shown.total)}` : "Пользователи"}
        aside={data.loading && shown ? <span className="adm-muted">Обновление…</span> : undefined}
      >
        {!shown ? (
          data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loading />
        ) : (
          <>
            <DataTable<AdminUserRow>
              rows={shown.items}
              rowKey={(row) => row.id}
              sort={sort}
              onSort={changeSort}
              onRowClick={(row) => navigate(`/admin/users/${row.id}`)}
              empty={q || status ? "Никого не нашли" : "Пользователей пока нет"}
              columns={[
                {
                  key: "user",
                  label: "Пользователь",
                  primary: true,
                  render: (row) => (
                    <span className="adm-user-cell">
                      <span className="adm-user-name">{userName(row)}</span>
                      <span className="adm-muted adm-mono">{row.id}</span>
                      {row.is_blocked && <span className="adm-tag adm-tag-danger">блок</span>}
                      {row.is_suspicious && <span className="adm-tag adm-tag-warn">подозр.</span>}
                    </span>
                  ),
                },
                { key: "registered_at", label: "Регистрация", sortable: true, hideOnMobile: true, render: (row) => formatDate(row.registered_at) },
                { key: "last_seen_at", label: "Был в сети", sortable: true, render: (row) => formatDateTime(row.last_seen_at) },
                { key: "available", label: "Доступно", sortable: true, align: "right", render: (row) => formatStars(row.available) },
                { key: "pending", label: "Ожидает", align: "right", hideOnMobile: true, render: (row) => formatStars(row.pending) },
                { key: "earned", label: "Заработал", sortable: true, align: "right", render: (row) => formatStars(row.earned ?? "0") },
              ]}
            />
            <Pager page={page} pages={shown.pages} onChange={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
