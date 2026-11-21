import { useEffect, useRef, useState } from 'react';
import { DEAL_STATUS, OFFSITE, amt, msgTime, seen, type Chat, type Offer } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore, type Role } from '../store';
import { haptic, inTelegram } from '../tg';
import { Avatar, Info, Note, Odometer, Pill, Seg, Sheet, Skeleton, Timer, Top } from '../ui';

export default function Chats() {
  const nav = useNav();
  const { chats, refreshChats } = useStore();
  useEffect(() => {
    refreshChats();
    const t = window.setInterval(refreshChats, 15000);
    return () => window.clearInterval(t);
  }, [refreshChats]);
  return (
    <div className="screen root">
      <Top title="Чаты" />
      {chats.length ? (
        <div className="group stagger">
          {chats.map((c) => {
            const last = c.messages[c.messages.length - 1];
            const preview = !last ? 'Нет сообщений' : last.offer ? `Оффер: ${amt(last.offer.amount)} USDT · ${last.offer.title}`
              : `${last.from === 'me' ? 'Вы: ' : ''}${last.text}`;
            return (
              <button key={c.id} className="cell has-avatar" onClick={() => nav.push('chat', { id: c.id })}>
                <Avatar name={c.peer.name} size={50} online={c.peer.lastSeenMin <= 5} />
                <div className="cell-body">
                  <div className="cell-title" style={{ justifyContent: 'space-between' }}>
                    <span className="t">{c.peer.name}</span>
                    <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>{last ? msgTime(last) : ''}</span>
                  </div>
                  <div className="cell-sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.peerTyping ? 'var(--green-text)' : undefined }}>
                      {c.peerTyping ? 'печатает…' : preview}
                    </span>
                    {!!c.offersWaiting && <Pill tone="green">Оффер</Pill>}
                    {c.unread > 0 && !c.offersWaiting && <span className="pill num" style={{ background: 'var(--ink)', color: 'var(--bg)', height: 20, padding: '0 7px' }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : <div className="empty">Здесь появятся чаты с исполнителями и заказчиками. Цену и сроки договаривайтесь офферами прямо в чате.</div>}
    </div>
  );
}

const STATE_TEXT: Record<Offer['status'], string> = {
  pending: '', accepted: 'Принято', declined: 'Отклонено', countered: 'Ответили своей ценой', withdrawn: 'Отозвано', expired: 'Срок истёк',
};

function OfferCard({ o, peer, onAccept, onDecline, onCounter, onWithdraw, onDeal, busy }: {
  o: Offer; peer: string; busy: boolean;
  onAccept(): void; onDecline(): void; onCounter(): void; onWithdraw(): void; onDeal(id: number): void;
}) {
  const { payCfg } = useStore();
  const pending = o.status === 'pending';
  const who = o.mine ? 'Вы предлагаете' : `${peer.split(' ')[0]} ${o.prevAmount ? 'отвечает' : 'предлагает'}`;
  return (
    <div className="offer">
      <div className={`offer-card ${pending || o.status === 'accepted' ? '' : 'closed'}`}>
        <div className="offer-head">
          <span className="lbl">{o.prevAmount ? 'ВСТРЕЧНАЯ ЦЕНА' : 'ОФФЕР'}</span>
          {pending ? <Timer from={o.createdAt} to={o.expiresAt} /> : <span className="lbl">{STATE_TEXT[o.status].toUpperCase()}</span>}
        </div>
        <div className="offer-sum num">
          <b>{amt(o.amount)}</b><small>{payCfg.asset}</small>{o.prevAmount ? <s>{amt(o.prevAmount)}</s> : null}
        </div>
        <div className="offer-text">{who}<br />за <b>«{o.title}»</b></div>
        <div className="offer-meta">
          Срок {o.days} дн. · {o.myRole === 'client' ? `к оплате ${amt(o.total)}` : `вы получите ${amt(o.amount)}`}
          <Info label="Как считается">{o.myRole === 'client'
            ? `Сумма сделки ${amt(o.amount)} ${payCfg.asset} плюс комиссия гаранта ${payCfg.feePercent}% (${amt(o.fee)}). Деньги хранятся у гаранта, пока вы не примете работу.`
            : `Вы получите всю сумму сделки. Комиссию гаранта ${payCfg.feePercent}% платит заказчик.`}</Info>
        </div>
        {o.status === 'accepted' && (
          <div className="offer-state ok"><Icon name="done" size={16} strokeWidth={2.2} />Сделка #{o.dealId} создана</div>
        )}
        {pending && o.mine && (
          <div className="offer-state">Ждём ответа · <button style={{ fontWeight: 700, color: 'var(--ink)' }} onClick={onWithdraw} disabled={busy}>отозвать</button></div>
        )}
      </div>
      {pending && !o.mine && (
        <div className="offer-acts">
          <button className="btn secondary" disabled={busy} onClick={onDecline}><Icon name="failed" size={18} strokeWidth={2} />Отклонить</button>
          <button className="btn primary" disabled={busy} onClick={onAccept}>{busy ? <span className="spin" /> : <><Icon name="done" size={18} strokeWidth={2} />Принять</>}</button>
          <button className="btn secondary wide" disabled={busy} onClick={onCounter}>Предложить свою цену</button>
        </div>
      )}
      {o.status === 'accepted' && o.dealId && (
        <div className="offer-acts"><button className="btn secondary wide" onClick={() => onDeal(o.dealId!)}>Открыть сделку</button></div>
      )}
    </div>
  );
}

/** "Своя цена" / new offer: the amount rolls like an odometer, the rest is a few taps */
function OfferSheet({ open, onClose, base, chat, onSend }: {
  open: boolean; onClose(): void; base: Offer | null; chat: Chat;
  onSend(d: { title: string; amount: number; days: number; ttlHours: number; asRole: Role }): Promise<void>;
}) {
  const { role, payCfg } = useStore();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState(100);
  const [days, setDays] = useState(7);
  const [ttl, setTtl] = useState('48');
  const [asRole, setAsRole] = useState<Role>(role);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setTitle(base?.title ?? chat.deal?.title ?? '');
    setAmount(base ? base.amount : 100);
    setDays(base?.days ?? 7);
    setTtl('48');
    setAsRole(base ? base.myRole : (chat.peer.role === 'dev' ? 'client' : role));
  }, [open, base, chat, role]);
  const myRole = base ? base.myRole : asRole;
  const fee = Math.round(amount * payCfg.feePercent) / 100;
  const ok = amount > 0 && days > 0 && (base || title.trim().length >= 3);
  const step = (n: number) => { haptic.select(); setAmount((a) => Math.max(1, a + n)); };
  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try { await onSend({ title: title.trim(), amount, days, ttlHours: Number(ttl), asRole: myRole }); onClose(); } catch { /* toast shown */ } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={base ? 'Своя цена' : 'Оффер'}>
      <p className="muted small" style={{ margin: 0 }}>{base ? `Сейчас в оффере ${amt(base.amount)} ${payCfg.asset}. Назовите свою цену.` : 'Сумма, срок и что нужно сделать. Собеседник примет, отклонит или ответит своей ценой.'}</p>
      <button className="amount-big" onClick={() => input.current?.focus()} aria-label="Изменить сумму" style={{ width: '100%' }}>
        <Odometer value={amount} /><small>{payCfg.asset}</small>
      </button>
      <input ref={input} className="vh" inputMode="numeric" value={amount} aria-label="Сумма"
        onChange={(e) => setAmount(Math.min(1_000_000, Number(e.target.value.replace(/\D/g, '')) || 0))} />
      <div className="steppers">
        <button onClick={() => step(-10)}>−10</button>
        <button onClick={() => step(-1)}>−1</button>
        <button onClick={() => step(1)}>+1</button>
        <button onClick={() => step(10)}>+10</button>
      </div>
      {!base && (
        <div className="mt">
          <Field2 label="Что сделать"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: лендинг для кофейни" maxLength={120} /></Field2>
          <div className="mt-s"><Seg<Role> value={asRole} onChange={setAsRole} items={[{ key: 'client', label: 'Я заказчик' }, { key: 'dev', label: 'Я исполнитель' }]} /></div>
        </div>
      )}
      <div className="group mt">
        <div className="cell">
          <div className="cell-body"><div className="cell-title">Срок</div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="icon-btn" aria-label="Меньше" onClick={() => setDays((d) => Math.max(1, d - 1))}><Icon name="minus" size={18} /></button>
            <b className="num" style={{ minWidth: 54, textAlign: 'center' }}>{days} дн.</b>
            <button className="icon-btn" aria-label="Больше" onClick={() => setDays((d) => Math.min(365, d + 1))}><Icon name="plus" size={18} /></button>
          </div>
        </div>
        <div className="cell">
          <div className="cell-body"><div className="cell-title">Действует</div></div>
          <div style={{ width: 170 }}><Seg value={ttl} onChange={setTtl} items={[{ key: '24', label: '24ч' }, { key: '48', label: '48ч' }, { key: '72', label: '72ч' }]} /></div>
        </div>
        <div className="cell">
          <div className="cell-body"><div className="cell-title" style={{ color: 'var(--muted)', fontWeight: 600 }}>
            {myRole === 'client' ? 'К оплате с гарантом' : 'Вы получите'}
            <Info label="Как считается">{myRole === 'client' ? `Сумма плюс комиссия гаранта ${payCfg.feePercent}%. Деньги хранятся у гаранта до приёмки работы.` : `Комиссию гаранта ${payCfg.feePercent}% платит заказчик, вы получаете всю сумму.`}</Info>
          </div></div>
          <b className="num">{amt(myRole === 'client' ? amount + fee : amount)} {payCfg.asset}</b>
        </div>
      </div>
      <button className="btn primary mt" disabled={!ok || busy} onClick={send}>{busy ? <span className="spin" /> : base ? 'Отправить свою цену' : 'Отправить оффер'}</button>
    </Sheet>
  );
}

function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

export function ChatView({ id, offer: openOffer }: { id: string; offer?: boolean }) {
  const nav = useNav();
  const { chats, send, readChat, loadChat, proposeOffer, counterOffer, acceptOffer, declineOffer, withdrawOffer, typing, showToast } = useStore();
  const c = chats.find((x) => x.id === id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<{ base: Offer | null } | null>(openOffer ? { base: null } : null);
  const [busyOffer, setBusyOffer] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const risky = OFFSITE.test(text);
  const count = (c?.messages.length ?? 0) + (c?.peerTyping ? 1 : 0);

  useEffect(() => {
    loadChat(id).then(() => readChat(id));
    const t = window.setInterval(() => loadChat(id), 3000);
    return () => window.clearInterval(t);
  }, [id, loadChat, readChat]);
  useEffect(() => { if (c?.unread) readChat(id); }, [c?.unread, id, readChat]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [count]);

  if (!c) return <div className="screen no-tabs"><Top title="Чат" small /><Skeleton rows={5} /></div>;

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    if (risky) haptic.warning(); else haptic.tap();
    setSending(true);
    try { await send(id, t); setText(''); } catch { /* toast shown */ } finally { setSending(false); }
  };
  const onText = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); typing(id); }
  };
  const act = async (oid: number, fn: () => Promise<unknown>) => {
    if (busyOffer) return;
    setBusyOffer(oid);
    try { await fn(); } catch { /* toast shown */ } finally { setBusyOffer(null); }
  };

  return (
    <div className="chat">
      <div className="chat-top">
        <div className="chat-peer">
          {!inTelegram && <button className="icon-btn" onClick={nav.pop} aria-label="Назад"><Icon name="back" /></button>}
          <button style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textAlign: 'left' }}
            onClick={() => c.peer.role === 'dev' && nav.push('dev', { id: c.peer.refId })}>
            <Avatar name={c.peer.name} size={40} online={c.peer.lastSeenMin <= 5} />
            <div style={{ minWidth: 0 }}><b>{c.peer.name}</b><span className={c.peerTyping ? 'typing-now' : ''}>{c.peerTyping ? 'печатает…' : seen(c.peer.lastSeenMin)}</span></div>
          </button>
          <button className="icon-btn" aria-label="Пожаловаться" onClick={() => nav.push('complaint', { against: c.peer.refId, name: c.peer.name, deal: c.deal?.id })}>
            <Icon name="flag" size={20} />
          </button>
        </div>
        {c.deal && (
          <button className="deal-card" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push('deal', { id: c.deal!.id })}>
            <span className="ic"><Icon name="shield" size={21} /></span>
            <div className="t">
              <b>Сделка #{c.deal.id} · {amt(c.deal.amount)} USDT</b>
              <span>{DEAL_STATUS[c.deal.status]} · до {c.deal.due}</span>
            </div>
            <Icon name="chevron" size={18} style={{ color: 'var(--faint)', flex: 'none' }} />
          </button>
        )}
      </div>

      <div className="msgs">
        {c.messages.length === 0 && <div className="empty">Напишите первое сообщение. Цену и срок предложите оффером: кнопка слева от поля ввода.</div>}
        {c.messages.map((m) => (m.offer ? (
          <OfferCard key={m.id} o={m.offer} peer={c.peer.name} busy={busyOffer === m.offer.id}
            onAccept={() => act(m.offer!.id, async () => { const dealId = await acceptOffer(id, m.offer!.id); showToast(`Сделка #${dealId} создана`); nav.push('deal', { id: dealId }); })}
            onDecline={() => act(m.offer!.id, () => declineOffer(id, m.offer!.id))}
            onWithdraw={() => act(m.offer!.id, () => withdrawOffer(id, m.offer!.id))}
            onCounter={() => setSheet({ base: m.offer! })}
            onDeal={(dealId) => nav.push('deal', { id: dealId })} />
        ) : (
          <div key={m.id} className={`msg ${m.from}`}>
            {m.file && <div className="att"><Icon name="doc" size={18} />{m.file}</div>}
            {m.text}
            <time>{msgTime(m)}</time>
          </div>
        )))}
        {c.peerTyping && <div className="typing" aria-label="Собеседник печатает"><i /><i /><i /></div>}
        <div ref={end} />
      </div>

      <div className="composer">
        {risky && (
          <div className="warn"><Note tone="red" icon="ban">Похоже на попытку договориться вне IT Trusty. Такие сделки не защищены, а за это блокируют.</Note></div>
        )}
        <div className="composer-row">
          <button className="icon-btn" aria-label="Предложить цену" onClick={() => setSheet({ base: null })}><Icon name="handshake" size={24} /></button>
          <textarea rows={1} value={text} placeholder="Сообщение" aria-label="Сообщение"
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="send" disabled={!text.trim() || sending} onClick={submit} aria-label="Отправить"><Icon name="send" size={20} strokeWidth={2} /></button>
        </div>
      </div>

      <OfferSheet open={!!sheet} base={sheet?.base ?? null} chat={c} onClose={() => setSheet(null)}
        onSend={async (d) => {
          if (sheet?.base) await counterOffer(id, sheet.base.id, { amount: d.amount, days: d.days, ttlHours: d.ttlHours });
          else await proposeOffer(id, d);
        }} />
    </div>
  );
}
