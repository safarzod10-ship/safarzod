import { useEffect, useRef, type ReactNode } from "react";
import type { ApiError } from "../api";
import { navigate, parentOf, type Route } from "../router";
import { haptic } from "../telegram";
import { ErrorState, Screen } from "../ui";
import { AdminOverviewView } from "./Overview";
import { AdminUsersView } from "./Users";
import { AdminUserCardView } from "./UserCard";
import { AdminTasksView } from "./Tasks";
import { AdminFinanceView } from "./Finance";
import { AdminSettingsView } from "./Settings";
import { AdminBroadcastView } from "./Broadcast";
import { AdminAuditView } from "./Audit";

const SECTIONS = [
  { id: "", label: "Обзор" },
  { id: "users", label: "Пользователи" },
  { id: "tasks", label: "Задания" },
  { id: "finance", label: "Финансы" },
  { id: "settings", label: "Настройки" },
  { id: "broadcast", label: "Рассылка" },
  { id: "audit", label: "Журнал" },
];

export function AdminScreen({ route }: { route: Route }) {
  const section = route.segments[1] ?? "";
  const userId = section === "users" ? route.segments[2] : undefined;
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [section]);

  return (
    <Screen title="Панель управления" back={parentOf(route)}>
      <nav className="admin-tabs" aria-label="Разделы панели">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            ref={item.id === section ? activeRef : undefined}
            type="button"
            className={item.id === section ? "admin-tab admin-tab-active" : "admin-tab"}
            onClick={() => {
              haptic("select");
              navigate(item.id ? `/admin/${item.id}` : "/admin");
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="admin-body">{renderSection(section, userId)}</div>
    </Screen>
  );
}

function renderSection(section: string, userId: string | undefined) {
  switch (section) {
    case "users":
      return userId ? <AdminUserCardView id={userId} /> : <AdminUsersView />;
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

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={tone === "danger" ? "stat-value stat-danger" : "stat-value"}>{value}</span>
    </div>
  );
}
