import { useState, type ReactNode } from 'react';
import { CATEGORIES, CLIENTS, budget, categoryLabel, plural, type Project } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Chips, Pill, Seg, Top } from '../ui';

export function ProjectCell({ p, onClick, badge }: { p: Project; onClick(): void; badge?: ReactNode }) {
  const c = CLIENTS.find((x) => x.id === p.clientId);
  return (
    <button className="cell" onClick={onClick} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%' }}>
        <div className="cell-title" style={{ fontSize: 15.5 }}>{p.title}</div>
        {badge}
      </div>
      <div className="price mt-s">{budget(p)}</div>
      <div className="cell-meta num">
        <span>{categoryLabel(p.category)}</span><span>·</span><span>{p.days} дн.</span><span>·</span>
        <span>{p.bids.length} {plural(p.bids.length, 'отклик', 'отклика', 'откликов')}</span><span>·</span><span>{p.ago}</span>
      </div>
      <div className="tags mt-s">{p.stack.map((s) => <span className="tag" key={s}>{s}</span>)}</div>
      {c && c.id !== 'me' && (
        <div className="cell-meta">Заказчик: {c.name} · ★ {c.rating.toFixed(1).replace('.', ',')} · {c.deals} {plural(c.deals, 'сделка', 'сделки', 'сделок')}</div>
      )}
    </button>
  );
}

export default function Projects() {
  const nav = useNav();
  const { projects, role, myBids } = useStore();
  const [view, setView] = useState<'feed' | 'mine'>('feed');
  const [cat, setCat] = useState('all');

  const mineClient = projects.filter((p) => p.clientId === 'me');
  const mineDev = projects.filter((p) => myBids.some((b) => b.projectId === p.id));
  const feed = projects.filter((p) => p.status === 'open' && p.clientId !== 'me' && (cat === 'all' || p.category === cat));
  const list = view === 'feed' ? feed : role === 'client' ? mineClient : mineDev;

  return (
    <div className="screen root">
      <Top title="Проекты" sub="Конкретные задачи с бюджетом и сроком"
        right={role === 'client' ? (
          <button className="icon-btn accent" aria-label="Создать проект" onClick={() => nav.push('project-new')}><Icon name="plus" /></button>
        ) : undefined} />
      <Seg value={view} onChange={(v) => setView(v)}
        items={[{ key: 'feed', label: 'Лента' }, { key: 'mine', label: role === 'client' ? 'Мои проекты' : 'Мои отклики' }]} />
      {view === 'feed' && (
        <div className="mt-s">
          <Chips value={cat} onChange={setCat} items={[{ key: 'all', label: 'Все' }, ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))]} />
        </div>
      )}
      <div className="mt">
        {list.length ? (
          <div className="group">
            {list.map((p) => (
              <ProjectCell key={p.id} p={p} onClick={() => nav.push('project', { id: p.id })}
                badge={p.status === 'in_work' ? <Pill tone="green">В работе</Pill>
                  : view === 'mine' && role === 'dev' ? <Pill tone="blue">Отклик отправлен</Pill> : undefined} />
            ))}
          </div>
        ) : (
          <div className="empty">
            {view === 'mine' && role === 'client' ? 'У вас пока нет проектов.' : view === 'mine' ? 'Вы ещё не откликались на проекты.' : 'В этой категории пока нет открытых проектов.'}
          </div>
        )}
      </div>
    </div>
  );
}
