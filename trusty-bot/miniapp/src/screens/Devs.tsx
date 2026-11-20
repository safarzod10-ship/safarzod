import { useMemo, useState } from 'react';
import { CATEGORIES, plural, responseTime, seen, type Dev } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Avatar, Chips, Pill, Rating, Top, Verified } from '../ui';

type Filter = 'all' | 'online' | 'free' | string;
type Sort = 'rating' | 'deals' | 'seen';

export function DevStatus({ d }: { d: Dev }) {
  if (d.status === 'free') return <Pill tone="green">Свободен</Pill>;
  if (d.status === 'busy') return <Pill tone="amber">Занят до {d.busyUntil}</Pill>;
  return <Pill>Не принимает заказы</Pill>;
}

export function DevCell({ d, onClick }: { d: Dev; onClick(): void }) {
  const online = d.lastSeenMin <= 5;
  return (
    <button className="cell has-avatar" onClick={onClick} style={{ alignItems: 'flex-start' }}>
      <Avatar name={d.name} hue={d.hue} size={46} online={online} />
      <div className="cell-body">
        <div className="cell-title" style={{ justifyContent: 'space-between' }}>
          <span className="t" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span className="t">{d.name}</span>{d.verified && <Verified />}
          </span>
          <span className="num" style={{ flex: 'none', fontSize: 14 }}>от {d.rate} $/ч</span>
        </div>
        <div className="cell-sub">{d.title}</div>
        <div className="cell-meta num">
          {d.deals ? (
            <>
              <Rating value={d.rating} size={13} />
              <span>{d.deals} {plural(d.deals, 'сделка', 'сделки', 'сделок')}</span>
              <span>в срок {d.onTime}%</span>
            </>
          ) : <Pill tone="blue">Новый разработчик</Pill>}
        </div>
        <div className="cell-meta">
          <DevStatus d={d} />
          <span style={{ color: online ? 'var(--primary)' : undefined, fontWeight: online ? 600 : 400 }}>{seen(d.lastSeenMin)}</span>
          {d.responseMin > 0 && <span>· отвечает {responseTime(d.responseMin)}</span>}
        </div>
      </div>
    </button>
  );
}

export default function Devs({ cat }: { cat?: string }) {
  const nav = useNav();
  const { devs } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(cat ?? 'all');
  const [sort, setSort] = useState<Sort>('rating');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return devs.filter((d) => {
      if (filter === 'online' && d.lastSeenMin > 5) return false;
      if (filter === 'free' && d.status !== 'free') return false;
      if (!['all', 'online', 'free'].includes(filter) && !d.categories.includes(filter)) return false;
      if (s && ![d.name, d.title, d.handle, ...d.stack].some((x) => x.toLowerCase().includes(s))) return false;
      return true;
    }).sort((a, b) => (sort === 'rating' ? b.rating - a.rating : sort === 'deals' ? b.deals - a.deals : a.lastSeenMin - b.lastSeenMin));
  }, [q, filter, sort, devs]);

  const sorts: { key: Sort; label: string }[] = [
    { key: 'rating', label: 'по рейтингу' }, { key: 'deals', label: 'по числу сделок' }, { key: 'seen', label: 'кто недавно в сети' },
  ];
  const nextSort = () => setSort(sorts[(sorts.findIndex((x) => x.key === sort) + 1) % sorts.length].key);

  return (
    <div className={`screen ${nav.depth > 1 ? '' : 'root'}`}>
      <Top title="Разработчики" sub="Рейтинг считается только по сделкам через Trusty" />
      <label className="search">
        <Icon name="search" size={19} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Python, React, парсер…" aria-label="Поиск разработчиков" />
        {q && <button onClick={() => setQ('')} aria-label="Очистить"><Icon name="x" size={18} /></button>}
      </label>
      <div className="mt-s">
        <Chips<Filter> value={filter} onChange={setFilter}
          items={[{ key: 'all', label: 'Все' }, { key: 'online', label: 'В сети' }, { key: 'free', label: 'Свободны' },
            ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))]} />
      </div>
      <div className="section-h" style={{ marginTop: 16 }}>
        <h2>{list.length} {plural(list.length, 'разработчик', 'разработчика', 'разработчиков')}</h2>
        <button onClick={nextSort} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="filter" size={16} />{sorts.find((x) => x.key === sort)!.label}
        </button>
      </div>
      {list.length ? (
        <div className="group">{list.map((d) => <DevCell key={d.id} d={d} onClick={() => nav.push('dev', { id: d.id })} />)}</div>
      ) : (
        <div className="empty">{devs.length ? 'Никого не нашли. Попробуйте другой стек или уберите фильтр.' : 'Каталог пока пуст: разработчики появятся после проверки анкет.'}</div>
      )}
    </div>
  );
}
