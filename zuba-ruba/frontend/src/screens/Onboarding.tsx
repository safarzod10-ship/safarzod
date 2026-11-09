import { useState } from "react";
import { ApiError, api } from "../api";
import { useApp } from "../AppContext";
import { haptic } from "../telegram";
import type { Me } from "../types";
import { Button } from "../ui";

const STEPS = [
  {
    title: ["Задания.", "Кейсы.", "Звёзды."],
    text: "Выполняй задания, открывай кейсы и получай награды.",
    action: "Далее",
  },
  {
    title: ["Выполняй задания"],
    text: "Подписывайся на каналы, запускай ботов и поддерживай проекты.",
    action: "Далее",
  },
  {
    title: ["Следи за наградами"],
    text: "Проверяй начисления, историю и доступный баланс.",
    action: "Начать",
  },
];

function Illustration({ step }: { step: number }) {
  if (step === 0) {
    return (
      <svg className="onb-art" viewBox="0 0 240 120" aria-hidden="true">
        <rect x="8" y="28" width="64" height="64" rx="10" />
        <path d="M24 60l10 10 22-22" />
        <rect x="88" y="28" width="64" height="64" rx="10" />
        <path d="M88 50h64M112 62h16" />
        <rect x="168" y="28" width="64" height="64" rx="10" />
        <path d="M200 44l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" />
      </svg>
    );
  }
  if (step === 1) {
    return (
      <svg className="onb-art" viewBox="0 0 240 120" aria-hidden="true">
        <rect x="8" y="10" width="224" height="28" rx="8" />
        <path d="M22 24l5 5 9-9M50 24h110" />
        <rect x="8" y="46" width="224" height="28" rx="8" />
        <path d="M22 60l5 5 9-9M50 60h80" />
        <rect x="8" y="82" width="224" height="28" rx="8" />
        <circle cx="29" cy="96" r="6" />
        <path d="M50 96h96" />
      </svg>
    );
  }
  return (
    <svg className="onb-art" viewBox="0 0 240 120" aria-hidden="true">
      <path d="M8 18h150M8 36h96" />
      <path d="M8 66h224M8 90h224M8 114h224" />
      <path d="M190 44h42M206 30v28" />
    </svg>
  );
}

export function Onboarding() {
  const { setMe } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

  const next = async () => {
    if (!last) {
      haptic("select");
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>("/me/onboarding");
      haptic("success");
      setMe(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось продолжить. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onb">
      <div className="onb-top">
        <span className="onb-brand">ZUBA RUBA</span>
        <span className="onb-count">
          {step + 1}/{STEPS.length}
        </span>
      </div>
      <div className="onb-body" key={step}>
        <Illustration step={step} />
        <h1 className="onb-title">
          {current.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="onb-text">{current.text}</p>
      </div>
      <div className="onb-bottom">
        <div className="onb-dots" role="tablist" aria-label="Шаги">
          {STEPS.map((_, index) => (
            <span key={index} className={index === step ? "onb-dot onb-dot-active" : "onb-dot"} />
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <Button block loading={busy} onClick={() => void next()}>
          {current.action}
        </Button>
      </div>
    </div>
  );
}
