/** Small sheets: the treasury breakdown and another player's city. */
import { GOODS, RES_LABEL } from '../../game/config.ts';
import { cityLevelLabel, cityStats } from '../../game/rules.ts';
import type { WorldCitySummary } from '../../game/types.ts';
import type { Game } from '../context.ts';
import { btn, dec1, h, int, num, perHour } from '../dom.ts';
import { row } from './bits.ts';
import type { Screen } from './shell.ts';

export function treasuryScreen(g: Game): Screen {
  let body: HTMLElement;
  const render = (): void => {
    const c = g.store.city;
    if (!c) return;
    const s = cityStats(c, g.store.mask);
    body.replaceChildren();
    const ul = h('ul', 't-rows', body);
    row(ul, 'Монеты', `налоги, рынки, ратуша минус содержание`, perHour(s.income.net), num(c.res.coins));
    row(ul, 'Кристаллы', 'за Telegram Stars в профиле', '', int(c.crystals));
    row(ul, 'Жители', `мест ${int(s.housing)} · настроение ${Math.round(s.happiness)}%`, '', int(c.pop));
    for (const r of GOODS) {
      const net = s.prod[r] - s.use[r];
      row(ul, RES_LABEL[r], `склад ${num(s.storage)}${c.res[r] >= s.storage ? ' · полон, добыча стоит' : ''}`, perHour(net), num(c.res[r]));
    }
    h('p', 't-note', body, 'Склад ограничивает только добычу: купленное на рынке поместится всегда. Пока вас нет, город работает до 12 часов.');
    const r2 = h('div', 't-btnrow', body);
    btn(r2, 't-btn ghost', 'Город', () => g.openTab('city'));
    btn(r2, 't-btn', 'Рынок', () => g.openTab('market'));
  };
  return {
    title: 'Казна и склад',
    sub: 'Сколько есть и сколько прибавляется в час',
    mount(el) {
      body = el;
      render();
    },
    update: () => render(),
  };
}

export function otherCityScreen(g: Game, c: WorldCitySummary, onShow: () => void): Screen {
  return {
    title: c.n,
    sub: `${cityLevelLabel(c.th)} · участок № ${c.r + 1}`,
    mount(el) {
      const grid = h('div', 't-stats', el);
      const cell = (l: string, v: string): void => {
        const d = h('div', '', grid);
        h('small', '', d, l);
        h('b', '', d, v);
      };
      cell('Жители', int(c.pop));
      cell('Ратуша', `уровень ${c.th}`);
      if (c.s === 'abandoned')
        h('p', 't-callout warn', el, 'Мэр давно не заходил. Если свободных участков не останется, эту землю отдадут новичку.');
      else h('p', 't-note', el, `Торговать с этим городом можно на бирже: его заявки видны всем.`);
      const r = h('div', 't-btnrow', el);
      btn(r, 't-btn ghost', 'Показать на карте', () => {
        g.shell.closeSheet();
        onShow();
      });
      btn(r, 't-btn', 'Биржа', () => g.openTab('market'));
      void dec1;
    },
  };
}
