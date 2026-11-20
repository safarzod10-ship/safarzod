// Admin panel: complaint queue, users, bans. Rule: first violation = 30-day ban, repeated = permanent; unban any time.
import { useState } from 'react';
import { ADMINS, REASONS, type Complaint } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, IconTile, Note, Pill, Section, Seg, Sheet, Top } from '../ui';

const STATUS: Record<Complaint['status'], [string, 'red' | 'amber' | 'green' | undefined]> = {
  new: ['Новая', 'red'], review: ['На рассмотрении', 'amber'], resolved: ['Решена', 'green'], rejected: ['Отклонена', undefined],
};
const reasonLabel = (k: string) => REASONS.find((r) => r.key === k)?.label ?? k;

function ComplaintCell({ c, onClick }: { c: Complaint; onClick(): void }) {
  return (
    <Cell onClick={onClick} chevron clamp
      lead={<IconTile name="flag" tone={c.status === 'new' ? 'red' : c.status === 'review' ? 'amber' : undefined} />}
      title={<><span className="t">#{c.id} · {c.againstName}</span></>}
      sub={reasonLabel(c.reason)}
      meta={<><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill><span>{c.ago}</span><span>от {c.fromName}</span></>} />
  );
}

export default function Admin() {
  const nav = useNav();
  const { complaints, members, unban } = useStore();
  const [tab, setTab] = useState<'complaints' | 'users' | 'bans'>('complaints');
  const [q, setQ] = useState('');
  const open = complaints.filter((c) => c.status === 'new' || c.status === 'review');
  const closed = complaints.filter((c) => c.status === 'resolved' || c.status === 'rejected');
  const banned = members.filter((m) => m.ban);
  const users = members.filter((m) => !q || `${m.name} ${m.handle}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="screen no-tabs">
      <Top title="Админ-панель" sub={`Администраторы: ${ADMINS.length} из 2 · ${ADMINS.map((a) => '@' + a.handle).join(', ')}`} />
      <Seg value={tab} onChange={(v) => setTab(v)} items={[
        { key: 'complaints', label: 'Жалобы', count: open.length },
        { key: 'users', label: 'Люди' },
        { key: 'bans', label: 'Баны' },
      ]} />

      {tab === 'complaints' && (
        <>
          <Section title={`Открытые · ${open.length}`}>
            {open.length ? <div className="group">{open.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
              : <div className="empty">Открытых жалоб нет.</div>}
          </Section>
          <Section title="Закрытые">
            <div className="group">{closed.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
          </Section>
        </>
      )}

      {tab === 'users' && (
        <>
          <label className="search mt"><Icon name="search" size={19} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или @username" aria-label="Поиск пользователей" /></label>
          <div className="group mt">
            {users.map((m) => (
              <Cell key={m.id} avatar lead={<Avatar name={m.name} hue={m.hue} />} chevron onClick={() => nav.push('member', { id: m.id })}
                title={<span className="t">{m.name}</span>} sub={`@${m.handle} · ${m.role === 'dev' ? 'разработчик' : 'заказчик'}`}
                trail={m.ban ? <Pill tone="red">Бан</Pill> : m.strikes ? <Pill tone="amber">{m.strikes} наруш.</Pill> : undefined} />
            ))}
          </div>
        </>
      )}

      {tab === 'bans' && (
        <Section title={`Заблокированы · ${banned.length}`}>
          {banned.length ? (
            <div className="group">
              {banned.map((m) => (
                <Cell key={m.id} avatar lead={<Avatar name={m.name} hue={m.hue} />} title={<span className="t">{m.name}</span>}
                  sub={m.ban!.until ? `до ${m.ban!.until}` : 'навсегда'}
                  trail={<button className="btn secondary sm" onClick={() => unban(m.id)}>Разбанить</button>} />
              ))}
            </div>
          ) : <div className="empty">Заблокированных нет.</div>}
          <p className="hint mt-s">Первое нарушение: бан на 30 дней. Повторное: навсегда. Разбанить можно в любой момент.</p>
        </Section>
      )}
    </div>
  );
}

export function ComplaintAdmin({ id }: { id: number }) {
  const nav = useNav();
  const { complaints, members, ban, rejectComplaint, takeComplaint, showToast } = useStore();
  const [zoom, setZoom] = useState<string | null>(null);
  const c = complaints.find((x) => x.id === id)!;
  const m = members.find((x) => x.id === c.againstId)!;
  const isOpen = c.status === 'new' || c.status === 'review';
  const repeat = m.strikes >= 1;

  return (
    <div className="screen no-tabs">
      <Top title={`Жалоба #${c.id}`} sub={<Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill>} />
      <div className="group">
        <Cell avatar lead={<Avatar name={m.name} hue={m.hue} />} title={m.name} sub={`@${m.handle} · нарушений: ${m.strikes}`}
          trail={m.ban ? <Pill tone="red">{m.ban.until ? `бан до ${m.ban.until}` : 'бан навсегда'}</Pill> : undefined}
          chevron onClick={() => nav.push('member', { id: m.id })} />
        <Cell lead={<IconTile name="profile" tone="blue" />} title={`Заявитель: ${c.fromName}`} sub={c.ago} />
        {c.dealId && <Cell lead={<IconTile name="shield" />} title={`Сделка #${c.dealId}`} sub="Переписка и условия сделки" chevron onClick={() => showToast('Переписка откроется в полной версии')} />}
      </div>

      <Section title="Причина">
        <div className="text"><b>{reasonLabel(c.reason)}</b><div className="mt-s">{c.text}</div></div>
      </Section>

      <Section title={`Доказательства · ${c.evidence.length}`}>
        {c.evidence.length ? (
          <div className="thumbs">
            {c.evidence.map((e, i) => (
              <button className="thumb" key={i} onClick={() => setZoom(e)} aria-label={`Открыть доказательство ${i + 1}`} style={{ width: 120, height: 94 }}>
                <img src={e} alt="" />
              </button>
            ))}
          </div>
        ) : <div className="text muted small">Доказательства не приложены.</div>}
      </Section>

      {c.decision && <div className="mt"><Note tone={c.status === 'resolved' ? 'green' : 'blue'} icon="check">{c.decision}</Note></div>}

      {isOpen && (
        <div className="mt"><Note tone={repeat ? 'red' : 'amber'} icon="ban">
          {repeat ? `У ${m.name} уже есть нарушение. Повторное означает бессрочную блокировку.` : 'Это первое нарушение пользователя: блокировка на 30 дней.'}
        </Note></div>
      )}

      {isOpen && (
        <Actions
          secondary={{ label: c.status === 'new' ? 'Взять в работу' : 'Отклонить', onClick: () => {
            if (c.status === 'new') { takeComplaint(c.id); showToast('Жалоба взята в работу'); } else { rejectComplaint(c.id); showToast('Жалоба отклонена'); }
          } }}
          primary={{ label: repeat ? 'Бан навсегда' : 'Бан на 30 дней', tone: 'danger', onClick: () => showToast(ban(m.id, c.id)) }} />
      )}

      <Sheet open={!!zoom} onClose={() => setZoom(null)}>
        {zoom && <img src={zoom} alt="Доказательство" style={{ width: '100%', borderRadius: 12 }} />}
      </Sheet>
    </div>
  );
}

export function MemberAdmin({ id }: { id: string }) {
  const { members, complaints, ban, unban, showToast } = useStore();
  const nav = useNav();
  const m = members.find((x) => x.id === id)!;
  const against = complaints.filter((c) => c.againstId === id);
  return (
    <div className="screen no-tabs">
      <div className="hero">
        <Avatar name={m.name} hue={m.hue} size={76} />
        <h1>{m.name}</h1>
        <div className="handle">@{m.handle} · {m.role === 'dev' ? 'разработчик' : 'заказчик'}</div>
        <div className="line">
          {m.ban ? <Pill tone="red">{m.ban.until ? `Бан до ${m.ban.until}` : 'Бан навсегда'}</Pill> : <Pill tone="green">Активен</Pill>}
          <Pill tone={m.strikes ? 'amber' : undefined}>Нарушений: {m.strikes}</Pill>
        </div>
      </div>
      <Section title={`Жалобы на пользователя · ${against.length}`}>
        {against.length ? <div className="group">{against.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
          : <div className="text muted small">Жалоб нет.</div>}
      </Section>
      <p className="hint mt">Первое нарушение: бан на 30 дней. Повторное: навсегда.</p>
      <Actions primary={m.ban
        ? { label: 'Разбанить', onClick: () => { unban(m.id); showToast('Пользователь разблокирован'); } }
        : { label: m.strikes ? 'Бан навсегда' : 'Бан на 30 дней', tone: 'danger', onClick: () => showToast(ban(m.id)) }} />
    </div>
  );
}

export function MyComplaints() {
  const { complaints } = useStore();
  const mine = complaints.filter((c) => c.fromName === 'Вы');
  return (
    <div className="screen no-tabs">
      <Top title="Мои жалобы" />
      {mine.length ? (
        <div className="group">
          {mine.map((c) => (
            <Cell key={c.id} lead={<IconTile name="flag" tone="red" />} title={`#${c.id} · ${c.againstName}`} sub={reasonLabel(c.reason)}
              meta={<><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill><span>{c.ago}</span></>} />
          ))}
        </div>
      ) : (
        <div className="empty">Вы ещё не отправляли жалоб. Пожаловаться можно из профиля пользователя или из чата сделки.</div>
      )}
    </div>
  );
}
