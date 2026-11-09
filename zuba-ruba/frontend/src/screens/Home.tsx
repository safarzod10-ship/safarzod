import { api } from "../api";
import { plural } from "../format";
import { IconBell, IconChevron } from "../icons";
import { OperationList } from "../components/OperationList";
import { navigate } from "../router";
import { Amount, Star } from "../stars";
import { haptic } from "../telegram";
import type { Home } from "../types";
import { EmptyState, ErrorState, Loader, useResource } from "../ui";

export function HomeScreen() {
  const home = useResource("home", () => api.get<Home>("/home"));
  const data = home.data;

  return (
    <div className="screen home">
      <header className="topbar">
        <span className="brand">ZUBA RUBA</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={data?.unread_notifications ? `Уведомления: ${data.unread_notifications} новых` : "Уведомления"}
          onClick={() => {
            haptic("light");
            navigate("/notifications");
          }}
        >
          <IconBell />
          {data && data.unread_notifications > 0 && <span className="dot" />}
        </button>
      </header>

      {!data && home.error && <ErrorState error={home.error} onRetry={() => void home.reload()} />}
      {!data && !home.error && <Loader />}

      {data && (
        <>
          <section className="ticket" aria-label="Баланс">
            <div className="ticket-top">
              <span className="ticket-label">Общий баланс</span>
              <Amount value={data.balance.total} size={34} className="ticket-total" />
              <dl className="ticket-split">
                <div>
                  <dt>Доступно</dt>
                  <dd>
                    <Amount value={data.balance.available} size={14} />
                  </dd>
                </div>
                <div>
                  <dt>В ожидании</dt>
                  <dd>
                    <Amount value={data.balance.pending} size={14} />
                  </dd>
                </div>
                <div>
                  <dt>На выводе</dt>
                  <dd>
                    <Amount value={data.balance.withdrawing} size={14} />
                  </dd>
                </div>
              </dl>
            </div>
            <div className="ticket-cut" aria-hidden="true" />
            <div className="ticket-bottom">
              <button
                type="button"
                className="btn btn-accent btn-md btn-block"
                onClick={() => {
                  haptic("medium");
                  navigate("/withdraw");
                }}
              >
                Вывести
              </button>
            </div>
          </section>

          <button
            type="button"
            className={data.cases_ready > 0 ? "cases-strip cases-strip-ready" : "cases-strip"}
            onClick={() => {
              haptic("light");
              navigate("/cases");
            }}
          >
            <span className="cases-strip-stars" aria-hidden="true">
              <Star size={30} />
              {data.cases_ready > 0 && <Star size={22} className="cases-strip-star-2" />}
            </span>
            <span className="cases-strip-text">
              {data.cases_ready > 0 ? (
                <>
                  <strong>
                    {data.cases_ready} {plural(data.cases_ready, "кейс ждёт", "кейса ждут", "кейсов ждут")} открытия
                  </strong>
                  <span>Открыто за всё время: {data.cases_opened}</span>
                </>
              ) : (
                <>
                  <strong>
                    Открыто {data.cases_opened} {plural(data.cases_opened, "кейс", "кейса", "кейсов")}
                  </strong>
                  <span>Новый кейс — за каждое выполненное задание</span>
                </>
              )}
            </span>
            <IconChevron size={20} />
          </button>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Последние операции</h2>
              {data.recent_operations.length > 0 && (
                <button type="button" className="link-btn" onClick={() => navigate("/history?from=home")}>
                  Вся история
                </button>
              )}
            </div>
            {data.recent_operations.length > 0 ? (
              <div className="card-list">
                <OperationList items={data.recent_operations} />
              </div>
            ) : (
              <EmptyState title="Операций пока нет" text="Выполни задание и открой кейс — первая награда появится здесь." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
