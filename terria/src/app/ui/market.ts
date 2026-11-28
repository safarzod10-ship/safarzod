/**
 * «Рынок»: two ways to trade.
 * - По рыночной цене: buy from / sell to the country at the live price.
 * - Биржа: player orders at any price, escrowed, open for 72 hours.
 */
import { GOODS, MARKET, RES_LABEL, type Good } from '../../game/config.ts';
import { partialTotal } from '../../game/market.ts';
import type { MarketResponse, Order, Trade } from '../../game/types.ts';
import type { Game } from '../context.ts';
import { btn, clear, dec, duration, h, int, num, plural, uuid } from '../dom.ts';
import { RES_SVG } from '../icons.ts';
import { haptic } from '../tg.ts';
import type { Screen } from './shell.ts';

type Tab = 'system' | 'exchange';
const GEN: Record<Good, string> = { wood: 'древесины', stone: 'камня', iron: 'железа', food: 'продуктов', goods: 'товаров' };

/** "1,12 за шт." or, for tiny prices, "1 мон. за всё". */
function unitText(o: Order): string {
  const u = o.total / o.qty;
  return u >= 0.01 ? `${dec(u)} за шт.` : `${dec(o.total)} мон. за всё`;
}

export function marketScreen(g: Game, startTab: Tab = 'system'): Screen {
  let tab: Tab = startTab;
  let res: Good = 'wood';
  let info: MarketResponse | null = null;
  let body: HTMLElement;
  let content: HTMLElement;
  let picker: HTMLElement;
  let tabs: HTMLElement;
  let disposed = false;
  let systemSide: 'buy' | 'sell' = 'buy';
  let qty = 0;
  let orderSide: 'buy' | 'sell' = 'buy';
  let book: { buy: Order[]; sell: Order[]; trades: Trade[] } | null = null;
  let fillOrder: Order | null = null;

  const load = async (): Promise<void> => {
    try {
      info = await g.store.api.market();
      if (tab === 'exchange') await loadBook();
    } catch {
      g.shell.toast('Рынок недоступен, проверьте связь', true);
    }
    if (!disposed) render();
  };
  const loadBook = async (): Promise<void> => {
    const [b, s, t] = await Promise.all([g.store.api.orders(res, 'buy'), g.store.api.orders(res, 'sell'), g.store.api.trades(res)]);
    book = { buy: b.orders, sell: s.orders, trades: t.trades };
  };

  const render = (): void => {
    for (const b of tabs.children) b.classList.toggle('is-on', (b as HTMLElement).dataset.tab === tab);
    for (const b of picker.children) b.classList.toggle('is-on', (b as HTMLElement).dataset.res === res);
    clear(content);
    if (!info) {
      h('p', 't-note', content, 'Загружаем цены…');
      return;
    }
    if (tab === 'system') renderSystem();
    else renderExchange();
  };

  // ------------------------------------------------------------ system market
  const renderSystem = (): void => {
    const c = g.store.city!;
    const q = info!.prices[res];
    const grid = h('div', 't-quote', content);
    const a = h('div', '', grid);
    h('small', '', a, 'Купить у страны, за штуку');
    h('b', '', a, dec(q.buy));
    const b = h('div', '', grid);
    h('small', '', b, 'Продать стране, за штуку');
    h('b', '', b, dec(q.sell));

    const seg = h('div', 't-tabs', content);
    for (const [side, label] of [
      ['buy', 'Купить'],
      ['sell', 'Продать'],
    ] as const) {
      const x = btn(seg, side === systemSide ? 'is-on' : '', label, () => {
        systemSide = side;
        qty = 0;
        render();
      });
      x.dataset.side = side;
    }
    const quota = info!.quota[res];
    const max =
      systemSide === 'buy' ? Math.max(0, Math.min(100000, Math.floor(c.res.coins / q.buy))) : Math.max(0, Math.min(Math.floor(c.res[res]), quota));
    qty = Math.min(qty || Math.min(max, 100), max);
    const line = h('div', 't-qty', content);
    const range = h('input', '', line);
    range.type = 'range';
    range.min = '0';
    range.max = String(max);
    range.step = String(max > 2000 ? 10 : 1);
    range.value = String(qty);
    const num1 = h('input', 't-input num', line);
    num1.type = 'number';
    num1.inputMode = 'numeric';
    num1.min = '0';
    num1.max = String(max);
    num1.value = String(qty);
    const total = h('p', 't-note', content);
    const go = btn(content, 't-btn wide', '', () => void trade());
    const sync = (): void => {
      const price = systemSide === 'buy' ? q.buy : q.sell;
      const sum = systemSide === 'buy' ? Math.ceil(price * qty * 100) / 100 : Math.floor(price * qty * 100) / 100;
      total.textContent =
        systemSide === 'buy'
          ? `У вас ${num(c.res[res])} ${GEN[res]}, ${num(c.res.coins)} монет.`
          : `На складе ${num(c.res[res])}. Сегодня стране можно продать ещё ${num(quota)}.`;
      go.textContent = qty > 0 ? `${systemSide === 'buy' ? 'Купить' : 'Продать'} ${int(qty)} ${GEN[res]} за ${dec(sum)} мон.` : 'Выберите количество';
      go.disabled = qty <= 0;
    };
    range.addEventListener('input', () => {
      qty = Number(range.value);
      num1.value = String(qty);
      sync();
    });
    num1.addEventListener('input', () => {
      qty = Math.max(0, Math.min(max, Math.floor(Number(num1.value) || 0)));
      range.value = String(qty);
      sync();
    });
    sync();
    h(
      'p',
      't-note',
      content,
      'Страна всегда купит и продаст, но дороже, чем игроки на бирже. Цена меняется от спроса и сделок между городами.',
    );

    const trade = async (): Promise<void> => {
      go.disabled = true;
      const ok = await g.store.run(() => g.store.api.system(uuid(), systemSide, res, qty));
      if (ok) {
        haptic.ok();
        g.shell.toast(`${systemSide === 'buy' ? 'Куплено' : 'Продано'}: ${int(qty)} ${GEN[res]}`);
        qty = 0;
      }
      await load();
    };
  };

  // ------------------------------------------------------------ exchange
  const renderExchange = (): void => {
    const c = g.store.city!;
    if (c.th < MARKET.exchangeTh) {
      const box = h('div', 't-locked', content);
      h('b', '', box, `Биржа откроется на ратуше ${MARKET.exchangeTh} уровня`);
      box.append('Пока торгуйте со страной по рыночной цене во вкладке рядом.');
      return;
    }
    if (!book) {
      h('p', 't-note', content, 'Загружаем заявки…');
      void loadBook().then(() => !disposed && render());
      return;
    }
    if (fillOrder) renderFill(fillOrder);

    const cols = h('div', 't-book', content);
    const col = (title: string, list: Order[], side: 'buy' | 'sell'): void => {
      const box = h('div', '', cols);
      h('h5', '', box, title);
      if (!list.length) h('p', 't-note', box, 'Заявок нет');
      for (const o of list.slice(0, 12)) {
        const mine = o.regionId === c.regionId;
        const b = h('button', `t-order ${side}${mine ? ' is-mine' : ''}`, box);
        b.type = 'button';
        h('b', '', b, unitText(o));
        h('small', '', b, `${int(o.remaining)} шт · ${mine ? 'ваша' : o.cityName}`);
        h('small', '', b, `ещё ${duration(o.expiresAt - g.store.now())}`);
        b.addEventListener('click', () => {
          if (mine) return g.shell.toast('Это ваша заявка');
          fillOrder = o;
          render();
          body.scrollTop = 0;
        });
      }
    };
    col('Покупают (продайте им)', book.buy, 'buy');
    col('Продают (купите у них)', book.sell, 'sell');

    // new order
    h('div', 't-h', content, 'Новая заявка');
    const seg = h('div', 't-tabs', content);
    for (const [side, label] of [
      ['buy', 'Куплю'],
      ['sell', 'Продам'],
    ] as const)
      btn(seg, side === orderSide ? 'is-on' : '', label, () => {
        orderSide = side;
        render();
      });
    const fr = h('div', 't-field-row', content);
    const f1 = h('label', 't-field', fr);
    h('span', '', f1, `Сколько ${GEN[res]}`);
    const qIn = h('input', 't-input', f1);
    qIn.type = 'number';
    qIn.inputMode = 'numeric';
    qIn.min = '1';
    qIn.placeholder = '5000';
    const f2 = h('label', 't-field', fr);
    h('span', '', f2, 'За всё, монет');
    const tIn = h('input', 't-input', f2);
    tIn.type = 'number';
    tIn.inputMode = 'decimal';
    tIn.min = '1';
    tIn.placeholder = '1';
    const hint = h('p', 't-note', content);
    const place = btn(content, 't-btn wide', 'Разместить на 3 дня', () => void submit());
    const sync = (): void => {
      const q = Math.floor(Number(qIn.value) || 0);
      const t = Math.round((Number(tIn.value) || 0) * 100) / 100;
      const okQ = q > 0 && q <= MARKET.maxOrderQty;
      const okT = t >= 1;
      if (!okQ || !okT) hint.textContent = 'Любая цена от 1 монеты за всю партию. Заявка висит 3 дня, потом закрывается сама.';
      else if (orderSide === 'buy')
        hint.textContent = `${dec(t / q)} за штуку. ${num(t)} монет уйдут в залог и вернутся, если никто не продаст.`;
      else hint.textContent = `${dec(t / q)} за штуку. ${num(q)} ${GEN[res]} уйдут в залог. Комиссия биржи 2% с выручки.`;
      const enough = orderSide === 'buy' ? c.res.coins >= t : c.res[res] >= q;
      place.disabled = !(okQ && okT && enough);
      if (okQ && okT && !enough) hint.textContent = orderSide === 'buy' ? 'Не хватает монет на залог.' : `На складе только ${num(c.res[res])}.`;
    };
    qIn.addEventListener('input', sync);
    tIn.addEventListener('input', sync);
    sync();
    const submit = async (): Promise<void> => {
      place.disabled = true;
      const q = Math.floor(Number(qIn.value));
      const t = Math.round(Number(tIn.value) * 100) / 100;
      const ok = await g.store.run(() => g.store.api.createOrder(uuid(), orderSide, res, q, t));
      if (ok) {
        haptic.ok();
        g.shell.toast('Заявка размещена на 3 дня');
      }
      await load();
    };

    // my orders
    const mine = info!.myOrders;
    h('div', 't-h', content, `Мои заявки · ${mine.length} из ${MARKET.maxOrdersPerCity}`);
    if (!mine.length) h('p', 't-note', content, 'Пока нет. Разместите первую — её увидят все города.');
    const ul = h('ul', 't-rows', content);
    for (const o of mine) {
      const li = h('li', 't-row', ul);
      const m = h('div', 't-row__main', li);
      h('b', '', m, `${o.side === 'buy' ? 'Куплю' : 'Продам'} ${int(o.remaining)} из ${int(o.qty)} ${GEN[o.res]}`);
      h('small', '', m, `${unitText(o)} · ещё ${duration(o.expiresAt - g.store.now())}`);
      btn(li, 't-btn ghost sm', 'Отменить', async () => {
        const ok = await g.store.run(() => g.store.api.cancel(uuid(), o.id));
        if (ok) g.shell.toast('Заявка отменена, залог вернулся');
        await load();
      });
    }

    if (book.trades.length) {
      h('div', 't-h', content, 'Последние сделки');
      const tl = h('ul', 't-rows', content);
      for (const t of book.trades.slice(0, 8)) {
        const li = h('li', 't-row', tl);
        const m = h('div', 't-row__main', li);
        h('b', '', m, `${int(t.qty)} ${GEN[t.res]}`);
        h('small', '', m, t.kind === 'system' ? 'со страной' : 'между городами');
        const e = h('div', 't-row__end', li);
        h('b', '', e, dec(t.unit));
        h('small', '', e, `${duration(g.store.now() - t.at)} назад`);
      }
    }
  };

  const renderFill = (o: Order): void => {
    const c = g.store.city!;
    const box = h('div', 't-callout', content);
    const youSell = o.side === 'buy';
    const unit = o.total / o.qty;
    const max = youSell ? Math.min(o.remaining, Math.floor(c.res[o.res])) : Math.min(o.remaining, Math.floor(c.res.coins / Math.max(unit, 1e-9)));
    h('b', '', box, `${youSell ? 'Продать' : 'Купить'} ${GEN[o.res]} · ${o.cityName}`);
    h('p', 't-note', box, `${unitText(o)} Доступно ${int(o.remaining)}.`);
    if (max <= 0) {
      h('p', 't-note', box, youSell ? `У вас нет ${GEN[o.res]} для этой сделки.` : 'Не хватает монет.');
      btn(box, 't-btn ghost sm', 'Закрыть', () => {
        fillOrder = null;
        render();
      });
      return;
    }
    let k = max;
    const line = h('div', 't-qty', box);
    const range = h('input', '', line);
    range.type = 'range';
    range.min = '1';
    range.max = String(max);
    range.value = String(k);
    const val = h('b', '', line);
    const res2 = h('p', 't-note', box);
    const rowEl = h('div', 't-btnrow', box);
    btn(rowEl, 't-btn ghost', 'Отмена', () => {
      fillOrder = null;
      render();
    });
    const go = btn(rowEl, 't-btn', youSell ? 'Продать' : 'Купить', async () => {
      go.disabled = true;
      const ok = await g.store.run(() => g.store.api.fill(uuid(), o.id, k));
      if (ok) {
        haptic.ok();
        g.shell.toast('Сделка заключена');
      }
      fillOrder = null;
      book = null;
      await load();
    });
    const sync = (): void => {
      val.textContent = `${int(k)} ${plural(k, 'шт', 'шт', 'шт')}`;
      const coins = partialTotal(o.total, o.qty, k);
      res2.textContent = youSell
        ? `Получите ${dec(coins * (1 - MARKET.fee))} монет (комиссия 2%).`
        : `Заплатите ${dec(coins)} монет.`;
    };
    range.addEventListener('input', () => {
      k = Number(range.value);
      sync();
    });
    sync();
  };

  return {
    title: 'Рынок',
    sub: 'Торговля со страной и с другими городами',
    mount(el) {
      body = el;
      tabs = h('div', 't-tabs', el);
      for (const [id, label] of [
        ['system', 'По рыночной цене'],
        ['exchange', 'Биржа'],
      ] as const) {
        const b = btn(tabs, '', label, () => {
          tab = id;
          fillOrder = null;
          render();
          if (id === 'exchange' && !book) void loadBook().then(() => !disposed && render());
        });
        b.dataset.tab = id;
      }
      picker = h('div', 't-respick', el);
      for (const r of GOODS) {
        const b = btn(picker, '', `${RES_SVG[r]}<span>${RES_LABEL[r]}</span>`, () => {
          res = r;
          qty = 0;
          fillOrder = null;
          book = null;
          haptic.select();
          render();
          if (tab === 'exchange') void loadBook().then(() => !disposed && render());
        });
        b.dataset.res = r;
      }
      content = h('div', '', el);
      render();
      void load();
    },
    dispose() {
      disposed = true;
    },
  };
}
