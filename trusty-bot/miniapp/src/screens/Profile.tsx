import { plural } from '../data';
import { useNav } from '../nav';
import { useStore, type Role } from '../store';
import { tgUser } from '../tg';
import { Avatar, Cell, IconTile, Note, Pill, Seg, Toggle } from '../ui';

const FORM_LABEL = { none: 'Не заполнена', review: 'На проверке', published: 'Одобрена', rejected: 'Исправить' } as const;
const FORM_TONE = { none: undefined, review: undefined, published: 'green', rejected: 'red' } as const;

export default function Profile() {
  const nav = useNav();
  const s = useStore();
  const name = s.live ? s.me.name : tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Гость';
  const username = s.live ? s.me.username : tgUser?.username;
  const p = s.me.profile;
  const myProjects = s.projects.filter((x) => s.isMe(x.clientId)).length;
  const openComplaints = s.complaints.filter((c) => c.status === 'new' || c.status === 'review').length;
  const line = s.role === 'dev' && p?.deals ? `${p.rating.toFixed(1)} ★ · ${p.deals} ${plural(p.deals, 'сделка', 'сделки', 'сделок')}` : username ? `@${username}` : '';

  return (
    <div className="screen root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0 18px' }}>
        <Avatar name={name} size={64} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{name}</div>
          {line && <div className="muted" style={{ fontWeight: 600, marginTop: 2 }}>{line}</div>}
        </div>
      </div>

      <Seg<Role> value={s.role} onChange={(r) => { s.setRole(r).catch(() => {}); }}
        items={[{ key: 'client', label: 'Я заказчик' }, { key: 'dev', label: 'Я исполнитель' }]} />

      <div className="group mt">
        <Cell lead={<IconTile name="shield" />} title="Мои сделки" trail={s.deals.length || undefined} chevron onClick={() => nav.push('deals')} />
        {s.role === 'client' ? (
          <Cell lead={<IconTile name="projects" />} title="Мои проекты" trail={myProjects || undefined} chevron onClick={() => nav.push('projects')} />
        ) : (
          <>
            <Cell lead={<IconTile name="doc" />} title="Анкета исполнителя" trail={<Pill tone={FORM_TONE[s.devForm]}>{FORM_LABEL[s.devForm]}</Pill>}
              chevron onClick={() => nav.push('dev-form')} />
            {p && <Cell lead={<IconTile name="eye" />} title="Мой профиль в каталоге" chevron onClick={() => nav.push('dev', { id: p.id })} />}
          </>
        )}
      </div>
      {s.role === 'dev' && s.devForm === 'rejected' && s.me.moderationNote && (
        <div className="mt-s"><Note tone="red" icon="info">Комментарий модератора: {s.me.moderationNote}</Note></div>
      )}

      <div className="group mt">
        <Cell lead={<IconTile name="info" />} title="Как работает гарант" chevron onClick={() => nav.push('guide')} />
        <Cell lead={<IconTile name="flag" />} title="Мои жалобы" trail={s.myComplaints.length || undefined} chevron onClick={() => nav.push('my-complaints')} />
      </div>

      {s.admin && (
        <div className="group mt">
          <Cell lead={<IconTile name="admin" />} title="Админ-панель"
            trail={openComplaints ? <span className="pill red">{openComplaints}</span> : undefined} chevron onClick={() => nav.push('admin')} />
          <Cell lead={<IconTile name="coin" />} title="Финансы и споры" chevron onClick={() => nav.push('finance')} />
        </div>
      )}

      {!s.live && (
        <div className="group mt">
          <Cell title="Режим администратора" sub="Демо в браузере. В боте доступ выдаёт /admin"
            trail={<Toggle on={s.admin} onChange={s.setAdmin} label="Режим администратора" />} />
        </div>
      )}
    </div>
  );
}
