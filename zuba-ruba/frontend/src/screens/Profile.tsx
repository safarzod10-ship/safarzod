import { useState } from "react";
import { api } from "../api";
import { useApp } from "../AppContext";
import { formatDate, initials, plural } from "../format";
import { IconCheck, IconCopy, IconShare } from "../icons";
import { navigate } from "../router";
import { haptic, openExternal } from "../telegram";
import type { Home, Referrals } from "../types";
import { Avatar, Button, InfoRow, NavRow, Screen, Section, useResource } from "../ui";

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
    const text = "Выполняй задания, открывай кейсы и собирай награды в ZUBA RUBA.";
    openExternal(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  return (
    <Screen title="Профиль">
      <div className="profile-head">
        <Avatar url={me.photo_url} label={initials(me.first_name, me.last_name)} size={64} />
        <div className="profile-name">
          <span className="profile-title">{name || "Без имени"}</span>
          {me.username && <span className="profile-sub">@{me.username}</span>}
        </div>
      </div>

      <div className="group">
        <InfoRow label="Telegram ID" value={me.id} mono />
        <InfoRow label="Дата регистрации" value={formatDate(me.registered_at)} />
        <InfoRow label="Открыто кейсов" value={home.data?.cases_opened ?? "—"} />
        <InfoRow label="Приглашено друзей" value={referrals.data?.invited ?? "—"} />
      </div>

      {config.features.referrals && (
        <Section title="Приглашай друзей">
          <p className="section-text">
            За каждые {threshold} {plural(threshold, "подтверждённое задание", "подтверждённых задания", "подтверждённых заданий")} приглашённого друга
            ты получаешь подарочный кейс.
          </p>
          <div className="ref-link">
            <span className="ref-link-text mono">{link}</span>
            <button type="button" className="icon-btn" aria-label="Скопировать ссылку" onClick={() => void copy()}>
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
          </div>
          {copied === true && <p className="hint">Ссылка скопирована</p>}
          {copied === false && <p className="form-error">Не удалось скопировать. Выделите ссылку вручную.</p>}
          <Button variant="secondary" block onClick={share}>
            <IconShare /> Поделиться ссылкой
          </Button>
          <div className="ref-progress">
            <div className="ref-progress-head">
              <span>До следующего кейса</span>
              <span className="mono">
                {progress}/{threshold}
              </span>
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={threshold} aria-valuenow={progress}>
              {Array.from({ length: threshold }, (_, index) => (
                <span key={index} className={index < progress ? "progress-step progress-step-done" : "progress-step"} />
              ))}
            </div>
            <InfoRow label="Получено подарочных кейсов" value={referrals.data?.cases_received ?? "—"} />
          </div>
        </Section>
      )}

      <div className="group group-spaced">
        <NavRow label="История операций" onClick={() => navigate("/history")} />
        {me.is_admin && <NavRow label="Панель управления" accent onClick={() => navigate("/admin")} />}
        <NavRow label="Правила проекта" onClick={() => navigate("/rules")} />
        {config.support_url && <NavRow label="Поддержка" onClick={() => openExternal(config.support_url!)} />}
      </div>
    </Screen>
  );
}
