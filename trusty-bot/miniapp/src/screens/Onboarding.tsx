// First-run introduction: what IT Trusty is, how a deal works, how fraud is handled, then the role choice.
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import type { Role } from '../store';
import { haptic } from '../tg';
import { Actions, Mark } from '../ui';

/** the IT Trusty shield, floating gently on the first slide */
function Shield({ size = 120, float }: { size?: number; float?: boolean }) {
  return <span className={float ? 'ob-float' : undefined} style={{ display: 'inline-flex', color: 'var(--ink)' }}><Mark size={size} /></span>;
}

function FlowArt() {
  return (
    <div className="ob-flow" aria-hidden="true">
      <div className="ob-node"><span className="ob-who">З</span><small>Заказчик</small></div>
      <div className="ob-line"><i className="ob-move" /></div>
      <div className="ob-node mid"><Shield size={56} /><small>Гарант</small></div>
      <div className="ob-line"><i className="ob-move late" /></div>
      <div className="ob-node"><span className="ob-who dev">И</span><small>Исполнитель</small></div>
    </div>
  );
}

function SafetyArt() {
  return (
    <div className="ob-cards" aria-hidden="true">
      <div className="ob-card c1">
        <b><Icon name="star" size={14} strokeWidth={0} /> 5.0 · сделка #1042</b>
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
  { art: <Shield size={140} float />, title: 'Сделки с разработчиками без риска',
    text: 'Оплата в USDT хранится у гаранта, пока заказчик не примет работу. Исполнитель видит, что деньги внесены, и спокойно работает.' },
  { art: <FlowArt />, title: 'Как проходит сделка',
    text: 'Цену и срок согласуете оффером в чате, можно торговаться. Заказчик вносит USDT, исполнитель сдаёт работу, после приёмки гарант переводит оплату.' },
  { art: <SafetyArt />, title: 'Защита от обмана',
    text: 'Отзывы только по сделкам через IT Trusty, видно, кто недавно был в сети. Споры решает арбитр по переписке, за обман аккаунт блокируют.' },
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
          <div className="ob-art small"><Shield size={72} /></div>
          <h1>Кто вы в IT Trusty?</h1>
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
