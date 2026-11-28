/** «Город»: population, happiness, income, the town hall and its next level. */
import { TOWNHALL } from '../../game/config.ts';
import {
  builderCount,
  busyBuilders,
  canAfford,
  cityLevelLabel,
  cityStats,
  ERRORS,
  townhallCost,
  townhallRequirements,
} from '../../game/rules.ts';
import type { Game } from '../context.ts';
import { btn, dec1, duration, h, int, num, perHour } from '../dom.ts';
import { UI_SVG } from '../icons.ts';
import { haptic } from '../tg.ts';
import { costLine, row } from './bits.ts';
import type { Screen } from './shell.ts';

const HOUR = 3_600_000;

export function cityScreen(g: Game): Screen {
  let body: HTMLElement;
  let lastKey = '';
  const render = (): void => {
    const c = g.store.city;
    const m = g.store.mask;
    if (!c || !m) return;
    body.replaceChildren();
    const s = cityStats(c, m);
    const now = g.store.now();

    const name = h('h3', 't-cityname', body, c.name);
    name.addEventListener('click', () => rename());
    h('p', 't-note', body, `${cityLevelLabel(c.th)} · участок № ${c.regionId + 1} · ${dec1((c.ownedCount / m.cells) * 100)}% земли`);

    const grid = h('div', 't-stats', body);
    const cell = (label: string, value: string, sub?: string): void => {
      const d = h('div', '', grid);
      h('small', '', d, label);
      h('b', '', d, value);
      if (sub) h('small', '', d, sub);
    };
    cell('Жители', int(c.pop), `мест ${int(s.housing)}`);
    cell('Настроение', `${Math.round(s.happiness)}%`, s.happiness >= 70 ? 'город доволен' : s.happiness >= 45 ? 'терпимо' : 'жители недовольны');
    cell('Работают', int(s.workers), `мест ${int(s.jobs)} · ${Math.round(s.efficiency * 100)}%`);
    cell('Строители', `${busyBuilders(c, now)} из ${builderCount(c)}`, 'заняты');

    h('div', 't-h', body, 'Казна в час');
    const ul = h('ul', 't-rows', body);
    row(ul, 'Ратуша', 'базовое финансирование', perHour(s.income.townhall));
    row(ul, 'Налоги', `${int(s.workers)} работающих`, perHour(s.income.taxes));
    row(ul, 'Рынки кварталов', 'покупки жителей', perHour(s.income.shops));
    row(ul, 'Содержание зданий', undefined, perHour(-s.income.upkeep));
    const net = row(ul, 'Итого', 'пока вас нет, город копит до 12 часов', perHour(s.income.net));
    net.style.fontWeight = '650';

    // town hall
    h('div', 't-h', body, `Ратуша · уровень ${c.th} из ${TOWNHALL.maxLevel}`);
    if (c.thUntil > now) {
      h('p', 't-callout', body, `Ратуша растёт до уровня ${c.th + 1}. Осталось ${duration(c.thUntil - now)}.`);
    } else if (c.th >= TOWNHALL.maxLevel) {
      h('p', 't-callout', body, 'Мегаполис. Выше только звёзды.');
    } else {
      h('p', 't-note', body, `Уровень ${c.th + 1} откроет новые здания и улучшения до уровня ${Math.min(5, c.th + 1)}.`);
      const reqs = townhallRequirements(c, m);
      for (const r of reqs) {
        const d = h('div', `t-req ${r.ok ? 'ok' : 'no'}`, body);
        h('span', '', d, r.label);
        h('b', '', d, `${num(r.have)} / ${num(r.need)}`);
      }
      const cost = townhallCost(c.th);
      costLine(body, cost, c);
      const hrs = TOWNHALL.hours[c.th - 1];
      const ok = reqs.every((r) => r.ok) && canAfford(c, cost) && busyBuilders(c, now) < builderCount(c);
      const b = btn(body, 't-btn wide', `${UI_SVG.up}Улучшить ратушу · ${duration(hrs * HOUR)}`, () => {
        const r = g.store.act({ type: 'townhall' }, true);
        if (r.ok) {
          haptic.ok();
          g.shell.toast('Ратуша начала расти');
        } else g.shell.toast(ERRORS[r.error] ?? r.error, true);
        render();
      });
      b.style.marginTop = '10px';
      b.disabled = !ok;
    }

    h('div', 't-h', body, 'Производство в час');
    const prod = h('ul', 't-rows', body);
    const names: [keyof typeof s.prod, string][] = [
      ['food', 'Продукты'],
      ['wood', 'Древесина'],
      ['stone', 'Камень'],
      ['iron', 'Железо'],
      ['goods', 'Товары'],
    ];
    for (const [r, label] of names) {
      const net2 = s.prod[r] - s.use[r];
      if (!s.prod[r] && !s.use[r]) continue;
      row(prod, label, `склад ${num(c.res[r])} из ${num(s.storage)}`, perHour(net2), s.use[r] ? `расход ${dec1(s.use[r])}` : undefined);
    }
  };

  const rename = (): void => {
    const c = g.store.city;
    if (!c) return;
    body.replaceChildren();
    h('div', 't-h', body, 'Новое название');
    const input = h('input', 't-input', body);
    input.value = c.name;
    input.maxLength = 24;
    const rowEl = h('div', 't-btnrow', body);
    btn(rowEl, 't-btn ghost', 'Отмена', () => render());
    btn(rowEl, 't-btn', 'Сохранить', () => {
      const r = g.store.act({ type: 'rename', name: input.value }, true);
      if (!r.ok) g.shell.toast(ERRORS[r.error] ?? r.error, true);
      else render();
    });
    input.focus();
  };

  return {
    title: 'Город',
    sub: 'Нажмите на название, чтобы переименовать',
    mount(el) {
      body = el;
      render();
    },
    update() {
      // re-render only when something visible changed (keeps scroll position)
      const c = g.store.city;
      if (!c || body.querySelector('input')) return;
      const key = `${Math.floor(c.pop)}:${Math.floor(c.res.coins / 10)}:${c.th}:${c.thUntil}:${c.buildings.length}:${Math.floor(g.store.now() / 30000)}`;
      if (key === lastKey) return;
      lastKey = key;
      const y = body.scrollTop;
      render();
      body.scrollTop = y;
    },
  };
}
