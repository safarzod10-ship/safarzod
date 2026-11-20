import { CLIENTS, DEVS, plural } from '../data';
import { useNav } from '../nav';
import { useStore, type Role } from '../store';
import { tgUser } from '../tg';
import { Avatar, Cell, IconTile, Note, Pill, Section, Seg, Toggle } from '../ui';

export default function Profile() {
  const nav = useNav();
  const s = useStore();
  const me = CLIENTS.find((c) => c.id === 'me')!;
  const asDev = DEVS[0];
  const name = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость';
  const myProjects = s.projects.filter((p) => p.clientId === 'me').length;
  const deals = s.chats.filter((c) => c.deal).length;
  const myComplaints = s.complaints.filter((c) => c.fromName === 'Вы').length;
  const openComplaints = s.complaints.filter((c) => c.status === 'new' || c.status === 'review').length;
  const formLabel = { none: 'Не заполнена', review: 'На проверке', published: 'Опубликована' }[s.devForm];

  return (
    <div className="screen root">
      <div className="hero" style={{ paddingTop: 18 }}>
        <Avatar name={name} hue={0} size={80} />
        <h1>{name}</h1>
        <div className="handle">{tgUser?.username ? `@${tgUser.username}` : 'Откройте приложение из Telegram, чтобы войти'}</div>
      </div>

      <Seg<Role> value={s.role} onChange={s.setRole} items={[{ key: 'client', label: 'Я заказчик' }, { key: 'dev', label: 'Я разработчик' }]} />

      {s.role === 'client' ? (
        <div className="stats mt" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat"><b>{me.rating.toFixed(1).replace('.', ',')}</b><span>рейтинг</span></div>
          <div className="stat"><b>{myProjects}</b><span>{plural(myProjects, 'проект', 'проекта', 'проектов')}</span></div>
          <div className="stat"><b>{deals}</b><span>{plural(deals, 'сделка', 'сделки', 'сделок')}</span></div>
        </div>
      ) : (
        <>
          <div className="stats mt">
            <div className="stat"><b>{asDev.rating.toFixed(1).replace('.', ',')}</b><span>рейтинг</span></div>
            <div className="stat"><b>{asDev.deals}</b><span>сделок</span></div>
            <div className="stat"><b>{asDev.onTime}%</b><span>в срок</span></div>
            <div className="stat"><b>{s.myBids.length}</b><span>откликов</span></div>
          </div>
          <p className="hint mt-s center">В прототипе режим разработчика показан на примере профиля «{asDev.name}».</p>
        </>
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
              <Cell lead={<IconTile name="doc" />} title="Анкета разработчика" trail={<Pill tone={s.devForm === 'none' ? 'amber' : 'blue'}>{formLabel}</Pill>}
                chevron onClick={() => nav.push('dev-form')} />
              <Cell lead={<IconTile name="devs" />} title="Как меня видят заказчики" chevron onClick={() => nav.push('dev', { id: asDev.id })} />
            </>
          )}
          <Cell lead={<IconTile name="shield" />} title="Мои сделки" trail={deals} chevron onClick={() => nav.setTab('chats')} />
        </div>
      </Section>

      <Section title="Безопасность">
        <div className="group">
          <Cell lead={<IconTile name="info" tone="blue" />} title="Как работает гарант" chevron onClick={() => nav.push('guide')} />
          <Cell lead={<IconTile name="flag" tone="red" />} title="Мои жалобы" trail={myComplaints} chevron
            onClick={() => nav.push('my-complaints')} />
        </div>
      </Section>

      {s.admin && (
        <Section title="Администрирование">
          <div className="group">
            <Cell lead={<IconTile name="admin" tone="amber" />} title="Админ-панель" sub="Жалобы, блокировки, пользователи"
              trail={openComplaints ? <span className="pill red">{openComplaints}</span> : undefined} chevron onClick={() => nav.push('admin')} />
          </div>
        </Section>
      )}

      <Section title="Прототип">
        <div className="group">
          <Cell title="Режим администратора" sub="В боте доступ выдаёт команда /admin, максимум 2 администратора"
            trail={<Toggle on={s.admin} onChange={s.setAdmin} label="Режим администратора" />} />
        </div>
        <div className="mt-s"><Note tone="blue">Данные в прототипе примерные, оплата не подключена.</Note></div>
      </Section>
    </div>
  );
}
