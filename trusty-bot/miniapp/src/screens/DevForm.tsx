import { useState } from 'react';
import { CATEGORIES } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { tgUser } from '../tg';
import { Actions, Avatar, Done, Field, Note, Seg, Top } from '../ui';

const STACK = ['Python', 'aiogram', 'Django', 'FastAPI', 'Node.js', 'grammY', 'NestJS', 'React', 'Next.js', 'Vue', 'TypeScript',
  'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Flutter', 'Kotlin', 'Swift', 'Solidity', 'TON / FunC', 'Figma', 'Mini Apps'];

export default function DevForm() {
  const nav = useNav();
  const { submitDevForm, me, live } = useStore();
  const prev = live ? me.profile : null;
  const yearKey = (y?: number) => (y === undefined ? '2' : y < 1 ? '0' : y <= 3 ? '2' : y <= 5 ? '4' : '6');
  const [step, setStep] = useState(0);
  const [cats, setCats] = useState<string[]>(prev?.categories ?? []);
  const [years, setYears] = useState(yearKey(prev?.years));
  const [stack, setStack] = useState<string[]>(prev?.stack ?? []);
  const [custom, setCustom] = useState('');
  const [rate, setRate] = useState(String(prev?.rate ?? 20));
  const [status, setStatus] = useState<'free' | 'busy'>(prev?.status === 'busy' ? 'busy' : 'free');
  const [about, setAbout] = useState(prev?.about ?? '');
  const [github, setGithub] = useState(prev?.github ?? '');
  const [links, setLinks] = useState((prev?.links ?? []).join('\n'));
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const can = [cats.length > 0 && +years >= 0, stack.length >= 2, +rate > 0, about.trim().length >= 60][step];
  const titles = ['Чем вы занимаетесь', 'Ваш стек', 'Ставка и занятость', 'О себе и портфолио'];

  if (sent) {
    return (
      <div className="screen no-tabs">
        <Done title="Анкета на проверке" text="Обычно проверка занимает до 2 часов. После неё профиль появится в каталоге, а мы напишем в бот." />
        <Actions primary={{ label: 'В профиль', onClick: () => nav.pop() }} />
      </div>
    );
  }

  return (
    <div className="screen no-tabs">
      <Top title="Анкета разработчика" sub={`Шаг ${step + 1} из 4 · ${titles[step]}`} />
      {step === 0 && me.devForm === 'rejected' && me.moderationNote && (
        <div style={{ marginBottom: 14 }}><Note tone="red" icon="info">Комментарий модератора: {me.moderationNote}</Note></div>
      )}
      <div className="progress"><i style={{ width: `${(step + 1) * 25}%` }} /></div>

      {step === 0 && (
        <>
          <Field label="Направления" hint="Можно выбрать несколько">
            <div className="pick">
              {CATEGORIES.map((c) => (
                <button key={c.key} className={cats.includes(c.key) ? 'on' : ''} onClick={() => toggle(cats, setCats, c.key)}>
                  {c.label}{cats.includes(c.key) && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Коммерческий опыт">
            <Seg value={years} onChange={setYears}
              items={[{ key: '0', label: '< 1 года' }, { key: '2', label: '1–3' }, { key: '4', label: '3–5' }, { key: '6', label: '5+' }]} />
          </Field>
        </>
      )}

      {step === 1 && (
        <Field label="Технологии" hint="Минимум две. По ним вас найдут в поиске.">
          <div className="tags">
            {[...STACK, ...stack.filter((s) => !STACK.includes(s))].map((s) => (
              <button key={s} className="tag" onClick={() => toggle(stack, setStack, s)}
                style={stack.includes(s) ? { background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}>
                {stack.includes(s) ? '✓ ' : ''}{s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Добавить свою технологию" />
            <button className="btn secondary sm" onClick={() => { const v = custom.trim(); if (v && !stack.includes(v)) setStack([...stack, v]); setCustom(''); }}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </Field>
      )}

      {step === 2 && (
        <>
          <Field label="Ставка" hint="Ориентир для заказчиков. Цену за проект вы указываете в каждом отклике.">
            <div className="suffix"><input className="input num" inputMode="numeric" value={rate}
              onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} /><span>USDT / час</span></div>
          </Field>
          <Field label="Сейчас">
            <Seg value={status} onChange={(v) => setStatus(v)} items={[{ key: 'free', label: 'Свободен' }, { key: 'busy', label: 'Занят' }]} />
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <Field label="О себе" hint={`Опыт, сильные стороны, как работаете. ${about.trim().length < 60 ? `Ещё ${60 - about.trim().length} символов.` : ''}`}>
            <textarea className="textarea" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Пишу ботов с 2021 года…" />
          </Field>
          <Field label="GitHub (необязательно)" hint="Привязанный GitHub даёт отметку в профиле">
            <input className="input" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="username" />
          </Field>
          <Field label="Ссылки на работы (необязательно)" hint="По одной в строке">
            <textarea className="textarea" style={{ minHeight: 80 }} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://t.me/my_bot" />
          </Field>
          <div className="section-h mt"><h2>Так увидят заказчики</h2></div>
          <div className="group">
            <div className="cell has-avatar">
              <Avatar name={tgUser ? `${tgUser.first_name} ${tgUser.last_name ?? ''}` : 'Вы'} hue={0} online />
              <div className="cell-body">
                <div className="cell-title">{tgUser?.first_name ?? 'Ваше имя'}</div>
                <div className="cell-sub">{cats.map((c) => CATEGORIES.find((x) => x.key === c)?.label).join(', ') || 'Направления'} · {stack.slice(0, 3).join(', ')}</div>
                <div className="cell-meta"><span className="pill blue">Новый разработчик</span><span>от {rate || 0} $/ч</span></div>
              </div>
            </div>
          </div>
        </>
      )}

      <Actions
        secondary={step > 0 ? { label: 'Назад', onClick: () => setStep(step - 1) } : undefined}
        primary={{
          label: step < 3 ? 'Дальше' : busy ? 'Отправляем…' : 'Отправить анкету', disabled: !can || busy,
          onClick: async () => {
            if (!can || busy) return;
            if (step < 3) { setStep(step + 1); window.scrollTo(0, 0); return; }
            setBusy(true);
            try {
              await submitDevForm({ categories: cats, years: +years, stack, rate: +rate, status, about: about.trim(), github: github.trim(),
                links: links.split(/\n+/).map((x) => x.trim()).filter(Boolean) });
              setSent(true);
            } catch {} finally { setBusy(false); }
          },
        }} />
    </div>
  );
}
