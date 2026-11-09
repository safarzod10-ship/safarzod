import { useState } from "react";
import { api } from "../api";
import { formatDateTime, formatStars } from "../format";
import { navigate } from "../router";
import type { AdminUserRow } from "../types";
import { Badge, Button, EmptyState, Loader, useResource } from "../ui";
import { AdminError } from "./Admin";

export function AdminUsersView() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const users = useResource(`admin:users:${query}`, () =>
    api.get<{ items: AdminUserRow[] }>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  );

  return (
    <>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(input.trim().replace(/^@/, ""));
        }}
      >
        <input
          className="input"
          type="search"
          inputMode="search"
          placeholder="Telegram ID или username"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="Поиск пользователя"
        />
        <Button size="sm" type="submit">
          Найти
        </Button>
      </form>
      {!users.data && users.error && <AdminError error={users.error} onRetry={() => void users.reload()} />}
      {!users.data && !users.error && <Loader />}
      {users.data && users.data.items.length === 0 && <EmptyState title="Никого не найдено" />}
      {users.data && users.data.items.length > 0 && (
        <ul className="list">
          {users.data.items.map((user) => (
            <li key={user.id}>
              <button type="button" className="user-row" onClick={() => navigate(`/admin/users/${user.id}`)}>
                <div className="op-main">
                  <span className="op-title">
                    {user.first_name}
                    {user.username ? ` · @${user.username}` : ""}
                  </span>
                  <span className="op-reason mono">ID {user.id}</span>
                  <span className="op-date">Был: {formatDateTime(user.last_seen_at)}</span>
                </div>
                <div className="op-side">
                  <span className="op-amount">{formatStars(user.available)}</span>
                  {user.is_blocked ? <Badge tone="danger">Заблокирован</Badge> : <span className="op-date">ожид. {formatStars(user.pending)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
