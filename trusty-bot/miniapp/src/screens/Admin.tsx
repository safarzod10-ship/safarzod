import { useEffect, useState } from 'react';
import { CATEGORIES, REASONS, type Complaint } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, Field, IconTile, Note, Pill, Section, Seg, Sheet, Top } from '../ui';

const STATUS: Record<Complaint['status'], [string, 'red' | 'amber' | 'green' | undefined]> = {
  new: ['Новая', 'red'], review: ['На рассмотрении', 'amber'], resolved: ['Решена', 'green'], rejected: ['Отклонена', undefined],
};
const reasonLabel = (k: string) => REASONS.find((r) => r.key === k)?.label ?? k;

function ComplaintCell({ c, onClick }: { c: Complaint; onClick(): void }) {
  return (
    <Cell onClick={onClick} chevron clamp
      lead={<IconTile name="flag" tone={c.status === 'new' ? 'red' : c.status === 'review' ? 'amber' : undefined} />}
      title={<span className="t">#{c.id} · {c.againstName}</span>}
      sub={reasonLabel(c.reason)}
      meta={<><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill><span>{c.ago}</span><span>от {c.fromName}</span></>} />
  );
}

type Tab = 'complaints' | 'profiles' | 'users' | 'bans';
let lastTab: Tab = 'complaints';

export default function Admin() {
  const nav = useNav();
  const { complaints, members, profiles, admins, unban, loadAdmin, showToast } = useStore();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => { lastTab = t; setTabState(t); };
  const [q, setQ] = useState('');
  useEffect(() => { loadAdmin().catch(() => {}); }, [loadAdmin]);
  const open = complaints.filter((c) => c.status === 'new' || c.status === 'review');
  const closed = complaints.filter((c) => c.status === 'resolved' || c.status === 'rejected');
  const banned = members.filter((m) => m.ban);
  const users = members.filter((m) => !q || `${m.name} ${m.handle} ${m.id}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="screen no-tabs">
      <Top title="Админ-панель" sub={`Администраторы: ${admins.length} из 2${admins.length ? ' · ' + admins.map((a) => (a.handle ? '@' + a.handle : a.name)).join(', ') : ''}`} />
      <Seg value={tab} onChange={(v) => setTab(v)} items={[
        { key: 'complaints', label: 'Жалобы', count: open.length },
        { key: 'profiles', label: 'Анкеты', count: profiles.length },
        { key: 'users', label: 'Люди' },
        { key: 'bans', label: 'Баны' },
      ]} />

      {tab === 'complaints' && (
        <>
          <Section title={`Открытые · ${open.length}`}>
            {open.length ? <div className="group">{open.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
              : <div className="empty">Открытых жалоб нет.</div>}
          </Section>
          {closed.length > 0 && (
            <Section title="Закрытые">
              <div className="group">{closed.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
            </Section>
          )}
        </>
      )}

      {tab === 'profiles' && (
        <Section title={`На проверке · ${profiles.length}`}>
          {profiles.length ? (
            <div className="group">
              {profiles.map((p) => (
                <Cell key={p.id} avatar lead={<Avatar name={p.name} hue={p.hue} />} chevron onClick={() => nav.push('profile-review', { id: p.id })}
                  title={<span className="t">{p.name}</span>} sub={p.title} meta={<span>{p.stack.slice(0, 4).join(', ')}</span>} />
              ))}
            </div>
          ) : <div className="empty">Новых анкет нет.</div>}
        </Section>
      )}

      {tab === 'users' && (
        <>
          <label className="search mt"><Icon name="search" size={19} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя, @username или id" aria-label="Поиск пользователей" /></label>
          <div className="group mt">
            {users.slice(0, 200).map((m) => (
              <Cell key={m.id} avatar lead={<Avatar name={m.name} hue={m.hue} />} chevron onClick={() => nav.push('member', { id: m.id })}
                title={<span className="t">{m.name}</span>} sub={`${m.handle ? '@' + m.handle + ' · ' : ''}${m.role === 'dev' ? 'разработчик' : 'заказчик'}`}
                trail={m.isAdmin ? <Pill tone="green">Админ</Pill> : m.ban ? <Pill tone="red">Бан</Pill> : m.strikes ? <Pill tone="amber">{m.strikes} наруш.</Pill> : undefined} />
            ))}
            {users.length === 0 && <div className="empty">Никого не нашли.</div>}
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
                  trail={<button className="btn secondary sm" onClick={() => unban(m.id).then(() => showToast('Пользователь разблокирован')).catch(() => {})}>Разбанить</button>} />
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
  const { complaints, members, ban, rejectComplaint, takeComplaint, showToast, loadAdmin } = useStore();
  const [zoom, setZoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!complaints.some((c) => c.id === id)) loadAdmin().catch(() => {}); }, [id, complaints, loadAdmin]);
  const c = complaints.find((x) => x.id === id);
  const m = c && members.find((x) => x.id === c.againstId);
  if (!c || !m) return <div className="screen no-tabs"><Top title="Жалоба" small /><div className="empty">Загружаем жалобу…</div></div>;
  const isOpen = c.status === 'new' || c.status === 'review';
  const repeat = m.strikes >= 1;
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); showToast(typeof r === 'string' ? r : done ?? 'Готово'); } catch {} finally { setBusy(false); }
  };

  return (
    <div className="screen no-tabs">
      <Top title={`Жалоба #${c.id}`} sub={<Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill>} />
      <div className="group">
        <Cell avatar lead={<Avatar name={m.name} hue={m.hue} />} title={m.name} sub={`${m.handle ? '@' + m.handle + ' · ' : ''}нарушений: ${m.strikes}`}
          trail={m.ban ? <Pill tone="red">{m.ban.until ? `бан до ${m.ban.until}` : 'бан навсегда'}</Pill> : undefined}
          chevron onClick={() => nav.push('member', { id: m.id })} />
        <Cell lead={<IconTile name="profile" tone="blue" />} title={`Заявитель: ${c.fromName}`} sub={c.ago} />
        {c.dealId && <Cell lead={<IconTile name="shield" />} title={`Сделка #${c.dealId}`} sub="Переписка сделки сохранена в IT Trusty" />}
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
          {m.isAdmin ? 'Это администратор: заблокировать его нельзя.'
            : repeat ? `У ${m.name} уже есть нарушение. Повторное означает бессрочную блокировку.` : 'Это первое нарушение пользователя: блокировка на 30 дней.'}
        </Note></div>
      )}

      {isOpen && (
        <Actions
          secondary={{ label: c.status === 'new' ? 'Взять в работу' : 'Отклонить', onClick: () => act(
            () => (c.status === 'new' ? takeComplaint(c.id) : rejectComplaint(c.id)), c.status === 'new' ? 'Жалоба взята в работу' : 'Жалоба отклонена') }}
          primary={m.isAdmin ? undefined : { label: repeat ? 'Бан навсегда' : 'Бан на 30 дней', tone: 'danger', disabled: busy, onClick: () => act(() => ban(m.id, c.id)) }} />
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
  const [busy, setBusy] = useState(false);
  const m = members.find((x) => x.id === id);
  if (!m) return <div className="screen no-tabs"><Top title="Пользователь" small /><div className="empty">Пользователь не найден.</div></div>;
  const against = complaints.filter((c) => c.againstId === id);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); showToast(typeof r === 'string' ? r : done); } catch {} finally { setBusy(false); }
  };
  return (
    <div className="screen no-tabs">
      <div className="hero">
        <Avatar name={m.name} hue={m.hue} size={76} />
        <h1>{m.name}</h1>
        <div className="handle">{m.handle ? `@${m.handle} · ` : ''}{m.role === 'dev' ? 'разработчик' : 'заказчик'} · id {m.id}</div>
        <div className="line">
          {m.isAdmin && <Pill tone="green">Администратор</Pill>}
          {m.ban ? <Pill tone="red">{m.ban.until ? `Бан до ${m.ban.until}` : 'Бан навсегда'}</Pill> : <Pill tone="green">Активен</Pill>}
          <Pill tone={m.strikes ? 'amber' : undefined}>Нарушений: {m.strikes}</Pill>
        </div>
      </div>
      <Section title={`Жалобы на пользователя · ${against.length}`}>
        {against.length ? <div className="group">{against.map((c) => <ComplaintCell key={c.id} c={c} onClick={() => nav.push('complaint-admin', { id: c.id })} />)}</div>
          : <div className="text muted small">Жалоб нет.</div>}
      </Section>
      <p className="hint mt">Первое нарушение: бан на 30 дней. Повторное: навсегда.</p>
      {!m.isAdmin && (
        <Actions primary={m.ban
          ? { label: 'Разбанить', disabled: busy, onClick: () => act(() => unban(m.id), 'Пользователь разблокирован') }
          : { label: m.strikes ? 'Бан навсегда' : 'Бан на 30 дней', tone: 'danger', disabled: busy, onClick: () => act(() => ban(m.id), 'Заблокирован') }} />
      )}
    </div>
  );
}

export function ProfileReview({ id }: { id: string }) {
  const nav = useNav();
  const { profiles, moderate, showToast } = useStore();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = profiles.find((x) => x.id === id);
  if (!p) return <div className="screen no-tabs"><Top title="Анкета" small /><div className="empty">Анкета уже проверена.</div></div>;
  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await moderate(id, approve, note.trim() || undefined);
      showToast(approve ? 'Профиль опубликован' : 'Анкета отправлена на доработку');
      nav.pop();
    } catch { setBusy(false); }
  };
  return (
    <div className="screen no-tabs">
      <div className="hero">
        <Avatar name={p.name} hue={p.hue} size={76} />
        <h1>{p.name}</h1>
        <div className="handle">{p.handle ? `@${p.handle} · ` : ''}id {p.id}</div>
      </div>
      <div className="group">
        <Cell title="Направления" sub={p.categories.map((c) => CATEGORIES.find((x) => x.key === c)?.label ?? c).join(', ')} />
        <Cell title="Стек" sub={p.stack.join(', ')} />
        <Cell title="Ставка" sub={`${p.rate} USDT/ч · ${p.status === 'free' ? 'свободен' : 'занят'}`} />
        {p.github && <Cell title="GitHub" sub={`github.com/${p.github}`} />}
        {(p.links ?? []).length > 0 && <Cell title="Работы" sub={(p.links ?? []).join(', ')} />}
      </div>
      <Section title="О себе"><div className="text">{p.about}</div></Section>
      <Sheet open={rejecting} onClose={() => setRejecting(false)} title="Что исправить?">
        <Field label="Комментарий для разработчика" hint="Его увидят в профиле и в сообщении от бота">
          <textarea className="textarea" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Добавьте ссылки на работы" />
        </Field>
        <button className="btn danger mt" disabled={busy} onClick={() => decide(false)}>Отправить на доработку</button>
      </Sheet>
      <Actions secondary={{ label: 'На доработку', onClick: () => setRejecting(true) }}
        primary={{ label: 'Опубликовать', disabled: busy, onClick: () => decide(true) }} />
    </div>
  );
}

export function MyComplaints() {
  const { myComplaints } = useStore();
  return (
    <div className="screen no-tabs">
      <Top title="Мои жалобы" />
      {myComplaints.length ? (
        <div className="group">
          {myComplaints.map((c) => (
            <Cell key={c.id} lead={<IconTile name="flag" tone="red" />} title={`#${c.id} · ${c.againstName}`} sub={c.decision ?? reasonLabel(c.reason)}
              meta={<><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill><span>{c.ago}</span></>} />
          ))}
        </div>
      ) : (
        <div className="empty">Вы ещё не отправляли жалоб. Пожаловаться можно из профиля пользователя или из чата сделки.</div>
      )}
    </div>
  );
}
