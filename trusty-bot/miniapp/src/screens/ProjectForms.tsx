// Create a project (client), respond to one (developer), pick a developer (client).
import { useState } from 'react';
import { CATEGORIES, amt, budget, plural, usdt } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { Actions, Avatar, Cell, Chips, Done, Field, Note, Rating, Section, Top } from '../ui';

const STACK_HINTS = ['Python', 'aiogram', 'Node.js', 'React', 'Next.js', 'PostgreSQL', 'Mini Apps', 'Figma', 'Flutter', 'Docker', 'TON'];

export function ProjectNew() {
  const nav = useNav();
  const { addProject, showToast } = useStore();
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('bots');
  const [text, setText] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [days, setDays] = useState('7');
  const [stack, setStack] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const errs = {
    title: title.trim().length < 8 && 'Минимум 8 символов: что нужно сделать',
    text: text.trim().length < 40 && `Опишите задачу подробнее: ещё ${Math.max(0, 40 - text.trim().length)} символов`,
    budget: (!+min || (max !== '' && +max < +min)) && 'Укажите бюджет: от и до (или одну сумму)',
    days: !(+days > 0) && 'Укажите срок в днях',
  };
  const ok = !Object.values(errs).some(Boolean);

  const submit = async () => {
    setTried(true);
    if (!ok) { showToast('Заполните выделенные поля'); return; }
    if (busy) return;
    setBusy(true);
    try {
      setDone(await addProject({
        title: title.trim(), category: cat, text: text.trim(), budgetMin: +min, budgetMax: +(max || min), days: +days,
        stack, files: files.map((f) => ({ name: f, size: '—' })),
      }));
    } catch { /* toast shown */ } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="screen no-tabs">
        <Done title="Проект опубликован" text="Разработчики увидят его в ленте. Мы пришлём уведомление в бот, когда придут отклики." />
        <Actions secondary={{ label: 'К проектам', onClick: () => nav.pop() }}
          primary={{ label: 'Открыть проект', onClick: () => nav.replace('project', { id: done }) }} />
      </div>
    );
  }

  return (
    <div className="screen no-tabs">
      <Top title="Новый проект" sub="Чем точнее задача, тем точнее цены в откликах" />
      <Field label="Что нужно сделать" error={tried && errs.title}>
        <input className={`input ${tried && errs.title ? 'bad' : ''}`} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Например, бот для записи в салон" maxLength={90} />
      </Field>
      <Field label="Направление">
        <Chips value={cat} onChange={setCat} items={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} />
      </Field>
      <Field label="Описание и требования" error={tried && errs.text} hint="Что должно работать, примеры, интеграции. Это станет ТЗ сделки.">
        <textarea className={`textarea ${tried && errs.text ? 'bad' : ''}`} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Бот должен…" />
      </Field>
      <Field label="Бюджет, USDT" error={tried && errs.budget}>
        <div className="row2">
          <div className="suffix"><input className={`input num ${tried && errs.budget ? 'bad' : ''}`} inputMode="numeric" value={min}
            onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} placeholder="от" /><span>USDT</span></div>
          <div className="suffix"><input className="input num" inputMode="numeric" value={max}
            onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} placeholder="до" /><span>USDT</span></div>
        </div>
      </Field>
      <Field label="Срок" error={tried && errs.days}>
        <div className="suffix"><input className="input num" inputMode="numeric" value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /><span>{plural(+days || 0, 'день', 'дня', 'дней')}</span></div>
      </Field>
      <Field label="Стек (необязательно)">
        <div className="tags">
          {STACK_HINTS.map((s) => (
            <button key={s} className="tag" onClick={() => setStack((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}
              style={stack.includes(s) ? { background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}>
              {stack.includes(s) ? '✓ ' : ''}{s}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Файлы (необязательно)" hint="ТЗ, макеты, примеры. До 20 МБ.">
        <div className="tags">
          {files.map((f) => <span className="tag" key={f}><Icon name="doc" size={13} /> {f}</span>)}
          <label className="tag" style={{ color: 'var(--primary)', cursor: 'pointer' }}>
            <Icon name="clip" size={13} /> Прикрепить
            <input type="file" multiple hidden onChange={(e) => setFiles((x) => [...x, ...Array.from(e.target.files ?? []).map((f) => f.name)])} />
          </label>
        </div>
      </Field>
      <div className="mt"><Note tone="green" icon="shield">Оплата пойдёт через гаранта после того, как вы выберете исполнителя.</Note></div>
      <Actions primary={{ label: busy ? 'Публикуем…' : 'Опубликовать проект', onClick: submit, disabled: busy }} />
    </div>
  );
}

export function BidForm({ id }: { id: number }) {
  const nav = useNav();
  const { projects, myBidFor, addBid, showToast } = useStore();
  const p = projects.find((x) => x.id === id)!;
  const prev = myBidFor(id);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState(String(prev?.price ?? p.budgetMax));
  const [days, setDays] = useState(String(prev?.days ?? p.days));
  const [text, setText] = useState(prev?.text ?? '');
  const [sent, setSent] = useState(false);
  const ok = +price > 0 && +days > 0 && text.trim().length >= 20;

  if (sent) {
    return (
      <div className="screen no-tabs">
        <Done title="Отклик отправлен" text={`Заказчик увидит вашу цену ${usdt(+price)} и срок ${days} дн. Ответ придёт в чат.`} />
        <Actions primary={{ label: 'Вернуться к проекту', onClick: () => nav.pop() }} />
      </div>
    );
  }

  return (
    <div className="screen no-tabs">
      <Top title="Отклик" sub={p.title} />
      <Note tone="blue">Бюджет заказчика: {budget(p)}, срок {p.days} дн.</Note>
      <div className="mt">
        <div className="row2">
          <Field label="Ваша цена"><div className="suffix"><input className="input num" inputMode="numeric" value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /><span>USDT</span></div></Field>
          <Field label="Срок"><div className="suffix"><input className="input num" inputMode="numeric" value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /><span>дн.</span></div></Field>
        </div>
      </div>
      <div className="mt">
        <Field label="Сопроводительное сообщение" hint="Почему вы подходите: похожие проекты, как будете делать.">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Делал похожий проект для…" />
        </Field>
      </div>
      <Actions primary={{
        label: prev ? 'Обновить отклик' : 'Отправить отклик', disabled: !ok || busy,
        onClick: async () => {
          if (!ok || busy) return;
          setBusy(true);
          try { await addBid({ projectId: id, price: +price, days: +days, text: text.trim() }); showToast('Отклик отправлен'); setSent(true); } catch { /* toast shown */ } finally { setBusy(false); }
        },
      }} />
    </div>
  );
}

export function Choose({ projectId, devId }: { projectId: number; devId: string }) {
  const nav = useNav();
  const { projects, startDeal, devById, payCfg } = useStore();
  const [busy, setBusy] = useState(false);
  const p = projects.find((x) => x.id === projectId)!;
  const b = p.bids.find((x) => x.devId === devId)!;
  const d = devById(devId)!;
  const fee = Math.round(b.price * payCfg.feePercent) / 100;

  return (
    <div className="screen no-tabs">
      <Top title="Начать сделку" sub={p.title} />
      <div className="group">
        <Cell avatar lead={<Avatar name={d.name} hue={d.hue} online={d.lastSeenMin <= 5} />} title={d.name}
          sub={d.title} trail={d.deals ? <Rating value={d.rating} /> : undefined} />
      </div>
      <Section title="Условия">
        <div className="group">
          <Cell title="Сумма сделки" sub="получит исполнитель" trail={<span className="num">{usdt(b.price)}</span>} />
          <Cell title={`Комиссия гаранта, ${payCfg.feePercent}%`} trail={<span className="num">{amt(fee)} {payCfg.asset}</span>} />
          <Cell title={<b>К оплате</b>} trail={<b className="num" style={{ color: 'var(--ink)' }}>{amt(b.price + fee)} {payCfg.asset}</b>} />
          <Cell title="Срок" trail={<span className="num">{b.days} {plural(b.days, 'день', 'дня', 'дней')}</span>} />
          <Cell title="Автоприёмка" sub={`Если вы не ответите ${payCfg.reviewDays} дн. после сдачи, работа принимается автоматически`} />
        </div>
      </Section>
      <div className="mt stack">
        <Note tone="green" icon="shield">Условия и ТЗ зафиксируются в сделке. Изменить их можно только с согласия обеих сторон.</Note>
        <Note tone="blue" icon="coin">Оплата через @CryptoBot в {payCfg.asset}. Деньги хранятся у гаранта, исполнитель получит их после приёмки.</Note>
      </div>
      <Actions primary={{
        label: busy ? 'Создаём сделку…' : `Создать сделку на ${usdt(b.price)}`, disabled: busy,
        onClick: async () => {
          if (busy) return;
          setBusy(true);
          try { nav.open('chats', 'deal', { id: await startDeal(projectId, devId, b.price, b.days) }); } catch { setBusy(false); }
        },
      }} />
    </div>
  );
}
