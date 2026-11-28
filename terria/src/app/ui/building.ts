/** The sheet of one building: what it does, its level, the upgrade, demolition. */
import { BUILDINGS, LEVEL_JOBS, LEVEL_OUT, type BuildingDef } from '../../game/config.ts';
import { buildHours, buildingCost, builderCount, busyBuilders, canAfford, ERRORS, maxBuildingLevel, woodedShare } from '../../game/rules.ts';
import type { Building } from '../../game/types.ts';
import { thumbnail } from '../city/buildingArt.ts';
import type { Game } from '../context.ts';
import { btn, dec1, duration, h, num } from '../dom.ts';
import { UI_SVG } from '../icons.ts';
import { haptic } from '../tg.ts';
import { costLine, levelPips } from './bits.ts';
import type { Screen } from './shell.ts';

const HOUR = 3_600_000;
const OUT_NAME: Record<string, string> = { food: 'Продукты', wood: 'Древесина', stone: 'Камень', iron: 'Железо', goods: 'Товары' };

function effects(d: BuildingDef, lvl: number, forest: number): [string, string][] {
  if (lvl < 1) return [];
  const k = LEVEL_OUT[lvl - 1];
  const out: [string, string][] = [];
  if (d.housing) out.push(['Жители', num(d.housing * k)]);
  if (d.out) for (const [r, v] of Object.entries(d.out)) out.push([`${OUT_NAME[r]}, в час`, dec1((v ?? 0) * k * forest)]);
  if (d.inp) for (const [r, v] of Object.entries(d.inp)) out.push([`Расход: ${OUT_NAME[r].toLowerCase()}`, dec1((v ?? 0) * k)]);
  if (d.jobs) out.push(['Рабочие места', num(d.jobs * LEVEL_JOBS[lvl - 1])]);
  if (d.shop) out.push(['Доход, до', `${num(d.shop * k)}/ч`]);
  if (d.storage) out.push(['Склад', `+${num(d.storage * k)}`]);
  if (d.care) out.push(['Лечит жителей', num(d.care * k)]);
  if (d.joy) out.push(['Настроение', `+${d.joy}`]);
  if (d.upkeep) out.push(['Содержание', `${dec1(d.upkeep * k)}/ч`]);
  return out;
}

export function buildingScreen(g: Game, id: number): Screen {
  let body: HTMLElement;
  let timerBar: HTMLElement | null = null;
  let timerText: HTMLElement | null = null;
  let confirmDemolish = false;
  const find = (): Building | undefined => g.store.city?.buildings.find((b) => b.id === id);

  const render = (): void => {
    const c = g.store.city;
    const b = find();
    body.replaceChildren();
    timerBar = timerText = null;
    if (!c || !b) {
      h('p', 't-note', body, 'Здание снесено.');
      return;
    }
    const d = BUILDINGS[b.t];
    const forest = d.forestBonus && g.store.mask && woodedShare(b, g.store.mask) >= 0.5 ? d.forestBonus : 1;
    g.shell.setSheetTitle(d.name, b.lvl === 0 ? 'Строится' : `Уровень ${b.lvl} из ${d.maxLevel}`);

    const head = h('div', 't-bhead', body);
    head.appendChild(thumbnail(b.t, Math.max(1, b.lvl), 86));
    const info = h('div', '', head);
    h('p', 't-note', info, d.description);
    if (forest > 1) h('p', 't-note', info, 'Стоит в лесу: добыча ×1,6.');
    if (d.maxLevel > 1) levelPips(info, b.lvl, d.maxLevel, b.until > 0);

    const now = g.store.now();
    if (b.until > now) {
      const total = buildHours(b.t, b.lvl + 1) * HOUR;
      h('div', 't-h', body, b.lvl === 0 ? 'Идёт стройка' : `Улучшение до уровня ${b.lvl + 1}`);
      const bar = h('div', 't-progress', body);
      timerBar = h('i', '', bar);
      timerText = h('div', 't-note', body);
      timerBar.style.width = `${Math.round(100 * (1 - (b.until - now) / total))}%`;
      timerText.textContent = `Осталось ${duration(b.until - now)}`;
    }

    const eff = effects(d, Math.max(1, b.lvl), forest);
    const next = b.lvl < d.maxLevel ? effects(d, b.lvl + 1, forest) : [];
    if (eff.length) {
      const grid = h('div', 't-stats', body);
      for (let i = 0; i < eff.length; i++) {
        const cell = h('div', '', grid);
        h('small', '', cell, eff[i][0]);
        const v = h('b', '', cell, eff[i][1]);
        if (next[i] && next[i][1] !== eff[i][1] && b.lvl >= 1) {
          const s = h('small', '', v, ` → ${next[i][1]}`);
          s.style.display = 'inline';
          s.style.color = 'var(--meadow)';
        }
      }
    }

    if (d.maxLevel > 1 && b.lvl >= 1 && !b.until) {
      if (b.lvl >= d.maxLevel) h('p', 't-callout', body, 'Максимальный уровень.');
      else {
        const nextLvl = b.lvl + 1;
        const cost = buildingCost(b.t, nextLvl);
        h('div', 't-h', body, `Улучшение до уровня ${nextLvl} · ${duration(buildHours(b.t, nextLvl) * HOUR)}`);
        costLine(body, cost, c);
        const capped = b.lvl >= maxBuildingLevel(c);
        const noBuilder = busyBuilders(c, now) >= builderCount(c);
        const ok = !capped && !noBuilder && canAfford(c, cost);
        const row = h('div', 't-btnrow', body);
        const up = btn(row, 't-btn', `${UI_SVG.up}Улучшить`, () => {
          const r = g.store.act({ type: 'upgrade', id: b.id }, true);
          if (r.ok) {
            haptic.ok();
            g.shell.toast(`${d.name}: улучшение началось`);
          } else g.shell.toast(ERRORS[r.error] ?? r.error, true);
          render();
        });
        up.disabled = !ok;
        if (capped) h('p', 't-note', body, `Сначала улучшите ратушу до уровня ${b.lvl + 1}.`);
        else if (noBuilder) h('p', 't-note', body, 'Все строители заняты. Дождитесь окончания стройки.');
        else if (!canAfford(c, cost)) {
          const m = h('p', 't-note', body, 'Не хватает ресурсов. Их можно купить ');
          const link = h('a', '', m, 'на рынке');
          link.href = '#';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            g.openTab('market');
          });
          m.append('.');
        }
      }
    }

    if (b.t !== 'townhall') {
      const row = h('div', 't-btnrow', body);
      row.style.justifyContent = 'flex-start';
      const del = btn(row, 't-btn danger sm', `${UI_SVG.trash}${confirmDemolish ? 'Точно снести? Вернётся 20%' : 'Снести'}`, () => {
        if (!confirmDemolish) {
          confirmDemolish = true;
          render();
          return;
        }
        const r = g.store.act({ type: 'demolish', id: b.id }, true);
        if (r.ok) {
          haptic.heavy();
          g.shell.toast(`${d.name} снесено`);
          g.shell.closeSheet();
        }
      });
      del.style.flex = '0 0 auto';
    }
  };

  return {
    title: BUILDINGS[find()?.t ?? 'house'].name,
    mount(el) {
      body = el;
      render();
    },
    update() {
      const b = find();
      if (!b) return render();
      const now = g.store.now();
      if (timerBar && timerText) {
        if (b.until <= now) return render();
        const total = buildHours(b.t, b.lvl + 1) * HOUR;
        timerBar.style.width = `${Math.round(100 * (1 - (b.until - now) / total))}%`;
        timerText.textContent = `Осталось ${duration(b.until - now)}`;
      } else if (b.until > now) render();
    },
  };
}
