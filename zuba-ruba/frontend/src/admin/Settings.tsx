import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";
import { confirmDialog, haptic } from "../telegram";
import type { SettingItem } from "../types";
import { Button, Loader, Section, useResource } from "../ui";
import { AdminError } from "./Admin";

type Draft = Record<string, string | boolean>;

const UNIT: Record<string, string> = { stars: "⭐", rub: "₽", usd: "$" };

function toDraft(items: SettingItem[]): Draft {
  const draft: Draft = {};
  for (const item of items) draft[item.key] = item.type === "bool" ? Boolean(item.value) : item.value === null ? "" : String(item.value);
  return draft;
}

function validate(item: SettingItem, value: string | boolean): string | null {
  if (item.type === "bool" || item.type === "string") return null;
  const text = String(value).trim().replace(",", ".");
  if (item.type === "int") return /^\d+$/.test(text) ? null : "Целое неотрицательное число";
  return /^\d+(\.\d+)?$/.test(text) ? null : "Неотрицательное число";
}

export function AdminSettingsView() {
  const data = useResource("admin:settings", () => api.get<{ items: SettingItem[] }>("/admin/settings"));
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data.data) setDraft(toDraft(data.data.items));
  }, [data.data]);

  const groups = useMemo(() => {
    const map = new Map<string, SettingItem[]>();
    for (const item of data.data?.items ?? []) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [data.data]);

  if (!data.data) return data.error ? <AdminError error={data.error} onRetry={() => void data.reload()} /> : <Loader />;

  const original = toDraft(data.data.items);
  const changed = Object.keys(draft).filter((key) => draft[key] !== original[key]);
  const errors = Object.fromEntries(data.data.items.map((item) => [item.key, draft[item.key] === undefined ? null : validate(item, draft[item.key]!)]));
  const hasErrors = changed.some((key) => errors[key]);

  const save = async () => {
    if (!data.data || changed.length === 0 || hasErrors) return;
    if (!(await confirmDialog(`Сохранить изменения (${changed.length})? Они применятся сразу и попадут в журнал.`))) return;
    setSaving(true);
    setMessage(null);
    const values: Record<string, string | boolean> = {};
    for (const key of changed) {
      const item = data.data.items.find((entry) => entry.key === key)!;
      const value = draft[key]!;
      values[key] = typeof value === "string" && item.type !== "string" ? value.trim().replace(",", ".") : value;
    }
    try {
      const updated = await api.patch<{ items: SettingItem[] }>("/admin/settings", { values });
      data.setData(updated);
      haptic("success");
      setMessage({ tone: "ok", text: "Настройки сохранены." });
    } catch (err) {
      haptic("error");
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Не удалось сохранить настройки." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      {groups.map(([group, items]) => (
        <Section key={group} title={group}>
          <div className="group group-flat">
            {items.map((item) =>
              item.type === "bool" ? (
                <label key={item.key} className="toggle-row">
                  <span className="info-label">{item.label}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={Boolean(draft[item.key])}
                    onChange={(event) => {
                      haptic("select");
                      setDraft({ ...draft, [item.key]: event.target.checked });
                    }}
                  />
                </label>
              ) : (
                <label key={item.key} className="field field-row">
                  <span className="field-label">
                    {item.label}
                    {UNIT[item.type] && !item.label.includes(UNIT[item.type]!) ? `, ${UNIT[item.type]}` : ""}
                  </span>
                  <input
                    className={errors[item.key] && changed.includes(item.key) ? "input input-error" : "input"}
                    inputMode={item.type === "string" ? "text" : item.type === "int" ? "numeric" : "decimal"}
                    value={String(draft[item.key] ?? "")}
                    onChange={(event) => setDraft({ ...draft, [item.key]: event.target.value })}
                  />
                  {errors[item.key] && changed.includes(item.key) && <span className="form-error">{errors[item.key]}</span>}
                </label>
              ),
            )}
          </div>
        </Section>
      ))}
      <div className="sticky-actions">
        {message && <p className={message.tone === "ok" ? "hint" : "form-error"}>{message.text}</p>}
        <div className="task-actions">
          <Button variant="secondary" disabled={changed.length === 0 || saving} onClick={() => setDraft(original)}>
            Сбросить
          </Button>
          <Button loading={saving} disabled={changed.length === 0 || hasErrors} onClick={() => void save()}>
            Сохранить{changed.length ? ` (${changed.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
