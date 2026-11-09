import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../AppContext";
import { formatDateTime, formatNumber, plural } from "../format";
import { navigate } from "../router";
import { Amount, Star } from "../stars";
import { haptic } from "../telegram";
import type { Case, CasesResponse, PrizeRow } from "../types";
import { Badge, Button, EmptyState, ErrorState, Loader, Screen, Section, clearResourceCache, useResource } from "../ui";

const CARD = 92;
const GAP = 10;
const STEP = CARD + GAP;
const STRIP = 80;
const START_INDEX = 3;
const WIN_INDEX = 72;
const SPIN_MS = 5200;

type Tier = "common" | "rare" | "top";

function tierOf(amount: string, table: PrizeRow[]): Tier {
  const sorted = table.map((row) => Number(row.amount)).sort((a, b) => a - b);
  const value = Number(amount);
  if (value >= sorted[sorted.length - 1]) return "top";
  if (sorted.length > 2 && value >= sorted[sorted.length - 2]) return "rare";
  return "common";
}

function pick(table: PrizeRow[]): string {
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let roll = Math.random() * total;
  for (const row of table) {
    roll -= row.weight;
    if (roll <= 0) return row.amount;
  }
  return table[table.length - 1].amount;
}

function buildStrip(table: PrizeRow[], winner: string | null): string[] {
  const items = Array.from({ length: STRIP }, () => pick(table));
  if (winner !== null) items[WIN_INDEX] = winner;
  return items;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 5);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function rewardNote(item: Case): string {
  if (item.reward_status === "pending") return "Награда в ожидании: станет доступной после проверки условий задания.";
  if (item.reward_status === "completed") return "Зачислено на доступный баланс.";
  if (item.reward_status === "cancelled" || item.state === "cancelled") return "Отменено: условия задания не подтвердились.";
  return "";
}

type Phase = { kind: "idle" } | { kind: "requesting" } | { kind: "spinning"; result: Case } | { kind: "done"; result: Case };

export function CasesScreen() {
  const { config } = useApp();
  const table = config.case_prizes;
  const cases = useResource("cases", () => api.get<CasesResponse>("/cases"));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [strip, setStrip] = useState<string[]>(() => buildStrip(table, null));
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const frame = useRef(0);

  const ready = cases.data?.ready ?? [];
  const current = ready[0] ?? null;

  const place = useCallback((value: number) => {
    offset.current = value;
    if (track.current) track.current.style.transform = `translate3d(${value}px,0,0)`;
  }, []);

  const startOffset = useCallback(() => {
    const width = viewport.current?.clientWidth ?? 360;
    return width / 2 - (START_INDEX * STEP + CARD / 2);
  }, []);

  useEffect(() => {
    if (phase.kind !== "idle") return;
    place(startOffset());
    if (reducedMotion()) return;
    let last = performance.now();
    const drift = (time: number) => {
      const delta = time - last;
      last = time;
      let next = offset.current - delta * 0.02;
      if (next < startOffset() - STEP * 8) next = startOffset();
      place(next);
      frame.current = requestAnimationFrame(drift);
    };
    frame.current = requestAnimationFrame(drift);
    return () => cancelAnimationFrame(frame.current);
  }, [phase.kind, place, startOffset, strip]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const spin = useCallback(
    (result: Case) => {
      cancelAnimationFrame(frame.current);
      const width = viewport.current?.clientWidth ?? 360;
      const jitter = (Math.random() - 0.5) * (CARD * 0.6);
      const target = width / 2 - (WIN_INDEX * STEP + CARD / 2) + jitter;
      const from = startOffset();
      const duration = reducedMotion() ? 500 : SPIN_MS;
      const started = performance.now();
      let lastIndex = -1;
      let lastHaptic = 0;
      place(from);
      const tick = (time: number) => {
        const progress = Math.min((time - started) / duration, 1);
        const value = from + (target - from) * easeOut(progress);
        place(value);
        const index = Math.floor((width / 2 - value) / STEP);
        if (index !== lastIndex) {
          lastIndex = index;
          if (progress < 0.98 && time - lastHaptic > 70) {
            lastHaptic = time;
            haptic("select");
          }
        }
        if (progress < 1) {
          frame.current = requestAnimationFrame(tick);
        } else {
          haptic(result.reward_status === "cancelled" ? "warning" : "success");
          setPhase({ kind: "done", result });
        }
      };
      frame.current = requestAnimationFrame(tick);
    },
    [place, startOffset],
  );

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
      setStrip(buildStrip(table, opened.amount));
      setPhase({ kind: "spinning", result: opened });
      requestAnimationFrame(() => spin(opened));
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
    setStrip(buildStrip(table, null));
    setPhase({ kind: "idle" });
  };

  const busy = phase.kind === "requesting" || phase.kind === "spinning";
  const result = phase.kind === "done" ? phase.result : null;
  const chances = useMemo(() => [...table].sort((a, b) => Number(b.amount) - Number(a.amount)), [table]);
  const maxChance = Math.max(...table.map((row) => Number(row.chance)));

  return (
    <Screen title="Кейсы" aside={ready.length > 0 ? <span className="count-chip">{ready.length}</span> : undefined}>
      <section className="roulette" aria-label="Рулетка кейса">
        <div className="roulette-viewport" ref={viewport}>
          <div className="roulette-track" ref={track}>
            {strip.map((amount, index) => (
              <PrizeCard
                key={index}
                amount={amount}
                tier={tierOf(amount, table)}
                won={result !== null && index === WIN_INDEX}
              />
            ))}
          </div>
          <span className="roulette-pointer roulette-pointer-top" aria-hidden="true" />
          <span className="roulette-pointer roulette-pointer-bottom" aria-hidden="true" />
          <span className="roulette-line" aria-hidden="true" />
        </div>

        <div className="roulette-panel">
          {result ? (
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
    </Screen>
  );
}

function PrizeCard({ amount, tier, won }: { amount: string; tier: Tier; won: boolean }) {
  return (
    <div className={`prize prize-${tier}${won ? " prize-won" : ""}`}>
      <Star size={48} className="prize-star" />
      <span className="prize-amount">{formatNumber(amount)}</span>
    </div>
  );
}
