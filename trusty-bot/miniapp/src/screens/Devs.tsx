import { useMemo, useState } from 'react';
import { CATEGORIES, categoryLabel, plural, seen, type Dev } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Avatar, Chips, Pill, Rating, Seg, Sheet, Toggle, Top, Verified } from '../ui';

type Filter = 'all' | 'online' | string;
type Sort = 'rating' | 'deals' | 'seen';

export function DevStatus({ d }: { d: Dev }) {
  if (d.status === 'free') return <Pill tone="green">Свободен</Pill>;
  if (d.status === 'busy') return <Pill>Занят до {d.busyUntil}</Pill>;
  return <Pill>Не принимает заказы</Pill>;
}

/** one row of the catalogue: who, what, rating and deals; online shows as a green dot */
export function DevCell({ d, onClick }: { d: Dev; onClick(): void }) {
  const online = d.lastSeenMin <= 5;
  return (
    <button className="cell has-avatar" onClick={onClick}>
      <Avatar name={d.name} size={44} online={online} />
      <div className="cell-body">
        <div className="cell-title"><span className="t">{d.name}</span>{d.verified && <Verified />}</div>
        <div className="cell-sub">{categoryLabel(d.categories[0] ?? '')} · {online ? 'в сети' : seen(d.lastSeenMin)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: 'none' }}>
        {d.deals ? <Rating value={d.rating} /> : <span className="pill">Новый</span>}
        {d.deals > 0 && <span className="muted num" style={{ fontSize: 12, fontWeight: 600 }}>{d.deals} {plural(d.deals, 'сделка', 'сделки', 'сделок')}</span>}
      </div>
    </button>
  );
}

/** "Исполнители | Проекты" at the top of the search tab */
export function SearchSwitch({ value }: { value: 'devs' | 'projects' }) {
  const nav = useNav();
  return (
    <Seg value={value} onChange={(v) => nav.setTab(v)}
      items={[{ key: 'devs', label: 'Исполнители' }, { key: 'projects', label: 'Проекты' }]} />
  );
}

export default function Devs({ cat }: { cat?: string }) {
  const nav = useNav();
  const { devs } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(cat ?? 'all');
  const [sort, setSort] = useState<Sort>('rating');
  const [freeOnly, setFreeOnly] = useState(false);
  const [sheet, setSheet] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return devs.filter((d) => {
      if (filter === 'online' && d.lastSeenMin > 5) return false;
      if (freeOnly && d.status !== 'free') return false;
      if (!['all', 'online'].includes(filter) && !d.categories.includes(filter)) return false;
      if (s && ![d.name, d.title, d.handle, ...d.stack].some((x) => x.toLowerCase().includes(s))) return false;
      return true;
    }).sort((a, b) => (sort === 'rating' ? b.rating - a.rating : sort === 'deals' ? b.deals - a.deals : a.lastSeenMin - b.lastSeenMin));
  }, [q, filter, sort, devs, freeOnly]);

  const sorts: { key: Sort; label: string }[] = [
    { key: 'rating', label: 'С лучшими отзывами' }, { key: 'deals', label: 'С большим числом сделок' }, { key: 'seen', label: 'Кто недавно в сети' },
  ];
  const root = nav.depth === 1;

  return (
    <div className={`screen ${root ? 'root' : ''}`}>
      {root && <div style={{ paddingTop: 10 }}><SearchSwitch value="devs" /></div>}
      <Top title="Исполнители" />
      <label className="search">
        <Icon name="search" size={19} strokeWidth={2} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Стек, задача или имя" aria-label="Поиск исполнителей" />
        {q && <button onClick={() => setQ('')} aria-label="Очистить"><Icon name="x" size={18} /></button>}
        <button onClick={() => setSheet(true)} aria-label="Сортировка и фильтры" style={{ color: 'var(--ink)', display: 'flex' }}><Icon name="filter" size={20} /></button>
      </label>
      <div className="mt-s">
        <Chips<Filter> value={filter} onChange={setFilter}
          items={[{ key: 'all', label: 'Все' }, { key: 'online', label: 'В сети' }, ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))]} />
      </div>
      <div className="mt">
        {list.length ? (
          <div className="group stagger" key={`${filter}-${sort}-${freeOnly}`}>{list.map((d) => <DevCell key={d.id} d={d} onClick={() => nav.push('dev', { id: d.id })} />)}</div>
        ) : (
          <div className="empty">{devs.length ? 'Никого не нашли. Попробуйте другой стек или уберите фильтр.' : 'Каталог пока пуст: исполнители появятся после проверки анкет.'}</div>
        )}
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Сортировка">
        <div className="group mt-s">
          {sorts.map((s) => (
            <button key={s.key} className={`radio ${sort === s.key ? 'on' : ''}`} onClick={() => { setSort(s.key); setSheet(false); }}><i />{s.label}</button>
          ))}
        </div>
        <div className="group mt-s">
          <div className="cell"><div className="cell-body"><div className="cell-title">Только свободные</div></div><Toggle on={freeOnly} onChange={setFreeOnly} label="Только свободные" /></div>
        </div>
      </Sheet>
    </div>
  );
}
