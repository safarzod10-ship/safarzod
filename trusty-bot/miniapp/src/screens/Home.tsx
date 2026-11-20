import { CATEGORIES, bidCount, budget, plural, seen } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { tgUser } from '../tg';
import { Avatar, Cell, Rating, Section } from '../ui';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function Home() {
  const nav = useNav();
  const { projects, role, devs, clientOf, isMe } = useStore();
  const online = devs.filter((d) => d.lastSeenMin <= 5);
  const fresh = projects.filter((p) => p.status === 'open' && !isMe(p.clientId)).slice(0, 3);

  return (
    <div className="screen root">
      <div className="hello">
        <h1>{greeting()}{tgUser?.first_name ? `, ${tgUser.first_name}` : ''}</h1>
        <p>{role === 'client' ? 'Найдите разработчика и проведите сделку через гаранта.' : 'Новые проекты ждут откликов.'}</p>
      </div>

      <button className="search" onClick={() => nav.setTab('devs')}>
        <Icon name="search" size={19} />
        <span>Стек, задача или имя разработчика</span>
      </button>

      <div className="quick">
        {role === 'client' ? (
          <button className="main" onClick={() => nav.open('projects', 'project-new')}>
            <span className="ic"><Icon name="plus" size={19} /></span>
            <div><b>Создать проект</b><br /><span>Опишите задачу и получите отклики</span></div>
          </button>
        ) : (
          <button className="main" onClick={() => nav.setTab('projects')}>
            <span className="ic"><Icon name="projects" size={19} /></span>
            <div><b>Лента проектов</b><br /><span>{fresh.length} {plural(fresh.length, 'новый', 'новых', 'новых')} сегодня</span></div>
          </button>
        )}
        <button onClick={() => nav.push('guide')}>
          <span className="ic"><Icon name="shield" size={19} /></span>
          <div><b>Как работает гарант</b><br /><span>4 шага и арбитраж</span></div>
        </button>
      </div>

      <Section title="Направления">
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button key={c.key} className="chip" onClick={() => nav.open('devs', 'devs', { cat: c.key })}>
              {c.label}<small className="num">{devs.filter((d) => d.categories.includes(c.key)).length}</small>
            </button>
          ))}
        </div>
      </Section>

      {online.length > 0 && <Section title={`Сейчас в сети · ${online.length}`} action={{ label: 'Все', onClick: () => nav.setTab('devs') }}>
        <div className="hs">
          {online.map((d) => (
            <button key={d.id} className="mini" onClick={() => nav.open('devs', 'dev', { id: d.id })}>
              <Avatar name={d.name} hue={d.hue} size={44} online />
              <b>{d.name}</b>
              <span>{d.title}</span>
              {d.deals ? <Rating value={d.rating} size={13} /> : <span className="pill blue">Новый</span>}
            </button>
          ))}
        </div>
      </Section>}

      <Section title="Новые проекты" action={{ label: 'Все', onClick: () => nav.setTab('projects') }}>
        {fresh.length === 0 && <div className="empty">Пока нет открытых проектов. {role === 'client' ? 'Опубликуйте первый.' : 'Загляните позже.'}</div>}
        {fresh.length > 0 && <div className="group">
          {fresh.map((p) => {
            const c = clientOf(p);
            return (
              <Cell key={p.id} onClick={() => nav.open('projects', 'project', { id: p.id })} chevron
                title={<span className="t">{p.title}</span>}
                sub={<span className="num">{budget(p)} · {p.days} дн.</span>}
                meta={<>{bidCount(p)} {plural(bidCount(p), 'отклик', 'отклика', 'откликов')}<span>·</span>{p.ago}{c && <><span>·</span>{seen(c.lastSeenMin)}</>}</>} />
            );
          })}
        </div>}
      </Section>
    </div>
  );
}
