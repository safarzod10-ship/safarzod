import { useEffect } from "react";
import { api } from "../api";
import { OperationList } from "../components/OperationList";
import { formatStars } from "../format";
import { IconBell } from "../icons";
import { navigate } from "../router";
import { haptic } from "../telegram";
import type { Home } from "../types";
import { Button, EmptyState, ErrorState, Loader, NavRow, Section, useResource } from "../ui";

export function HomeScreen() {
  const home = useResource("home", () => api.get<Home>("/home"));

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void home.reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [home.reload]);

  const unread = home.data?.unread_notifications ?? 0;

  return (
    <div className="screen">
      <header className="topbar">
        <span className="brand">ZUBA RUBA</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
          onClick={() => {
            haptic("select");
            navigate("/notifications");
          }}
        >
          <IconBell />
          {unread > 0 && <span className="dot" />}
        </button>
      </header>

      {!home.data && home.error && <ErrorState error={home.error} onRetry={() => void home.reload()} />}
      {!home.data && !home.error && <Loader />}
      {home.data && (
        <>
          <section className="balance">
            <span className="balance-label">Общий баланс</span>
            <span className="balance-total">{formatStars(home.data.balance.total)}</span>
            <div className="balance-split">
              <div className="balance-cell">
                <span className="balance-cell-label">Доступно</span>
                <span className="balance-cell-value">{formatStars(home.data.balance.available)}</span>
              </div>
              <div className="balance-cell">
                <span className="balance-cell-label">В ожидании</span>
                <span className="balance-cell-value">{formatStars(home.data.balance.pending)}</span>
              </div>
            </div>
            <Button block onClick={() => navigate("/withdraw")}>
              Вывести
            </Button>
          </section>

          <div className="group">
            <NavRow label="Открыто кейсов" value={home.data.cases_opened} onClick={() => navigate("/cases")} />
            {home.data.cases_ready > 0 && (
              <NavRow label="Готовы к открытию" value={<span className="pill">{home.data.cases_ready}</span>} accent onClick={() => navigate("/cases")} />
            )}
          </div>

          <Section
            title="Последние операции"
            aside={
              home.data.recent_operations.length > 0 && (
                <button type="button" className="link-btn" onClick={() => navigate("/history?from=home")}>
                  Вся история
                </button>
              )
            }
          >
            {home.data.recent_operations.length > 0 ? (
              <OperationList items={home.data.recent_operations} />
            ) : (
              <EmptyState title="Операций пока нет" text="Здесь появятся начисления за кейсы, бусты и приглашения." />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
