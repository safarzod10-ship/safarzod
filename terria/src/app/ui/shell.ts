/**
 * The frame of the game UI: treasury strip on top, navigation at the bottom,
 * one bottom sheet at a time, a mode bar for placing / expanding, toasts.
 */
import { RESOURCES, type Res } from '../../game/config.ts';
import { btn, h, num, perHour } from '../dom.ts';
import { NAV_SVG, RES_SVG, UI_SVG } from '../icons.ts';
import { haptic, setBack } from '../tg.ts';

export type Tab = 'map' | 'build' | 'market' | 'city' | 'profile';

export interface Screen {
  title: string;
  sub?: string;
  mount(body: HTMLElement): void;
  /** Live refresh (store changed or a second passed). */
  update?(): void;
  dispose?(): void;
}

export interface TopValues {
  res: Record<Res, number>;
  perHour: Partial<Record<Res, number>>;
  crystals: number;
  pop: number;
  housing: number;
  happiness: number;
  storage: number;
}

export class Shell {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly navBtns = new Map<Tab, HTMLButtonElement>();
  private readonly sheetEl: HTMLElement;
  private readonly sheetTitle: HTMLElement;
  private readonly sheetSub: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private screen: Screen | null = null;
  private readonly modeEl: HTMLElement;
  readonly modeTitle: HTMLElement;
  readonly modeMsg: HTMLElement;
  readonly modeTools: HTMLElement;
  private modeClose: (() => void) | null = null;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  readonly side: HTMLElement;
  readonly guide: HTMLElement;
  readonly plotLabel: HTMLElement;
  private readonly purse: Record<'coins' | 'crystals' | 'pop', { b: HTMLElement; s: HTMLElement }>;
  private readonly stock = new Map<Res, { btn: HTMLButtonElement; v: HTMLElement }>();
  onTab: ((t: Tab) => void) | null = null;
  onTreasury: (() => void) | null = null;
  tab: Tab = 'map';

  constructor(parent: HTMLElement) {
    this.root = h('div', 't-app no-city', parent);
    h('div', 't-crosshair', this.root);
    this.plotLabel = h('div', 't-plotlabel', this.root);

    // treasury strip
    this.top = h('div', 't-top', this.root);
    const purse = h('div', 't-purse', this.top);
    const chip = (cls: string, icon: string): { b: HTMLElement; s: HTMLElement } => {
      const b = btn(purse, cls, icon, () => this.onTreasury?.());
      const v = h('span', 't-val', b);
      return { b: h('b', '', v), s: h('small', '', v) };
    };
    this.purse = {
      coins: chip('t-coins', RES_SVG.coins),
      crystals: chip('t-cry', RES_SVG.crystals),
      pop: chip('t-pop', RES_SVG.pop),
    };
    const stock = h('div', 't-stock', this.top);
    for (const r of RESOURCES) {
      if (r === 'coins') continue;
      const b = btn(stock, '', RES_SVG[r], () => this.onTreasury?.());
      b.title = r;
      this.stock.set(r, { btn: b, v: h('span', '', b) });
    }

    this.guide = h('div', 't-guide', this.root);
    this.guide.hidden = true;

    this.side = h('div', 't-side', this.root);

    // sheet
    this.sheetEl = h('section', 't-sheet', this.root);
    const head = h('div', 't-sheet__head', this.sheetEl);
    const titles = h('div', '', head);
    titles.style.flex = '1';
    this.sheetTitle = h('h2', 't-sheet__title', titles);
    this.sheetSub = h('p', 't-sheet__sub', titles);
    btn(head, 't-x', UI_SVG.close, () => this.closeSheet());
    this.sheetBody = h('div', 't-sheet__body', this.sheetEl);

    // mode bar
    this.modeEl = h('div', 't-mode', this.root);
    const mt = h('div', 't-mode__top', this.modeEl);
    this.modeTitle = h('b', '', mt);
    this.modeTitle.style.flex = '1';
    btn(mt, 't-x', UI_SVG.close, () => this.modeClose?.());
    this.modeMsg = h('div', 't-mode__msg', this.modeEl);
    this.modeTools = h('div', 't-mode__tools', this.modeEl);

    // nav
    const nav = h('nav', 't-nav', this.root);
    const tabs: [Tab, string, string][] = [
      ['map', 'Карта', NAV_SVG.map],
      ['build', 'Стройка', NAV_SVG.build],
      ['market', 'Рынок', NAV_SVG.market],
      ['city', 'Город', NAV_SVG.city],
      ['profile', 'Профиль', NAV_SVG.profile],
    ];
    for (const [id, label, icon] of tabs) {
      const b = btn(nav, '', `${icon}<span>${label}</span>`, () => {
        haptic.select();
        this.onTab?.(id);
      });
      this.navBtns.set(id, b);
    }
    this.setTab('map');

    this.toastEl = h('div', 't-toast', this.root);
    this.toastEl.setAttribute('role', 'status');
  }

  show(): void {
    this.root.classList.add('is-on');
  }

  setTab(t: Tab): void {
    this.tab = t;
    for (const [id, b] of this.navBtns) b.classList.toggle('is-on', id === t);
  }

  setBadge(t: Tab, n: number): void {
    const b = this.navBtns.get(t)!;
    let badge = b.querySelector('.badge') as HTMLElement | null;
    if (!n) {
      badge?.remove();
      return;
    }
    badge ??= h('span', 'badge', b);
    badge.textContent = String(n);
  }

  setTop(v: TopValues): void {
    this.purse.coins.b.textContent = num(v.res.coins);
    const ph = v.perHour.coins ?? 0;
    this.purse.coins.s.textContent = perHour(ph);
    this.purse.coins.s.className = ph >= 0 ? 'up' : 'down';
    this.purse.crystals.b.textContent = num(v.crystals);
    this.purse.crystals.s.textContent = 'кристаллы';
    this.purse.pop.b.textContent = num(v.pop);
    this.purse.pop.s.textContent = `из ${num(v.housing)} · ${Math.round(v.happiness)}%`;
    for (const [r, s] of this.stock) {
      const val = v.res[r];
      s.v.textContent = num(val);
      s.btn.classList.toggle('is-full', val >= v.storage * 0.98);
      s.btn.classList.toggle('is-low', (v.perHour[r] ?? 0) < 0 && val < -(v.perHour[r] ?? 0) * 3);
    }
  }

  // ---------------------------------------------------------- sheet
  openSheet(s: Screen): void {
    this.closeMode();
    this.screen?.dispose?.();
    this.screen = s;
    this.sheetTitle.textContent = s.title;
    this.sheetSub.textContent = s.sub ?? '';
    this.sheetSub.hidden = !s.sub;
    this.sheetBody.replaceChildren();
    this.sheetBody.scrollTop = 0;
    s.mount(this.sheetBody);
    this.sheetEl.classList.add('is-open');
    this.root.classList.add('has-sheet');
    setBack(() => this.closeSheet());
  }

  setSheetTitle(title: string, sub?: string): void {
    this.sheetTitle.textContent = title;
    this.sheetSub.textContent = sub ?? '';
    this.sheetSub.hidden = !sub;
  }

  closeSheet(): void {
    if (!this.screen) return;
    this.screen.dispose?.();
    this.screen = null;
    this.sheetEl.classList.remove('is-open');
    this.root.classList.remove('has-sheet');
    setBack(null);
    if (this.tab !== 'map') this.onTab?.('map');
  }

  get sheetOpen(): boolean {
    return !!this.screen;
  }

  refresh(): void {
    this.screen?.update?.();
  }

  // ---------------------------------------------------------- mode bar
  openMode(title: string, onClose: () => void): void {
    this.screen?.dispose?.();
    this.screen = null;
    this.sheetEl.classList.remove('is-open');
    this.root.classList.remove('has-sheet');
    this.modeTitle.textContent = title;
    this.modeMsg.textContent = '';
    this.modeTools.replaceChildren();
    this.modeClose = onClose;
    this.modeEl.classList.add('is-open');
    this.root.classList.add('has-mode');
    setBack(onClose);
  }

  closeMode(): void {
    if (!this.modeClose) return;
    this.modeClose = null;
    this.modeEl.classList.remove('is-open');
    this.root.classList.remove('has-mode', 'is-placing');
    setBack(null);
  }

  get modeOpen(): boolean {
    return !!this.modeClose;
  }

  // ---------------------------------------------------------- toast
  toast(msg: string, bad = false): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle('bad', bad);
    this.toastEl.classList.add('is-on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-on'), 2600);
    if (bad) haptic.error();
  }
}
