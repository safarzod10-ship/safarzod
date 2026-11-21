import { useEffect } from 'react';
import { bidCount, budget, categoryLabel, plural, seen, usdt } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, IconTile, Loader, Note, Pill, ProBadge, Rating, Section, Top, Verified } from '../ui';
import { Matches } from './Extras';

export default function ProjectView({ id }: { id: number }) {
  const nav = useNav();
  const { projects, role, isMe, myBidFor, clientOf, devById, loadProject, me, devForm, live, setRole } = useStore();
  useEffect(() => { loadProject(id); }, [id, loadProject]);
  const p = projects.find((x) => x.id === id);
  if (!p) return <div className="screen no-tabs"><Top title="Проект" small /><Loader label="Загружаем проект" /></div>;
  const c = clientOf(p);
  const own = isMe(p.clientId);
  const myBid = myBidFor(p.id);
  // in the browser demo the example executor profile counts as approved
  const form = live ? devForm : me.profile ? 'published' : devForm;
  const open = p.status === 'open';

  // what the bottom button does for this person: respond, fill the profile, wait for approval or switch role
  let action: { label: string; onClick(): void } | undefined;
  let note: string | null = null;
  if (own) note = null;
  else if (!open) note = 'Исполнитель уже выбран, отклики закрыты.';
  else if (role === 'client') action = { label: 'Откликнуться как исполнитель', onClick: () => { setRole('dev').catch(() => {}); } };
  else if (form === 'published') action = { label: myBid ? 'Изменить отклик' : 'Откликнуться', onClick: () => nav.push('bid', { id: p.id }) };
  else if (form === 'review') note = 'Анкета на проверке. Откликаться можно сразу после одобрения, мы пришлём уведомление в бот.';
  else if (form === 'rejected') { note = 'Анкета не прошла проверку. Исправьте её, чтобы откликаться.'; action = { label: 'Исправить анкету', onClick: () => nav.open('profile', 'dev-form') }; }
  else { note = 'Откликаться могут исполнители с одобренной анкетой. Заполните её: это 4 коротких шага.'; action = { label: 'Заполнить анкету', onClick: () => nav.open('profile', 'dev-form') }; }

  return (
    <div className="screen no-tabs">
      <Top title={p.title} small />
      <div className="summary" style={{ margin: '-6px 0 18px', flexWrap: 'wrap' }}>
        {p.invited && !own && <Pill tone="green"><Icon name="invite" size={13} />Вас пригласили</Pill>}
        <Pill tone={open && !p.invited ? 'green' : undefined}>{open ? 'Приём откликов' : 'В работе'}</Pill>
        <span>{categoryLabel(p.category)} · {p.ago}</span>
      </div>

      <div className="group">
        <Cell title="Бюджет" trail={<b className="num" style={{ color: 'var(--ink)' }}>{budget(p)}</b>} />
        <Cell title="Срок" trail={<b className="num" style={{ color: 'var(--ink)' }}>{p.days} {plural(p.days, 'день', 'дня', 'дней')}</b>} />
        <Cell title="Откликов" trail={<b className="num" style={{ color: 'var(--ink)' }}>{bidCount(p)}</b>} />
      </div>

      <Section title="Задача">
        <div className="text">{p.text}</div>
        {p.stack.length > 0 && <div className="tags mt-s">{p.stack.map((s) => <span className="tag" key={s}>{s}</span>)}</div>}
      </Section>

      {p.files.length > 0 && (
        <Section title="Файлы">
          <div className="group">
            {p.files.map((f) => <Cell key={f.name} lead={<IconTile name="doc" />} title={f.name} sub={f.size} />)}
          </div>
        </Section>
      )}

      {!own && c && (
        <Section title="Заказчик">
          <div className="group">
            <Cell avatar lead={<Avatar name={c.name} online={c.lastSeenMin <= 5} />} title={c.name}
              sub={c.deals ? `${c.rating.toFixed(1)} ★ · ${c.deals} ${plural(c.deals, 'сделка', 'сделки', 'сделок')} через гаранта` : `Новый заказчик · ${seen(c.lastSeenMin)}`}
              trail={c.fastPay ? <Pill tone="green">Платит быстро</Pill> : undefined} />
          </div>
        </Section>
      )}

      {own && (
        <Section title={`Отклики · ${bidCount(p)}`}>
          {p.bids.length ? (
            <div className="group">
              {[...p.bids].sort((a, b) => a.price - b.price).map((b) => {
                const d = devById(b.devId);
                if (!d) return null;
                return (
                  <div className="bid" key={b.devId}>
                    <button className="bid-h" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push('dev', { id: d.id })}>
                      <Avatar name={d.name} size={42} online={d.lastSeenMin <= 5} />
                      <div className="cell-body">
                        <div className="cell-title"><span className="t">{d.name}</span>{d.verified && <Verified />}{d.pro && <ProBadge />}</div>
                        <div className="cell-meta num" style={{ marginTop: 2 }}>
                          {d.deals ? <><Rating value={d.rating} /><span>{d.deals} {plural(d.deals, 'сделка', 'сделки', 'сделок')}</span></> : <span>Новый исполнитель</span>}
                        </div>
                      </div>
                      <Icon name="chevron" size={18} style={{ color: 'var(--faint)' }} />
                    </button>
                    <p>{b.text}</p>
                    <div className="bid-f">
                      <div style={{ flex: 1 }}>
                        <div className="price">{usdt(b.price)}</div>
                        <div className="small muted">{b.days} {plural(b.days, 'день', 'дня', 'дней')} · {b.ago}</div>
                      </div>
                      {open && <button className="btn primary sm" onClick={() => nav.push('choose', { projectId: p.id, devId: d.id })}>Выбрать</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="text muted small">Откликов пока нет. Обычно первые приходят в течение часа.</div>}
        </Section>
      )}

      {own && open && (
        <Section title="Подходящие исполнители">
          <p className="muted small" style={{ margin: '-4px 0 10px' }}>Подобрали по категории и стеку. Приглашённый получит проект в боте.</p>
          <Matches projectId={p.id} invited={p.invitedIds ?? []} />
        </Section>
      )}

      {!own && myBid && <div className="mt"><Note tone="green" icon="check">Ваш отклик: {usdt(myBid.price)}, {myBid.days} дн. Заказчик получил уведомление.</Note></div>}
      {note && <div className="mt"><Note tone="blue" icon={form === 'review' ? 'clock' : 'info'}>{note}</Note></div>}
      {action && <Actions primary={action} />}
    </div>
  );
}
