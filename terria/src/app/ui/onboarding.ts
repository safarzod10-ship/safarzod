/**
 * First visit: the continent, the name of the city, the flight to the plot.
 * Also the waiting-list screen when every region is taken.
 */
import { NAME, REFERENCE_REGION_CELLS } from '../../game/config.ts';
import { cleanName } from '../../game/rules.ts';
import { btn, h, int } from '../dom.ts';
import { haptic } from '../tg.ts';

export interface OnboardingHooks {
  /** Create the city; resolves with false when the world is full. */
  found(name: string): Promise<'ok' | 'full' | 'error'>;
  /** Called after the welcome card closes. */
  done(): void;
}

export function showOnboarding(parent: HTMLElement, hooks: OnboardingHooks, suggested: string, freeRegions: number): void {
  const root = h('div', 't-onb', parent);
  const step1 = (): void => {
    root.replaceChildren();
    h('p', 't-onb__mark', root, 'TERRIA');
    h('h1', '', root, 'Континент ждёт своих мэров');
    h(
      'p',
      '',
      root,
      'Здесь 1000 участков, и у каждого будет один хозяин. Вы получите свой: сначала небольшой клочок земли с ратушей, а дальше — сколько сумеете освоить.',
    );
    const facts = h('div', 't-onb__facts', root);
    const f = (v: string, l: string): void => {
      const d = h('div', '', facts);
      h('b', '', d, v);
      h('small', '', d, l);
    };
    f(int(freeRegions), 'свободных участков');
    f(`${Math.round((REFERENCE_REGION_CELLS * 256) / 1e6 * 10) / 10} км²`, 'в среднем на город');
    f('3 мес.', 'до мегаполиса');
    const field = h('label', 't-field', root);
    h('span', '', field, 'Как назовёте город?');
    const input = h('input', 't-input', field);
    input.maxLength = NAME.max;
    input.value = suggested;
    input.placeholder = 'Например, Новый Берег';
    const go = btn(root, 't-btn wide', 'Основать город', () => void found());
    const msg = h('p', '', root);
    msg.style.margin = '8px 0 0';
    msg.style.fontSize = '13px';
    const sync = (): void => {
      go.disabled = !cleanName(input.value);
    };
    input.addEventListener('input', sync);
    sync();
    const found = async (): Promise<void> => {
      const name = cleanName(input.value);
      if (!name) return;
      go.disabled = true;
      go.textContent = 'Ищем свободный участок…';
      haptic.tap();
      const r = await hooks.found(name);
      if (r === 'full') return full();
      if (r === 'error') {
        go.disabled = false;
        go.textContent = 'Основать город';
        msg.textContent = 'Не получилось связаться с сервером. Попробуйте ещё раз.';
        return;
      }
      root.classList.add('is-hidden');
      window.setTimeout(() => welcome(name), 1500);
    };
  };

  const welcome = (name: string): void => {
    root.replaceChildren();
    root.classList.remove('is-hidden');
    root.style.background = 'linear-gradient(180deg, rgba(244,247,243,0) 45%, rgba(244,247,243,0.9) 70%, var(--paper) 86%)';
    h('p', 't-onb__mark is-name', root, name);
    h('h1', '', root, 'Добро пожаловать в TERRIA. Эта земля теперь твоя.');
    h('p', '', root, 'Построй на ней первый город: жильё для людей, лесопилку для древесины, ферму, чтобы всех прокормить.');
    btn(root, 't-btn wide', 'Начать строить', () => {
      haptic.ok();
      root.classList.add('is-hidden');
      window.setTimeout(() => root.remove(), 450);
      hooks.done();
    });
  };

  const full = (): void => {
    root.replaceChildren();
    root.classList.remove('is-hidden');
    h('p', 't-onb__mark', root, 'TERRIA');
    h('h1', '', root, 'Все 1000 участков заняты');
    h(
      'p',
      '',
      root,
      'Сейчас на континенте нет свободной земли. Участки освобождаются, когда мэры надолго бросают свои города. Загляните позже — бот напишет, если вы запускали его.',
    );
    btn(root, 't-btn wide ghost', 'Проверить снова', () => step1());
  };

  step1();
}
