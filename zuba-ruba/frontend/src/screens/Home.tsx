import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import type { RouletteHandle } from "../components/Roulette";
import { Wheel } from "../components/Wheel";
import { formatNumber } from "../format";
import { navigate } from "../router";
import { Amount, Star } from "../stars";
import { haptic } from "../telegram";
import type { Home, SpinResult, SpinStatus } from "../types";
import { Button, ErrorState, Loader, clearResourceCache, useResource } from "../ui";

function useCountdown(target: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target) return "";
  const left = Math.max(0, new Date(target).getTime() - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.ceil((left % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes} мин`;
  return `${hours} ч ${minutes === 60 ? 59 : minutes} мин`;
}

export function HomeScreen() {
  const home = useResource("home", () => api.get<Home>("/home"));
  const roulette = useRef<RouletteHandle>(null);
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<string | null>(null);
  const [testWon, setTestWon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = home.data;
  const spin = data?.spin;
  const countdown = useCountdown(spin?.spun ? spin.next_at : null);

  const play = async () => {
    if (!data || !spin || !(spin.available || spin.test_available) || spinning) return;
    haptic("medium");
    setError(null);
    setTestWon(null);
    setSpinning(true);
    try {
      const result = await api.post<SpinResult>("/spin");
      await roulette.current?.spin(result.amount);
      haptic("success");
      if (result.test) {
        setTestWon(result.amount);
      } else {
        setWon(result.amount);
        home.setData({ ...data, balance: result.balance, spin: result.spin });
        clearResourceCache("withdrawals");
      }
    } catch (err) {
      haptic("error");
      setError(err instanceof ApiError ? err.message : "Не удалось прокрутить. Попробуй ещё раз.");
      void home.reload();
    } finally {
      setSpinning(false);
    }
  };

  return (
    <div className="screen home">
      <header className="topbar">
        <span className="brand">ZUBA RUBA</span>
        {data && (
          <button
            type="button"
            className="balance-pill"
            aria-label="Баланс, перейти к выводу"
            onClick={() => {
              haptic("light");
              navigate("/withdraw");
            }}
          >
            <Amount value={data.balance.available} size={16} />
          </button>
        )}
      </header>

      {!data && home.error && <ErrorState error={home.error} onRetry={() => void home.reload()} />}
      {!data && !home.error && <Loader />}

      {data && spin && (
        <section className="daily" aria-label="Ежедневная рулетка">
          <p className="daily-kicker">Ежедневная рулетка</p>
          <h1 className="daily-title">
            {prizeRange(spin)}
            <Star size={22} className="star-inline" />
          </h1>
          <p className="daily-sub">Одна прокрутка в день после {spin.tasks_required} заданий</p>

          <div className="daily-wheel">
            <Wheel ref={roulette} table={spin.prizes} label="Колесо ежедневной рулетки" muted={!spin.enabled} />
          </div>

          <div className="daily-action">
            {!spin.enabled ? (
              <p className="daily-note">Рулетка временно выключена.</p>
            ) : won !== null || spin.spun ? (
              <>
                <p className="daily-won">
                  {won !== null ? "Выпало" : "Сегодня выпало"} <Amount value={won ?? spin.amount ?? "0"} sign="+" size={20} />
                </p>
                <p className="daily-note">Следующая прокрутка через {countdown}</p>
              </>
            ) : spin.available ? (
              <>
                {error && <p className="form-error">{error}</p>}
                <Button variant="accent" block disabled={spinning} onClick={() => void play()}>
                  {spinning ? "Крутим…" : "Крутить"}
                </Button>
              </>
            ) : (
              <>
                <div className="daily-progress" role="progressbar" aria-valuemin={0} aria-valuemax={spin.tasks_required} aria-valuenow={spin.tasks_done}>
                  {Array.from({ length: spin.tasks_required }, (_, index) => (
                    <span key={index} className={index < spin.tasks_done ? "daily-dot daily-dot-done" : "daily-dot"} />
                  ))}
                </div>
                <p className="daily-note">
                  Задания сегодня: {spin.tasks_done} из {spin.tasks_required}
                </p>
                <Button variant="primary" block onClick={() => navigate("/tasks")}>
                  К заданиям
                </Button>
              </>
            )}
            {spin.test_available && (
              <div className="daily-test">
                {testWon !== null && (
                  <p className="daily-test-result">
                    Тест: выпало <Amount value={testWon} sign="+" size={16} />
                  </p>
                )}
                {error && !spin.available && <p className="form-error">{error}</p>}
                <Button variant="secondary" block disabled={spinning} onClick={() => void play()}>
                  {spinning ? "Крутим…" : "Тестовая прокрутка"}
                </Button>
                <p className="daily-test-note">Режим администратора: без ограничений и без начисления звёзд.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function prizeRange(spin: SpinStatus): string {
  const amounts = spin.prizes.map((row) => Number(row.amount));
  if (amounts.length === 0) return "";
  return `От ${formatNumber(String(Math.min(...amounts)))} до ${formatNumber(String(Math.max(...amounts)))}`;
}
