import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "./api";
import { IconChevron } from "./icons";
import { haptic, showBackButton } from "./telegram";
import { navigate } from "./router";

const cache = new Map<string, unknown>();

export function clearResourceCache(prefix?: string): void {
  if (!prefix) cache.clear();
  else for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T) => void;
}

export function useResource<T>(key: string | null, fetcher: () => Promise<T>): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  const reload = useCallback(async () => {
    const current = keyRef.current;
    if (!current) return;
    setLoading(true);
    try {
      const value = await fetcherRef.current();
      if (keyRef.current !== current) return;
      cache.set(current, value);
      setDataState(value);
      setError(null);
    } catch (err) {
      if (keyRef.current !== current) return;
      setError(err instanceof ApiError ? err : new ApiError(0, "internal", "Что-то пошло не так."));
    } finally {
      if (keyRef.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    setDataState(cache.get(key) as T | undefined);
    setError(null);
    void reload();
  }, [key, reload]);

  const setData = useCallback((value: T) => {
    if (keyRef.current) cache.set(keyRef.current, value);
    setDataState(value);
  }, []);

  return { data, error, loading, reload, setData };
}

type Variant = "primary" | "secondary" | "plain" | "danger" | "accent";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, block, className, children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={["btn", `btn-${variant}`, `btn-${size}`, block ? "btn-block" : "", className ?? ""].join(" ").trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(event) => {
        haptic("light");
        onClick?.(event);
      }}
      {...rest}
    >
      {loading ? <Spinner small /> : children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? "spinner spinner-sm" : "spinner"} role="progressbar" aria-label="Загрузка" />;
}

export function Loader() {
  return (
    <div className="loader">
      <Spinner />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="state">
      <p className="state-title">Не удалось загрузить</p>
      <p className="state-text">{error.message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {text && <p className="state-text">{text}</p>}
      {action}
    </div>
  );
}

export function Section({ title, aside, children, flush }: { title?: string; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={flush ? "section section-flush" : "section"}>
      {(title || aside) && (
        <div className="section-head">
          {title && <h2 className="section-title">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function NavRow({ label, value, onClick, accent }: { label: string; value?: ReactNode; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      className={accent ? "nav-row nav-row-accent" : "nav-row"}
      onClick={() => {
        haptic("select");
        onClick();
      }}
    >
      <span className="nav-row-label">{label}</span>
      {value !== undefined && <span className="nav-row-value">{value}</span>}
      <IconChevron size={18} />
    </button>
  );
}

export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={mono ? "info-value mono" : "info-value"}>{value}</span>
    </div>
  );
}

export function Screen({ title, back, aside, children }: { title?: string; back?: string; aside?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!back) return;
    return showBackButton(() => navigate(back));
  }, [back]);
  return (
    <div className="screen">
      {(title || aside) && (
        <header className="screen-head">
          {title && <h1 className="screen-title">{title}</h1>}
          {aside}
        </header>
      )}
      {children}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "pending" | "success" | "danger"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warning"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Sheet({ open, onClose, children, dismissible = true }: { open: boolean; onClose: () => void; children: ReactNode; dismissible?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={() => dismissible && onClose()} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function PromptSheet({
  open,
  title,
  label,
  confirmText,
  danger,
  required = true,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  confirmText: string;
  danger?: boolean;
  required?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
    }
  }, [open]);
  return (
    <Sheet open={open} onClose={() => !busy && onCancel()}>
      <h3 className="sheet-title">{title}</h3>
      <label className="field">
        <span className="field-label">{label}</span>
        <textarea className="input textarea" rows={3} value={value} onChange={(event) => setValue(event.target.value)} maxLength={500} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="sheet-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          loading={busy}
          disabled={required && !value.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onSubmit(value.trim());
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Не удалось выполнить действие.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmText}
        </Button>
      </div>
    </Sheet>
  );
}

export function Avatar({ url, label, size = 40 }: { url: string | null | undefined; label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (url && !failed) {
    return <img className="avatar" src={url} alt="" style={style} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
  }
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {label}
    </span>
  );
}
