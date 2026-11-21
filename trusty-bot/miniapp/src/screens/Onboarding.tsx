// First run: what IT Trusty is in one line and the role choice. Tips over the real screens explain the rest.
import { useState } from 'react';
import { Icon } from '../icons';
import type { Role } from '../store';
import { haptic } from '../tg';
import { Actions, Mark } from '../ui';

/** the IT Trusty shield, floating gently on the first slide */
function Shield({ size = 120, float }: { size?: number; float?: boolean }) {
  return <span className={float ? 'ob-float' : undefined} style={{ display: 'inline-flex', color: 'var(--ink)' }}><Mark size={size} /></span>;
}

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

/** first launch: one screen with the role choice; the rest is explained by tips over the real screens */
export default function Onboarding({ initialRole, onDone }: { initialRole: Role | null; onDone(r: Role): Promise<void> }) {
  const [role, setRole] = useState<Role | null>(initialRole);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    if (!role || busy) return;
    setBusy(true);
    try { await onDone(role); } catch { setBusy(false); }
  };
  return (
    <div className="ob">
      <section className="ob-slide ob-one">
        <div className="ob-art small"><Shield size={84} float /></div>
        <h1>Сделки с исполнителями через гаранта</h1>
        <p>Договоритесь о цене в чате и оплатите в USDT. Деньги у гаранта, пока работа не принята. Кто вы?</p>
        <RolePicker value={role} onChange={setRole} />
        <p className="hint center" style={{ marginTop: 12 }}>Роль можно сменить в любой момент в профиле.</p>
      </section>
      <Actions primary={{ label: busy ? 'Сохраняем…' : role ? `Начать как ${role === 'client' ? 'заказчик' : 'исполнитель'}` : 'Выберите роль', disabled: !role || busy, onClick: finish }} />
    </div>
  );
}
