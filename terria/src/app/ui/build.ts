/** «Стройка»: the catalogue of buildings, plus the way into expanding land. */
import { BUILDINGS, type BuildingDef, type BuildingType } from '../../game/config.ts';
import { buildHours, buildingCost, builderCount, busyBuilders, landPrice } from '../../game/rules.ts';

const OUT_LABEL: Record<string, string> = { food: 'продуктов', wood: 'древесины', stone: 'камня', iron: 'железа', goods: 'товаров' };
import { duration, h, int, num } from '../dom.ts';
import { UI_SVG } from '../icons.ts';
import { haptic } from '../tg.ts';
import { thumbnail } from '../city/atlas.ts';
import type { Game } from '../context.ts';
import { costLine } from './bits.ts';
import type { Screen } from './shell.ts';

type Cat = 'all' | BuildingDef['category'];
const CATS: [Cat, string][] = [
  ['all', 'Все'],
  ['living', 'Жильё'],
  ['production', 'Добыча'],
  ['service', 'Услуги'],
  ['decor', 'Украшения'],
];

export function effectText(def: BuildingDef): string {
  if (def.housing) return `${def.housing} жителей`;
  if (def.out) {
    const [r, v] = Object.entries(def.out)[0];
    const name = OUT_LABEL[r] ?? r;
    return `${num(v ?? 0)} ${name}/ч`;
  }
  if (def.shop) return `до ${def.shop} монет/ч`;
  if (def.storage) return `+${num(def.storage)} к складу`;
  if (def.care) return `лечит ${def.care} жителей`;
  if (def.joy) return `+${def.joy} к настроению`;
  return '';
}

export function buildScreen(g: Game): Screen {
  let cat: Cat = 'all';
  let plates: HTMLElement;
  let builders: HTMLElement;
  const render = (): void => {
    const c = g.store.city;
    if (!c) return;
    plates.replaceChildren();
    const m = g.store.mask!;
    // the first plate is always "more land"
    if (cat === 'all') {
      const ex = h('button', 't-plate expand', plates);
      ex.type = 'button';
      ex.innerHTML = UI_SVG.expand;
      const t = h('div', '', ex);
      h('b', '', t, 'Расширить землю');
      h('small', '', t, `${Math.round((c.ownedCount / m.cells) * 1000) / 10}% участка · клетка 16×16 м от ${num(Math.ceil(landPrice(c.ownedCount, m.cells)))} монет`);
      ex.addEventListener('click', () => {
        haptic.tap();
        g.startExpand();
      });
    }
    const types = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => t !== 'townhall' && (cat === 'all' || BUILDINGS[t].category === cat));
    types.sort((a, b) => BUILDINGS[a].th - BUILDINGS[b].th);
    for (const t of types) {
      const d = BUILDINGS[t];
      const locked = c.th < d.th;
      const p = h('button', `t-plate${locked ? ' is-locked' : ''}`, plates);
      p.type = 'button';
      p.appendChild(thumbnail(t, Math.max(1, Math.min(3, c.th)), 92));
      h('b', '', p, d.name);
      h('small', '', p, `${effectText(d)} · ${d.size}×${d.size} клетки`);
      if (locked) {
        h('span', 'lock', p, `Ратуша ${d.th}`);
        p.addEventListener('click', () => g.shell.toast(`Откроется на ратуше ${d.th} уровня`));
        continue;
      }
      const cost = buildingCost(t, 1);
      costLine(p, cost, c, d.crystals);
      if (d.category !== 'decor') h('small', '', p, `Стройка ${duration(buildHours(t, 1) * 3_600_000)}`);
      p.addEventListener('click', () => {
        haptic.tap();
        g.startBuild(t);
      });
    }
    builders.textContent = `Строители: ${busyBuilders(c, g.store.now())} из ${builderCount(c)} заняты`;
  };
  return {
    title: 'Стройка',
    sub: 'Выберите здание и место на своей земле',
    mount(body) {
      const cats = h('div', 't-cats', body);
      for (const [id, label] of CATS) {
        const b = h('button', id === cat ? 'is-on' : '', cats, label);
        b.type = 'button';
        b.addEventListener('click', () => {
          cat = id;
          for (const x of cats.children) x.classList.toggle('is-on', x === b);
          render();
        });
      }
      builders = h('p', 't-note', body);
      plates = h('div', 't-plates', body);
      render();
    },
    update() {
      const c = g.store.city;
      if (c) builders.textContent = `Строители: ${busyBuilders(c, g.store.now())} из ${builderCount(c)} заняты · ${int(c.res.coins)} монет`;
    },
  };
}
