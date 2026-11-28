/** Reusable UI fragments: cost lines, rows, level pips. */
import { RESOURCES, type Res } from '../../game/config.ts';
import type { Cost } from '../../game/rules.ts';
import type { CityState } from '../../game/types.ts';
import { h, int, num } from '../dom.ts';
import { RES_SVG } from '../icons.ts';

/** "🪙 120  🪵 40" with missing amounts in brick red. */
export function costLine(parent: HTMLElement, cost: Cost, city: CityState | null, crystals?: number): HTMLElement {
  const box = h('span', 't-cost', parent);
  for (const r of RESOURCES) {
    const v = cost[r];
    if (!v) continue;
    const s = h('span', city && city.res[r] + 1e-9 < v ? 'miss' : '', box);
    s.innerHTML = RES_SVG[r];
    s.append(num(v));
  }
  if (crystals) {
    const s = h('span', city && city.crystals < crystals ? 'miss' : '', box);
    s.innerHTML = RES_SVG.crystals;
    s.append(int(crystals));
  }
  if (!box.childNodes.length) box.textContent = 'бесплатно';
  return box;
}

export function row(parent: HTMLElement, title: string, sub?: string, end?: string, endSub?: string): HTMLElement {
  const li = h('li', 't-row', parent);
  const main = h('div', 't-row__main', li);
  h('b', '', main, title);
  if (sub) h('small', '', main, sub);
  if (end !== undefined) {
    const e = h('div', 't-row__end', li);
    h('b', '', e, end);
    if (endSub) h('small', '', e, endSub);
  }
  return li;
}

export function levelPips(parent: HTMLElement, lvl: number, max: number, pending: boolean): HTMLElement {
  const box = h('div', 't-levels', parent);
  for (let i = 1; i <= max; i++) h('i', i <= lvl ? 'on' : pending && i === lvl + 1 ? 'next' : '', box);
  return box;
}

export function resIcon(r: Res | 'crystals' | 'pop'): string {
  return RES_SVG[r];
}
