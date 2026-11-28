/** «Профиль»: crystals and Telegram Stars, the crystal shop, how the world works. */
import { CRYSTAL_PACKS, CRYSTAL_SHOP, INACTIVITY, LAND, type CrystalPack } from '../../game/config.ts';
import { ERRORS } from '../../game/rules.ts';
import type { Game } from '../context.ts';
import { btn, h, int } from '../dom.ts';
import { RES_SVG, UI_SVG } from '../icons.ts';
import { haptic } from '../tg.ts';
import { row } from './bits.ts';
import type { Screen } from './shell.ts';

export function profileScreen(g: Game): Screen {
  let body: HTMLElement;
  let packs: CrystalPack[] = CRYSTAL_PACKS;
  let crystalsEl: HTMLElement;
  const render = (): void => {
    const c = g.store.city;
    body.replaceChildren();
    const top = h('div', 't-callout', body);
    top.style.display = 'flex';
    top.style.alignItems = 'center';
    top.style.gap = '10px';
    top.innerHTML = RES_SVG.crystals;
    (top.firstChild as SVGElement).style.cssText = 'width:30px;height:30px;color:var(--crystal)';
    const t = h('div', '', top);
    crystalsEl = h('b', '', t, `${int(c?.crystals ?? 0)} кристаллов`);
    crystalsEl.style.fontSize = '18px';
    h('small', '', t, 'Покупаются за Telegram Stars. Нельзя вывести или продать.').style.display = 'block';

    h('div', 't-h', body, 'Пополнить звёздами');
    const grid = h('div', 't-packs', body);
    const bestRatio = Math.max(...packs.map((p) => p.crystals / p.stars));
    for (const p of packs) {
      const b = h('button', `t-pack${p.crystals / p.stars === bestRatio ? ' best' : ''}`, grid);
      b.type = 'button';
      const v = h('b', '', b);
      v.innerHTML = RES_SVG.crystals;
      v.append(int(p.crystals));
      h('small', '', b, p.label);
      h('span', 'stars', b, `${p.stars} ⭐`);
      b.addEventListener('click', () => {
        haptic.tap();
        void g.buyPack(p.id);
      });
    }

    h('div', 't-h', body, 'За кристаллы');
    const ul = h('ul', 't-rows', body);
    const builder = row(ul, 'Ещё один строитель', 'Навсегда, одна стройка сверх лимита', undefined);
    const has = (c?.extraBuilders ?? 0) >= 1;
    const bb = btn(builder, 't-btn sm gold', has ? 'Уже есть' : `${CRYSTAL_SHOP.extraBuilder} 💎`, () => {
      const r = g.store.act({ type: 'builder' }, true);
      if (r.ok) {
        haptic.ok();
        g.shell.toast('Новый строитель приступил к работе');
        render();
      } else g.shell.toast(ERRORS[r.error] ?? r.error, true);
    });
    bb.disabled = has;
    const land = row(ul, 'Земля за кристаллы', `1 💎 = ${LAND.crystalRate} монет цены земли, до ${LAND.crystalCellsPerDay} клеток в день`);
    btn(land, 't-btn sm ghost', 'Выбрать', () => g.startExpand());
    const decor = row(ul, 'Фонтан и памятник', 'Украшения поднимают настроение жителей');
    btn(decor, 't-btn sm ghost', 'В стройку', () => g.openTab('build'));

    h('div', 't-h', body, 'Как устроен мир');
    const rules = h('ul', 't-rows', body);
    row(rules, 'Один континент, 1000 участков', 'У каждого игрока один город на своём участке. Чужую землю купить нельзя.');
    row(rules, 'Город не разрушается', 'Пока вас нет, город копит ресурсы до 12 часов и ждёт.');
    row(
      rules,
      'Брошенные города',
      `Без визитов ${INACTIVITY.daysByTh[0]} дней (ратуша 1–2), ${INACTIVITY.daysByTh[2]} (3–4) или ${INACTIVITY.daysByTh[4]} (5–6) город помечается заброшенным. Вернётесь — он снова ваш. Участок отдают новичку, только когда свободных не осталось. Кристаллы не пропадают.`,
    );
    row(rules, 'Честная игра', 'Всё нужное для развития доступно за монеты. Кристаллы ускоряют и украшают.');

    const tools = h('div', 't-btnrow', body);
    btn(tools, 't-btn ghost sm', `${UI_SVG.info}Показатели`, () => g.togglePerf());
    if (g.store.api.mock) h('p', 't-note', body, 'Демо-режим: данные хранятся только в этом браузере.');
  };
  return {
    title: 'Профиль',
    sub: g.store.user.name ? `Мэр ${g.store.user.name}` : undefined,
    mount(el) {
      body = el;
      render();
      void g.store.api
        .shop()
        .then((r) => {
          packs = r.packs;
          render();
        })
        .catch(() => undefined);
    },
    update() {
      const c = g.store.city;
      if (c && crystalsEl) crystalsEl.textContent = `${int(c.crystals)} кристаллов`;
    },
  };
}
