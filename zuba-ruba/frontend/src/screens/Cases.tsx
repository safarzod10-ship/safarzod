import { useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../AppContext";
import { formatDateTime, formatNumber, plural } from "../format";
import { navigate, useRoute } from "../router";
import { Amount, Star } from "../stars";
import { haptic } from "../telegram";
import { Roulette, tierOf, type RouletteHandle } from "../components/Roulette";
import type { Case, CasesResponse } from "../types";
import { CaseShop } from "./CaseShop";
import { Badge, Button, EmptyState, ErrorState, Loader, Screen, Section, clearResourceCache, useResource } from "../ui";

function rewardNote(item: Case): string {
  if (item.reward_status === "pending") return "Награда в ожидании: станет доступной после проверки условий задания.";
  if (item.reward_status === "completed") return "Зачислено на доступный баланс.";
  if (item.reward_status === "cancelled" || item.state === "cancelled") return "Отменено: условия задания не подтвердились.";
  return "";
}

type Phase = { kind: "idle" } | { kind: "requesting" } | { kind: "spinning"; result: Case } | { kind: "done"; result: Case };

export function CasesScreen() {
  const { config } = useApp();
  const route = useRoute();
  const [tab, setTab] = useState<"mine" | "shop">(() => (config.paid_cases && route.query.get("tab") === "shop" ? "shop" : "mine"));
  const cases = useResource("cases", () => api.get<CasesResponse>("/cases"));
  const ready = cases.data?.ready.length ?? 0;
  return (
    <Screen title="Кейсы">
      {config.paid_cases && (
        <div className="filters case-tabs" role="tablist" aria-label="Раздел кейсов">
          {(
            [
              ["mine", "Мои кейсы"],
              ["shop", "Магазин"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "filter filter-active" : "filter"}
              onClick={() => {
                if (tab !== id) haptic("select");
                setTab(id);
              }}
            >
              {label}
              {id === "mine" && ready > 0 && <span className="filter-count">{ready}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === "shop" ? <CaseShop /> : <MyCases />}
    </Screen>
  );
}

function MyCases() {
  const { config, me } = useApp();
  const table = config.case_prizes;
  const cases = useResource("cases", () => api.get<CasesResponse>("/cases"));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const roulette = useRef<RouletteHandle>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const openTest = async () => {
    if (testing || phase.kind === "requesting" || phase.kind === "spinning") return;
    haptic("medium");
    setError(null);
    setTesting(true);
    try {
      const result = await api.post<{ amount: string }>("/cases/test");
      await roulette.current?.spin(result.amount);
      haptic("success");
      setTestResult(result.amount);
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось открыть тестовый кейс.");
    } finally {
      setTesting(false);
    }
  };

  const closeTest = () => {
    setTestResult(null);
    roulette.current?.reset();
  };

  const ready = cases.data?.ready ?? [];
  const current = ready[0] ?? null;

  const open = async () => {
    if (!current || phase.kind === "requesting" || phase.kind === "spinning") return;
    haptic("medium");
    setError(null);
    setPhase({ kind: "requesting" });
    try {
      const opened = await api.post<Case>(`/cases/${current.id}/open`);
      clearResourceCache("home");
      if (opened.state !== "opened" || opened.amount === null) {
        setPhase({ kind: "idle" });
        setError(rewardNote(opened) || "Кейс недоступен.");
        void cases.reload();
        return;
      }
      setPhase({ kind: "spinning", result: opened });
      await roulette.current?.spin(opened.amount);
      haptic(opened.reward_status === "cancelled" ? "warning" : "success");
      setPhase({ kind: "done", result: opened });
    } catch (err) {
      haptic("error");
      setPhase({ kind: "idle" });
      setError(err instanceof ApiError ? err.message : "Не удалось открыть кейс.");
    }
  };

  const next = () => {
    if (phase.kind === "done" && cases.data) {
      const result = phase.result;
      cases.setData({
        ready: cases.data.ready.filter((c) => c.id !== result.id),
        opened: [result, ...cases.data.opened.filter((c) => c.id !== result.id)],
      });
    }
    roulette.current?.reset();
    setPhase({ kind: "idle" });
  };

  const busy = phase.kind === "requesting" || phase.kind === "spinning" || testing;
  const result = phase.kind === "done" ? phase.result : null;
  const chances = useMemo(() => [...table].sort((a, b) => Number(b.amount) - Number(a.amount)), [table]);
  const maxChance = Math.max(...table.map((row) => Number(row.chance)));

  return (
    <>
      <section className="roulette" aria-label="Рулетка кейса">
        <Roulette ref={roulette} table={table} label="Лента призов кейса" />

        <div className="roulette-panel">
          {testResult !== null ? (
            <div className="roulette-result" role="status">
              <span className="roulette-result-label">Тестовый кейс</span>
              <Amount value={testResult} sign="+" size={26} className="roulette-result-amount" />
              <span className="roulette-result-note">Режим администратора: звёзды не начисляются.</span>
              <Button variant="primary" block onClick={closeTest}>
                Готово
              </Button>
            </div>
          ) : result ? (
            <div className="roulette-result" role="status">
              <span className="roulette-result-label">Выпало</span>
              <Amount value={result.amount ?? "0"} sign="+" size={26} className="roulette-result-amount" />
              <span className="roulette-result-note">{rewardNote(result)}</span>
              <Button variant="primary" block onClick={next}>
                {ready.length > 1 ? "Следующий кейс" : "Готово"}
              </Button>
            </div>
          ) : cases.data && !current ? (
            <div className="roulette-empty">
              <strong>Нет кейсов к открытию</strong>
              <span>Кейс выдаётся за каждое подтверждённое задание и за друзей.</span>
              <Button variant="secondary" block onClick={() => navigate("/tasks")}>
                К заданиям
              </Button>
            </div>
          ) : (
            <>
              {current && (
                <p className="roulette-source">
                  {current.source === "referral" ? "Подарочный кейс" : "Кейс за задание"}
                  <span>{current.source_label}</span>
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
              <Button variant="accent" block loading={phase.kind === "requesting"} disabled={busy || !current} onClick={() => void open()}>
                {phase.kind === "spinning" ? "Крутим…" : "Открыть кейс"}
              </Button>
              {ready.length > 1 && (
                <span className="roulette-more">
                  Ещё {ready.length - 1} {plural(ready.length - 1, "кейс", "кейса", "кейсов")} в очереди
                </span>
              )}
            </>
          )}
        </div>
        {me.is_admin && testResult === null && !result && (
          <div className="roulette-admin">
            <Button variant="secondary" block disabled={busy} onClick={() => void openTest()}>
              {testing ? "Крутим…" : "Тестовый кейс"}
            </Button>
            <span>Без ограничений и без начисления звёзд</span>
          </div>
        )}
      </section>

      {!cases.data && cases.error && <ErrorState error={cases.error} onRetry={() => void cases.reload()} />}
      {!cases.data && !cases.error && <Loader />}

      <Section title="Что может выпасть">
        <ul className="chances">
          {chances.map((row) => (
            <li key={row.amount} className={`chance chance-${tierOf(row.amount, table)}`}>
              <span className="chance-amount">
                {formatNumber(row.amount)}
                <Star size={14} />
              </span>
              <span className="chance-bar">
                <span style={{ width: `${Math.max(4, (Number(row.chance) / maxChance) * 100)}%` }} />
              </span>
              <span className="chance-value">{formatNumber(row.chance)}%</span>
            </li>
          ))}
        </ul>
        <p className="hint">Результат определяет сервер в момент открытия. Средняя награда — {formatNumber(config.case_expected)}
          <Star size={13} className="star-inline" />.
        </p>
      </Section>

      {cases.data && (
        <Section title="История открытий">
          {cases.data.opened.length === 0 ? (
            <EmptyState title="Пока пусто" text="Открытые кейсы появятся здесь." />
          ) : (
            <ul className="card-list list">
              {cases.data.opened.map((item) => (
                <li key={item.id} className="op-row">
                  <span className={item.state === "cancelled" ? "op-icon op-icon-muted" : "op-icon op-icon-star"}>
                    <Star size={22} />
                  </span>
                  <div className="op-main">
                    <span className="op-title">{item.source === "referral" ? "Подарочный кейс" : "Кейс за задание"}</span>
                    <span className="op-reason">{item.source_label}</span>
                    <span className="op-date">{formatDateTime(item.opened_at ?? item.created_at)}</span>
                  </div>
                  <div className="op-side">
                    {item.amount !== null ? (
                      <Amount
                        value={item.amount}
                        sign="+"
                        size={14}
                        className={item.reward_status === "cancelled" ? "op-amount op-amount-struck" : "op-amount op-amount-in"}
                      />
                    ) : (
                      <span className="op-amount">—</span>
                    )}
                    <Badge tone={item.reward_status === "completed" ? "success" : item.reward_status === "pending" ? "pending" : "danger"}>
                      {item.reward_status === "completed" ? "Зачислено" : item.reward_status === "pending" ? "В ожидании" : "Отменено"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

