import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { formatNumber, formatStars } from "../format";
import { confirmDialog, haptic, initData } from "../telegram";
import { useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { Panel } from "./kit";
import type { SettingItem } from "./types";

const UNIT: Record<string, string> = { stars: "⭐", rub: "₽", usd: "$" };

function normalize(item: SettingItem, value: string): string {
  if (item.type === "bool") return value === "true" ? "true" : "false";
  return value.trim();
}

function validate(item: SettingItem, value: string): string | null {
  const text = value.trim().replace(",", ".");
  switch (item.type) {
    case "bool":
    case "string":
      return null;
    case "int":
      return /^\d+$/.test(text) ? null : "Целое неотрицательное число";
    case "stars":
    case "rub":
    case "usd":
      return /^\d+(\.\d+)?$/.test(text) ? null : "Неотрицательное число";
    case "prizes":
      return parsePrizes(value) ? null : "Формат: сумма:вес через запятую, минимум два приза";
    case "stars_list":
      return /^\s*\d+(\s*,\s*\d+)*\s*$/.test(value) ? null : "Целые числа через запятую";
    default:
      return text ? null : "Заполните поле";
  }
}

export function parsePrizes(value: string): { amount: number; weight: number }[] | null {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const rows: { amount: number; weight: number }[] = [];
  for (const part of parts) {
    const match = /^(\d+(?:[.,]\d{1,3})?)\s*:\s*(\d+)$/.exec(part);
    if (!match) return null;
    const amount = Number(match[1].replace(",", "."));
    const weight = Number(match[2]);
    if (amount <= 0 || weight <= 0 || rows.some((row) => row.amount === amount)) return null;
    rows.push({ amount, weight });
  }
  return rows.sort((a, b) => a.amount - b.amount);
}

function PrizePreview({ value }: { value: string }) {
  const rows = parsePrizes(value);
  if (!rows) return null;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const expected = rows.reduce((sum, row) => sum + (row.amount * row.weight) / total, 0);
  return (
    <div className="adm-prizes">
      {rows.map((row) => (
        <div key={row.amount} className="adm-prize">
          <span className="adm-num">{formatStars(String(row.amount))}</span>
          <div className="adm-meter">
            <span style={{ width: `${(row.weight / total) * 100}%` }} />
          </div>
          <span className="adm-muted adm-num">{((row.weight / total) * 100).toFixed(1).replace(".", ",")}%</span>
        </div>
      ))}
      <p className="adm-note">
        Средний приз кейса: <strong>{formatStars(expected.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""))}</strong>
      </p>
    </div>
  );
}

export function AdminSettingsView() {
  const data = useResource("admin:settings", () => api.get<{ items: SettingItem[] }>("/admin/settings"));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data.data) setDraft(Object.fromEntries(data.data.items.map((item) => [item.key, item.value])));
  }, [data.data]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, SettingItem[]>();
    for (const item of data.data?.items ?? []) {
      if (q && !`${item.label} ${item.key} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(q)) continue;
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [data.data, query]);

  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loading />;
  const items = data.data.items;

  const changed = items.filter((item) => draft[item.key] !== undefined && normalize(item, draft[item.key]) !== item.value);
  const errors = Object.fromEntries(items.map((item) => [item.key, draft[item.key] === undefined ? null : validate(item, draft[item.key])]));
  const hasErrors = changed.some((item) => errors[item.key]);

  const save = async () => {
    if (changed.length === 0 || hasErrors) return;
    if (!(await confirmDialog(`Сохранить изменения (${changed.length})? Они применятся сразу и попадут в журнал.`))) return;
    setSaving(true);
    setMessage(null);
    setServerErrors({});
    try {
      const values = Object.fromEntries(changed.map((item) => [item.key, normalize(item, draft[item.key])]));
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { Authorization: `tma ${initData()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { items: SettingItem[] }
        | { error?: { message?: string; fields?: Record<string, string> } }
        | null;
      if (!response.ok || !payload || !("items" in payload)) {
        const failure = payload && "error" in payload ? payload.error : undefined;
        haptic("error");
        setServerErrors(failure?.fields ?? {});
        setMessage({ tone: "error", text: failure?.message ?? "Не удалось сохранить." });
        return;
      }
      data.setData(payload);
      haptic("success");
      setMessage({ tone: "ok", text: "Настройки сохранены." });
    } catch {
      haptic("error");
      setMessage({ tone: "error", text: "Нет соединения с сервером." });
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  return (
    <div className="adm-stack adm-settings">
      <div className="adm-toolbar">
        <input className="adm-input adm-search" type="search" placeholder="Найти настройку" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Поиск настроек" />
        <span className="adm-muted">{formatNumber(items.filter((item) => item.default !== undefined && item.value !== item.default).length)} изменено относительно стандартных</span>
      </div>
      {groups.length === 0 && <div className="adm-empty">Ничего не найдено</div>}
      <div className="adm-grid adm-grid-2 adm-masonry">
        {groups.map(([group, list]) => (
          <Panel key={group} title={group}>
            <div className="adm-settings-list">
              {list.map((item) => {
                const value = draft[item.key] ?? item.value;
                const isDefault = item.default === undefined || normalize(item, value) === item.default;
                const dirty = normalize(item, value) !== item.value;
                const error = (dirty && errors[item.key]) || serverErrors[item.key];
                return (
                  <div key={item.key} className={dirty ? "adm-setting adm-setting-dirty" : "adm-setting"}>
                    <div className="adm-setting-text">
                      <label htmlFor={`set-${item.key}`} className="adm-setting-label">
                        {item.label}
                      </label>
                      {item.hint && <span className="adm-muted">{item.hint}</span>}
                      {!isDefault && (
                        <button type="button" className="adm-link adm-small" onClick={() => set(item.key, item.default ?? item.value)}>
                          Вернуть стандартное: {item.type === "bool" ? (item.default === "true" ? "вкл." : "выкл.") : item.default || "пусто"}
                        </button>
                      )}
                    </div>
                    <div className="adm-setting-control">
                      {item.type === "bool" ? (
                        <button
                          id={`set-${item.key}`}
                          type="button"
                          role="switch"
                          aria-checked={value === "true"}
                          className={value === "true" ? "adm-switch adm-switch-on" : "adm-switch"}
                          onClick={() => set(item.key, value === "true" ? "false" : "true")}
                        >
                          <span />
                        </button>
                      ) : (
                        <span className="adm-input-unit">
                          <input
                            id={`set-${item.key}`}
                            className={error ? "adm-input adm-input-error" : "adm-input"}
                            inputMode={["int", "stars", "rub", "usd"].includes(item.type) ? "decimal" : "text"}
                            value={value}
                            onChange={(event) => set(item.key, event.target.value)}
                          />
                          {UNIT[item.type] ? <span className="adm-unit">{UNIT[item.type]}</span> : null}
                        </span>
                      )}
                    </div>
                    {error && <p className="adm-error adm-setting-error">{error}</p>}
                    {item.type === "prizes" && <PrizePreview value={value} />}
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>
      {(changed.length > 0 || message) && (
        <div className="adm-savebar">
          <span className={message?.tone === "error" ? "adm-error" : message ? "adm-ok" : "adm-muted"}>
            {message?.text ?? `Изменено настроек: ${changed.length}`}
          </span>
          <span className="adm-actions">
            {changed.length > 0 && (
              <button type="button" className="adm-ghost" disabled={saving} onClick={() => setDraft(Object.fromEntries(items.map((item) => [item.key, item.value])))}>
                Отменить
              </button>
            )}
            <button type="button" className="adm-btn" disabled={saving || changed.length === 0 || hasErrors} onClick={() => void save()}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
