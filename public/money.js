export const XTR = 'XTR';
export const GRAM = 'GRAM';
export const NANO = 1_000_000_000;

export const STAR_ICON = '<svg class="cur cur-xtr"><use href="#i-star"/></svg>';
export const GRAM_ICON = '<svg class="cur cur-gram"><use href="#i-gram"/></svg>';
export const icon = (cur) => (cur === GRAM ? GRAM_ICON : STAR_ICON);

const intFmt = new Intl.NumberFormat('ru-RU');
const gramFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const fmtStars = (n) => intFmt.format(Math.round(n ?? 0));
export const fmtGram = (nano) => gramFmt.format(Math.floor((nano ?? 0) / 10_000_000) / 100);
export const fmtAmount = (amount, cur) => (cur === GRAM ? fmtGram(amount) : fmtStars(amount));
export const money = (amount, cur) => `<span class="money num">${fmtAmount(amount, cur)}${icon(cur)}</span>`;

export function pot(xtr, gram) {
  const parts = [];
  if (xtr || !gram) parts.push(money(xtr, XTR));
  if (gram) parts.push(money(gram, GRAM));
  return parts.join('<span class="plus">+</span>');
}

export function parseGram(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d{0,9}(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return 0;
  const [i, f = ''] = s.split('.');
  return Number(i || 0) * NANO + Number(f.padEnd(2, '0')) * 10_000_000;
}

export const gramInput = (nano) => (nano / NANO).toFixed(2).replace(/\.?0+$/, '');

export function cleanGramInput(input) {
  let v = input.value.replace(',', '.').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1)
    v =
      v.slice(0, dot + 1) +
      v
        .slice(dot + 1)
        .replace(/\./g, '')
        .slice(0, 2);
  v = v.replace(/^0+(?=\d)/, '');
  if (v !== input.value) input.value = v;
  return parseGram(v);
}

const listeners = new Set();
let current = XTR;
try {
  if (localStorage.getItem('cur') === GRAM) current = GRAM;
} catch {}

export const currency = () => current;
export function setCurrency(cur, { remember = true } = {}) {
  if (cur !== XTR && cur !== GRAM) return;
  if (remember) {
    try {
      localStorage.setItem('cur', cur);
    } catch {}
  }
  if (cur === current) return;
  current = cur;
  listeners.forEach((fn) => fn(cur));
}

export function autoCurrency(stars, gram) {
  let chosen = null;
  try {
    chosen = localStorage.getItem('cur');
  } catch {}
  const has = { XTR: stars > 0, GRAM: gram > 0 };
  if (!chosen) return setCurrency(gram > 0 ? GRAM : XTR, { remember: false });
  if (!has[current] && has[current === GRAM ? XTR : GRAM])
    setCurrency(current === GRAM ? XTR : GRAM, { remember: false });
}
export const onCurrency = (fn) => listeners.add(fn);

export const switchHtml = () =>
  `<div class="cur-switch" role="tablist" aria-label="Валюта">
    <button data-cur="XTR" role="tab">${STAR_ICON}Звёзды</button>
    <button data-cur="GRAM" role="tab">${GRAM_ICON}Gram</button>
  </div>`;

export function syncSwitches(root = document) {
  root.querySelectorAll('.cur-switch button').forEach((b) => {
    const on = b.dataset.cur === current;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
}

export function commentBoc(text) {
  const data = [0, 0, 0, 0, ...new TextEncoder().encode(text)];
  if (data.length > 127) throw new Error('comment too long');
  const cell = [0x00, data.length * 2, ...data];
  const bytes = [0xb5, 0xee, 0x9c, 0x72, 0x01, 0x01, 0x01, 0x01, 0x00, cell.length, 0x00, ...cell];
  return btoa(String.fromCharCode(...bytes));
}
