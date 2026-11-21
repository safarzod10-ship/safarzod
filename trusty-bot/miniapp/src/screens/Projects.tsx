import { useState, type ReactNode } from 'react';
import { CATEGORIES, bidCount, budget, plural, type Client, type Project } from '../data';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Chips, Pill, Seg, Top } from '../ui';

export function ProjectCell({ p, onClick, badge }: { p: Project; onClick(): void; badge?: ReactNode; client?: Client }) {
  return (
    <button className="cell" onClick={onClick} style={{ alignItems: 'flex-start' }}>
      <div className="cell-body">
        <div className="cell-title"><span className="t">{p.title}</span></div>
        <div className="cell-sub num">{budget(p)} · {p.days} дн. · {bidCount(p)} {plural(bidCount(p), 'отклик', 'отклика', 'откликов')}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{p.ago}</span>
        {badge}
      </div>
    </button>
  );
}

/** A client sees only their own projects; an executor sees the feed of open projects and their own bids. */
export default function Projects() {
  const nav = useNav();
  const { projects, role, isMe, myBidFor } = useStore();
  const [view, setView] = useState<'feed' | 'mine'>('feed');
  const [cat, setCat] = useState('all');
  const root = nav.depth === 1;

  if (role === 'client') {
    const mine = projects.filter((p) => isMe(p.clientId));
    return (
      <div className={`screen ${root ? 'root' : ''}`}>
        <Top title="Мои проекты" />
        {mine.length ? (
          <div className="group stagger">
            {mine.map((p) => (
              <ProjectCell key={p.id} p={p} onClick={() => nav.push('project', { id: p.id })}
                badge={p.status === 'open' ? <Pill tone="green">Приём откликов</Pill> : <Pill>В работе</Pill>} />
            ))}
          </div>
        ) : (
          <div className="empty-cta">
            <b>Проектов пока нет</b>
            <span>Опубликуйте задачу с бюджетом и сроком: исполнители пришлют отклики, а в чате можно предложить цену по ней.</span>
          </div>
        )}
        <button className="btn primary mt" onClick={() => nav.push('project-new')}>Опубликовать проект</button>
      </div>
    );
  }

  const mineDev = projects.filter((p) => !!myBidFor(p.id));
  const feed = projects.filter((p) => p.status === 'open' && !isMe(p.clientId) && (cat === 'all' || p.category === cat));
  const list = view === 'feed' ? feed : mineDev;

  return (
    <div className={`screen ${root ? 'root' : ''}`}>
      <Top title="Проекты" />
      <Seg value={view} onChange={(v) => setView(v)}
        items={[{ key: 'feed', label: 'Лента' }, { key: 'mine', label: 'Мои отклики', count: mineDev.length }]} />
      {view === 'feed' && (
        <div className="mt-s">
          <Chips value={cat} onChange={setCat} items={[{ key: 'all', label: 'Все' }, ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))]} />
        </div>
      )}
      <div className="mt">
        {list.length ? (
          <div className="group stagger" key={`${view}-${cat}`}>
            {list.map((p) => (
              <ProjectCell key={p.id} p={p} onClick={() => nav.push('project', { id: p.id })}
                badge={p.status === 'in_work' ? <Pill>В работе</Pill> : view === 'mine' ? <Pill tone="green">Отклик отправлен</Pill> : undefined} />
            ))}
          </div>
        ) : (
          <div className="empty">{view === 'mine' ? 'Вы ещё не откликались на проекты.' : 'В этой категории пока нет открытых проектов.'}</div>
        )}
      </div>
    </div>
  );
}
