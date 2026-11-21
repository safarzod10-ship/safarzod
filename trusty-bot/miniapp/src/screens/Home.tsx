import { useState } from 'react';
import { amt } from '../data';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Avatar, Info, Mark, Seg, Sheet, Top } from '../ui';
import { DealRow, isActive } from './Deal';
import { RolePicker, ROLE_INFO } from './Onboarding';

export default function Home() {
  const nav = useNav();
  const { deals, role, setRole, showToast, me, devForm, payCfg } = useStore();
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [roleSheet, setRoleSheet] = useState(false);
  const active = deals.filter((d) => isActive(d.status));
  const archive = deals.filter((d) => !isActive(d.status));
  const list = tab === 'active' ? active : archive;
  const held = active.filter((d) => d.paidAt).reduce((n, d) => n + Number(d.role === 'dev' ? d.amount : d.total), 0);

  return (
    <div className="screen root">
      <div className="brandbar">
        <span className="mark"><Mark size={24} /></span>
        <button onClick={() => setRoleSheet(true)} aria-label="Сменить роль" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pill">{ROLE_INFO[role].title}</span>
          <Avatar name={me.name} size={36} />
        </button>
      </div>
      <Top title="Сделки" />
      <div className="summary">
        <span><b className="num">{amt(held)} {payCfg.asset}</b> у гаранта</span>
        <Info label="Что значит «у гаранта»">
          Деньги оплаченных сделок заморожены у гаранта, пока заказчик не примет работу. Исполнитель получает сумму сделки,
          комиссию {payCfg.feePercent}% платит заказчик.
        </Info>
      </div>

      {role === 'dev' && !me.profile && (
        <div style={{ marginBottom: 14 }}>
          <button className="note" onClick={() => nav.open('profile', 'dev-form')}>
            <span style={{ display: 'flex' }}><Mark size={18} /></span>
            <div><b style={{ color: 'var(--ink)' }}>{devForm === 'review' ? 'Анкета на проверке' : 'Заполните анкету исполнителя'}</b></div>
          </button>
        </div>
      )}

      <Seg<'active' | 'archive'> value={tab} onChange={setTab} items={[{ key: 'active', label: 'Активные', count: active.length }, { key: 'archive', label: 'Архив', count: archive.length }]} />

      <div className="mt">
        {list.length ? (
          <div className="group stagger" key={tab}>
            {list.map((d) => <DealRow key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}
          </div>
        ) : (
          <div className="empty-cta">
            <b>{tab === 'active' ? 'Активных сделок нет' : 'Архив пуст'}</b>
            {tab === 'active' && (
              <button className="btn primary sm" style={{ marginTop: 4 }} onClick={() => nav.setTab(role === 'client' ? 'devs' : 'projects')}>
                {role === 'client' ? 'Найти исполнителя' : 'Найти проект'}
              </button>
            )}
          </div>
        )}
      </div>

      <Sheet open={roleSheet} onClose={() => setRoleSheet(false)} title="Кто вы сейчас?">
        <RolePicker value={role} onChange={(r) => {
          setRoleSheet(false);
          if (r !== role) setRole(r).then(() => showToast(`Режим: ${ROLE_INFO[r].title.toLowerCase()}`)).catch(() => {});
        }} />

      </Sheet>
    </div>
  );
}
