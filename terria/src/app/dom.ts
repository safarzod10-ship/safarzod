/** Small DOM + formatting helpers for the game UI. No framework on purpose. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: HTMLElement | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

export function btn(parent: HTMLElement | null, cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', cls, parent);
  b.type = 'button';
  b.innerHTML = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function clear(n: HTMLElement): HTMLElement {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** 1 234, 12,5 тыс., 3,4 млн */
export function num(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} млн`;
  if (a >= 1e5) return `${nf0.format(v / 1e3)} тыс.`;
  if (a >= 1e4) return `${nf1.format(v / 1e3)} тыс.`;
  return nf0.format(Math.floor(v));
}
/** Exact integer with thin spaces. */
export const int = (v: number): string => nf0.format(Math.floor(v));
export const dec = (v: number): string => nf2.format(v);
export const dec1 = (v: number): string => nf1.format(v);

export function perHour(v: number): string {
  const s = Math.abs(v) >= 10 ? nf0.format(v) : nf1.format(v);
  return `${v >= 0 ? '+' : ''}${s}/ч`;
}

/** 45 с, 12 мин, 3 ч 05 мин, 2 д 4 ч */
export function duration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} мин`;
  const hTotal = Math.floor(m / 60);
  if (hTotal < 24) return `${hTotal} ч ${String(m % 60).padStart(2, '0')} мин`;
  return `${Math.floor(hTotal / 24)} д ${hTotal % 24} ч`;
}

/** Russian plural: plural(5, 'клетка', 'клетки', 'клеток') */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
