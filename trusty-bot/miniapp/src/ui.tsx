import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';
import { useNav } from './nav';
import { haptic, inTelegram } from './tg';

export const MARK_UP = 'M285 468C285 432 300 412 338 401C360.8 393.5 452.9 366.4 597 280C615 269 638 269 656 280C800.1 366.4 892.2 393.5 915 401C953 412 968 432 968 468L968 492C945 476 920 470 890 470C706 470 548 704 372 704C325 704 285 685 285 635Z';
export const MARK_LO = 'M325.3 766C338 777 370 783 400 783C608 783 738 547 890 547C935 547 968 560 968 600C968 880 640 1038 640 1038C632 1044 621 1044 613 1038C613 1038 412.9 941.6 325.3 766Z';

/** the IT Trusty shield with the wave */
export function Mark({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="285 268 684 778" width={Math.round(size * 684 / 778)} height={size} aria-hidden="true">
      <path fill={color} d={MARK_UP} /><path fill={color} d={MARK_LO} />
    </svg>
  );
}

export function Avatar({ name, size = 46, online }: { name: string; hue?: number; size?: number; online?: boolean }) {
  const initials = name.replace(/[«»"]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="av" style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}>
      {initials}
      {online && <i className="on live" />}
    </span>
  );
}

export function Pill({ tone, children }: { tone?: 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function Rating({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="rating num">
      {value.toFixed(1)}
      <Icon name="star" size={size} strokeWidth={0} />
    </span>
  );
}

export function Verified() {
  return <span className="verified" title="Анкета проверена"><Icon name="badge" size={16} strokeWidth={2} /></span>;
}

/** amount with the currency: big Unbounded digits, small "USDT" */
export function Amount({ value, cur = 'USDT', size = 15 }: { value: ReactNode; cur?: string; size?: number }) {
  return <span className="cell-amt"><b style={{ fontSize: size }}>{value}</b><small style={{ fontSize: Math.max(9, size * 0.6) }}>{cur}</small></span>;
}

export function Top({ title, sub, right, small }: { title: string; sub?: ReactNode; right?: ReactNode; small?: boolean }) {
  const nav = useNav();
  return (
    <div className="top">
      {!inTelegram && nav.depth > 1 && (
        <button className="icon-btn" onClick={nav.pop} aria-label="Назад"><Icon name="back" /></button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 className={small ? 'sm' : ''}>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: string; action?: { label: string; onClick(): void }; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className ?? ''}`}>
      {(title || action) && (
        <div className="section-h">
          {title && <h2>{title}</h2>}
          {action && <button onClick={action.onClick}>{action.label}</button>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Cell({ lead, title, sub, meta, trail, onClick, chevron, avatar, icon, clamp, hot }: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; trail?: ReactNode;
  onClick?(): void; chevron?: boolean; avatar?: boolean; icon?: boolean; clamp?: boolean; hot?: boolean;
}) {
  const body = (
    <>
      {lead}
      <div className="cell-body">
        <div className="cell-title">{title}</div>
        {sub && <div className={`cell-sub ${clamp ? 'clamp' : ''} ${hot ? 'hot' : ''}`}>{sub}</div>}
        {meta && <div className="cell-meta">{meta}</div>}
      </div>
      {(trail || chevron) && (
        <div className="cell-trail">{trail}{chevron && <Icon name="chevron" size={17} strokeWidth={2} />}</div>
      )}
    </>
  );
  const cls = `cell ${avatar ? 'has-avatar' : ''} ${icon ? 'has-icon' : ''}`;
  return onClick ? <button className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

/** an icon in a list row: no tile behind it */
export function IconTile({ name, tone, className }: { name: IconName; tone?: 'red' | 'amber' | 'blue'; className?: string }) {
  return <span className={`ic ${tone ?? ''} ${className ?? ''}`}><Icon name={name} size={22} /></span>;
}

export function Chips<T extends string>({ items, value, onChange }: { items: { key: NoInfer<T>; label: string; count?: number }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="chips" role="tablist">
      {items.map((i) => (
        <button key={i.key} role="tab" aria-selected={value === i.key} className={`chip ${value === i.key ? 'on' : ''}`}
          onClick={() => { haptic.select(); onChange(i.key); }}>
          {i.label}{i.count !== undefined && <small className="num">{i.count}</small>}
        </button>
      ))}
    </div>
  );
}

/** segmented control; the green thumb slides to the chosen item */
export function Seg<T extends string>({ items, value, onChange }: { items: { key: NoInfer<T>; label: string; count?: number }[]; value: T; onChange(v: T): void }) {
  const idx = Math.max(0, items.findIndex((i) => i.key === value));
  return (
    <div className="seg" role="tablist">
      <span className="seg-thumb" style={{ width: `calc((100% - 6px - ${(items.length - 1) * 3}px) / ${items.length})`, transform: `translateX(calc(${idx} * (100% + 3px)))` }} />
      {items.map((i) => (
        <button key={i.key} role="tab" aria-selected={value === i.key} className={value === i.key ? 'on' : ''}
          onClick={() => { haptic.select(); onChange(i.key); }}>
          {i.label}{!!i.count && <span className="count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | false; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <div className="hint bad">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Note({ tone, icon = 'info', children }: { tone: 'amber' | 'red' | 'green' | 'blue'; icon?: IconName; children: ReactNode }) {
  return <div className={`note ${tone}`}><Icon name={icon} size={18} /><div>{children}</div></div>;
}

/** (i) that opens a short explanation next to it; long texts live here instead of on the screen */
export function Info({ children, label = 'Подробнее' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(16, Math.min(r.left - 20, window.innerWidth - 316)), top: r.bottom + window.scrollY + 8 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = window.setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('click', close); };
  }, [open]);
  return (
    <>
      <span ref={ref} role="button" tabIndex={0} aria-label={label} aria-expanded={open} className="info"
        onClick={(e) => { e.stopPropagation(); haptic.select(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => !o); }}>
        <Icon name="info" size={16} strokeWidth={2} />
      </span>
      {open && createPortal(<div className="pop" role="tooltip" style={{ left: pos.left, top: pos.top }}>{children}</div>, document.body)}
    </>
  );
}

interface Act { label: string; onClick(): void; disabled?: boolean; tone?: 'danger'; loading?: boolean }

/** Screen actions pinned to the bottom: one green main button, an optional grey one beside it and a text link under. */
export function Actions({ primary, secondary, link }: { primary?: Act; secondary?: Act; link?: Act }) {
  if (!primary && !secondary && !link) return null;
  return (
    <div className="bar">
      <div className="bar-in">
        {(primary || secondary) && (
          <div className="bar-row">
            {secondary && !primary?.loading && <button className="btn secondary" disabled={secondary.disabled} onClick={() => { haptic.tap(); secondary.onClick(); }}>{secondary.label}</button>}
            {primary && (
              <button className={`btn paybtn ${primary.tone === 'danger' ? 'danger' : 'primary'} ${primary.loading ? 'loading' : ''}`} disabled={primary.disabled || primary.loading}
                onClick={() => { haptic.tap(); primary.onClick(); }}>
                {primary.loading ? <span className="spin" aria-label="Загрузка" /> : primary.label}
              </button>
            )}
          </div>
        )}
        {link && <button className={`bar-link ${link.tone === 'danger' ? 'danger' : ''}`} onClick={link.onClick}>{link.label}</button>}
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose(): void; title?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`}
      onClick={() => { haptic.select(); onChange(!on); }} />
  );
}

export function Done({ title, text, children }: { title: string; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="done">
      <div className="ok"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <h1>{title}</h1>
      <p>{text}</p>
      {children}
    </div>
  );
}

/** grey placeholder rows that shimmer while data loads */
export function Skeleton({ rows = 4, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="group" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          {avatar && <span className="sk" style={{ width: 42, height: 42, borderRadius: 21, flex: 'none' }} />}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="sk" style={{ height: 12, width: `${70 - (i % 3) * 12}%` }} />
            <span className="sk" style={{ height: 10, width: `${45 - (i % 2) * 10}%` }} />
          </div>
          <span className="sk" style={{ width: 38, height: 14 }} />
        </div>
      ))}
    </div>
  );
}

/** digits roll to the new value (counter-offers, amounts) */
export function Odometer({ value }: { value: number }) {
  const s = String(Math.max(0, Math.round(value)));
  return (
    <span className="odo num" aria-label={s}>
      {s.split('').map((d, i) => (
        <span key={`${s.length}-${i}`} className="col" aria-hidden="true">
          <span className="strip" style={{ transform: `translateY(-${Number(d)}em)` }}>
            {'0123456789'.split('').map((x) => <span key={x}>{x}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** counts a number up from zero (success screens) */
export function useCountUp(target: number, ms = 900, run = true) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now() + 250;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, run]);
  return v;
}

/** full-screen confirmation: green circle, the check draws itself, the amount counts up */
export function Success({ title, amount, cur = 'USDT', text, onDone }: { title: string; amount?: number; cur?: string; text?: string; onDone(): void }) {
  const v = useCountUp(amount ?? 0, 900, amount !== undefined);
  useEffect(() => { haptic.success(); const t = window.setTimeout(onDone, 2400); return () => window.clearTimeout(t); }, [onDone]);
  return (
    <div className="success" role="status" onClick={onDone}>
      <div className="ok"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <h2>{title}</h2>
      {amount !== undefined && <div className="sum num"><b>{v.toFixed(2).replace('.', ',')}</b><small>{cur}</small></div>}
      {text && <p>{text}</p>}
    </div>
  );
}

/** waiting for the payment: an arc runs round the ₮ */
export function WaitPay({ text = 'Ждём оплату' }: { text?: string }) {
  return (
    <div className="waitpay" role="status">
      <div className="ringbox">
        <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="45" fill="none" stroke="#1e2023" strokeWidth="6" /></svg>
        <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true" className="arc"><circle cx="52" cy="52" r="45" fill="none" stroke="#2b9a6c" strokeWidth="6" strokeLinecap="round" strokeDasharray="66 217" /></svg>
        <div className="t">₮</div>
      </div>
      <p>{text}<span className="dots"><i /><i /><i /></span></p>
    </div>
  );
}

/** time left as "47ч 58м" with a ring that empties */
export function Timer({ from, to }: { from?: string; to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const end = new Date(to).getTime();
  const start = from ? new Date(from).getTime() : end - 48 * 3600e3;
  const left = Math.max(0, end - now);
  const frac = Math.max(0, Math.min(1, left / Math.max(1, end - start)));
  const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3), s = Math.floor((left % 60e3) / 1e3);
  const label = h ? `${h}ч ${String(m).padStart(2, '0')}м` : `${m}м ${String(s).padStart(2, '0')}с`;
  const C = 2 * Math.PI * 7;
  return (
    <span className="timer num">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="track" cx="9" cy="9" r="7" fill="none" strokeWidth="2.4" />
        <circle className="left" cx="9" cy="9" r="7" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      {label}
    </span>
  );
}
