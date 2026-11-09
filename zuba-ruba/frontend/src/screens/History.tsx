import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { OperationList } from "../components/OperationList";
import { parentOf, type Route } from "../router";
import type { Operation, Page } from "../types";
import { Button, EmptyState, ErrorState, Loader, Screen } from "../ui";

export function HistoryScreen({ route }: { route: Route }) {
  const [items, setItems] = useState<Operation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async (from: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "30" });
      if (from) query.set("cursor", from);
      const page = await api.get<Page<Operation>>(`/operations?${query}`);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setDone(!page.next_cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "internal", "Не удалось загрузить историю."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <Screen title="История операций" back={parentOf(route)}>
      {items.length === 0 && loading && <Loader />}
      {items.length === 0 && error && <ErrorState error={error} onRetry={() => void load(null)} />}
      {items.length === 0 && !loading && !error && done && <EmptyState title="Операций пока нет" text="Начисления и списания будут отображаться здесь." />}
      {items.length > 0 && <OperationList items={items} />}
      {items.length > 0 && error && <p className="form-error center">{error.message}</p>}
      {items.length > 0 && !done && (
        <div className="more">
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void load(cursor)}>
            Показать ещё
          </Button>
        </div>
      )}
    </Screen>
  );
}
