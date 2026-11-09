import { formatDateTime, formatRub, formatStars } from "../format";
import { navigate } from "../router";
import { DataTable } from "./kit";
import type { AdminCompletion } from "./types";

const TONE: Record<AdminCompletion["status"], string> = {
  waiting_payment: "warn",
  holding: "warn",
  confirmed: "ok",
  cancelled: "danger",
  disputed: "danger",
};

export function StatusTag({ tone, children }: { tone: string; children: string }) {
  return <span className={`adm-tag adm-tag-${tone}`}>{children}</span>;
}

export function CompletionList({
  items,
  onResolve,
  showUser,
  empty,
}: {
  items: AdminCompletion[];
  onResolve?: (item: AdminCompletion, action: "confirm" | "cancel") => void;
  showUser?: boolean;
  empty: string;
}) {
  return (
    <DataTable<AdminCompletion>
      rows={items}
      rowKey={(row) => row.id}
      empty={empty}
      columns={[
        {
          key: "title",
          label: "Задание",
          primary: true,
          render: (row) => (
            <span className="adm-stack-xs">
              <span className="adm-clip">{row.title || "Без названия"}</span>
              <span className="adm-muted adm-mono adm-clip" title={row.signature}>
                {row.signature}
              </span>
              {row.note && <span className="adm-muted">{row.note}</span>}
            </span>
          ),
        },
        ...(showUser
          ? [
              {
                key: "user",
                label: "Пользователь",
                render: (row: AdminCompletion) => (
                  <button
                    type="button"
                    className="adm-link adm-mono"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/admin/users/${row.user_id}`);
                    }}
                  >
                    {row.user_id}
                  </button>
                ),
              },
            ]
          : []),
        { key: "status", label: "Статус", render: (row) => <StatusTag tone={TONE[row.status]}>{row.status_label}</StatusTag> },
        { key: "flyer", label: "Flyer", hideOnMobile: true, render: (row) => <span className="adm-mono">{row.flyer_status ?? "—"}</span> },
        { key: "reward", label: "Награда / доход", align: "right", render: (row) => `${formatStars(row.reward)} · ${formatRub(row.income)}` },
        { key: "completed", label: "Выполнено", render: (row) => formatDateTime(row.completed_at) },
        { key: "next", label: "Проверка", hideOnMobile: true, render: (row) => formatDateTime(row.next_check_at ?? row.hold_until) },
        ...(onResolve
          ? [
              {
                key: "actions",
                wide: true,
                label: "Решение",
                render: (row: AdminCompletion) =>
                  row.status === "disputed" || row.status === "waiting_payment" || row.status === "holding" ? (
                    <span className="adm-actions">
                      <button
                        type="button"
                        className="adm-btn adm-btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onResolve(row, "confirm");
                        }}
                      >
                        Подтвердить
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn-sm adm-btn-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          onResolve(row, "cancel");
                        }}
                      >
                        Отменить
                      </button>
                    </span>
                  ) : (
                    "—"
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}
