// IT Trusty Pro for executors: projects arrive in the bot at once and the profile goes first. Paid in Stars or USDT.
import { useState } from 'react';
import { amt } from '../data';
import { Icon, type IconName } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { inTelegram } from '../tg';
import { Actions, Note, Section, Success, Toggle, Top } from '../ui';

const PERKS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'bell', title: 'Новые проекты сразу в бот', text: 'Проект по вашей категории или стеку приходит в Telegram в момент публикации, раньше, чем его увидят в ленте.' },
  { icon: 'crown', title: 'Первые места', text: 'Вы выше всех в каталоге исполнителей и первым в подборке, которую бот присылает заказчику после публикации.' },
  { icon: 'badge', title: 'Значок PRO', text: 'В каталоге, в профиле и на карточке для соцсетей.' },
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
    try { if (await buyPro(method, plan)) setDone(true); } catch { /* toast */ } finally { setBusy(null); }
  };
  const noProfile = role === 'dev' && !me.profile;

  return (
    <div className="screen no-tabs" style={{ paddingBottom: 'calc(170px + var(--safe-b))' }}>
      <Top title="" small />
      <div className="pro-hero">
        <span className="pro-badge big">PRO</span>
        <h1>IT Trusty Pro</h1>
        <p>{info.active ? `Подписка активна до ${info.until}.` : 'Для исполнителей, которые хотят получать заказы первыми.'}</p>
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
            <div className="cell-body"><div className="cell-title">Присылать новые проекты</div><div className="cell-sub">В бот, по вашим категориям и стеку</div></div>
            <Toggle on={info.alerts} onChange={(v) => { setAlerts(v).catch(() => {}); }} label="Присылать новые проекты" />
          </div>
        </div>
      )}
      {noProfile && <div className="mt"><Note tone="amber">Проекты подбираются по анкете: категориям и стеку. Заполните её, чтобы Pro работал.</Note></div>}

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
      <p className="hint center mt-s">Продление добавляет дни к текущему сроку. Автосписаний нет.</p>
      {!inTelegram && <div className="mt-s"><Note tone="amber">Демо в браузере: оплата не списывается. Звёзды и USDT работают в боте.</Note></div>}

      <Actions
        primary={info.stars ? { label: `Оплатить ${p.stars} ★`, onClick: () => buy('stars'), loading: busy === 'stars', disabled: !!busy }
          : info.crypto ? { label: `Оплатить ${amt(p.usdt)} USDT`, onClick: () => buy('crypto'), loading: busy === 'crypto', disabled: !!busy } : undefined}
        secondary={info.stars && info.crypto ? { label: `Или ${amt(p.usdt)} USDT`, onClick: () => buy('crypto'), disabled: !!busy } : undefined}
        link={busy === 'crypto' ? { label: 'Ждём оплату в @CryptoBot…', onClick: () => {} } : undefined} />

      {done && <Success title={info.active ? 'Pro активен' : 'Оплата получена'} text={`Pro до ${info.until ?? '…'}. Новые проекты придут в бот, а профиль уже выше в каталоге.`}
        onDone={() => { setDone(false); nav.pop(); }} />}
    </div>
  );
}
