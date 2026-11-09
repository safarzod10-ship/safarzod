import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { formatNumber } from "../format";
import { IconBolt, IconBot, IconChannel, IconExternal, IconRefresh, IconTasks } from "../icons";
import { navigate } from "../router";
import { Amount, Star } from "../stars";
import { haptic, openExternal } from "../telegram";
import type { CheckResult, Task, TaskStatus, TaskType, TasksResponse } from "../types";
import { Badge, Button, EmptyState, ErrorState, Loader, Notice, Screen, clearResourceCache, useResource } from "../ui";

type Filter = "all" | "channel" | "bot" | "boost";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "channel", label: "Каналы" },
  { id: "bot", label: "Боты" },
  { id: "boost", label: "Бусты" },
];

const TYPE_ICON: Record<TaskType, ReactNode> = {
  channel: <IconChannel size={22} />,
  bot: <IconBot size={22} />,
  boost: <IconBolt size={22} />,
  other: <IconTasks size={22} />,
};

const STATUS_TONE: Record<TaskStatus, "neutral" | "pending" | "success" | "danger"> = {
  new: "neutral",
  incomplete: "neutral",
  waiting: "pending",
  completed: "success",
  cancelled: "danger",
  unavailable: "danger",
};

const EMPTY_TEXT: Record<Filter, string> = {
  all: "Новые задания появляются регулярно. Загляни чуть позже.",
  channel: "Сейчас нет заданий с подпиской на каналы.",
  bot: "Сейчас нет заданий с запуском ботов.",
  boost: "Сейчас нет заданий с бустами.",
};

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

type Message = { text: string; caseId: number | null; tone: "ok" | "info" | "error" };

export function TasksScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const tasks = useResource("tasks:all", () => api.get<TasksResponse>("/tasks?type=all"));
  const [opened, setOpened] = useState<Set<string>>(readOpened);
  const [checking, setChecking] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message>>({});

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setOpened(readOpened());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const items = tasks.data?.items ?? [];
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: 0, channel: 0, bot: 0, boost: 0 };
    for (const task of items) {
      if (!task.can_check) continue;
      result.all += 1;
      if (task.type in result) result[task.type as Filter] += 1;
    }
    return result;
  }, [items]);
  const visible = filter === "all" ? items : items.filter((task) => task.type === filter);

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
      <ol className="steps" aria-label="Как получить кейс">
        <li>
          <span className="steps-num">1</span>Перейди
        </li>
        <li>
          <span className="steps-num">2</span>Выполни
        </li>
        <li>
          <span className="steps-num">3</span>Проверь
        </li>
        <li className="steps-prize">
          <Star size={18} />
          Кейс
        </li>
      </ol>

      <div className="filters" role="tablist" aria-label="Тип заданий">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "filter filter-active" : "filter"}
            onClick={() => {
              if (filter !== item.id) haptic("select");
              setFilter(item.id);
            }}
          >
            {item.label}
            {tasks.data && <span className="filter-count">{counts[item.id]}</span>}
          </button>
        ))}
      </div>

      {tasks.data?.flyer_error && <Notice tone="warning">{tasks.data.flyer_error}</Notice>}
      {!tasks.data && tasks.error && <ErrorState error={tasks.error} onRetry={() => void tasks.reload()} />}
      {!tasks.data && !tasks.error && <Loader />}
      {tasks.data && visible.length === 0 && !tasks.data.flyer_error && (
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

      {visible.length > 0 && (
        <ul className="tasks">
          {visible.map((task) => (
            <TaskCard
              key={task.signature}
              task={task}
              message={messages[task.signature]}
              wasOpened={opened.has(task.signature)}
              checking={checking}
              onOpen={() => open(task)}
              onCheck={() => void check(task)}
            />
          ))}
        </ul>
      )}
    </Screen>
  );
}

function TaskCard({
  task,
  message,
  wasOpened,
  checking,
  onOpen,
  onCheck,
}: {
  task: Task;
  message: Message | undefined;
  wasOpened: boolean;
  checking: string | null;
  onOpen: () => void;
  onCheck: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const actionable = task.can_check && (task.status === "new" || task.status === "incomplete");
  return (
    <li className={actionable ? "task-card" : "task-card task-card-done"}>
      <div className="task-card-head">
        <span className={`task-icon task-icon-${task.type}`}>
          {task.photo && !photoFailed ? (
            <img src={task.photo} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
          ) : (
            TYPE_ICON[task.type]
          )}
        </span>
        <div className="task-card-info">
          <span className="task-card-title">{task.title}</span>
          <span className="task-card-type">{task.type_label}</span>
        </div>
        <span className={task.reward_kind === "case" ? "reward reward-case" : "reward"}>
          {task.reward_kind === "case" ? (
            <>
              <span className="reward-label">Кейс</span>
              <span className="reward-value">
                до {formatNumber(task.reward)}
                <Star size={13} />
              </span>
            </>
          ) : (
            <Amount value={task.reward} sign="+" size={14} className="reward-value" />
          )}
        </span>
      </div>
      <p className="task-card-conditions">{task.conditions}</p>
      {task.status !== "new" && (
        <div className="task-card-status">
          <Badge tone={STATUS_TONE[task.status]}>{task.status_label}</Badge>
        </div>
      )}
      {message && (
        <p className={`task-note task-note-${message.tone}`} role="status">
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
          <Button variant={wasOpened ? "secondary" : "primary"} size="sm" onClick={onOpen}>
            Перейти <IconExternal size={16} />
          </Button>
          <Button
            variant={wasOpened ? "primary" : "secondary"}
            size="sm"
            loading={checking === task.signature}
            disabled={checking !== null && checking !== task.signature}
            onClick={onCheck}
          >
            Проверить
          </Button>
        </div>
      )}
    </li>
  );
}
