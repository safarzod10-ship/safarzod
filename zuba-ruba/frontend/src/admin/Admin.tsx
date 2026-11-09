import { useEffect, useRef, type ReactNode } from "react";
import type { ApiError } from "../api";
import { api } from "../api";
import { navigate, parentOf, type Route } from "../router";
import { haptic, showBackButton } from "../telegram";
import { ErrorState, useResource } from "../ui";
import "./admin.css";
import { AdminAuditView } from "./Audit";
import { AdminBroadcastView } from "./Broadcast";
import { AdminFinanceView } from "./Finance";
import { AdminOverviewView } from "./Overview";
import { AdminSettingsView } from "./Settings";
import { AdminTasksView } from "./Tasks";
import { AdminUserCardView } from "./UserCard";
import { AdminUsersView } from "./Users";
import { AdminWithdrawalsView } from "./Withdrawals";
import type { AdminOverview, AdminWithdrawalQueue } from "./types";

const SECTIONS = [
  { id: "", label: "Обзор" },
  { id: "users", label: "Пользователи" },
  { id: "withdrawals", label: "Выводы" },
  { id: "tasks", label: "Задания" },
  { id: "finance", label: "Финансы" },
  { id: "broadcast", label: "Рассылка" },
  { id: "settings", label: "Настройки" },
  { id: "audit", label: "Журнал" },
];

export function AdminScreen({ route }: { route: Route }) {
  const section = route.segments[1] ?? "";
  const userId = section === "users" ? route.segments[2] : undefined;
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const back = parentOf(route);
  const queue = useResource("admin:nav:withdrawals", () => api.get<AdminWithdrawalQueue>("/admin/withdrawals?tab=pending"));
  const overview = useResource("admin:overview", () => api.get<AdminOverview>("/admin/overview"));

  useEffect(() => showBackButton(() => navigate(back)), [back]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [section]);

  const badges: Record<string, number> = {
    withdrawals: (queue.data?.counts.pending ?? 0) + (queue.data?.counts.processing ?? 0),
    tasks: overview.data?.tasks_disputed ?? 0,
  };
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const go = (id: string) => {
    haptic("select");
    navigate(id ? `/admin/${id}` : "/admin");
  };

  return (
    <div className="adm">
      <aside className="adm-side" aria-label="Разделы панели">
        <button type="button" className="adm-brand" onClick={() => navigate("/profile")}>
          <span className="adm-brand-mark">ZR</span>
          <span className="adm-brand-text">
            <strong>ZUBA RUBA</strong>
            <span>Панель управления</span>
          </span>
        </button>
        <nav className="adm-side-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === current.id ? "adm-side-link adm-side-active" : "adm-side-link"}
              aria-current={item.id === current.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              <span>{item.label}</span>
              {badges[item.id] ? <span className="adm-count">{badges[item.id]}</span> : null}
            </button>
          ))}
        </nav>
        <button type="button" className="adm-side-back" onClick={() => navigate("/profile")}>
          ← Вернуться в приложение
        </button>
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <p className="adm-eyebrow">Панель управления</p>
          <h1 className="adm-title">{userId ? "Пользователь" : current.label}</h1>
        </header>
        <nav className="adm-tabs" aria-label="Разделы панели">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              ref={item.id === current.id ? activeRef : undefined}
              type="button"
              className={item.id === current.id ? "adm-tab adm-tab-active" : "adm-tab"}
              onClick={() => go(item.id)}
            >
              {item.label}
              {badges[item.id] ? <span className="adm-count">{badges[item.id]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="adm-body">{renderSection(section, userId)}</div>
      </div>
    </div>
  );
}

function renderSection(section: string, userId: string | undefined) {
  switch (section) {
    case "users":
      return userId ? <AdminUserCardView id={userId} /> : <AdminUsersView />;
    case "withdrawals":
      return <AdminWithdrawalsView />;
    case "tasks":
      return <AdminTasksView />;
    case "finance":
      return <AdminFinanceView />;
    case "settings":
      return <AdminSettingsView />;
    case "broadcast":
      return <AdminBroadcastView />;
    case "audit":
      return <AdminAuditView />;
    default:
      return <AdminOverviewView />;
  }
}

export function AdminError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.status === 403 || error.code === "forbidden") {
    return (
      <div className="state">
        <p className="state-title">Нет доступа</p>
        <p className="state-text">Раздел доступен только администратору проекта.</p>
      </div>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="adm-loading" aria-busy="true">
      <span className="spinner" />
      {children}
    </div>
  );
}
