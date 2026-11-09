import { useState } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { formatDate, initials, plural } from "../format";
import { IconCheck, IconCopy, IconGift, IconShare } from "../icons";
import { Star } from "../stars";
import { navigate } from "../router";
import { haptic, openExternal } from "../telegram";
import type { Home, Referrals } from "../types";
import { Avatar, Button, NavRow, Screen, useResource } from "../ui";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return legacyCopy(text);
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function ProfileScreen() {
  const { me, config } = useApp();
  const home = useResource("home", () => api.get<Home>("/home"));
  const referrals = useResource("referrals", () => api.get<Referrals>("/referrals"));
  const [copied, setCopied] = useState<boolean | null>(null);

  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
  const link = referrals.data?.ref_link ?? me.ref_link;
  const threshold = referrals.data?.threshold ?? config.referral_threshold;
  const progress = Math.min(referrals.data?.progress ?? 0, threshold);

  const copy = async () => {
    const ok = await copyText(link);
    haptic(ok ? "success" : "error");
    setCopied(ok);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const share = () => {
    haptic("light");
    const text = "Выполняй задания, открывай кейсы и выводи подарки в ZUBA RUBA.";
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  return (
    <Screen title="Профиль">
      <section className="me-card">
        <Avatar url={me.photo_url} label={initials(me.first_name, me.last_name)} size={64} />
        <div className="me-info">
          <span className="me-name">{name || "Без имени"}</span>
          {me.username && <span className="me-sub">@{me.username}</span>}
          <span className="me-meta">
            ID <span className="mono">{me.id}</span> · с {formatDate(me.registered_at)}
          </span>
        </div>
      </section>

      <dl className="stats-row">
        <div>
          <dt>Кейсов открыто</dt>
          <dd>{home.data?.cases_opened ?? "—"}</dd>
        </div>
        <div>
          <dt>Друзей</dt>
          <dd>{referrals.data?.invited ?? "—"}</dd>
        </div>
        <div>
          <dt>Подарочных кейсов</dt>
          <dd>{referrals.data?.cases_received ?? "—"}</dd>
        </div>
      </dl>

      {config.features.referrals && (
        <section className="invite">
          <h2 className="invite-title">Приглашай друзей</h2>
          <p className="invite-text">
            Друг открывает {threshold} {plural(threshold, "подтверждённый кейс", "подтверждённых кейса", "подтверждённых кейсов")} — ты получаешь подарочный кейс.
            И так за каждые {threshold}.
          </p>
          <div className="invite-progress" role="progressbar" aria-valuemin={0} aria-valuemax={threshold} aria-valuenow={progress} aria-label="До следующего кейса">
            {Array.from({ length: threshold }, (_, index) => (
              <span key={index} className={index < progress ? "invite-step invite-step-done" : "invite-step"}>
                {index < progress ? <Star size={18} /> : index + 1}
              </span>
            ))}
            <span className="invite-step invite-step-prize">
              <IconGift size={18} />
            </span>
          </div>
          <p className="invite-hint">Прогресс ближайшего к кейсу друга</p>
          <div className="invite-link">
            <span className="mono">{link.replace("https://", "")}</span>
          </div>
          <div className="invite-actions">
            <Button variant="accent" onClick={() => void copy()}>
              {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              {copied === true ? "Скопировано" : "Копировать"}
            </Button>
            <Button variant="secondary" onClick={share}>
              <IconShare size={18} /> Поделиться
            </Button>
          </div>
          {copied === false && <p className="form-error">Не удалось скопировать. Выделите ссылку вручную.</p>}
        </section>
      )}

      <div className="group group-spaced menu">
        <NavRow label="История операций" onClick={() => navigate("/history")} />
        <NavRow label="Вывод подарками" onClick={() => navigate("/withdraw?from=profile")} />
        {me.is_admin && <NavRow label="Панель управления →" accent onClick={() => navigate("/admin")} />}
        <NavRow label="Правила и вопросы" onClick={() => navigate("/rules")} />
        {config.support_url && <NavRow label="Поддержка" onClick={() => openExternal(config.support_url!)} />}
      </div>
    </Screen>
  );
}
