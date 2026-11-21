import { useState } from 'react';
import { amt } from '../data';
import { Icon, type IconName } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { inTelegram } from '../tg';
import { Actions, Note, Section, Success, Toggle, Top } from '../ui';

const PERKS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'bell', title: 'Новые проекты сразу в бот', text: 'По вашему стеку, в момент публикации' },
  { icon: 'crown', title: 'Первые места', text: 'В каталоге и подборках для заказчиков' },
  { icon: 'badge', title: 'Значок PRO', text: 'В каталоге и профиле' },
];

export default function Pro() {
  const nav = useNav();
  const { proInfo: info, buyPro, setAlerts, me, role } = useStore();
  const [plan, setPlan] = useState<'1m' | '3m'>('1m');
  const [busy, setBusy] = useState<null | 'stars' | 'crypto'>(null);
  const [done, setDone] = useState(false);
  const p = info.plans.find((x) => x.key === plan) ?? info.plans[0];
  const buy = async (method: 'stars' | 'crypto') => {
    if (busy) return;
    setBusy(method);
    try { if (await buyPro(method, plan)) setDone(true); } catch {} finally { setBusy(null); }
  };
  const noProfile = role === 'dev' && !me.profile;

  return (
    <div className="screen no-tabs" style={{ paddingBottom: 'calc(170px + var(--safe-b))' }}>
      <Top title="" small />
      <div className="pro-hero">
        <span className="pro-badge big">PRO</span>
        <h1>IT Trusty Pro</h1>
        {info.active && <p>До {info.until}</p>}
      </div>

      <div className="group">
        {PERKS.map((x) => (
          <div className="cell" key={x.title} style={{ alignItems: 'flex-start' }}>
            <span className="ic" style={{ paddingTop: 1 }}><Icon name={x.icon} size={22} /></span>
            <div className="cell-body"><div className="cell-title">{x.title}</div><div className="cell-sub clamp-none">{x.text}</div></div>
          </div>
        ))}
      </div>

      {info.active && (
        <div className="group mt">
          <div className="cell">
            <div className="cell-body"><div className="cell-title">Присылать новые проекты</div></div>
            <Toggle on={info.alerts} onChange={(v) => { setAlerts(v).catch(() => {}); }} label="Присылать новые проекты" />
          </div>
        </div>
      )}
      {noProfile && <div className="mt"><Note tone="amber">Заполните анкету: проекты подбираются по ней.</Note></div>}

      <Section title={info.active ? 'Продлить' : 'Тариф'}>
      <div className="plans" role="radiogroup" aria-label="Тариф">
        {info.plans.map((x) => (
          <button key={x.key} role="radio" aria-checked={plan === x.key} className={`plan ${plan === x.key ? 'on' : ''}`} onClick={() => setPlan(x.key)}>
            {x.discount > 0 && <span className="tag2">−{x.discount}%</span>}
            <span className="t">{x.key === '3m' ? '3 месяца' : '1 месяц'}</span>
            <span className="p num"><b>{x.stars}</b><Icon name="star" size={18} strokeWidth={0} /></span>
            <span className="s num">или {amt(x.usdt)} USDT · {x.days} дн.</span>
          </button>
        ))}
      </div>
      </Section>
      <p className="hint center mt-s">Без автосписаний</p>
      {!inTelegram && <div className="mt-s"><Note tone="amber">Демо: оплата не списывается.</Note></div>}

      <Actions
        primary={info.stars ? { label: `Оплатить ${p.stars} ★`, onClick: () => buy('stars'), loading: busy === 'stars', disabled: !!busy }
          : info.crypto ? { label: `Оплатить ${amt(p.usdt)} USDT`, onClick: () => buy('crypto'), loading: busy === 'crypto', disabled: !!busy } : undefined}
        secondary={info.stars && info.crypto ? { label: `Или ${amt(p.usdt)} USDT`, onClick: () => buy('crypto'), disabled: !!busy } : undefined}
        link={busy === 'crypto' ? { label: 'Ждём оплату в @CryptoBot…', onClick: () => {} } : undefined} />

      {done && <Success title={info.active ? 'Pro активен' : 'Оплата получена'} text={`До ${info.until ?? '…'}`}
        onDone={() => { setDone(false); nav.pop(); }} />}
    </div>
  );
}
