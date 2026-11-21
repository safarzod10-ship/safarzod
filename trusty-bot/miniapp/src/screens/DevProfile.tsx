import { useEffect, useState } from 'react';
import { RESULT_LABEL, plural, responseTime, seen, usdt, type DealResult } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, IconTile, Info, Note, Pill, Rating, Section, Sheet, Skeleton, Top, Verified } from '../ui';
import { DevStatus } from './Devs';

const RESULT_TONE: Record<DealResult, 'green' | 'amber' | 'blue' | 'red'> = {
  ontime: 'green', late: 'amber', dispute_won: 'blue', dispute_lost: 'red',
};

export default function DevProfile({ id }: { id: string }) {
  const nav = useNav();
  const { role, members, openChat, devById, fetchDev, isMe, live } = useStore();
  const [menu, setMenu] = useState(false);
  const [missing, setMissing] = useState(false);
  const d = devById(id);
  useEffect(() => { if (!d) fetchDev(id).then((x) => { if (!x) setMissing(true); }); }, [id, d, fetchDev]);
  if (!d) {
    return (
      <div className="screen no-tabs"><Top title="" small />
        {missing ? <div className="empty">Профиль не найден или ещё на проверке.</div> : <Skeleton rows={4} />}</div>
    );
  }
  const banned = live ? d.banned : members.find((m) => m.id === id)?.ban;
  const self = isMe(d.id);
  const online = d.lastSeenMin <= 5;
  const vol = d.volume >= 1000 ? `${(d.volume / 1000).toFixed(1)}k` : String(d.volume);

  const write = async (offer = false) => {
    try { nav.open('chats', 'chat', { id: await openChat(d.id), offer }); } catch { /* toast shown */ }
  };

  return (
    <div className="screen no-tabs">
      <Top title="" small right={
        <button className="icon-btn" aria-label="Ещё" onClick={() => setMenu(true)}><Icon name="dots" /></button>} />

      <div className="hero">
        <Avatar name={d.name} size={88} online={online} />
        <h1>{d.name}{d.verified && <Verified />}</h1>
        <div className="handle">@{d.handle} · {d.title}</div>
        <div className="line">
          <DevStatus d={d} />
          <Pill><Icon name="clock" size={13} />{seen(d.lastSeenMin)}</Pill>
          {d.responseMin > 0 && <Pill>отвечает {responseTime(d.responseMin)}</Pill>}
        </div>
      </div>

      {banned && (
        <Note tone="red" icon="ban">
          Аккаунт заблокирован {banned.until ? `до ${banned.until}` : 'навсегда'} за нарушение правил. Сделки с ним недоступны.
        </Note>
      )}
      {self && d.moderation && d.moderation !== 'published' && (
        <div className="mt-s"><Note tone={d.moderation === 'rejected' ? 'red' : 'amber'} icon="clock">
          {d.moderation === 'rejected' ? 'Анкета не прошла проверку. Исправьте её в профиле.' : 'Анкета на проверке. Так профиль будет выглядеть в каталоге.'}
        </Note></div>
      )}
      {d.isNew && (
        <div className="summary" style={{ justifyContent: 'center', margin: '0 0 6px' }}>Новый исполнитель
          <Info label="Что это значит">Пока нет трёх успешных сделок, сумма одной сделки ограничена 100 USDT.</Info></div>
      )}

      {d.deals > 0 && (
        <div className="stats mt">
          <div className="stat"><b>{d.rating.toFixed(1)}</b><span>рейтинг</span></div>
          <div className="stat"><b>{d.deals}</b><span>{plural(d.deals, 'сделка', 'сделки', 'сделок')}</span></div>
          <div className="stat"><b>{d.onTime}%</b><span>в срок</span></div>
          <div className="stat"><b>{vol}</b><span>USDT оборот</span></div>
        </div>
      )}

      <Section title="Гарантии">
        <div className="group">
          <Cell icon lead={<IconTile name="shield" />} title={d.verified ? 'Анкета проверена' : 'Анкета не проверена'} sub={d.verified ? 'Модератор IT Trusty проверил профиль' : 'Профиль ещё не прошёл модерацию'} />
          {d.github && <Cell icon lead={<IconTile name="github" />} title="GitHub" sub={`github.com/${d.github}`} />}
          {d.deposit && <Cell icon lead={<IconTile name="coin" />} title={`Залог ${usdt(d.deposit)}`} sub="Списывается в пользу заказчика при обмане" />}
          <Cell icon lead={<IconTile name="flag" />} title={`Споры: ${d.disputes}`}
            sub={d.disputes ? `проиграно ${d.disputesLost} из ${d.disputes}` : 'ни одного спора'} />
        </div>
      </Section>

      <Section title="О себе">
        <div className="text">{d.about}</div>
        <div className="tags mt-s">{d.stack.map((s) => <span className="tag" key={s}>{s}</span>)}</div>
      </Section>

      {d.portfolio.length > 0 && (
        <Section title="Портфолио">
          <div className="group">
            {d.portfolio.map((p) => <Cell key={p.title} icon lead={<IconTile name="doc" />} title={p.title} sub={p.text} />)}
          </div>
        </Section>
      )}

      <Section title={d.history.length ? 'Последние сделки' : 'Сделки'}>
        {d.history.length ? (
          <div className="group">
            {d.history.map((h) => (
              <div className="deal-row" key={h.id}>
                <div className="h"><span>{h.title}</span>{h.rating && <Rating value={h.rating} size={13} />}</div>
                <div className="m num">
                  <span>#{h.id}</span><span>{h.category}</span><span>{h.amount} USDT</span><span>{h.date}</span>
                  <Pill tone={RESULT_TONE[h.result]}>{RESULT_LABEL[h.result]}</Pill>
                </div>
                {h.review && <><q>«{h.review}»</q><small>{h.author}, заказчик</small></>}
              </div>
            ))}
          </div>
        ) : <div className="text muted small">Сделок через IT Trusty пока не было.</div>}
        <p className="hint mt-s">Суммы показаны диапазоном, имена заказчиков сокращены.</p>
      </Section>

      <div className="small muted center mt">В IT Trusty с {d.joined}</div>

      {!banned && !self && (
        <Actions secondary={{ label: 'Написать', onClick: () => write() }}
          primary={role === 'client' ? { label: 'Предложить цену', onClick: () => write(true) } : undefined} />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="group">
          <Cell icon lead={<IconTile name="link" />} title="Скопировать ссылку на профиль"
            onClick={() => { navigator.clipboard?.writeText(`https://t.me/itrusty_bot?start=dev_${d.id}`).catch(() => {}); setMenu(false); }} />
          <Cell icon lead={<IconTile name="flag" tone="red" />} title={<span style={{ color: 'var(--red)' }}>Пожаловаться</span>}
            onClick={() => { setMenu(false); nav.push('complaint', { against: d.id, name: d.name }); }} />
        </div>
      </Sheet>

    </div>
  );
}
