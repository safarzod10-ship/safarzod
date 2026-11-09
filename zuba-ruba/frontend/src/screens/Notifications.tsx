import { useEffect } from "react";
import { api } from "../api";
import { formatDateTime } from "../format";
import type { NotificationItem } from "../types";
import { EmptyState, ErrorState, Loader, Screen, clearResourceCache, useResource } from "../ui";

export function NotificationsScreen() {
  const list = useResource("notifications", () => api.get<{ items: NotificationItem[] }>("/notifications"));
  const hasUnread = list.data?.items.some((item) => !item.read) ?? false;

  useEffect(() => {
    if (!hasUnread) return;
    api
      .post("/notifications/read")
      .then(() => clearResourceCache("home"))
      .catch(() => undefined);
  }, [hasUnread]);

  return (
    <Screen title="Уведомления" back="/">
      {!list.data && list.error && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
      {!list.data && !list.error && <Loader />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title="Уведомлений нет" text="Сообщения о начислениях, проверках и выводе появятся здесь и в чате с ботом." />
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="list">
          {list.data.items.map((item) => (
            <li key={item.id} className={item.read ? "note" : "note note-unread"}>
              <div className="note-head">
                <span className="note-title">{item.title}</span>
                <span className="note-date">{formatDateTime(item.created_at)}</span>
              </div>
              <p className="note-text">{item.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
