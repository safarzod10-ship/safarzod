import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { formatNumber } from "../format";
import { Lottie, giftAnimationUrl } from "../lottie";
import { webApp } from "../telegram";
import type { ExportLink } from "./types";

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={["adm-panel", className ?? ""].join(" ").trim()}>
      {(title || aside) && (
        <header className="adm-panel-head">
          {title && <h2 className="adm-panel-title">{title}</h2>}
          {aside && <div className="adm-panel-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "positive" | "accent" }) {
  return (
    <div className={tone ? `adm-kpi adm-kpi-${tone}` : "adm-kpi"}>
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      {hint && <span className="adm-kpi-hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="adm-seg" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "adm-seg-item adm-seg-active" : "adm-seg-item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "right";
  primary?: boolean;
  hideOnMobile?: boolean;
  wide?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  sort?: { key: string; order: "asc" | "desc" };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <div className="adm-empty">{empty ?? "Нет данных"}</div>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th key={column.key} className={column.align === "right" ? "adm-right" : undefined} aria-sort={active ? (sort?.order === "asc" ? "ascending" : "descending") : undefined}>
                  {column.sortable && onSort ? (
                    <button type="button" className={active ? "adm-sort adm-sort-active" : "adm-sort"} onClick={() => onSort(column.key)}>
                      {column.label}
                      <span className="adm-sort-mark" aria-hidden="true">
                        {active ? (sort?.order === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "adm-row-link" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (event) => event.key === "Enter" && onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.label}
                  className={[column.align === "right" ? "adm-right" : "", column.primary ? "adm-cell-primary" : "", column.hideOnMobile ? "adm-hide-sm" : "", column.wide ? "adm-cell-wide" : ""].join(" ").trim() || undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="adm-pager">
      <button type="button" className="adm-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Назад
      </button>
      <span className="adm-muted">
        {page} из {pages}
      </span>
      <button type="button" className="adm-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Вперёд →
      </button>
    </div>
  );
}

const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

export function formatDay(iso: string): string {
  return shortDate.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * exponent >= value) ?? 10;
  return step * exponent;
}

export function BarChart({ dates, values, unit }: { dates: string[]; values: number[]; unit?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 320;
  const height = 120;
  const left = 30;
  const bottom = 18;
  const top = 8;
  const plotWidth = width - left;
  const plotHeight = height - bottom - top;
  const max = niceMax(Math.max(0, ...values));
  const slot = plotWidth / Math.max(values.length, 1);
  const barWidth = Math.max(1.5, slot * 0.68);
  const ticks = [0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, arr) => arr.indexOf(v) === i);

  const pick = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width - left;
    const index = Math.floor(x / slot);
    setActive(index >= 0 && index < values.length ? index : null);
  };

  const shown = active ?? values.length - 1;
  return (
    <div className="adm-chart">
      <div className="adm-chart-readout">
        <span className="adm-chart-value">
          {formatNumber(values[shown] ?? 0)}
          {unit ? ` ${unit}` : ""}
        </span>
        <span className="adm-muted">{dates[shown] ? formatDay(dates[shown]) : ""}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="adm-chart-svg"
        role="img"
        aria-label="График по дням"
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        <line x1={left} x2={width} y1={top} y2={top} className="adm-gridline" />
        <line x1={left} x2={width} y1={top + plotHeight / 2} y2={top + plotHeight / 2} className="adm-gridline" />
        <line x1={left} x2={width} y1={top + plotHeight} y2={top + plotHeight} className="adm-axis" />
        <text x={left - 4} y={top + 4} className="adm-tick" textAnchor="end">
          {formatNumber(max)}
        </text>
        <text x={left - 4} y={top + plotHeight + 3} className="adm-tick" textAnchor="end">
          0
        </text>
        {values.map((value, index) => {
          const h = (value / max) * plotHeight;
          return (
            <rect
              key={dates[index] ?? index}
              x={left + index * slot + (slot - barWidth) / 2}
              y={top + plotHeight - h}
              width={barWidth}
              height={Math.max(h, value > 0 ? 1.5 : 0)}
              rx={Math.min(2, barWidth / 2)}
              className={index === shown ? "adm-bar adm-bar-active" : "adm-bar"}
            />
          );
        })}
        {ticks.map((index) => (
          <text
            key={index}
            x={left + index * slot + slot / 2}
            y={height - 4}
            className="adm-tick"
            textAnchor={index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"}
          >
            {dates[index] ? formatDay(dates[index]) : ""}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function GiftThumb({ giftId, emoji, size = 40 }: { giftId: string | null | undefined; emoji?: string | null; size?: number }) {
  return (
    <span className="adm-gift" style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }} aria-hidden="true">
      {giftId && /^\d+$/.test(giftId) ? <Lottie src={giftAnimationUrl(giftId)} size={size} play={false} frame={90} fallback={emoji ?? "★"} /> : <span>{emoji ?? "★"}</span>}
    </span>
  );
}

export function userName(user: { username?: string | null; first_name?: string | null; id: number }): string {
  if (user.username) return `@${user.username}`;
  if (user.first_name) return user.first_name;
  return String(user.id);
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface InvoiceApp {
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
  downloadFile?: (params: { url: string; file_name: string }, callback?: (accepted: boolean) => void) => void;
}

function extra(): InvoiceApp | null {
  return webApp() as unknown as InvoiceApp | null;
}

export async function downloadExport(kind: "users" | "operations", userId?: number): Promise<void> {
  const query = userId ? `?user_id=${userId}` : "";
  const link = await api.post<ExportLink>(`/admin/export/${kind}/link${query}`);
  const app = extra();
  if (app?.downloadFile) {
    app.downloadFile({ url: link.url, file_name: link.file_name });
    return;
  }
  window.open(link.url, "_blank", "noopener");
}

export function openInvoice(url: string): Promise<string> {
  return new Promise((resolve) => {
    const app = extra();
    if (app?.openInvoice) app.openInvoice(url, (status) => resolve(status));
    else {
      window.open(url, "_blank", "noopener");
      resolve("external");
    }
  });
}
