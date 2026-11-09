const GROUP = " ";

export function formatNumber(value: string | number, minFraction = 0): string {
  const raw = typeof value === "number" ? String(value) : value.trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) return raw;
  const negative = match[1] === "-";
  const integer = (match[2] || "0").replace(/^0+(?=\d)/, "");
  let fraction = (match[3] ?? "").replace(/0+$/, "");
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, "0");
  const grouped = integer.length > 4 ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP) : integer;
  const isZero = /^0*$/.test(integer) && /^0*$/.test(fraction);
  const sign = negative && !isZero ? "−" : "";
  return `${sign}${grouped}${fraction ? `,${fraction}` : ""}`;
}

export function stripSign(value: string): string {
  return value.replace(/^[+-]/, "");
}

export function formatStars(value: string | number, options: { sign?: "+" | "-" | "auto" } = {}): string {
  const text = String(value);
  if (options.sign === "+" || options.sign === "-") {
    const body = formatNumber(stripSign(text));
    return `${options.sign === "+" ? "+" : "−"}${body} ⭐`;
  }
  if (options.sign === "auto") {
    const body = formatNumber(text);
    return `${body.startsWith("−") || isZero(text) ? "" : "+"}${body} ⭐`;
  }
  return `${formatNumber(text)} ⭐`;
}

export function formatRub(value: string | number): string {
  return `${formatNumber(String(value), 2)} ₽`;
}

export function isZero(value: string): boolean {
  return /^[+-]?0*(\.0*)?$/.test(value.trim());
}

export function isNegative(value: string): boolean {
  return value.trim().startsWith("-") && !isZero(value);
}

const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dateTimeYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export function formatDateTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return (date.getFullYear() === now.getFullYear() ? dateTime : dateTimeYear).format(date).replace(" г.", "");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateOnly.format(date).replace(" г.", "");
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function hours(count: number): string {
  return `${count} ${plural(count, "час", "часа", "часов")}`;
}

export function initials(first: string | null | undefined, last?: string | null): string {
  const a = (first ?? "").trim().charAt(0);
  const b = (last ?? "").trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}
