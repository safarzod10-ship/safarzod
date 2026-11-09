import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { formatStars, initials } from "../format";
import { IconExternal, IconRefresh } from "../icons";
import { navigate } from "../router";
import { haptic, openExternal } from "../telegram";
import type { CheckResult, Task, TaskStatus, TasksResponse } from "../types";
import { Avatar, Badge, Button, EmptyState, ErrorState, Loader, Notice, Screen, clearResourceCache, useResource } from "../ui";

type Filter = "all" | "channel" | "bot" | "boost";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "channel", label: "Каналы" },
  { id: "bot", label: "Боты" },
  { id: "boost", label: "Бусты" },
];

const OPENED_KEY = "zr.opened";

function readOpened(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeOpened(set: Set<string>): void {
  try {
    sessionStorage.setItem(OPENED_KEY, JSON.stringify([...set].slice(-100)));
  } catch {
    return;
  }
}

const STATUS_TONE: Record<TaskStatus, "neutral" | "pending" | "success" | "danger"> = {
  new: "neutral",
  incomplete: "neutral",
  waiting: "pending",
  completed: "success",
  cancelled: "danger",
  unavailable: "danger",
};

const EMPTY_TEXT: Record<Filter, string> = {
  all: "Новые задания появляются регулярно. Загляните чуть позже.",
  channel: "Сейчас нет заданий с подпиской на каналы.",
  bot: "Сейчас нет заданий с запуском ботов.",
  boost: "Сейчас нет заданий с бустами.",
};

export function TasksScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const tasks = useResource(`tasks:${filter}`, () => api.get<TasksResponse>(`/tasks?type=${filter}`));
  const [opened, setOpened] = useState<Set<string>>(readOpened);
  const [checking, setChecking] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { text: string; caseId: number | null; tone: "ok" | "info" | "error" }>>({});

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setOpened(readOpened());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const open = (task: Task) => {
    haptic("light");
    const next = new Set(opened);
    next.add(task.signature);
    setOpened(next);
    writeOpened(next);
    openExternal(task.link);
  };

  const check = async (task: Task) => {
    setChecking(task.signature);
    try {
      const result = await api.post<CheckResult>(`/tasks/${encodeURIComponent(task.signature)}/check`);
      const tone = result.result === "completed" || result.result === "waiting" ? "ok" : result.result === "error" ? "error" : "info";
      haptic(tone === "ok" ? "success" : tone === "error" ? "error" : "warning");
      setMessages((prev) => ({ ...prev, [task.signature]: { text: result.message, caseId: result.case_id, tone } }));
      if (tasks.data) {
        tasks.setData({ ...tasks.data, items: tasks.data.items.map((item) => (item.signature === task.signature ? result.task : item)) });
      }
      if (result.case_id) clearResourceCache("cases");
      clearResourceCache("home");
    } catch (err) {
      haptic("error");
      const text = err instanceof ApiError ? err.message : "Не удалось проверить задание.";
      setMessages((prev) => ({ ...prev, [task.signature]: { text, caseId: null, tone: "error" } }));
    } finally {
      setChecking(null);
    }
  };

  return (
    <Screen
      title="Задания"
      aside={
        <button
          type="button"
          className={tasks.loading ? "icon-btn spinning" : "icon-btn"}
          aria-label="Обновить список"
          disabled={tasks.loading}
          onClick={() => {
            haptic("light");
            void tasks.reload();
          }}
        >
          <IconRefresh />
        </button>
      }
    >
      <div className="segmented" role="tablist" aria-label="Тип заданий">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "segment segment-active" : "segment"}
            onClick={() => {
              if (filter !== item.id) haptic("select");
              setFilter(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tasks.data?.flyer_error && <Notice tone="warning">{tasks.data.flyer_error}</Notice>}

      {!tasks.data && tasks.error && <ErrorState error={tasks.error} onRetry={() => void tasks.reload()} />}
      {!tasks.data && !tasks.error && <Loader />}
      {tasks.data && tasks.data.items.length === 0 && !tasks.data.flyer_error && (
        <EmptyState
          title="Заданий пока нет"
          text={EMPTY_TEXT[filter]}
          action={
            <Button variant="secondary" size="sm" loading={tasks.loading} onClick={() => void tasks.reload()}>
              Обновить
            </Button>
          }
        />
      )}
      {tasks.data && tasks.data.items.length > 0 && (
        <ul className="list task-list">
          {tasks.data.items.map((task) => {
            const message = messages[task.signature];
            const actionable = task.can_check && (task.status === "new" || task.status === "incomplete");
            const wasOpened = opened.has(task.signature);
            return (
              <li key={task.signature} className="task">
                <div className="task-head">
                  <Avatar url={task.photo} label={initials(task.title)} size={44} />
                  <div className="task-info">
                    <span className="task-title">{task.title}</span>
                    <span className="task-meta">{task.type_label}</span>
                  </div>
                  <span className="task-reward">{formatStars(task.reward, { sign: "+" })}</span>
                </div>
                <div className="task-body">
                  <Badge tone={STATUS_TONE[task.status]}>{task.status_label}</Badge>
                  <span className="task-conditions">{task.conditions}</span>
                </div>
                {message && (
                  <p className={`task-message task-message-${message.tone}`} role="status">
                    {message.text}
                    {message.caseId && (
                      <button type="button" className="link-btn" onClick={() => navigate("/cases")}>
                        Открыть кейс
                      </button>
                    )}
                  </p>
                )}
                {actionable && (
                  <div className="task-actions">
                    <Button variant={wasOpened ? "secondary" : "primary"} size="sm" onClick={() => open(task)}>
                      Перейти <IconExternal size={16} />
                    </Button>
                    <Button
                      variant={wasOpened ? "primary" : "secondary"}
                      size="sm"
                      loading={checking === task.signature}
                      disabled={checking !== null && checking !== task.signature}
                      onClick={() => void check(task)}
                    >
                      Проверить
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
