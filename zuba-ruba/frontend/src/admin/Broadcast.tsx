import { useEffect, useState } from "react";
import { ApiError, api, fetchBlob } from "../api";
import { formatDateTime, formatNumber, plural } from "../format";
import { confirmDialog, haptic } from "../telegram";
import { useResource } from "../ui";
import { AdminError, Loading } from "./Admin";
import { StatusTag } from "./CompletionList";
import { Panel } from "./kit";
import type { Audience, AudienceSize, Broadcast, BroadcastButton } from "./types";

const STATUS: Record<Broadcast["status"], { label: string; tone: string }> = {
  draft: { label: "Черновик", tone: "neutral" },
  queued: { label: "В очереди", tone: "warn" },
  sending: { label: "Отправляется", tone: "warn" },
  done: { label: "Завершена", tone: "ok" },
  cancelled: { label: "Остановлена", tone: "danger" },
};

const MAX_TEXT = 4096;
const CAPTION = 1024;

function validUrl(url: string): boolean {
  return /^(https:\/\/|tg:\/\/)\S+$/.test(url.trim());
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
  return url ? <img className="adm-bc-thumb" src={url} alt="" /> : null;
}

function MessagePreview({ text, image, rows }: { text: string; image: string | null; rows: BroadcastButton[][] }) {
  return (
    <div className="adm-tg">
      <div className="adm-tg-bubble">
        {image && <img className="adm-tg-image" src={image} alt="" />}
        {text ? <p className="adm-tg-text">{text}</p> : <p className="adm-tg-text adm-muted">Текст сообщения</p>}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="adm-tg-row">
          {row.map((button, ci) => (
            <span key={ci} className="adm-tg-button">
              {button.text || "Кнопка"}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AdminBroadcastView() {
  const list = useResource("admin:broadcasts", () => api.get<{ items: Broadcast[] }>("/admin/broadcasts"));
  const sizes = useResource("admin:audience", () => api.get<{ items: AudienceSize[] }>("/admin/audience"));
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
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

  const buttonsValid = rows.every((row) => row.every((b) => b.text.trim() && validUrl(b.url)));
  const canCreate = (text.trim().length > 0 || image !== null) && text.length <= MAX_TEXT && buttonsValid;
  const audienceSize = sizes.data?.items.find((item) => item.key === audience)?.count;

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
    form.append("audience", audience);
    form.append("buttons", JSON.stringify(rows.map((row) => row.map((b) => ({ text: b.text.trim(), url: b.url.trim() })))));
    if (image) form.append("image", image);
    try {
      await api.post<Broadcast>("/admin/broadcasts", form);
      haptic("success");
      setText("");
      setImage(null);
      setRows([]);
      setActionMessage({ tone: "ok", text: "Черновик создан. Отправьте предпросмотр себе, затем запустите рассылку." });
      await list.reload();
    } catch (err) {
      haptic("error");
      setFormError(err instanceof ApiError ? err.message : "Не удалось создать рассылку.");
    } finally {
      setCreating(false);
    }
  };

  const act = async (item: Broadcast, action: "preview" | "send" | "cancel") => {
    if (action === "send" && !(await confirmDialog(`Запустить рассылку №${item.id} (${item.audience_label ?? "все пользователи"})? Отправленные сообщения отозвать нельзя.`))) return;
    if (action === "cancel" && !(await confirmDialog(item.status === "draft" ? `Удалить черновик №${item.id}?` : `Остановить рассылку №${item.id}?`))) return;
    setBusy(`${item.id}:${action}`);
    setActionMessage(null);
    try {
      await api.post(`/admin/broadcasts/${item.id}/${action}`);
      haptic("success");
      setActionMessage({
        tone: "ok",
        text: action === "preview" ? "Предпросмотр отправлен вам в чат с ботом." : action === "send" ? "Рассылка поставлена в очередь." : "Готово.",
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
    <div className="adm-grid adm-grid-2 adm-align-start">
      <Panel title="Новая рассылка">
        <div className="adm-form">
          <label className="adm-field">
            <span>Кому</span>
            <select className="adm-input adm-select" value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
              {(sizes.data?.items ?? [{ key: "all" as Audience, label: "Все пользователи бота", count: 0 }]).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                  {sizes.data ? ` · ${formatNumber(item.count)}` : ""}
                </option>
              ))}
            </select>
            {audienceSize !== undefined && (
              <span className="adm-muted">
                Получат {formatNumber(audienceSize)} {plural(audienceSize, "пользователь", "пользователя", "пользователей")}, которые запускали бота и не заблокировали его.
              </span>
            )}
          </label>
          <label className="adm-field">
            <span>Текст · HTML-разметка Telegram: &lt;b&gt;, &lt;i&gt;, &lt;a href&gt;</span>
            <textarea className="adm-input adm-textarea" rows={6} value={text} maxLength={MAX_TEXT} onChange={(e) => setText(e.target.value)} />
            <span className={image && text.length > CAPTION ? "adm-error" : "adm-muted"}>
              {text.length}/{image ? CAPTION : MAX_TEXT}
              {image && text.length > CAPTION ? " — текст длиннее подписи к фото, он придёт отдельным сообщением" : ""}
            </span>
          </label>
          <div className="adm-field">
            <span>Изображение · JPEG, PNG или WebP до 5 МБ</span>
            <div className="adm-actions">
              <label className="adm-ghost adm-file">
                {image ? "Заменить" : "Выбрать файл"}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
              </label>
              {image && (
                <button type="button" className="adm-link" onClick={() => setImage(null)}>
                  Убрать {image.name}
                </button>
              )}
            </div>
          </div>
          <div className="adm-field">
            <span>Кнопки-ссылки</span>
            {rows.map((row, r) => (
              <div key={r} className="adm-bc-row">
                {row.map((button, c) => (
                  <div key={c} className="adm-bc-button">
                    <input className="adm-input" placeholder="Текст" value={button.text} maxLength={64} onChange={(e) => updateButton(r, c, { text: e.target.value })} />
                    <input
                      className={button.url && !validUrl(button.url) ? "adm-input adm-input-error" : "adm-input"}
                      placeholder="https://"
                      value={button.url}
                      onChange={(e) => updateButton(r, c, { url: e.target.value })}
                    />
                    <button type="button" className="adm-link" onClick={() => removeButton(r, c)} aria-label="Удалить кнопку">
                      Удалить
                    </button>
                  </div>
                ))}
                {row.length < 4 && (
                  <button type="button" className="adm-link adm-small" onClick={() => setRows(rows.map((x, i) => (i === r ? [...x, { text: "", url: "" }] : x)))}>
                    + кнопка в этот ряд
                  </button>
                )}
              </div>
            ))}
            {rows.length < 8 && (
              <button type="button" className="adm-ghost" onClick={() => setRows([...rows, [{ text: "", url: "" }]])}>
                + Ряд кнопок
              </button>
            )}
          </div>
          {formError && <p className="adm-error">{formError}</p>}
          <button type="button" className="adm-btn adm-btn-block" disabled={!canCreate || creating} onClick={() => void create()}>
            {creating ? "Сохраняем…" : "Создать черновик"}
          </button>
        </div>
      </Panel>

      <div className="adm-stack">
        <Panel title="Как увидит пользователь">
          <MessagePreview text={text} image={preview} rows={rows} />
        </Panel>
        <Panel title="Рассылки">
          {actionMessage && <p className={actionMessage.tone === "ok" ? "adm-ok" : "adm-error"}>{actionMessage.text}</p>}
          {!list.data ? (
            list.error ? <AdminError error={list.error} onRetry={() => void list.reload()} /> : <Loading />
          ) : list.data.items.length === 0 ? (
            <div className="adm-empty">Рассылок ещё не было</div>
          ) : (
            <ul className="adm-bc-list">
              {list.data.items.map((item) => {
                const done = item.sent + item.failed;
                const share = item.total ? Math.min(100, Math.round((done / item.total) * 100)) : 0;
                return (
                  <li key={item.id} className="adm-bc-item">
                    <div className="adm-bc-head">
                      <span className="adm-strong">№{item.id}</span>
                      <StatusTag tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusTag>
                      <span className="adm-muted">{item.audience_label ?? "Все пользователи"}</span>
                      <span className="adm-muted adm-push">{formatDateTime(item.created_at)}</span>
                    </div>
                    <div className="adm-bc-body">
                      {item.image_url && <AuthImage src={item.image_url} />}
                      <p className="adm-clip-3">{item.text || "Без текста"}</p>
                    </div>
                    {item.status !== "draft" && (
                      <div className="adm-stack-xs">
                        <div className="adm-meter">
                          <span style={{ width: `${share}%` }} />
                        </div>
                        <span className="adm-muted">
                          Доставлено {formatNumber(item.sent)} · ошибок {formatNumber(item.failed)} · всего {formatNumber(item.total)}
                        </span>
                      </div>
                    )}
                    <div className="adm-actions">
                      {item.status === "draft" && (
                        <>
                          <button type="button" className="adm-ghost" disabled={busy !== null} onClick={() => void act(item, "preview")}>
                            Предпросмотр мне
                          </button>
                          <button type="button" className="adm-btn adm-btn-sm" disabled={busy !== null} onClick={() => void act(item, "send")}>
                            Запустить
                          </button>
                        </>
                      )}
                      {(item.status === "draft" || item.status === "queued" || item.status === "sending") && (
                        <button type="button" className="adm-btn adm-btn-sm adm-btn-danger" disabled={busy !== null} onClick={() => void act(item, "cancel")}>
                          {item.status === "draft" ? "Удалить" : "Остановить"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
