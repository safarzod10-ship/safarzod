import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { useNav } from './nav';
import { haptic, inTelegram, tg } from './tg';

const AV = ['#2f7d6b', '#8a5a3c', '#3d628a', '#8a3d63', '#5b7a35', '#6650a0', '#a0624f', '#3f8a9a'];

export function Avatar({ name, hue = 0, size = 46, online }: { name: string; hue?: number; size?: number; online?: boolean }) {
  const initials = name.replace(/[«»"]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="av" style={{ width: size, height: size, background: AV[hue % AV.length], fontSize: size * 0.36, color: '#fff' }}>
      {initials}
      {online && <i className="on" />}
    </span>
  );
}

export function Pill({ tone, children }: { tone?: 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function Rating({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="rating num">
      <Icon name="star" size={size} strokeWidth={0} />
      {value.toFixed(1).replace('.', ',')}
    </span>
  );
}

export function Verified() {
  return <span className="verified" title="Проверенный разработчик"><Icon name="shield" size={17} /></span>;
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

export function Cell({ lead, title, sub, meta, trail, onClick, chevron, avatar, clamp }: {
  lead?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; trail?: ReactNode;
  onClick?(): void; chevron?: boolean; avatar?: boolean; clamp?: boolean;
}) {
  const body = (
    <>
      {lead}
      <div className="cell-body">
        <div className="cell-title">{title}</div>
        {sub && <div className={`cell-sub ${clamp ? 'clamp' : ''}`}>{sub}</div>}
        {meta && <div className="cell-meta">{meta}</div>}
      </div>
      {(trail || chevron) && (
        <div className="cell-trail">{trail}{chevron && <Icon name="chevron" size={18} />}</div>
      )}
    </>
  );
  const cls = `cell ${avatar ? 'has-avatar' : ''}`;
  return onClick ? <button className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

export function IconTile({ name, tone }: { name: IconName; tone?: 'red' | 'amber' | 'blue' }) {
  return <span className={`ic ${tone ?? ''}`}><Icon name={name} size={19} /></span>;
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

export function Seg<T extends string>({ items, value, onChange }: { items: { key: NoInfer<T>; label: string; count?: number }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="seg" role="tablist">
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

interface Act { label: string; onClick(): void; disabled?: boolean; tone?: 'danger' }

/**
 * Screen actions. Inside Telegram the primary action uses the native MainButton (and SecondaryButton when the
 * client supports it); in a browser they render as a bar pinned to the bottom.
 */
export function Actions({ primary, secondary }: { primary?: Act; secondary?: Act }) {
  const p = useRef(primary);
  const s = useRef(secondary);
  p.current = primary;
  s.current = secondary;
  const native = inTelegram && !!tg?.MainButton;
  const nativeSecondary = native && !!secondary && !!tg?.SecondaryButton && tg.isVersionAtLeast('7.10');

  useEffect(() => {
    if (!native || !primary) return;
    const mb = tg!.MainButton;
    const handler = () => { if (!p.current?.disabled) { haptic.tap(); p.current?.onClick(); } };
    mb.onClick(handler);
    mb.show();
    return () => { mb.offClick(handler); mb.hide(); };
  }, [native, !!primary]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!native || !primary) return;
    const dark = document.documentElement.classList.contains('dark');
    tg!.MainButton.setParams({
      text: primary.label,
      color: primary.tone === 'danger' ? '#C4472B' : dark ? '#22A57B' : '#178A66',
      text_color: '#FFFFFF',
      is_active: !primary.disabled,
      is_visible: true,
    });
  });

  useEffect(() => {
    if (!nativeSecondary) return;
    const sb = tg!.SecondaryButton!;
    const handler = () => { haptic.tap(); s.current?.onClick(); };
    sb.setParams({ text: secondary!.label, position: 'left', is_visible: true, is_active: true });
    sb.onClick(handler);
    sb.show();
    return () => { sb.offClick(handler); sb.hide(); };
  }, [nativeSecondary, secondary?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  if (native && (!secondary || nativeSecondary)) return null;
  return (
    <div className="bar">
      <div className="bar-in">
        {secondary && <button className="btn secondary" onClick={secondary.onClick}>{secondary.label}</button>}
        {primary && !native && (
          <button className={`btn ${primary.tone === 'danger' ? 'danger' : 'primary'}`} disabled={primary.disabled} onClick={primary.onClick}>
            {primary.label}
          </button>
        )}
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
      <div className="ok"><Icon name="check" size={34} strokeWidth={2.4} /></div>
      <h1>{title}</h1>
      <p>{text}</p>
      {children}
    </div>
  );
}
