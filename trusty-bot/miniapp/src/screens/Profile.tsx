import { plural } from '../data';
import { useNav } from '../nav';
import { useStore, type Role } from '../store';
import { tgUser } from '../tg';
import { Avatar, Cell, IconTile, Note, Pill, Section, Seg, Toggle } from '../ui';

const FORM_LABEL = { none: 'Не заполнена', review: 'На проверке', published: 'Опубликована', rejected: 'Нужно исправить' } as const;
const FORM_TONE = { none: 'amber', review: 'blue', published: 'green', rejected: 'red' } as const;

export default function Profile() {
  const nav = useNav();
  const s = useStore();
  const name = s.live ? s.me.name : tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость';
  const username = s.live ? s.me.username : tgUser?.username;
  const p = s.me.profile;
  const myProjects = s.projects.filter((x) => s.isMe(x.clientId)).length;
  const deals = s.chats.filter((c) => c.deal).length;
  const bids = s.projects.filter((x) => !!s.myBidFor(x.id)).length;
  const openComplaints = s.complaints.filter((c) => c.status === 'new' || c.status === 'review').length;

  return (
    <div className="screen root">
      <div className="hero" style={{ paddingTop: 18 }}>
        <Avatar name={name} hue={s.live ? Number(s.me.id) % 8 : 0} size={80} />
        <h1>{name}</h1>
        <div className="handle">{username ? `@${username}` : s.live ? '' : 'Откройте приложение из Telegram, чтобы войти'}</div>
      </div>

      <Seg<Role> value={s.role} onChange={(r) => { s.setRole(r).catch(() => {}); }}
        items={[{ key: 'client', label: 'Я заказчик' }, { key: 'dev', label: 'Я разработчик' }]} />

      {s.role === 'client' ? (
        <div className="stats mt" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat"><b>{myProjects}</b><span>{plural(myProjects, 'проект', 'проекта', 'проектов')}</span></div>
          <div className="stat"><b>{deals}</b><span>{plural(deals, 'сделка', 'сделки', 'сделок')}</span></div>
        </div>
      ) : p ? (
        <>
          <div className="stats mt">
            <div className="stat"><b>{p.deals ? p.rating.toFixed(1).replace('.', ',') : '—'}</b><span>рейтинг</span></div>
            <div className="stat"><b>{p.deals}</b><span>сделок</span></div>
            <div className="stat"><b>{p.deals ? `${p.onTime}%` : '—'}</b><span>в срок</span></div>
            <div className="stat"><b>{bids}</b><span>откликов</span></div>
          </div>
          {!s.live && <p className="hint mt-s center">В демо режим разработчика показан на примере профиля «{p.name}».</p>}
        </>
      ) : (
        <div className="mt"><Note tone="blue" icon="doc">Заполните анкету разработчика: после проверки профиль появится в каталоге и вы сможете откликаться на проекты.</Note></div>
      )}

      <Section title={s.role === 'client' ? 'Заказы' : 'Работа'}>
        <div className="group">
          {s.role === 'client' ? (
            <>
              <Cell lead={<IconTile name="projects" />} title="Мои проекты" trail={myProjects} chevron onClick={() => nav.setTab('projects')} />
              <Cell lead={<IconTile name="plus" />} title="Создать проект" chevron onClick={() => nav.open('projects', 'project-new')} />
            </>
          ) : (
            <>
              <Cell lead={<IconTile name="doc" />} title="Анкета" trail={<Pill tone={FORM_TONE[s.devForm]}>{FORM_LABEL[s.devForm]}</Pill>}
                chevron onClick={() => nav.push('dev-form')} />
              {p && <Cell lead={<IconTile name="devs" />} title="Как меня видят заказчики" chevron onClick={() => nav.push('dev', { id: p.id })} />}
            </>
          )}
          <Cell lead={<IconTile name="shield" />} title="Мои сделки" trail={deals} chevron onClick={() => nav.setTab('chats')} />
        </div>
        {s.devForm === 'rejected' && s.me.moderationNote && s.role === 'dev' && (
          <div className="mt-s"><Note tone="red" icon="info">Комментарий модератора: {s.me.moderationNote}</Note></div>
        )}
      </Section>

      <Section title="Безопасность">
        <div className="group">
          <Cell lead={<IconTile name="info" tone="blue" />} title="Как работает гарант" chevron onClick={() => nav.push('guide')} />
          <Cell lead={<IconTile name="flag" tone="red" />} title="Мои жалобы" trail={s.myComplaints.length} chevron onClick={() => nav.push('my-complaints')} />
        </div>
      </Section>

      {s.admin && (
        <Section title="Администрирование">
          <div className="group">
            <Cell lead={<IconTile name="admin" tone="amber" />} title="Админ-панель" sub="Жалобы, анкеты, блокировки"
              trail={openComplaints ? <span className="pill red">{openComplaints}</span> : undefined} chevron onClick={() => nav.push('admin')} />
          </div>
        </Section>
      )}

      {!s.live && (
        <Section title="Демо">
          <div className="group">
            <Cell title="Режим администратора" sub="В боте доступ выдаёт команда /admin, максимум 2 администратора"
              trail={<Toggle on={s.admin} onChange={s.setAdmin} label="Режим администратора" />} />
          </div>
          <div className="mt-s"><Note tone="blue">Это демо на примерных данных. В Telegram приложение работает с настоящими данными.</Note></div>
        </Section>
      )}
    </div>
  );
}
