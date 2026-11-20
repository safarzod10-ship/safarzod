// Complaint with evidence (screenshots, files) against a developer or a client.
import { useState } from 'react';
import { MEMBERS, REASONS, type ComplaintReason } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, Done, Field, Note, Section, Top } from '../ui';

export default function Complaint({ against, deal }: { against: string; deal?: number }) {
  const nav = useNav();
  const { addComplaint } = useStore();
  const who = MEMBERS.find((m) => m.id === against);
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [text, setText] = useState('');
  const [shots, setShots] = useState<string[]>([]);
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

  return (
    <div className="screen no-tabs">
      <Top title="Жалоба" sub="Нужны доказательства: без них арбитр не сможет принять решение" />
      {who && (
        <div className="group">
          <Cell avatar lead={<Avatar name={who.name} hue={who.hue} />} title={who.name}
            sub={`@${who.handle}${deal ? ` · сделка #${deal}` : ''}`} />
        </div>
      )}

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
        <Field label="Подробности" hint="Даты, суммы, что обещали и что произошло">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Опишите ситуацию" />
        </Field>
      </Section>

      <Section title={`Доказательства · ${shots.length}`}>
        <div className="thumbs">
          {shots.map((s, i) => (
            <div className="thumb" key={s}>
              <img src={s} alt={`Доказательство ${i + 1}`} />
              <button aria-label="Удалить" onClick={() => setShots(shots.filter((x) => x !== s))}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <label className="thumb add">
            <Icon name="plus" size={22} />Скриншот
            <input type="file" accept="image/*" multiple hidden
              onChange={(e) => setShots([...shots, ...Array.from(e.target.files ?? []).map((f) => URL.createObjectURL(f))])} />
          </label>
        </div>
        <p className="hint mt-s">Скриншоты переписки, условий, переводов. Переписку из чата Trusty арбитр увидит сам.</p>
      </Section>

      <div className="mt"><Note tone="amber">За заведомо ложные жалобы блокируют так же, как за обман.</Note></div>
      <Actions primary={{
        label: 'Отправить жалобу', disabled: !ok,
        onClick: () => { if (ok && reason) setId(addComplaint({ againstId: against, dealId: deal, reason, text: text.trim(), evidence: shots })); },
      }} />
    </div>
  );
}
