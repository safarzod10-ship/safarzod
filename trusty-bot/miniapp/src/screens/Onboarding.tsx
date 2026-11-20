// First-run introduction: what Trusty is, how a deal works, how fraud is handled, then the role choice.
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import type { Role } from '../store';
import { haptic } from '../tg';
import { Actions } from '../ui';

/** the logo mark, drawn inline so slides do not depend on image files */
export function Mark({ size = 120, float }: { size?: number; float?: boolean }) {
  const half = 'M43.5 15L27.5 20.6Q22 22.6 22 28.4V58C22 70 30.8 79.4 43.5 85.5';
  const nib = 'M19.75 40.92H18.25C18.25 45.17 17.25 46.08 15.58 46.29A1.71 1.71 0 0 0 15.58 49.71C17.25 49.92 18.25 50.83 18.25 55.08H19.75Z';
  return (
    <svg viewBox="8 6 84 88" width={size} height={size} className={float ? 'ob-float' : undefined} aria-hidden="true">
      {[false, true].map((m) => (
        <g key={String(m)} transform={m ? 'matrix(-1 0 0 1 100 0)' : undefined}>
          <path d={half} fill="none" stroke="var(--ink)" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={nib} fill="var(--ink)" />
        </g>
      ))}
      <g transform="translate(50 48)">
        <g className="ob-coin">
          <circle r="14.5" fill="#26A17B" />
          <path d="M-7.6 -8.1H7.6V-4.9H2.1V8.6H-2.1V-4.9H-7.6Z" fill="#fff" />
          <ellipse cy="-1.15" rx="8.8" ry="2.6" fill="none" stroke="#fff" strokeWidth="1.6" />
        </g>
      </g>
    </svg>
  );
}

function FlowArt() {
  return (
    <div className="ob-flow" aria-hidden="true">
      <div className="ob-node"><span className="ob-who">З</span><small>Заказчик</small></div>
      <div className="ob-line"><i className="ob-move" /></div>
      <div className="ob-node mid"><Mark size={64} /><small>Trusty</small></div>
      <div className="ob-line"><i className="ob-move late" /></div>
      <div className="ob-node"><span className="ob-who dev">И</span><small>Исполнитель</small></div>
    </div>
  );
}

function SafetyArt() {
  return (
    <div className="ob-cards" aria-hidden="true">
      <div className="ob-card c1">
        <b><span className="ob-star">★</span> 5,0 · сделка #1042</b>
        <span>«Сделал за 5 дней вместо 7»</span>
      </div>
      <div className="ob-card c2">
        <b><i className="ob-dot" /> Тимур · в сети</b>
        <span>отвечает примерно за 15 минут</span>
      </div>
      <div className="ob-card c3">
        <b><Icon name="ban" size={15} /> «Напиши мне в лс»</b>
        <span>предупреждение и жалоба арбитру</span>
      </div>
    </div>
  );
}

const SLIDES: { art: ReactNode; title: string; text: string }[] = [
  { art: <Mark size={150} float />, title: 'Сделки с разработчиками без риска',
    text: 'Оплата в USDT хранится у гаранта, пока заказчик не примет работу. Исполнитель видит, что деньги внесены, и спокойно работает.' },
  { art: <FlowArt />, title: 'Как проходит сделка',
    text: 'Условия и ТЗ фиксируются. Заказчик вносит USDT, исполнитель сдаёт работу в чате сделки, после приёмки гарант переводит оплату.' },
  { art: <SafetyArt />, title: 'Защита от обмана',
    text: 'Отзывы только по сделкам через Trusty, видно, кто недавно был в сети. Споры решает арбитр по переписке, за обман аккаунт блокируют.' },
];

export const ROLE_INFO: Record<Role, { title: string; text: string; icon: 'projects' | 'devs' }> = {
  client: { title: 'Заказчик', text: 'Ищу исполнителя, публикую проекты и плачу через гаранта', icon: 'projects' },
  dev: { title: 'Исполнитель', text: 'Беру проекты, откликаюсь и получаю оплату после приёмки', icon: 'devs' },
};

export function RolePicker({ value, onChange }: { value: Role | null; onChange(r: Role): void }) {
  return (
    <div className="roles" role="radiogroup" aria-label="Роль">
      {(['client', 'dev'] as Role[]).map((r) => (
        <button key={r} role="radio" aria-checked={value === r} className={`role ${value === r ? 'on' : ''}`}
          onClick={() => { haptic.select(); onChange(r); }}>
          <span className="ic"><Icon name={ROLE_INFO[r].icon} size={20} /></span>
          <span className="role-t"><b>{ROLE_INFO[r].title}</b><span>{ROLE_INFO[r].text}</span></span>
          <i className="role-check">{value === r && <Icon name="check" size={16} strokeWidth={2.6} />}</i>
        </button>
      ))}
    </div>
  );
}

export default function Onboarding({ initialRole, onDone }: { initialRole: Role | null; onDone(r: Role): Promise<void> }) {
  const [i, setI] = useState(0);
  const [role, setRole] = useState<Role | null>(initialRole);
  const [busy, setBusy] = useState(false);
  const touch = useRef<number | null>(null);
  const last = SLIDES.length; // index of the role step
  const go = (n: number) => { const v = Math.max(0, Math.min(last, n)); if (v !== i) { haptic.select(); setI(v); } };

  const finish = async () => {
    if (!role || busy) return;
    setBusy(true);
    try { await onDone(role); } catch { setBusy(false); }
  };

  return (
    <div className="ob" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
        touch.current = null;
      }}>
      <div className="ob-top">
        <div className="ob-dots" aria-hidden="true">{[...SLIDES, null].map((_, n) => <i key={n} className={n === i ? 'on' : n < i ? 'past' : ''} />)}</div>
        {i < last && <button className="ob-skip" onClick={() => go(last)}>Пропустить</button>}
      </div>
      <div className="ob-track" style={{ transform: `translateX(${-i * 100}%)` }}>
        {SLIDES.map((s, n) => (
          <section key={s.title} className="ob-slide" aria-hidden={n !== i}>
            <div className="ob-art">{n === i || Math.abs(n - i) === 1 ? s.art : null}</div>
            <h1>{s.title}</h1>
            <p>{s.text}</p>
          </section>
        ))}
        <section className="ob-slide" aria-hidden={i !== last}>
          <div className="ob-art small"><Mark size={84} /></div>
          <h1>Кто вы в Trusty?</h1>
          <p>От роли зависит главный экран. Сменить её можно в любой момент: на главной или в профиле.</p>
          <RolePicker value={role} onChange={setRole} />
        </section>
      </div>
      <Actions
        secondary={i > 0 && i < last ? { label: 'Назад', onClick: () => go(i - 1) } : undefined}
        primary={i < last
          ? { label: 'Дальше', onClick: () => go(i + 1) }
          : { label: busy ? 'Сохраняем…' : role ? `Начать как ${role === 'client' ? 'заказчик' : 'исполнитель'}` : 'Выберите роль', disabled: !role || busy, onClick: finish }} />
    </div>
  );
}
