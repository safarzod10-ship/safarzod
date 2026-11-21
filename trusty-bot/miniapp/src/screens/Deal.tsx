// Deal screen (escrow), my deals, and the admin's finance & disputes screen.
import { useEffect, useRef, useState } from 'react';
import { DEAL_STATUS, amt, dateTime, type Deal } from '../data';
import { useNav } from '../nav';
import { useStore } from '../store';
import { onReturn, openTg } from '../tg';
import { Actions, Amount, Avatar, Cell, Field, IconTile, Info, Loader, Note, Pill, Section, Sheet, Skeleton, Success, Top, WaitPay } from '../ui';
import { Icon, type IconName } from '../icons';

const PAY_LABEL: Record<string, string> = { sent: 'Отправлено', check: 'Чек', pending: 'В обработке', failed: 'Повторяем', paid: 'Оплачено', active: 'Ожидает', expired: 'Истёк' };
export const isActive = (s: Deal['status']) => s === 'awaiting_payment' || s === 'in_work' || s === 'review' || s === 'dispute';
const ICON: Record<Deal['status'], IconName> = {
  awaiting_payment: 'wallet', in_work: 'hammer', review: 'eye', dispute: 'scale', done: 'done', cancelled: 'failed', refunded: 'undo',
};

function leftText(iso?: string | null) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'сейчас';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 3600e3);
  return d ? `${d}д ${h}ч` : `${h}ч ${Math.floor((ms % 3600e3) / 60e3)}м`;
}

/** what the deal waits for, from my side; hot = my move */
function stateLine(d: Deal): { text: string; hot: boolean } {
  const client = d.role === 'client';
  switch (d.status) {
    case 'awaiting_payment': return client ? { text: 'Ждёт вашей оплаты', hot: true } : { text: 'Ждёт оплаты заказчика', hot: false };
    case 'in_work': return d.role === 'dev' ? { text: `Сдать до ${d.due}`, hot: true } : { text: `В работе · до ${d.due}`, hot: false };
    case 'review': return client ? { text: 'Ждёт вашей проверки', hot: true } : { text: 'На проверке у заказчика', hot: false };
    case 'dispute': return { text: 'Спор у арбитра', hot: false };
    default: return { text: DEAL_STATUS[d.status], hot: false };
  }
}

export function DealRow({ d, onClick }: { d: Deal; onClick(): void }) {
  const st = stateLine(d);
  return (
    <Cell icon onClick={onClick} lead={<IconTile name={ICON[d.status]} tone={d.status === 'dispute' ? 'red' : undefined} />}
      title={<span className="t">{d.title}</span>} sub={d.role === 'admin' ? `${d.client.name} → ${d.dev.name}` : st.text} hot={st.hot}
      trail={<Amount value={amt(d.amount)} />} chevron />
  );
}
export const DealCell = DealRow;

function Steps({ d }: { d: Deal }) {
  const at = { awaiting_payment: 0, in_work: 1, review: 2, dispute: 2, done: 4, refunded: 4, cancelled: -1 }[d.status];
  if (at < 0) return null;
  const rows: { t: string; s: string }[] = [
    { t: 'Оплата', s: d.paidAt ? dateTime(d.paidAt) : d.role === 'client' ? 'ждёт вас' : 'ждём заказчика' },
    { t: 'Работа', s: d.submittedAt ? dateTime(d.submittedAt) : `до ${d.due}` },
    { t: d.status === 'dispute' ? 'Спор у арбитра' : 'Проверка', s: d.status === 'review' ? leftText(d.reviewUntil) : d.finishedAt ? dateTime(d.finishedAt) : '' },
    { t: d.status === 'refunded' ? 'Возврат заказчику' : 'Выплата', s: d.finishedAt ? dateTime(d.finishedAt) : '' },
  ];
  return (
    <div className="group track">
      {rows.map((r, i) => {
        const state = i < at ? 'done' : i === at ? (d.status === 'dispute' ? 'bad' : 'cur') : 'todo';
        return (
          <div key={r.t} className="cell has-icon">
            <span className={`ic st-${state}`} style={state === 'todo' ? { color: 'var(--dim)' } : undefined}>
              <Icon name={state === 'done' ? 'done' : state === 'cur' ? 'current' : state === 'bad' ? 'scale' : 'todo'} size={22} strokeWidth={2} />
            </span>
            <div className="cell-body"><div className={`cell-title ${state === 'todo' ? 'todo' : ''}`}>{r.t}</div></div>
            <span className="cell-trail num" style={{ fontWeight: 600 }}>{r.s}</span>
          </div>
        );
      })}
    </div>
  );
}

function help(d: Deal, asset: string, reviewDays: number): string | null {
  const client = d.role === 'client';
  switch (d.status) {
    case 'awaiting_payment': return client ? `Оплатите ${amt(d.total)} ${asset} в @CryptoBot. Деньги будут у гаранта: исполнитель получит их только после того, как вы примете работу.`
      : 'Ждём оплату от заказчика. Не начинайте работу, пока сделка не оплачена: мы пришлём уведомление.';
    case 'in_work': return client ? `Деньги у гаранта. Исполнитель работает, срок до ${d.due}. Можно принять работу досрочно.`
      : `Оплата у гаранта. Сдайте работу до ${d.due}: файлы и ссылки отправьте в чат, затем нажмите «Сдать работу». У заказчика будет ${reviewDays} дн. на проверку.`;
    case 'review': return client ? `Проверьте работу до ${dateTime(d.reviewUntil)}. Без ответа она примется автоматически, и деньги уйдут исполнителю.`
      : `Заказчик проверяет работу до ${dateTime(d.reviewUntil)}. Потом работа примется автоматически.`;
    case 'dispute': return `Спор: «${d.disputeReason ?? ''}». Деньги заморожены до решения арбитра. Доводы и доказательства пишите в чат сделки.`;
    case 'done': return d.resolution ?? (client ? 'Работа принята, исполнитель получил оплату.' : `Работа принята. ${amt(d.amount)} ${asset} отправлены вам в @CryptoBot.`);
    case 'refunded': return d.resolution ?? (client ? 'Деньги возвращены вам в @CryptoBot.' : 'Сделка закрыта, деньги возвращены заказчику.');
    case 'cancelled': return 'Сделка отменена до оплаты.';
  }
}

function Stars({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Оценка">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} aria-label={`${n}`} className={n <= value ? 'on' : ''} onClick={() => onChange(n)}>
          <Icon name="star" size={36} strokeWidth={0} />
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
  const [paying, setPaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [success, setSuccess] = useState<null | { title: string; amount: number; text: string; then?: 'review' }>(null);
  const [menu, setMenu] = useState(false);
  const d = deals.find((x) => x.id === id);
  const prev = useRef(d?.status);

  useEffect(() => { loadDeal(id); }, [id, loadDeal]);
  // after paying in @CryptoBot: re-check on return and every few seconds for a while
  useEffect(() => {
    if (!waiting) return;
    const stop = onReturn(() => { checkDeal(id); });
    let n = 0;
    const t = window.setInterval(() => { if (++n > 40) setWaiting(false); else checkDeal(id); }, 3000);
    return () => { stop(); window.clearInterval(t); };
  }, [waiting, id, checkDeal]);
  useEffect(() => {
    if (!d) return;
    if (prev.current === 'awaiting_payment' && d.status === 'in_work') {
      setWaiting(false);
      setSuccess({ title: 'Оплата получена', amount: Number(d.total), text: 'Деньги у гаранта. Исполнитель уже знает, что можно начинать.' });
    }
    prev.current = d.status;
  }, [d]);

  if (!d) return <div className="screen no-tabs"><Top title="Сделка" small /><Loader label="Загружаем сделку" /></div>;
  const a = d.actions;
  const asset = payCfg.asset;
  const other = d.role === 'dev' ? d.client : d.dev;
  const tone = d.status === 'dispute' ? 'red' : isActive(d.status) || d.status === 'done' ? 'green' : undefined;
  const info = help(d, asset, payCfg.reviewDays);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); setSheet(null); setText(''); if (done) showToast(done); } catch { /* toast shown */ } finally { setBusy(false); }
  };
  const pay = async () => {
    if (paying) return;
    setPaying(true);
    try { await payDeal(d.id); setWaiting(true); } catch { /* toast shown */ } finally { setPaying(false); }
  };
  // after accepting, the success screen leads straight into rating the executor
  const accept = () => run(async () => {
    await dealAct(d.id, 'accept');
    setSuccess({ title: 'Работа принята', amount: d.amount, text: `Гарант отправил ${amt(d.amount)} ${asset} исполнителю.`, then: 'review' });
  });
  const rateLabel = d.role === 'dev' ? 'Оценить заказчика' : 'Оценить исполнителя';
  const extra = [
    a.accept && d.status === 'in_work' && { label: 'Принять работу досрочно', icon: 'done' as const, onClick: () => setSheet('accept') },
    a.dispute && a.cancel && { label: 'Отказаться от сделки', icon: 'failed' as const, onClick: () => setSheet('cancel'), danger: true },
    d.role !== 'admin' && { label: 'Пожаловаться', icon: 'flag' as const, onClick: () => nav.push('complaint', { against: other.id, name: other.name, deal: d.id }) },
  ].filter(Boolean) as { label: string; icon: IconName; onClick(): void; danger?: boolean }[];

  const primary = a.pay ? { label: `Оплатить ${amt(d.total)} ${asset}`, onClick: pay, loading: paying }
    : a.submit ? { label: 'Сдать работу', onClick: () => setSheet('submit') }
      : a.accept && d.status === 'review' ? { label: 'Принять работу', onClick: () => setSheet('accept') }
        : a.review ? { label: rateLabel, onClick: () => setSheet('review') }
          : a.resolve ? { label: 'Решить спор', onClick: () => setSheet('resolve') }
            : undefined;
  const chat = d.chatId ? { label: 'Чат', onClick: () => nav.push('chat', { id: d.chatId }) } : undefined;
  const link = a.dispute ? { label: 'Открыть спор', onClick: () => setSheet('dispute'), tone: 'danger' as const }
    : a.cancel ? { label: d.status === 'awaiting_payment' ? 'Отменить сделку' : 'Отказаться от сделки', onClick: () => setSheet('cancel'), tone: 'danger' as const }
      : undefined;

  return (
    <div className="screen no-tabs" style={{ paddingBottom: 'calc(150px + var(--safe-b))' }}>
      <Top title={`Сделка #${d.id}`} small right={extra.length ? <button className="icon-btn" aria-label="Ещё" onClick={() => setMenu(true)}><Icon name="dots" /></button> : undefined} />
      <div className="deal-head">
        <div className="t">{d.title}</div>
        <div className="sum num"><b>{amt(d.amount)}</b><small>{asset}</small></div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Pill tone={tone}>{DEAL_STATUS[d.status]}</Pill>
          {info && <Info label="Что сейчас происходит">{info}</Info>}
        </span>
      </div>

      {waiting && d.status === 'awaiting_payment' && <WaitPay text="Ждём оплату в @CryptoBot" />}
      {!live && d.status === 'awaiting_payment' && <div className="mt"><Note tone="amber">Демо в браузере: деньги не списываются. Настоящая оплата работает в боте.</Note></div>}

      <Section title="Ход сделки"><Steps d={d} /></Section>

      <Section title="Детали">
        <div className="group">
          <Cell avatar lead={<Avatar name={other.name} size={40} online={other.lastSeenMin <= 5} />} title={other.name}
            sub={d.role === 'admin' ? `${d.client.name} → ${d.dev.name}` : d.role === 'dev' ? 'заказчик' : 'исполнитель'}
            chevron={d.role !== 'dev'} onClick={d.role !== 'dev' ? () => nav.push('dev', { id: d.dev.id }) : undefined} />
          <Cell title="Срок" trail={<span className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>до {d.due}</span>} />
          {d.role !== 'dev' && d.fee && (
            <Cell title={<>Гарант {payCfg.feePercent}% <Info label="Комиссия">Комиссию платит заказчик. Исполнитель получает всю сумму сделки.</Info></>}
              trail={<span className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>{amt(d.fee)} {asset}</span>} />
          )}
          {d.role !== 'dev' && <Cell title={d.paidAt ? 'Оплачено' : 'К оплате'} trail={<Amount value={amt(d.total)} cur={asset} />} />}
          {d.payments.filter((p) => p.kind !== 'invoice').map((p) => (
            <Cell key={p.id} title={`${p.kind === 'payout' ? 'Выплата' : 'Возврат'} ${amt(p.amount)} ${asset}`}
              sub={p.status === 'check' ? 'Получите по чеку в @CryptoBot' : `${PAY_LABEL[p.status] ?? p.status} · ${dateTime(p.at)}`}
              trail={p.url ? <button className="btn primary sm" onClick={() => openTg(p.url!)}>Получить</button> : undefined} />
          ))}
        </div>
      </Section>

      {d.workNote && <Section title="Комментарий к сдаче"><div className="text">{d.workNote}</div></Section>}
      {(d.review || d.clientReview) && (
        <Section title="Отзывы">
          <div className="group">
            {d.review && <Cell title={<>Заказчик об исполнителе <span className="rating">{d.review.rating}.0<Icon name="star" size={12} strokeWidth={0} /></span></>} sub={d.review.text || 'Без комментария'} />}
            {d.clientReview && <Cell title={<>Исполнитель о заказчике <span className="rating">{d.clientReview.rating}.0<Icon name="star" size={12} strokeWidth={0} /></span></>} sub={d.clientReview.text || 'Без комментария'} />}
          </div>
        </Section>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="group">
          {extra.map((x) => (
            <Cell key={x.label} lead={<IconTile name={x.icon} tone={x.danger ? 'red' : undefined} />}
              title={<span style={x.danger ? { color: 'var(--red)' } : undefined}>{x.label}</span>}
              onClick={() => { setMenu(false); x.onClick(); }} />
          ))}
        </div>
      </Sheet>

      <Actions primary={primary ? { ...primary, disabled: busy } : chat} secondary={primary ? chat : undefined} link={link} />

      <Sheet open={sheet === 'submit'} onClose={() => setSheet(null)} title="Сдать работу">
        <p className="muted small" style={{ marginTop: 0 }}>Файлы и ссылки отправьте в чат сделки. У заказчика будет {payCfg.reviewDays} дн. на проверку, потом работа примется автоматически.</p>
        <Field label="Комментарий"><textarea className="textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что сделано, где посмотреть" /></Field>
        <button className="btn primary mt" disabled={busy} onClick={() => run(() => dealAct(d.id, 'submit', { note: text }), 'Работа сдана')}>{busy ? <span className="spin" /> : 'Сдать работу'}</button>
      </Sheet>
      <Sheet open={sheet === 'accept'} onClose={() => setSheet(null)} title="Принять работу?">
        <p className="muted small" style={{ marginTop: 0 }}>Гарант сразу переведёт {amt(d.amount)} {asset} исполнителю. Отменить это будет нельзя.</p>
        <button className="btn primary" disabled={busy} onClick={accept}>{busy ? <span className="spin" /> : 'Принять и выплатить'}</button>
      </Sheet>
      <Sheet open={sheet === 'dispute'} onClose={() => setSheet(null)} title="Открыть спор">
        <p className="muted small" style={{ marginTop: 0 }}>Деньги заморозятся. Арбитр изучит переписку в чате сделки и решит, как их распределить.</p>
        <Field label="Что не так" hint="Минимум 10 символов"><textarea className="textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: работа не соответствует ТЗ" /></Field>
        <button className="btn danger mt" disabled={busy || text.trim().length < 10} onClick={() => run(() => dealAct(d.id, 'dispute', { reason: text.trim() }), 'Спор открыт')}>Открыть спор</button>
      </Sheet>
      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title={d.status === 'awaiting_payment' ? 'Отменить сделку?' : 'Отказаться от сделки?'}>
        <p className="muted small" style={{ marginTop: 0 }}>{d.status === 'awaiting_payment' ? 'Счёт будет удалён.'
          : `Заказчику вернутся все ${amt(d.total)} ${asset}.`}</p>
        <button className="btn danger" disabled={busy} onClick={() => run(() => dealAct(d.id, 'cancel'), 'Сделка закрыта')}>Да, {d.status === 'awaiting_payment' ? 'отменить' : 'отказаться'}</button>
      </Sheet>
      <Sheet open={sheet === 'review'} onClose={() => setSheet(null)} title={rateLabel}>
        <p className="muted small" style={{ margin: '0 0 4px' }}>Как прошла сделка с {other.name}? Отзыв увидят другие {d.role === 'dev' ? 'исполнители' : 'заказчики'}.</p>
        <Stars value={rating} onChange={setRating} />
        <Field label="Комментарий"><textarea className="textarea" style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что понравилось" /></Field>
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
        <p className="hint">Комиссия гаранта остаётся у IT Trusty. Деньги уйдут сразу после решения.</p>
        <button className="btn primary mt" disabled={busy} onClick={() => run(() => resolveDeal(d.id, share, text), 'Спор решён')}>Решить и выплатить</button>
      </Sheet>
      {success && <Success title={success.title} amount={success.amount} text={success.text} cur={asset}
        onDone={() => { const next = success.then; setSuccess(null); if (next === 'review') setSheet('review'); }} />}
    </div>
  );
}

export function DealsList() {
  const nav = useNav();
  const { deals } = useStore();
  const active = deals.filter((d) => isActive(d.status));
  const closed = deals.filter((d) => !active.includes(d));
  return (
    <div className="screen no-tabs">
      <Top title="Мои сделки" />
      {deals.length === 0 && <div className="empty">Сделок пока нет. Договоритесь о цене в чате с исполнителем: принятый оффер становится сделкой.</div>}
      {active.length > 0 && <Section title={`Активные · ${active.length}`}><div className="group stagger">{active.map((d) => <DealRow key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div></Section>}
      {closed.length > 0 && <Section title="Архив"><div className="group stagger">{closed.map((d) => <DealRow key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div></Section>}
    </div>
  );
}

export function Finance() {
  const nav = useNav();
  const { finance, loadFinance, retryPayment } = useStore();
  useEffect(() => { loadFinance().catch(() => {}); }, [loadFinance]);
  if (!finance) return <div className="screen no-tabs"><Top title="Финансы" small /><Skeleton rows={5} avatar={false} /></div>;
  const failed = finance.payments.filter((p) => p.status === 'failed' || p.status === 'pending');
  return (
    <div className="screen no-tabs">
      <Top title="Финансы" sub={`Crypto Pay · комиссия ${finance.feePercent}%`} />
      {!finance.enabled && <Note tone="red" icon="info">Оплата не подключена: на сервере нет токена Crypto Pay.</Note>}
      {finance.error && <Note tone="amber" icon="info">Crypto Pay не ответил: {finance.error}</Note>}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat"><b>{amt(finance.balance.find((b) => b.asset === finance.asset)?.available ?? '0')}</b><span>баланс {finance.asset}</span></div>
        <div className="stat"><b>{amt(finance.held)}</b><span>у гаранта по сделкам</span></div>
      </div>
      <p className="hint mt-s">Баланс приложения в @CryptoBot должен покрывать деньги у гаранта: из него идут выплаты и возвраты.</p>

      <Section title={`Споры · ${finance.disputes.length}`}>
        {finance.disputes.length ? <div className="group">{finance.disputes.map((d) => <DealRow key={d.id} d={d} onClick={() => nav.push('deal', { id: d.id })} />)}</div>
          : <div className="empty">Открытых споров нет.</div>}
      </Section>

      {failed.length > 0 && (
        <Section title={`Требуют внимания · ${failed.length}`}>
          <div className="group">
            {failed.map((p) => (
              <Cell key={p.id} icon lead={<IconTile name="coin" />} title={`${p.kind === 'refund' ? 'Возврат' : 'Выплата'} ${amt(p.amount)} · #${p.dealId}`}
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
              trail={<Pill tone={p.status === 'failed' ? 'red' : p.status === 'sent' || p.status === 'paid' ? 'green' : undefined}>{PAY_LABEL[p.status] ?? p.status}</Pill>} />
          ))}
          {finance.payments.length === 0 && <div className="empty">Операций пока нет.</div>}
        </div>
      </Section>
    </div>
  );
}
