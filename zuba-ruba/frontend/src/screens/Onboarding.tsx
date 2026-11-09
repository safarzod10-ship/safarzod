import { useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../AppContext";
import { formatNumber } from "../format";
import { haptic } from "../telegram";
import type { Config, Me } from "../types";
import { withStars } from "../stars";
import { Button } from "../ui";

interface Step {
  image: string;
  title: string;
  text: string;
  action: string;
}

function steps(config: Config): Step[] {
  const amounts = config.case_prizes.map((row) => Number(row.amount));
  const min = formatNumber(String(Math.min(...amounts)));
  const max = formatNumber(String(Math.max(...amounts)));
  return [
    {
      image: "/img/onboarding-1.png",
      title: "Задания. Кейсы. Звёзды.",
      text: `За каждое выполненное задание — кейс. В кейсе от ${min} до ${max} ⭐, рулетка крутится прямо в приложении.`,
      action: "Далее",
    },
    {
      image: "/img/onboarding-2.png",
      title: "Выполняй задания",
      text: "Подписывайся на каналы, запускай ботов и поддерживай проекты бустами. Выполнил — нажми «Проверить».",
      action: "Далее",
    },
    {
      image: "/img/onboarding-3.png",
      title: config.features.withdrawals ? "Забирай подарки" : "Следи за наградами",
      text: config.features.withdrawals
        ? `Копи звёзды и выводи их подарками Telegram: мишка, роза, кубок и другие — от ${config.withdraw.min_stars} ⭐.`
        : "Проверяй начисления, историю и доступный баланс в любой момент.",
      action: "Начать",
    },
  ];
}

export function Onboarding() {
  const { setMe, config } = useApp();
  const list = steps(config);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touch = useRef<number | null>(null);
  const last = step === list.length - 1;
  const dark = document.documentElement.dataset.theme === "dark";

  const go = (index: number) => {
    if (index < 0 || index >= list.length || index === step) return;
    haptic("select");
    setStep(index);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>("/me/onboarding");
      haptic("success");
      setMe(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось продолжить. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="onb"
      onTouchStart={(event) => {
        touch.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        const end = event.changedTouches[0]?.clientX;
        touch.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 48) return;
        go(end < start ? step + 1 : step - 1);
      }}
    >
      <header className="onb-top">
        <span className="brand">ZUBA RUBA</span>
        {!last && (
          <button type="button" className="link-btn onb-skip" onClick={() => go(list.length - 1)}>
            Пропустить
          </button>
        )}
      </header>

      <div className="onb-stage">
        {list.map((item, index) => (
          <img
            key={item.image}
            className={index === step ? "onb-art onb-art-active" : "onb-art"}
            src={dark ? item.image.replace(".png", "-dark.png") : item.image}
            alt=""
            width={360}
            height={300}
            draggable={false}
          />
        ))}
      </div>

      <div className="onb-copy" key={step}>
        <span className="onb-step">
          Шаг {step + 1} из {list.length}
        </span>
        <h1 className="onb-title">{list[step]!.title}</h1>
        <p className="onb-text">{withStars(list[step]!.text, 16)}</p>
      </div>

      <footer className="onb-bottom">
        <div className="onb-dots" aria-hidden="true">
          {list.map((_, index) => (
            <button key={index} type="button" tabIndex={-1} className={index === step ? "onb-dot onb-dot-active" : "onb-dot"} onClick={() => go(index)} />
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <Button variant={last ? "accent" : "primary"} block loading={busy} onClick={() => (last ? void finish() : go(step + 1))}>
          {list[step]!.action}
        </Button>
      </footer>
    </div>
  );
}
