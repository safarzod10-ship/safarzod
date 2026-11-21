import { useState } from 'react';
import { type Work } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { absUrl, haptic } from '../tg';
import { Actions, Field, Sheet, Top, pickFiles } from '../ui';

const MAX = 12;
const empty: Work = { title: '', text: '', url: '', image: null, imageId: null };

export default function Portfolio() {
  const nav = useNav();
  const { me, savePortfolio, showToast } = useStore();
  const [items, setItems] = useState<Work[]>(me.profile?.portfolio ?? []);
  const [edit, setEdit] = useState<{ i: number | null; w: Work } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(me.profile?.portfolio ?? []);

  if (!me.profile) {
    return (
      <div className="screen no-tabs"><Top title="Портфолио" small />
        <div className="empty">Портфолио появится после анкеты исполнителя.</div>
        <Actions primary={{ label: 'Заполнить анкету', onClick: () => nav.push('dev-form') }} />
      </div>
    );
  }

  const save = async (next: Work[]) => {
    setBusy(true);
    try { await savePortfolio(next); setItems(next); showToast('Портфолио сохранено'); } catch {} finally { setBusy(false); }
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    haptic.select();
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  return (
    <div className="screen no-tabs" style={{ paddingBottom: 'calc(120px + var(--safe-b))' }}>
      <Top title="Портфолио" small />
      {items.length ? (
        <div className="group stagger">
          {items.map((w, i) => (
            <div className="cell work-row" key={`${w.title}-${i}`}>
              <button className="wr-pic" onClick={() => setEdit({ i, w })} aria-label={`Изменить «${w.title}»`}>
                {w.image ? <img src={absUrl(w.image)} alt="" /> : <Icon name="image" size={22} />}
              </button>
              <button className="cell-body" style={{ textAlign: 'left' }} onClick={() => setEdit({ i, w })}>
                <div className="cell-title"><span className="t">{w.title}</span></div>
                <div className="cell-sub">{w.url ? w.url.replace(/^https?:\/\//, '') : w.text || 'Без описания'}</div>
              </button>
              <div className="wr-move">
                <button className="icon-btn" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="back" size={18} style={{ transform: 'rotate(90deg)' }} /></button>
                <button className="icon-btn" aria-label="Ниже" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="back" size={18} style={{ transform: 'rotate(-90deg)' }} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Работ пока нет</div>
      )}
      {items.length < MAX && (
        <button className="btn secondary mt" onClick={() => setEdit({ i: null, w: { ...empty } })}><Icon name="plus" size={19} />Добавить работу</button>
      )}

      <Actions primary={dirty ? { label: 'Сохранить порядок', onClick: () => save(items), loading: busy } : { label: 'Готово', onClick: nav.pop }} />

      <WorkSheet open={!!edit} start={edit?.w ?? empty} isNew={edit?.i === null} onClose={() => setEdit(null)}
        onDelete={async () => { if (edit?.i == null) return; const next = items.filter((_, j) => j !== edit.i); setEdit(null); await save(next); }}
        onSave={async (w) => {
          const next = edit?.i == null ? [...items, w] : items.map((x, j) => (j === edit.i ? w : x));
          await save(next);
          setEdit(null);
        }} />
    </div>
  );
}

function WorkSheet({ open, start, isNew, onClose, onSave, onDelete }: {
  open: boolean; start: Work; isNew: boolean; onClose(): void; onSave(w: Work): Promise<void>; onDelete(): Promise<void>;
}) {
  const { uploadWorkImage, showToast } = useStore();
  const [w, setW] = useState<Work>(start);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  if (open && !shown) { setShown(true); setW(start); }
  if (!open && shown) setShown(false);
  const url = (w.url ?? '').trim();
  const badUrl = !!url && !/^(https?:\/\/|t\.me\/)/.test(url);
  const ok = w.title.trim().length >= 2 && !badUrl && !loading;
  const pick = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { showToast('Картинка больше 10 МБ'); return; }
    setLoading(true);
    try { const r = await uploadWorkImage(f); setW((x) => ({ ...x, image: r.url, imageId: r.imageId })); } catch {} finally { setLoading(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={isNew ? 'Новая работа' : 'Работа'}>
      <button className="pic-drop" onClick={pick} aria-label="Выбрать картинку">
        {w.image && <img src={absUrl(w.image)} alt="" />}
        {loading ? <span className="spin" /> : !w.image && <><Icon name="image" size={26} />Скриншот или обложка</>}
      </button>
      {w.image && !loading && <button className="hint center" style={{ display: 'block', width: '100%', margin: '6px 0 0' }} onClick={pick}>Заменить картинку</button>}
      <div className="mt">
        <Field label="Название"><input className="input" value={w.title} maxLength={80} onChange={(e) => setW({ ...w, title: e.target.value })} placeholder="Бот записи для барбершопа" /></Field>
        <Field label="Что сделано"><textarea className="textarea" style={{ minHeight: 70 }} value={w.text} maxLength={300} onChange={(e) => setW({ ...w, text: e.target.value })} placeholder="Задача и результат в двух предложениях" /></Field>
        <Field label="Ссылка" error={badUrl && 'Ссылка должна начинаться с https://'}>
          <input className="input" value={w.url ?? ''} maxLength={300} inputMode="url" onChange={(e) => setW({ ...w, url: e.target.value })} placeholder="https://t.me/your_bot" />
        </Field>
      </div>
      <button className="btn primary mt" disabled={!ok || busy} onClick={async () => {
        setBusy(true);
        try { await onSave({ ...w, title: w.title.trim(), text: w.text.trim(), url: url || null }); } finally { setBusy(false); }
      }}>{busy ? <span className="spin" /> : isNew ? 'Добавить' : 'Сохранить'}</button>
      {!isNew && <button className="bar-link danger" style={{ display: 'block', margin: '10px auto 0' }} disabled={busy} onClick={onDelete}>Удалить работу</button>}
    </Sheet>
  );
}
