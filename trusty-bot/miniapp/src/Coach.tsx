import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Role } from './store';
import { haptic } from './tg';

type Step = { target: string; title: string; text: string };

const STEPS: Record<Role, Step[]> = {
  client: [
    { target: '.summary', title: 'Сделки', text: 'Деньги у гаранта, пока вы не примете работу.' },
    { target: '.island [aria-label="Исполнители"]', title: 'Исполнители', text: 'Отзывы, уровни и портфолио.' },
    { target: '.fab', title: 'Новый проект', text: 'Опубликуйте задачу и получите отклики.' },
    { target: '.island [aria-label="Чаты"]', title: 'Чаты', text: 'Цену и срок предлагайте оффером.' },
    { target: '.island [aria-label="Профиль"]', title: 'Профиль', text: 'Проекты, сделки и смена роли.' },
  ],
  dev: [
    { target: '.summary', title: 'Сделки', text: 'Деньги придут после приёмки работы.' },
    { target: '.island [aria-label="Проекты"]', title: 'Проекты', text: 'Откликайтесь своей ценой.' },
    { target: '.island [aria-label="Чаты"]', title: 'Чаты', text: 'Офферы от заказчиков и сдача работы.' },
    { target: '.island [aria-label="Профиль"]', title: 'Профиль', text: 'Анкета, портфолио, уровень и Pro.' },
  ],
};

const KEY = (r: Role) => `trusty.tips.${r}`;
export function tipsSeen(r: Role): boolean {
  try { return localStorage.getItem(KEY(r)) === '1'; } catch { return true; }
}
function markSeen(r: Role) {
  try { localStorage.setItem(KEY(r), '1'); } catch {}
}
export function replayTips(r: Role) {
  try { localStorage.removeItem(KEY(r)); } catch {}
  window.dispatchEvent(new Event('trusty:tips'));
}

export default function Coach({ role, onClose }: { role: Role; onClose(): void }) {
  const steps = STEPS[role];
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = document.querySelector(step.target);
    setBox(el ? el.getBoundingClientRect() : null);
  }, [step.target]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const t = window.setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [measure]);

  const close = () => { markSeen(role); onClose(); };
  const next = () => { haptic.select(); if (i < steps.length - 1) setI(i + 1); else close(); };

  const pad = 8;
  const hole = box && { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
  const below = !box || box.top + box.height / 2 < window.innerHeight / 2;
  const cardPos = !hole ? { top: '38%' } : below ? { top: hole.top + hole.height + 14 } : { bottom: window.innerHeight - hole.top + 14 };

  return (
    <div className="coach" role="dialog" aria-label="Подсказки" onClick={next}>
      <div className="coach-hole" style={hole ?? { top: '50%', left: '50%', width: 0, height: 0 }} />
      <div className="coach-card" style={cardPos} onClick={(e) => e.stopPropagation()}>
        <h4>{step.title}</h4>
        <p>{step.text}</p>
        <div className="foot">
          <div className="dots" aria-hidden="true">{steps.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
          {i < steps.length - 1 && <button className="bar-link" style={{ margin: 0, padding: '0 6px' }} onClick={close}>Пропустить</button>}
          <button className="btn primary sm" onClick={next}>{i < steps.length - 1 ? 'Далее' : 'Понятно'}</button>
        </div>
      </div>
    </div>
  );
}
