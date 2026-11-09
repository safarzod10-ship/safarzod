import { useState } from "react";
import { ApiError, api } from "../api";
import { formatDateTime, formatStars } from "../format";
import { IconCase } from "../icons";
import { navigate } from "../router";
import { haptic } from "../telegram";
import type { Case, CasesResponse } from "../types";
import { Badge, Button, EmptyState, ErrorState, Loader, Screen, Section, Sheet, clearResourceCache, useResource } from "../ui";

const MIN_ANIMATION_MS = 850;

function rewardBadge(item: Case) {
  if (item.state === "cancelled" || item.reward_status === "cancelled") return <Badge tone="danger">Отменено</Badge>;
  if (item.reward_status === "pending") return <Badge tone="pending">В ожидании</Badge>;
  if (item.reward_status === "completed") return <Badge tone="success">Зачислено</Badge>;
  return null;
}

function rewardNote(item: Case): string {
  if (item.reward_status === "pending") return "Награда в ожидании. Она станет доступной после проверки выполнения условий задания.";
  if (item.reward_status === "completed") return "Награда зачислена на доступный баланс.";
  if (item.reward_status === "cancelled") return "Награда отменена: условия задания не подтвердились.";
  return "";
}

export function CasesScreen() {
  const cases = useResource("cases", () => api.get<CasesResponse>("/cases"));
  const [opening, setOpening] = useState<Case | null>(null);
  const [result, setResult] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCase = async (item: Case) => {
    haptic("medium");
    setOpening(item);
    setResult(null);
    setError(null);
    const started = Date.now();
    try {
      const opened = await api.post<Case>(`/cases/${item.id}/open`);
      const wait = MIN_ANIMATION_MS - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      haptic("success");
      setResult(opened);
      clearResourceCache("home");
      if (cases.data) {
        cases.setData({
          ready: cases.data.ready.filter((c) => c.id !== opened.id),
          opened: [opened, ...cases.data.opened.filter((c) => c.id !== opened.id)],
        });
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось открыть кейс.");
    }
  };

  const close = () => {
    setOpening(null);
    setResult(null);
    setError(null);
    void cases.reload();
  };

  return (
    <Screen title="Кейсы">
      <p className="lead">Кейс становится доступен после подтверждённого задания или за приглашённых друзей.</p>
      {!cases.data && cases.error && <ErrorState error={cases.error} onRetry={() => void cases.reload()} />}
      {!cases.data && !cases.error && <Loader />}
      {cases.data && (
        <>
          <Section title={`Готовы к открытию${cases.data.ready.length ? ` · ${cases.data.ready.length}` : ""}`}>
            {cases.data.ready.length === 0 ? (
              <EmptyState
                title="Нет кейсов к открытию"
                text="Выполните задание — после проверки здесь появится кейс."
                action={
                  <Button variant="secondary" size="sm" onClick={() => navigate("/tasks")}>
                    К заданиям
                  </Button>
                }
              />
            ) : (
              <ul className="list">
                {cases.data.ready.map((item) => (
                  <li key={item.id} className="case-row">
                    <span className="case-icon">
                      <IconCase size={22} />
                    </span>
                    <div className="case-info">
                      <span className="case-title">{item.source === "referral" ? "Подарочный кейс" : "Кейс за задание"}</span>
                      <span className="case-sub">{item.source_label}</span>
                    </div>
                    <Button size="sm" onClick={() => void openCase(item)}>
                      Открыть
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {cases.data.opened.length > 0 && (
            <Section title="Открытые">
              <ul className="list">
                {cases.data.opened.map((item) => (
                  <li key={item.id} className="case-row">
                    <div className="case-info">
                      <span className="case-title">{item.source_label}</span>
                      <span className="case-sub">{formatDateTime(item.opened_at ?? item.created_at)}</span>
                    </div>
                    <div className="op-side">
                      <span className={item.reward_status === "cancelled" ? "op-amount op-amount-struck" : "op-amount"}>
                        {item.amount ? formatStars(item.amount, { sign: "+" }) : "—"}
                      </span>
                      {rewardBadge(item)}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <Sheet open={opening !== null} onClose={close} dismissible={result !== null || error !== null}>
        <div className="case-open">
          <div className={result ? "case-box case-box-open" : error ? "case-box" : "case-box case-box-shake"} aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <g className="case-lid">
                <rect x="14" y="30" width="92" height="22" rx="6" />
                <path d="M60 30v22" />
              </g>
              <rect x="20" y="52" width="80" height="52" rx="6" />
              <path d="M60 52v52" />
            </svg>
          </div>
          {!result && !error && <p className="case-open-status">Открываем кейс…</p>}
          {error && (
            <>
              <p className="case-open-status">{error}</p>
              <Button block onClick={close}>
                Закрыть
              </Button>
            </>
          )}
          {result && (
            <div className="case-reveal">
              <span className="case-reveal-amount">{result.amount ? formatStars(result.amount, { sign: "+" }) : "—"}</span>
              <span className="case-reveal-source">{result.source_label}</span>
              <p className="case-reveal-note">{rewardNote(result)}</p>
              <Button block onClick={close}>
                Готово
              </Button>
            </div>
          )}
        </div>
      </Sheet>
    </Screen>
  );
}
