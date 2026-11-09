import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, onGlobalError } from "./api";
import { AppContext, type AppState } from "./AppContext";
import { IconCase, IconHome, IconTasks, IconUser } from "./icons";
import { TAB_PATHS, navigate, tabOf, useRoute, type Route, type TabId } from "./router";
import { colorScheme, haptic, initData, onThemeChange, paintChrome } from "./telegram";
import type { Config, Me } from "./types";
import { Button, Loader } from "./ui";
import { Onboarding } from "./screens/Onboarding";
import { HomeScreen } from "./screens/Home";
import { TasksScreen } from "./screens/Tasks";
import { CasesScreen } from "./screens/Cases";
import { ProfileScreen } from "./screens/Profile";
import { HistoryScreen } from "./screens/History";
import { NotificationsScreen } from "./screens/Notifications";
import { WithdrawScreen } from "./screens/Withdraw";
import { RulesScreen } from "./screens/Rules";
import { AdminScreen } from "./admin/Admin";

const BOT_USERNAME = "zuba_ruba_bot";

const CHROME = { light: "#FFFFFF", dark: "#0F0F0F" } as const;

function useTheme(): void {
  useEffect(() => {
    const apply = () => {
      const scheme = colorScheme();
      document.documentElement.dataset.theme = scheme;
      paintChrome(CHROME[scheme]);
    };
    apply();
    const off = onThemeChange(apply);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", apply);
    return () => {
      off();
      media?.removeEventListener?.("change", apply);
    };
  }, []);
}

type Phase =
  | { kind: "loading" }
  | { kind: "outside" }
  | { kind: "ready"; me: Me; config: Config }
  | { kind: "error"; error: ApiError }
  | { kind: "maintenance"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "expired"; message: string };

export function App() {
  useTheme();
  const [phase, setPhase] = useState<Phase>(() => (initData() ? { kind: "loading" } : { kind: "outside" }));

  const boot = useCallback(async () => {
    if (!initData()) {
      setPhase({ kind: "outside" });
      return;
    }
    setPhase({ kind: "loading" });
    try {
      const [me, config] = await Promise.all([api.post<Me>("/session"), api.get<Config>("/config")]);
      if (config.maintenance && !me.is_admin) {
        setPhase({ kind: "maintenance", message: "Проводятся технические работы. Загляните немного позже." });
        return;
      }
      setPhase({ kind: "ready", me, config });
    } catch (err) {
      const error = err instanceof ApiError ? err : new ApiError(0, "internal", "Что-то пошло не так.");
      if (error.code === "maintenance") setPhase({ kind: "maintenance", message: error.message });
      else if (error.code === "blocked") setPhase({ kind: "blocked", message: error.message });
      else if (error.code === "unauthorized") setPhase({ kind: "expired", message: error.message });
      else setPhase({ kind: "error", error });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(
    () =>
      onGlobalError((error) => {
        if (error.code === "maintenance") setPhase({ kind: "maintenance", message: error.message });
        else if (error.code === "blocked") setPhase({ kind: "blocked", message: error.message });
        else if (error.code === "unauthorized") setPhase({ kind: "expired", message: error.message });
      }),
    [],
  );

  const setMe = useCallback((me: Me) => setPhase((prev) => (prev.kind === "ready" ? { ...prev, me } : prev)), []);
  const refreshConfig = useCallback(async () => {
    const config = await api.get<Config>("/config");
    setPhase((prev) => (prev.kind === "ready" ? { ...prev, config } : prev));
  }, []);

  const context = useMemo<AppState | null>(
    () => (phase.kind === "ready" ? { me: phase.me, config: phase.config, setMe, refreshConfig } : null),
    [phase, setMe, refreshConfig],
  );

  switch (phase.kind) {
    case "loading":
      return <Loader />;
    case "outside":
      return (
        <Gate title="Откройте приложение через Telegram" text={`ZUBA RUBA работает внутри Telegram. Откройте бота @${BOT_USERNAME} и нажмите «Открыть ZUBA RUBA».`}>
          <a className="btn btn-primary btn-md btn-block" href={`https://t.me/${BOT_USERNAME}`}>
            Перейти к @{BOT_USERNAME}
          </a>
        </Gate>
      );
    case "maintenance":
      return (
        <Gate title="Технические работы" text={phase.message}>
          <Button variant="secondary" block onClick={() => void boot()}>
            Проверить снова
          </Button>
        </Gate>
      );
    case "blocked":
      return <Gate title="Доступ ограничен" text={phase.message} />;
    case "expired":
      return <Gate title="Сессия устарела" text="Закройте приложение и откройте его снова из чата с ботом." />;
    case "error":
      return (
        <Gate title="Не удалось подключиться" text={phase.error.message}>
          <Button variant="secondary" block onClick={() => void boot()}>
            Повторить
          </Button>
        </Gate>
      );
    case "ready":
      return (
        <AppContext.Provider value={context}>
          {phase.me.onboarded ? <Shell /> : <Onboarding />}
        </AppContext.Provider>
      );
  }
}

function Gate({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-mark" aria-hidden="true">
        ZR
      </div>
      <h1 className="gate-title">{title}</h1>
      <p className="gate-text">{text}</p>
      {children && <div className="gate-actions">{children}</div>}
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const tab = tabOf(route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);
  return (
    <div className={tab ? "app app-tabs" : "app"}>
      <main className="content">{renderRoute(route)}</main>
      {tab && <TabBar active={tab} />}
    </div>
  );
}

function renderRoute(route: Route) {
  const [first] = route.segments;
  switch (first) {
    case undefined:
      return <HomeScreen />;
    case "tasks":
      return <TasksScreen />;
    case "cases":
      return <CasesScreen />;
    case "profile":
      return <ProfileScreen />;
    case "history":
      return <HistoryScreen route={route} />;
    case "notifications":
      return <NotificationsScreen />;
    case "withdraw":
      return <WithdrawScreen />;
    case "rules":
      return <RulesScreen route={route} />;
    case "admin":
      return <AdminScreen route={route} />;
    default:
      return <HomeScreen />;
  }
}

const TABS: { id: TabId; label: string; Icon: (props: { size?: number }) => ReactNode }[] = [
  { id: "home", label: "Главная", Icon: IconHome },
  { id: "tasks", label: "Задания", Icon: IconTasks },
  { id: "cases", label: "Кейсы", Icon: IconCase },
  { id: "profile", label: "Профиль", Icon: IconUser },
];

function TabBar({ active }: { active: TabId }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={id === active ? "tab tab-active" : "tab"}
          aria-current={id === active ? "page" : undefined}
          onClick={() => {
            if (id !== active) haptic("select");
            navigate(TAB_PATHS[id]);
          }}
        >
          <Icon size={24} />
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
