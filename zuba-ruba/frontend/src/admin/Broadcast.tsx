import { useEffect, useState } from "react";
import { ApiError, api, fetchBlob } from "../api";
import { formatDateTime } from "../format";
import { IconRefresh } from "../icons";
import { confirmDialog, haptic } from "../telegram";
import type { Broadcast, BroadcastButton } from "../types";
import { Badge, Button, EmptyState, Loader, Section, useResource } from "../ui";
import { AdminError } from "./Admin";

const STATUS: Record<Broadcast["status"], { label: string; tone: "neutral" | "pending" | "success" | "danger" }> = {
  draft: { label: "Черновик", tone: "neutral" },
  queued: { label: "В очереди", tone: "pending" },
  sending: { label: "Отправляется", tone: "pending" },
  done: { label: "Завершена", tone: "success" },
  cancelled: { label: "Отменена", tone: "danger" },
};

const MAX_TEXT = 1024;

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "tg:";
  } catch {
    return false;
  }
}

function AuthImage({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetchBlob(src)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return url ? <img className="bc-image" src={url} alt="" /> : null;
}

export function AdminBroadcastView() {
  const list = useResource("admin:broadcasts", () => api.get<{ items: Broadcast[] }>("/admin/broadcasts"));
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<BroadcastButton[][]>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const hasActive = list.data?.items.some((item) => item.status === "queued" || item.status === "sending") ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void list.reload(), 5000);
    return () => window.clearInterval(timer);
  }, [hasActive, list.reload]);

  const buttonsValid = rows.every((row) => row.every((b) => b.text.trim() && validUrl(b.url.trim())));
  const canCreate = text.trim().length > 0 && text.length <= MAX_TEXT && buttonsValid;

  const updateButton = (r: number, c: number, patch: Partial<BroadcastButton>) =>
    setRows(rows.map((row, ri) => (ri === r ? row.map((b, ci) => (ci === c ? { ...b, ...patch } : b)) : row)));

  const removeButton = (r: number, c: number) =>
    setRows(rows.map((row, ri) => (ri === r ? row.filter((_, ci) => ci !== c) : row)).filter((row) => row.length > 0));

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setFormError(null);
    const form = new FormData();
    form.append("text", text.trim());
    form.append("buttons", JSON.stringify(rows.map((row) => row.map((b) => ({ text: b.text.trim(), url: b.url.trim() })))));
    if (image) form.append("image", image);
    try {
      await api.post<Broadcast>("/admin/broadcasts", form);
      haptic("success");
      setText("");
      setImage(null);
      setRows([]);
      await list.reload();
    } catch (err) {
      haptic("error");
      setFormError(err instanceof ApiError ? err.message : "Не удалось создать рассылку.");
    } finally {
      setCreating(false);
    }
  };

  const act = async (item: Broadcast, action: "preview" | "send" | "cancel") => {
    if (action === "send" && !(await confirmDialog(`Отправить рассылку №${item.id} всем пользователям бота? Отменить уже отправленные сообщения нельзя.`))) return;
    if (action === "cancel" && !(await confirmDialog(`Остановить рассылку №${item.id}?`))) return;
    setBusy(`${item.id}:${action}`);
    setActionMessage(null);
    try {
      await api.post(`/admin/broadcasts/${item.id}/${action}`);
      haptic("success");
      setActionMessage({
        tone: "ok",
        text: action === "preview" ? "Предпросмотр отправлен вам в чат с ботом." : action === "send" ? "Рассылка поставлена в очередь." : "Рассылка остановлена.",
      });
      await list.reload();
    } catch (err) {
      haptic("error");
      setActionMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Действие не выполнено." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section title="Новая рассылка">
        <label className="field">
          <span className="field-label">Текст (поддерживается HTML-разметка Telegram)</span>
          <textarea className="input textarea" rows={5} value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} />
          <span className="hint right">
            {text.length}/{MAX_TEXT}
          </span>
        </label>
        <div className="field">
          <span className="field-label">Изображение</span>
          {preview ? (
            <div className="bc-preview">
              <img className="bc-image" src={preview} alt="" />
              <Button variant="secondary" size="sm" onClick={() => setImage(null)}>
                Убрать изображение
              </Button>
            </div>
          ) : (
            <label className="file-btn">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 10 * 1024 * 1024) {
                    setFormError("Изображение должно быть не больше 10 МБ.");
                    return;
                  }
                  setImage(file);
                }}
              />
              Выбрать файл
            </label>
          )}
        </div>
        <div className="field">
          <span className="field-label">Кнопки</span>
          {rows.map((row, r) => (
            <div key={r} className="bc-row">
              <span className="hint">Ряд {r + 1}</span>
              {row.map((button, c) => (
                <div key={c} className="bc-button">
                  <input className="input" placeholder="Текст кнопки" maxLength={64} value={button.text} onChange={(e) => updateButton(r, c, { text: e.target.value })} />
                  <input
                    className={button.url && !validUrl(button.url.trim()) ? "input input-error" : "input"}
                    placeholder="https://"
                    inputMode="url"
                    value={button.url}
                    onChange={(e) => updateButton(r, c, { url: e.target.value })}
                  />
                  <button type="button" className="link-btn danger" onClick={() => removeButton(r, c)}>
                    Удалить
                  </button>
                </div>
              ))}
              {row.length < 3 && (
                <button type="button" className="link-btn" onClick={() => setRows(rows.map((x, ri) => (ri === r ? [...x, { text: "", url: "" }] : x)))}>
                  + Кнопка в ряд
                </button>
              )}
            </div>
          ))}
          {rows.length < 5 && (
            <Button variant="secondary" size="sm" onClick={() => setRows([...rows, [{ text: "", url: "" }]])}>
              Добавить ряд кнопок
            </Button>
          )}
          {!buttonsValid && <p className="form-error">У каждой кнопки должен быть текст и корректная ссылка.</p>}
        </div>
        {formError && <p className="form-error">{formError}</p>}
        <Button block loading={creating} disabled={!canCreate} onClick={() => void create()}>
          Создать черновик
        </Button>
      </Section>

      <Section
        title="Рассылки"
        aside={
          <button type="button" className={list.loading ? "icon-btn spinning" : "icon-btn"} aria-label="Обновить" onClick={() => void list.reload()}>
            <IconRefresh />
          </button>
        }
      >
        {actionMessage && <p className={actionMessage.tone === "ok" ? "hint" : "form-error"}>{actionMessage.text}</p>}
        {!list.data && list.error && <AdminError error={list.error} onRetry={() => void list.reload()} />}
        {!list.data && !list.error && <Loader />}
        {list.data && list.data.items.length === 0 && <EmptyState title="Рассылок ещё не было" />}
        {list.data && list.data.items.length > 0 && (
          <ul className="list">
            {list.data.items.map((item) => (
              <li key={item.id} className="admin-item">
                <div className="admin-item-head">
                  <span className="op-title">Рассылка №{item.id}</span>
                  <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                </div>
                {item.image_url && <AuthImage src={item.image_url} />}
                <p className="bc-text">{item.text}</p>
                {item.buttons.length > 0 && (
                  <div className="bc-buttons">
                    {item.buttons.map((row, r) => (
                      <div key={r} className="bc-buttons-row">
                        {row.map((b, c) => (
                          <span key={c} className="bc-chip">
                            {b.text}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="kv">
                  <span>Создана</span>
                  <span>{formatDateTime(item.created_at)}</span>
                  {item.status !== "draft" && (
                    <>
                      <span>Доставлено</span>
                      <span>
                        {item.sent} из {item.total}
                      </span>
                      <span>Ошибки</span>
                      <span>{item.failed}</span>
                    </>
                  )}
                  {item.finished_at && (
                    <>
                      <span>Завершена</span>
                      <span>{formatDateTime(item.finished_at)}</span>
                    </>
                  )}
                </div>
                {item.status === "draft" && (
                  <div className="task-actions">
                    <Button variant="secondary" size="sm" loading={busy === `${item.id}:preview`} disabled={busy !== null} onClick={() => void act(item, "preview")}>
                      Предпросмотр
                    </Button>
                    <Button size="sm" loading={busy === `${item.id}:send`} disabled={busy !== null} onClick={() => void act(item, "send")}>
                      Отправить
                    </Button>
                  </div>
                )}
                {(item.status === "draft" || item.status === "queued" || item.status === "sending") && (
                  <button type="button" className="link-btn danger" disabled={busy !== null} onClick={() => void act(item, "cancel")}>
                    {item.status === "draft" ? "Отменить черновик" : "Остановить рассылку"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
