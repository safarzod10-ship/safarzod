import { CLIENTS, DEVS, budget, categoryLabel, plural, seen, usdt } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, IconTile, Note, Pill, Rating, Section, Top, Verified } from '../ui';

export default function ProjectView({ id }: { id: number }) {
  const nav = useNav();
  const { projects, role, myBids } = useStore();
  const p = projects.find((x) => x.id === id)!;
  const c = CLIENTS.find((x) => x.id === p.clientId)!;
  const own = p.clientId === 'me';
  const myBid = myBids.find((b) => b.projectId === p.id);

  return (
    <div className="screen no-tabs">
      <Top title={p.title} small sub={<span style={{ display: 'inline-flex', gap: 6, marginTop: 4 }}>
        <Pill tone={p.status === 'open' ? 'green' : 'blue'}>{p.status === 'open' ? 'Приём откликов' : 'В работе'}</Pill>
        <Pill>{categoryLabel(p.category)}</Pill>
      </span>} />

      <div className="facts">
        <div className="fact"><span>Бюджет</span><b>{budget(p)}</b></div>
        <div className="fact"><span>Срок</span><b>{p.days} {plural(p.days, 'день', 'дня', 'дней')}</b></div>
        <div className="fact"><span>Отклики</span><b>{p.bids.length}</b></div>
        <div className="fact"><span>Опубликован</span><b>{p.ago}</b></div>
      </div>

      <Section title="Задача">
        <div className="text">{p.text}</div>
        <div className="tags mt-s">{p.stack.map((s) => <span className="tag" key={s}>{s}</span>)}</div>
      </Section>

      {p.files.length > 0 && (
        <Section title="Файлы">
          <div className="group">
            {p.files.map((f) => <Cell key={f.name} lead={<IconTile name="doc" tone="blue" />} title={f.name} sub={f.size} />)}
          </div>
        </Section>
      )}

      {!own && (
        <Section title="Заказчик">
          <div className="group">
            <Cell avatar lead={<Avatar name={c.name} hue={c.hue} online={c.lastSeenMin <= 5} />} title={c.name}
              sub={<>★ {c.rating.toFixed(1).replace('.', ',')} · {c.deals} {plural(c.deals, 'сделка', 'сделки', 'сделок')} как заказчик</>}
              meta={seen(c.lastSeenMin)} />
          </div>
        </Section>
      )}

      {own && (
        <Section title={`Отклики · ${p.bids.length}`}>
          {p.bids.length ? (
            <div className="group">
              {[...p.bids].sort((a, b) => a.price - b.price).map((b) => {
                const d = DEVS.find((x) => x.id === b.devId)!;
                return (
                  <div className="bid" key={b.devId}>
                    <button className="bid-h" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push('dev', { id: d.id })}>
                      <Avatar name={d.name} hue={d.hue} size={42} online={d.lastSeenMin <= 5} />
                      <div className="cell-body">
                        <div className="cell-title"><span className="t">{d.name}</span>{d.verified && <Verified />}</div>
                        <div className="cell-meta num" style={{ marginTop: 2 }}>
                          {d.deals ? <><Rating value={d.rating} size={13} /><span>{d.deals} сделок</span><span>в срок {d.onTime}%</span></>
                            : <Pill tone="blue">Новый</Pill>}
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
                      {p.status === 'open' && (
                        <button className="btn primary sm" onClick={() => nav.push('choose', { projectId: p.id, devId: d.id })}>Выбрать</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="text muted small">Откликов пока нет. Обычно первые приходят в течение часа.</div>}
        </Section>
      )}

      {!own && role === 'client' && (
        <Note tone="blue" icon="info">Откликаться на проекты могут разработчики. Переключите роль в профиле, чтобы посмотреть, как это выглядит.</Note>
      )}
      {!own && myBid && <div className="mt"><Note tone="green" icon="check">Вы откликнулись: {usdt(myBid.price)}, {myBid.days} дн. Заказчик получил уведомление.</Note></div>}

      {!own && role === 'dev' && p.status === 'open' && (
        <Actions primary={{ label: myBid ? 'Изменить отклик' : 'Откликнуться', onClick: () => nav.push('bid', { id: p.id }) }} />
      )}
    </div>
  );
}
