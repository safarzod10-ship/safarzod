// Deal screen (escrow), my deals, and the admin's finance & disputes screen.
import { useEffect, useState, type CSSProperties } from 'react';
import { DEAL_STATUS, DEAL_TONE, amt, dateTime, type Deal } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { onReturn, openTg } from '../tg';
import { Actions, Avatar, Cell, Field, IconTile, Note, Pill, Section, Sheet, Top } from '../ui';

const STEPS = ['Оплата', 'Работа', 'Приёмка', 'Выплата'];
const STEP_OF: Record<Deal['status'], number> = { awaiting_payment: 0, in_work: 1, review: 2, dispute: 2, done: 4, refunded: 4, cancelled: -1 };
const PAY_LABEL: Record<string, string> = { sent: 'Отправлено', check: 'Чек', pending: 'В обработке', failed: 'Повторяем', paid: 'Оплачено', active: 'Ожидает', expired: 'Истёк' };

function Stepper({ status }: { status: Deal['status'] }) {
  const step = STEP_OF[status];
  if (step < 0) return null;
  return (
    <div className="stepper" aria-label="Этапы сделки" style={{ '--p': Math.min(step, 3) / 3 } as CSSProperties}>
      {STEPS.map((s, i) => (
        <div key={s} className={`st ${i < step ? 'is-done' : i === step ? 'is-cur' : ''} ${status === 'dispute' && i === step ? 'is-bad' : ''}`}>
          <i />{s}
        </div>
      ))}
    </div>
  );
}

function hint(d: Deal, asset: string): { tone: 'amber' | 'green' | 'blue' | 'red'; text: string } | null {
  const client = d.role === 'client';
  switch (d.status) {
    case 'awaiting_payment':
      return client ? { tone: 'amber', text: `Оплатите ${amt(d.total)} ${asset} в @CryptoBot. Деньги будут у гаранта, исполнитель получит их только после приёмки работы.` }
        : { tone: 'amber', text: 'Ждём оплату от заказчика. Не начинайте работу, пока сделка не оплачена: мы пришлём уведомление.' };
    case 'in_work':
      return client ? { tone: 'blue', text: `Деньги у гаранта. Исполнитель работает, срок до ${d.due}.` }
        : { tone: 'green', text: `Оплата у гаранта. Сдайте работу до ${d.due}: файлы и ссылки отправьте в чат сделки, затем нажмите «Сдать работу».` };
    case 'review':
      return client ? { tone: 'amber', text: `Проверьте работу до ${dateTime(d.reviewUntil)}. Без ответа она примется автоматически и деньги уйдут исполнителю.` }
        : { tone: 'blue', text: `Заказчик проверяет работу до ${dateTime(d.reviewUntil)}. Потом работа примется автоматически.` };
    case 'dispute':
      return { tone: 'red', text: `Спор у арбитра: «${d.disputeReason ?? ''}». Деньги заморожены до решения. Доводы и доказательства пишите в чат сделки.` };
    case 'done':
      return d.resolution ? { tone: 'blue', text: d.resolution }
        : client ? { tone: 'green', text: 'Работа принята, исполнитель получил оплату.' } : { tone: 'green', text: `Работа принята. ${amt(d.amount)} ${asset} отправлены вам в @CryptoBot.` };
    case 'refunded':
      return { tone: 'blue', text: d.resolution ?? (client ? 'Деньги возвращены вам в @CryptoBot.' : 'Сделка закрыта, деньги возвращены заказчику.') };
    case 'cancelled':
      return { tone: 'blue', text: 'Сделка отменена до оплаты.' };
  }
}

function Stars({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Оценка">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} aria-label={`${n}`} className={n <= value ? 'on' : ''} onClick={() => onChange(n)}>
          <Icon name="star" size={34} strokeWidth={0} />
        </button>
      ))}
    </div>
  );
}

export default function DealView({ id }: { id: number }) {
  const nav = useNav();
  const { deals, loadDeal, checkDeal, payDeal, dealAct, resolveDeal, payCfg, showToast, live } = useStore();
  const [sheet, setSheet] = useState<null | 'submit' | 'accept' | 'dispute' | 'cancel' | 'review' | 'resolve'>(null);
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
  const [share, setShare] = useState(50);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const d = deals.find((x) => x.id === id);

  useEffect(() => { loadDeal(id); }, [id, loadDeal]);
  // after paying in @CryptoBot: re-check on return and every few seconds for a while
  useEffect(() => {
    if (!waiting) return;
    const stop = onReturn(() => { checkDeal(id); });
    let n = 0;
    const t = window.setInterval(() => { if (++n > 40) setWaiting(false); else checkDeal(id); }, 3000);
    return () => { stop(); window.clearInterval(t); };
  }, [waiting, id, checkDeal]);
  useEffect(() => { if (waiting && d && d.status !== 'awaiting_payment') { setWaiting(false); showToast('Оплата получена'); } }, [waiting, d, showToast]);

  if (!d) return <div className="screen no-tabs"><Top title="Сделка" small /><div className="empty">Загружаем сделку…</div></div>;
  const a = d.actions;
  const asset = payCfg.asset;
  const h = hint(d, asset);
  const other = d.role === 'dev' ? d.client : d.dev;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); setSheet(null); setText(''); if (done) showToast(done); } catch { /* toast shown */ } finally { setBusy(false); }
  };
  const pay = () => run(async () => { await payDeal(d.id); setWaiting(true); });

  // the main action for this role and state; the rest are links under the summary
  const primary = a.pay ? { label: `Оплатить ${amt(d.total)} ${asset}`, onClick: pay }
    : a.submit ? { label: 'Сдать работу', onClick: () => setSheet('submit') }
      : a.accept && d.status === 'review' ? { label: 'Принять работу', onClick: () => setSheet('accept') }
        : a.review ? { label: 'Оставить отзыв', onClick: () => setSheet('review') }
          : a.resolve ? { label: 'Решить спор', onClick: () => setSheet('resolve') }
            : undefined;
  const chat = d.chatId ? { label: 'Чат сделки', onClick: () => nav.push('chat', { id: d.chatId }) } : undefined;

  return (
    <div className="screen no-tabs">
      <Top title={`Сделка #${d.id}`} small sub={<span style={{ display: 'inline-flex', gap: 6, marginTop: 4 }}>
        <Pill tone={DEAL_TONE[d.status]}>{DEAL_STATUS[d.status]}</Pill>
        <Pill>{d.role === 'client' ? 'вы заказчик' : d.role === 'dev' ? 'вы исполнитель' : 'арбитраж'}</Pill>
      </span>} />

      <div className="deal-sum">
        <div className="deal-title">{d.title}</div>
        <div className="deal-amount num">{amt(d.amount)} <span>{asset}</span></div>
        <Stepper status={d.status} />
      </div>

      {!live && <div className="mt"><Note tone="amber" icon="info">Это демо в браузере: деньги не списываются. Настоящая оплата через @CryptoBot работает в боте @mytrusty_bot.</Note></div>}
      {h && <div className="mt"><Note tone={h.tone} icon={d.status === 'dispute' ? 'flag' : d.status === 'done' ? 'check' : 'shield'}>{h.text}</Note></div>}
      {waiting && d.status === 'awaiting_payment' && (
        <div className="mt-s"><Note tone="blue" icon="clock">Ждём подтверждение оплаты от @CryptoBot. Обычно это несколько секунд после оплаты.</Note></div>
      )}

      <Section title="Деньги">
        <div className="group">
          <Cell title="Сумма сделки" sub={d.role === 'dev' ? 'вы получите после приёмки' : 'получит исполнитель'} trail={<span className="num">{amt(d.amount)} {asset}</span>} />
          {d.role !== 'dev' && d.fee && <Cell title={`Комиссия гаранта, ${payCfg.feePercent}%`} trail={<span className="num">{amt(d.fee)} {asset}</span>} />}
          {d.role !== 'dev' && <Cell title={<b>{d.paidAt ? 'Оплачено' : 'К оплате'}</b>} trail={<b className="num" style={{ color: 'var(--ink)' }}>{amt(d.total)} {asset}</b>} />}
          {d.payments.filter((p) => p.kind !== 'invoice').map((p) => (
            <Cell key={p.id} lead={<IconTile name="coin" tone={p.status === 'failed' ? 'amber' : undefined} />}
              title={`${p.kind === 'payout' ? 'Выплата' : 'Возврат'} ${amt(p.amount)} ${asset}`}
              sub={p.status === 'check' ? 'Получите по чеку в @CryptoBot' : `${PAY_LABEL[p.status] ?? p.status} · ${dateTime(p.at)}`}
              trail={p.url ? <button className="btn primary sm" onClick={() => openTg(p.url!)}>Получить</button> : undefined} />
          ))}
        </div>
      </Section>

      <Section title="Участники">
        <div className="group">
          {[d.client, d.dev].map((u, i) => (
            <Cell key={u.id} avatar lead={<Avatar name={u.name} hue={u.hue} online={u.lastSeenMin <= 5} />} title={u.name}
              sub={i === 0 ? 'заказчик' : 'исполнитель'} chevron={i === 1}
              onClick={i === 1 ? () => nav.push('dev', { id: u.id }) : undefined} />
          ))}
          <Cell title="Срок" trail={<span className="num">до {d.due}</span>} />
        </div>
      </Section>

      {d.workNote && <Section title="Комментарий к сдаче"><div className="text">{d.workNote}</div></Section>}
      {d.review && (
        <Section title="Отзыв заказчика">
          <div className="text"><span className="rating" style={{ color: '#e2a52b' }}>{'★'.repeat(d.review.rating)}</span>{d.review.text && <div className="mt-s">{d.review.text}</div>}</div>
        </Section>
      )}

      <div className="deal-links">
        {a.accept && d.status === 'in_work' && <button onClick={() => setSheet('accept')}>Принять работу досрочно</button>}
        {a.dispute && <button onClick={() => setSheet('dispute')}>Открыть спор</button>}
        {a.cancel && <button className="danger" onClick={() => setSheet('cancel')}>{d.status === 'awaiting_payment' ? 'Отменить сделку' : 'Отказаться от сделки'}</button>}
        {d.role !== 'admin' && <button onClick={() => nav.push('complaint', { against: other.id, name: other.name, deal: d.id })}>Пожаловаться</button>}
      </div>

      <Actions primary={primary ? { ...primary, disabled: busy } : chat} secondary={primary ? chat : undefined} />

      <Sheet open={sheet === 'submit'} onClose={() => setSheet(null)} title="Сдать работу">
        <p className="muted small" style={{ marginTop: 0 }}>Отправьте файлы и ссылки в чат сделки. У заказчика будет {payCfg.reviewDays} дн. на проверку, потом работа примется автоматически.</p>
        <Field label="Комментарий (необязательно)"><textarea className="textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что сделано, где посмотреть" /></Field>
        <button className="btn primary mt" disabled={busy} onClick={() => run(() => dealAct(d.id, 'submit', { note: text }), 'Работа сдана')}>Сдать работу</button>
      </Sheet>
      <Sheet open={sheet === 'accept'} onClose={() => setSheet(null)} title="Принять работу?">
        <p className="muted small" style={{ marginTop: 0 }}>Гарант сразу переведёт {amt(d.amount)} {asset} исполнителю. Отменить это будет нельзя.</p>
        <button className="btn primary" disabled={busy} onClick={() => run(() => dealAct(d.id, 'accept'), 'Работа принята')}>Принять и выплатить</button>
      </Sheet>
      <Sheet open={sheet === 'dispute'} onClose={() => setSheet(null)} title="Открыть спор">
        <p className="muted small" style={{ marginTop: 0 }}>Деньги заморозятся. Арбитр изучит переписку в чате сделки и решит, как их распределить.</p>
        <Field label="Что не так" hint="Минимум 10 символов"><textarea className="textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: работа не соответствует ТЗ" /></Field>
        <button className="btn danger mt" disabled={busy || text.trim().length < 10} onClick={() => run(() => dealAct(d.id, 'dispute', { reason: text.trim() }), 'Спор открыт')}>Открыть спор</button>
      </Sheet>
      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title={d.status === 'awaiting_payment' ? 'Отменить сделку?' : 'Отказаться от сделки?'}>
        <p className="muted small" style={{ marginTop: 0 }}>{d.status === 'awaiting_payment' ? 'Счёт будет удалён, проект снова откроется для откликов.'
          : `Заказчику вернутся все ${amt(d.total)} ${asset}, проект снова откроется для откликов.`}</p>
        <button className="btn danger" disabled={busy} onClick={() => run(() => dealAct(d.id, 'cancel'), 'Сделка закрыта')}>Да, {d.status === 'awaiting_payment' ? 'отменить' : 'отказаться'}</button>
      </Sheet>
      <Sheet open={sheet === 'review'} onClose={() => setSheet(null)} title="Отзыв об исполнителе">
        <Stars value={rating} onChange={setRating} />
        <Field label="Комментарий (необязательно)"><textarea className="textarea" style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что понравилось" /></Field>
        <button className="btn primary mt" disabled={busy} onClick={() => run(() => dealAct(d.id, 'review', { rating, text }), 'Спасибо за отзыв')}>Отправить</button>
      </Sheet>
      <Sheet open={sheet === 'resolve'} onClose={() => setSheet(null)} title="Решение по спору">
        <p className="muted small" style={{ marginTop: 0 }}>Спор открыл {d.disputeBy === 'dev' ? 'исполнитель' : 'заказчик'}: «{d.disputeReason}»</p>
        <div className="share">
          <div className="share-row num"><span>Исполнителю<b>{amt(Math.floor(d.amount * share) / 100)} {asset}</b></span><span>Заказчику<b>{amt(d.amount - Math.floor(d.amount * share) / 100)} {asset}</b></span></div>
          <input type="range" min={0} max={100} step={10} value={share} onChange={(e) => setShare(+e.target.value)} aria-label="Доля исполнителя" />
          <div className="share-ticks"><span>всё заказчику</span><b>{share}%</b><span>всё исполнителю</span></div>
        </div>
        <Field label="Комментарий к решению"><textarea className="textarea" style={{ minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Его увидят обе стороны" /></Field>
        <p className="hint">Комиссия гаранта остаётся у Trusty. Деньги уйдут сразу после решения.</p>
        <button className="btn primary mt" disabled={busy} onClick={() => run(() => resolveDeal(d.id, share, text), 'Спор решён')}>Решить и выплатить</button>
      </Sheet>
    </div>
  );
}

export function DealCell({ d, onClick }: { d: Deal; onClick(): void }) {
  const other = d.role === 'dev' ? d.client : d.dev;
  return (
    <Cell onClick={onClick} chevron avatar lead={<Avatar name={other.name} hue={other.hue} online={other.lastSeenMin <= 5} />}
      title={<span className="t">{d.title}</span>}
      sub={<span className="num">#{d.id} · {amt(d.amount)} USDT · {d.role === 'dev' ? 'вы исполнитель' : d.role === 'client' ? 'вы заказчик' : `${d.client.name} → ${d.dev.name}`}</span>}
      meta={<Pill tone={DEAL_TONE[d.status]}>{DEAL_STATUS[d.status]}</Pill>} />
  );
}

export function DealsList() {
  const nav = useNav();
  const { deals } = useStore();
  const active = deals.filter((d) => ['awaiting_payment', 'in_work', 'review', 'dispute'].includes(d.status));
  const closed = deals.filter((d) => !active.includes(d));
  return (
    <div className="screen no-tabs">
      <Top title="Мои сделки" sub="Деньги каждой сделки хранятся у гаранта до приёмки" />
      {deals.length === 0 && <div className="empty">Сделок пока нет. Выберите исполнителя в проекте или предложите проект разработчику.</div>}
      {active.length > 0 && <Section title={`Активные · ${active.length}`}><div className="group">{active.map((d) => <DealCell key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div></Section>}
      {closed.length > 0 && <Section title="Завершённые"><div className="group">{closed.map((d) => <DealCell key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div></Section>}
    </div>
  );
}

export function Finance() {
  const nav = useNav();
  const { finance, loadFinance, retryPayment } = useStore();
  useEffect(() => { loadFinance().catch(() => {}); }, [loadFinance]);
  if (!finance) return <div className="screen no-tabs"><Top title="Финансы" small /><div className="empty">Загружаем…</div></div>;
  const failed = finance.payments.filter((p) => p.status === 'failed' || p.status === 'pending');
  return (
    <div className="screen no-tabs">
      <Top title="Финансы и споры" sub={`Crypto Pay · комиссия ${finance.feePercent}%`} />
      {!finance.enabled && <Note tone="red" icon="info">Оплата не подключена: на сервере нет токена Crypto Pay.</Note>}
      {finance.error && <Note tone="amber" icon="info">Crypto Pay не ответил: {finance.error}</Note>}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat"><b>{amt(finance.balance.find((b) => b.asset === finance.asset)?.available ?? '0')}</b><span>баланс {finance.asset}</span></div>
        <div className="stat"><b>{amt(finance.held)}</b><span>у гаранта по сделкам</span></div>
      </div>
      <p className="hint mt-s">Баланс приложения в @CryptoBot должен покрывать деньги у гаранта: из него идут выплаты и возвраты.</p>

      <Section title={`Споры · ${finance.disputes.length}`}>
        {finance.disputes.length ? <div className="group">{finance.disputes.map((d) => <DealCell key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div>
          : <div className="empty">Открытых споров нет.</div>}
      </Section>

      {failed.length > 0 && (
        <Section title={`Требуют внимания · ${failed.length}`}>
          <div className="group">
            {failed.map((p) => (
              <Cell key={p.id} lead={<IconTile name="coin" tone="amber" />} title={`${p.kind === 'refund' ? 'Возврат' : 'Выплата'} ${amt(p.amount)} · #${p.dealId}`}
                sub={`${p.user} · попыток ${p.attempts}${p.error ? ` · ${p.error}` : ''}`}
                trail={<button className="btn secondary sm" onClick={() => retryPayment(p.id).catch(() => {})}>Повторить</button>} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Последние операции">
        <div className="group">
          {finance.payments.slice(0, 40).map((p) => (
            <Cell key={p.id} title={`${p.kind === 'invoice' ? 'Счёт' : p.kind === 'payout' ? 'Выплата' : 'Возврат'} ${amt(p.amount)} ${finance.asset}`}
              sub={`#${p.dealId} · ${p.user} · ${dateTime(p.at)}`}
              trail={<Pill tone={p.status === 'failed' ? 'red' : p.status === 'active' || p.status === 'pending' ? 'amber' : 'green'}>{PAY_LABEL[p.status] ?? p.status}</Pill>} />
          ))}
          {finance.payments.length === 0 && <div className="empty">Операций пока нет.</div>}
        </div>
      </Section>
    </div>
  );
}
