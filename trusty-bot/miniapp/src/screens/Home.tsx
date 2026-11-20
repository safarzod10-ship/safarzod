import { CATEGORIES, bidCount, budget, plural, seen } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { tgUser } from '../tg';
import { useState } from 'react';
import { Avatar, Cell, Rating, Section, Sheet } from '../ui';
import { RolePicker, ROLE_INFO } from './Onboarding';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function Home() {
  const nav = useNav();
  const { projects, role, devs, clientOf, isMe, setRole, showToast, me, devForm } = useStore();
  const [roleSheet, setRoleSheet] = useState(false);
  const online = devs.filter((d) => d.lastSeenMin <= 5);
  const fresh = projects.filter((p) => p.status === 'open' && !isMe(p.clientId)).slice(0, 3);

  return (
    <div className="screen root">
      <div className="hello">
        <div className="hello-row">
          <h1>{greeting()}{tgUser?.first_name ? `, ${tgUser.first_name}` : ''}</h1>
          <button className="role-pill" onClick={() => setRoleSheet(true)} aria-label="Сменить роль">
            {ROLE_INFO[role].title}<Icon name="swap" size={15} />
          </button>
        </div>
        <p>{role === 'client' ? 'Найдите исполнителя и проведите сделку через гаранта.' : 'Новые проекты ждут откликов.'}</p>
      </div>
      {role === 'dev' && !me.profile && (
        <div style={{ marginBottom: 14 }}>
          <button className="note blue" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.open('profile', 'dev-form')}>
            <Icon name="doc" size={18} />
            <div><b>{devForm === 'review' ? 'Анкета на проверке' : 'Заполните анкету исполнителя'}</b><br />
              {devForm === 'review' ? 'После проверки профиль появится в каталоге.' : 'Без неё нельзя откликаться на проекты. Это 4 коротких шага.'}</div>
          </button>
        </div>
      )}

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
      <Sheet open={roleSheet} onClose={() => setRoleSheet(false)} title="Кто вы сейчас?">
        <RolePicker value={role} onChange={(r) => {
          setRoleSheet(false);
          if (r !== role) setRole(r).then(() => showToast(`Режим: ${ROLE_INFO[r].title.toLowerCase()}`)).catch(() => {});
        }} />
        <p className="hint mt-s">Профиль, сделки и чаты сохраняются при смене роли.</p>
      </Sheet>
    </div>
  );
}
