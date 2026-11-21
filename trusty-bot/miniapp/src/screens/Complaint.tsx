import { useState } from 'react';
import { REASONS, type ComplaintReason } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, Done, Field, Note, Section, Top } from '../ui';

interface Shot { file: File; url: string }
const MAX = 6;

export default function Complaint({ against, name, deal }: { against: string; name?: string; deal?: number }) {
  const nav = useNav();
  const { addComplaint, members, devById } = useStore();
  const who = members.find((m) => m.id === against) ?? devById(against);
  const title = who?.name ?? name ?? 'Пользователь';
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [text, setText] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState<number | null>(null);
  const ok = !!reason && text.trim().length >= 20 && shots.length > 0;

  if (id) {
    return (
      <div className="screen no-tabs">
        <Done title={`Жалоба #${id} отправлена`} text="Арбитр изучит переписку и доказательства и ответит в течение 24 часов. Если нарушение подтвердится, аккаунт будет заблокирован." />
        <Actions primary={{ label: 'Готово', onClick: () => nav.pop() }} />
      </div>
    );
  }

  const submit = async () => {
    if (!ok || !reason || busy) return;
    setBusy(true);
    try {
      setId(await addComplaint({ againstId: against, againstName: title, dealId: deal, reason, text: text.trim(),
        files: shots.map((s) => s.file), previews: shots.map((s) => s.url) }));
    } catch {} finally { setBusy(false); }
  };

  return (
    <div className="screen no-tabs">
      <Top title="Жалоба" />
      <div className="group">
        <Cell avatar lead={<Avatar name={title} hue={who?.hue ?? 0} />} title={title}
          sub={`${who?.handle ? `@${who.handle}` : ''}${deal ? `${who?.handle ? ' · ' : ''}сделка #${deal}` : ''}` || undefined} />
      </div>

      <Section title="Что случилось">
        <div className="group">
          {REASONS.map((r) => (
            <button key={r.key} className={`radio ${reason === r.key ? 'on' : ''}`} onClick={() => setReason(r.key)} role="radio" aria-checked={reason === r.key}>
              <i />{r.label}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <Field label="Подробности" hint="Даты, суммы, что обещали и что произошло. Минимум 20 символов.">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Опишите ситуацию" maxLength={4000} />
        </Field>
      </Section>

      <Section title={`Доказательства · ${shots.length} из ${MAX}`}>
        <div className="thumbs">
          {shots.map((s, i) => (
            <div className="thumb" key={s.url}>
              <img src={s.url} alt={`Доказательство ${i + 1}`} />
              <button aria-label="Удалить" onClick={() => setShots(shots.filter((x) => x !== s))}><Icon name="x" size={14} /></button>
            </div>
          ))}
          {shots.length < MAX && (
            <label className="thumb add">
              <Icon name="plus" size={22} />Скриншот
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
                onChange={(e) => {
                  const add = Array.from(e.target.files ?? []).filter((f) => f.size <= 8 * 1024 * 1024).slice(0, MAX - shots.length);
                  setShots([...shots, ...add.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
                  e.target.value = '';
                }} />
            </label>
          )}
        </div>
        <p className="hint mt-s">До 8 МБ каждый</p>
      </Section>

      <div className="mt"><Note tone="amber">За ложные жалобы блокируют.</Note></div>
      <Actions primary={{ label: busy ? 'Отправляем…' : 'Отправить жалобу', disabled: !ok || busy, onClick: submit }} />
    </div>
  );
}
