import { useState, type ReactNode } from 'react';
import { CATEGORIES, bidCount, budget, plural, type Client, type Project } from '../data';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Chips, Pill, Seg, Top } from '../ui';
import { SearchSwitch } from './Devs';

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

export default function Projects() {
  const nav = useNav();
  const { projects, role, isMe, myBidFor } = useStore();
  const [view, setView] = useState<'feed' | 'mine'>('feed');
  const [cat, setCat] = useState('all');

  const mineClient = projects.filter((p) => isMe(p.clientId));
  const mineDev = projects.filter((p) => !!myBidFor(p.id));
  const feed = projects.filter((p) => p.status === 'open' && !isMe(p.clientId) && (cat === 'all' || p.category === cat));
  const list = view === 'feed' ? feed : role === 'client' ? mineClient : mineDev;

  return (
    <div className="screen root">
      <div style={{ paddingTop: 10 }}><SearchSwitch value="projects" /></div>
      <Top title="Проекты" />
      <Seg value={view} onChange={(v) => setView(v)}
        items={[{ key: 'feed', label: 'Лента' }, { key: 'mine', label: role === 'client' ? 'Мои проекты' : 'Мои отклики', count: role === 'client' ? mineClient.length : mineDev.length }]} />
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
                badge={p.status === 'in_work' ? <Pill tone="green">В работе</Pill>
                  : view === 'mine' && role === 'dev' ? <Pill>Отклик отправлен</Pill> : undefined} />
            ))}
          </div>
        ) : (
          <div className="empty">
            {view === 'mine' && role === 'client' ? 'У вас пока нет проектов. Нажмите «+» внизу, чтобы опубликовать.' : view === 'mine' ? 'Вы ещё не откликались на проекты.' : 'В этой категории пока нет открытых проектов.'}
          </div>
        )}
      </div>
    </div>
  );
}
