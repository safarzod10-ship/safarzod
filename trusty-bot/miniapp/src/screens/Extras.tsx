import { useEffect, useState } from 'react';
import { LEVEL_LABEL, LEVEL_RULES, budget, levelOf, plural, type Dev, type Level, type Work } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { absUrl, haptic, openTg, shareInline, sharePrepared, tg } from '../tg';
import { Avatar, Info, LevelBadge, Mark, ProBadge, Sheet, Skeleton } from '../ui';

export function LevelInfo({ d }: { d: Dev }) {
  const level = levelOf(d);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <LevelBadge level={level} />
      <Info label="Уровни исполнителей">
        {LEVEL_RULES.map((r) => <span key={r.key} style={{ display: 'block', marginBottom: 6 }}><b style={{ color: r.key === level ? 'var(--green-text)' : 'var(--ink)' }}>{r.title}.</b> {r.rule}</span>)}
      </Info>
    </span>
  );
}

export function LevelSheet({ open, onClose, d }: { open: boolean; onClose(): void; d: Dev }) {
  const level = levelOf(d);
  const order: Level[] = ['new', 'verified', 'top'];
  const at = order.indexOf(level);
  return (
    <Sheet open={open} onClose={onClose} title="Ваш уровень">
      <div className="group ladder">
        {LEVEL_RULES.map((r, i) => (
          <div key={r.key} className={`cell ${i <= at ? 'on' : ''}`}>
            <span className="ic" style={{ color: i <= at ? 'var(--green-text)' : 'var(--dim)' }}><Icon name={i < at ? 'done' : i === at ? 'current' : 'todo'} size={22} /></span>
            <div className="cell-body"><div className="cell-title">{r.title}{i === at && <span className="pill green" style={{ marginLeft: 6 }}>сейчас</span>}</div><div className="cell-sub clamp-none">{r.rule}</div></div>
          </div>
        ))}
      </div>
      {d.levelNext?.left.length ? (
        <div className="mt">
          <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>До уровня «{d.levelNext.name}» осталось</div>
          <div className="group">{d.levelNext.left.map((x) => <div key={x} className="cell"><div className="cell-body"><div className="cell-title" style={{ fontWeight: 600 }}>{x}</div></div></div>)}</div>
        </div>
      ) : level === 'top' ? <p className="small center mt" style={{ color: 'var(--green-text)', fontWeight: 700 }}>Это высший уровень</p> : null}
    </Sheet>
  );
}

export function levelHint(d: Dev): string {
  const level = levelOf(d);
  if (level === 'top') return 'Высший уровень';
  const left = d.levelNext?.left ?? [];
  return left.length ? `До «${d.levelNext!.name}»: ${left[0].toLowerCase()}` : `До «${level === 'new' ? LEVEL_LABEL.verified : LEVEL_LABEL.top}» — больше сделок`;
}

export function Works({ items }: { items: Work[] }) {
  return (
    <div className="works">
      {items.map((w, i) => (
        <div className="work" key={`${w.title}-${i}`}>
          <div className="pic">{w.image ? <img src={absUrl(w.image)} alt="" loading="lazy" /> : <Icon name="image" size={28} />}</div>
          <div className="body">
            <b>{w.title}</b>
            {w.text && <span>{w.text}</span>}
            {w.url && <a href={w.url} target="_blank" rel="noreferrer" onClick={(e) => { if (tg?.openLink) { e.preventDefault(); tg.openLink(w.url!); } }}>{w.url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 34)} ↗</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShareSheet({ open, onClose, d, self }: { open: boolean; onClose(): void; d: Dev; self?: boolean }) {
  const { live, showToast, shareBase, shareDev, shareInlineOn } = useStore();
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = `${shareBase}${d.id}`;
  const card = absUrl(`/api/share/dev/${d.id}.jpg`);
  const text = self ? 'Мой профиль исполнителя в IT Trusty: сделки через гаранта, оплата в USDT' : `${d.name} — ${d.title}. Профиль в IT Trusty`;
  const story = live && !!tg?.shareToStory && tg.isVersionAtLeast('7.8');
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await shareDev(d.id);
      if (r.prepared && sharePrepared(r.prepared, (sent) => { if (sent) { haptic.success(); showToast('Отправлено'); onClose(); } })) return;
      if (shareInlineOn && shareInline(`dev_${d.id}`)) { onClose(); return; }
      openTg(`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`);
      onClose();
    } catch { showToast('Не получилось, попробуйте ещё раз'); } finally { setBusy(false); }
  };
  const toStory = () => {
    const premium = !!tg?.initDataUnsafe.user?.is_premium;
    tg!.shareToStory!(card, premium ? { text, widget_link: { url: link, name: 'Открыть профиль' } } : { text: `${text}\n@${link.split('/')[3].split('?')[0]}` });
    onClose();
  };
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => showToast('Ссылка скопирована')).catch(() => showToast(link));
    haptic.success();
  };
  return (
    <Sheet open={open} onClose={onClose} title={self ? 'Поделиться профилем' : 'Поделиться'}>
      <div className="share-pic">
        {live && !broken ? <img src={card} alt="Карточка профиля" onError={() => setBroken(true)} /> : <CardPreview d={d} />}
      </div>
      <button className="btn primary mt" onClick={send} disabled={busy}>{busy ? <span className="spin" /> : <><Icon name="send" size={19} />Переслать</>}</button>
      <div className="group mt-s">
        {story && (
          <button className="cell" onClick={toStory}>
            <span className="ic"><Icon name="image" size={22} /></span><div className="cell-body"><div className="cell-title">В историю</div></div><Icon name="chevron" size={18} className="chev" />
          </button>
        )}
        <button className="cell" onClick={copy}>
          <span className="ic"><Icon name="copy" size={22} /></span><div className="cell-body"><div className="cell-title">Скопировать ссылку</div></div>
        </button>
      </div>
    </Sheet>
  );
}

function CardPreview({ d }: { d: Dev }) {
  return (
    <div className="card-preview">
      <div className="cp-top"><Mark size={20} color="#fff" /><span>IT Trusty</span>{d.pro && <ProBadge />}</div>
      <div className="cp-main">
        <Avatar name={d.name} size={54} />
        <div><b>{d.name}</b><span>{d.title}</span></div>
      </div>
      <div className="cp-stats">
        <span><b>{d.deals ? d.rating.toFixed(1) : '—'}</b>рейтинг</span>
        <span><b>{d.deals}</b>{plural(d.deals, 'сделка', 'сделки', 'сделок')}</span>
        <span><b>{d.deals ? `${d.onTime}%` : '—'}</b>в срок</span>
        <span><b>{LEVEL_LABEL[levelOf(d)]}</b>уровень</span>
      </div>
    </div>
  );
}

export function InviteSheet({ open, onClose, d }: { open: boolean; onClose(): void; d: Dev }) {
  const nav = useNav();
  const { projects, isMe, invite } = useStore();
  const [busy, setBusy] = useState<number | null>(null);
  const mine = projects.filter((p) => p.status === 'open' && isMe(p.clientId));
  if (!mine.length) {
    return (
      <Sheet open={open} onClose={onClose} title="Сначала проект">
        <p className="muted" style={{ margin: '0 0 18px', fontWeight: 500, lineHeight: 1.5 }}>
          Пригласить можно в опубликованный проект.
        </p>
        <button className="btn primary" onClick={() => { onClose(); nav.open('home', 'project-new'); }}>Опубликовать проект</button>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title="Пригласить в проект">
      <div className="group">
        {mine.map((p) => {
          const done = p.invitedIds?.includes(d.id);
          return (
            <div key={p.id} className="cell">
              <div className="cell-body">
                <div className="cell-title"><span className="t">{p.title}</span></div>
                <div className="cell-sub num">{budget(p)} · {p.days} дн.</div>
              </div>
              {done ? <span className="pill green"><Icon name="check" size={13} strokeWidth={2.4} />Приглашён</span>
                : <button className="btn primary sm" disabled={busy !== null} onClick={async () => {
                  setBusy(p.id);
                  try { await invite(p.id, d.id); } catch {} finally { setBusy(null); }
                }}>{busy === p.id ? <span className="spin" /> : 'Пригласить'}</button>}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function Matches({ projectId, invited }: { projectId: number; invited: string[] }) {
  const nav = useNav();
  const { loadMatches, invite } = useStore();
  const [list, setList] = useState<Dev[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { let on = true; loadMatches(projectId).then((x) => on && setList(x)); return () => { on = false; }; }, [projectId, loadMatches]);
  if (list === null) return <Skeleton rows={3} />;
  if (!list.length) return <div className="text muted small">Пока никого</div>;
  return (
    <div className="group">
      {list.map((d) => (
        <div key={d.id} className="cell has-avatar">
          <button style={{ display: 'contents' }} onClick={() => nav.push('dev', { id: d.id })}>
            <Avatar name={d.name} size={44} online={d.lastSeenMin <= 5} />
            <div className="cell-body" style={{ textAlign: 'left' }}>
              <div className="cell-title"><span className="t">{d.name}</span>{d.pro && <ProBadge />}</div>
              <div className="cell-sub num">{d.deals ? <>★ {d.rating.toFixed(1)} · {d.deals} {plural(d.deals, 'сделка', 'сделки', 'сделок')} · {LEVEL_LABEL[levelOf(d)]}</> : 'новый исполнитель'}</div>
            </div>
          </button>
          {invited.includes(d.id) ? <span className="pill green" style={{ flex: 'none' }}><Icon name="check" size={13} strokeWidth={2.4} />Приглашён</span>
            : <button className="btn secondary sm" style={{ flex: 'none' }} disabled={busy !== null} onClick={async () => {
              setBusy(d.id);
              try { await invite(projectId, d.id); } catch {} finally { setBusy(null); }
            }}>{busy === d.id ? <span className="spin" /> : 'Пригласить'}</button>}
        </div>
      ))}
    </div>
  );
}
