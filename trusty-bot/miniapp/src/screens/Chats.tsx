import { useEffect, useRef, useState } from 'react';
import { DEAL_STATUS, OFFSITE, msgTime, seen, usdt, type DealStatus } from '../data';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { useStore } from '../store';
import { haptic, inTelegram } from '../tg';
import { Avatar, Note, Pill, Top } from '../ui';

const TONE: Record<DealStatus, 'green' | 'amber' | 'blue' | 'red' | undefined> = {
  awaiting_payment: 'amber', in_work: 'blue', review: 'amber', done: 'green', dispute: 'red',
};

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
      <Top title="Чаты" sub="Переписка внутри Trusty защищена гарантом" />
      {chats.length ? (
        <div className="group">
          {chats.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <button key={c.id} className="cell has-avatar" onClick={() => nav.push('chat', { id: c.id })}>
                <Avatar name={c.peer.name} hue={c.peer.hue} size={50} online={c.peer.lastSeenMin <= 5} />
                <div className="cell-body">
                  <div className="cell-title" style={{ justifyContent: 'space-between' }}>
                    <span className="t">{c.peer.name}</span>
                    <span className="small muted" style={{ fontWeight: 400 }}>{last ? msgTime(last) : ''}</span>
                  </div>
                  {c.deal && (
                    <div style={{ marginTop: 3 }}><Pill tone={TONE[c.deal.status]}>#{c.deal.id} · {DEAL_STATUS[c.deal.status]}</Pill></div>
                  )}
                  <div className="cell-sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {last ? `${last.from === 'me' ? 'Вы: ' : last.from === 'system' ? 'Trusty: ' : ''}${last.file ? '📎 ' : ''}${last.text}` : 'Нет сообщений'}
                    </span>
                    {c.unread > 0 && <span className="pill" style={{ background: 'var(--primary)', color: '#fff', borderRadius: 11, height: 20 }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : <div className="empty">Здесь появятся чаты с разработчиками и заказчиками.</div>}
    </div>
  );
}

export function ChatView({ id }: { id: string }) {
  const nav = useNav();
  const { chats, send, readChat, loadChat } = useStore();
  const c = chats.find((x) => x.id === id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const risky = OFFSITE.test(text);
  const count = c?.messages.length ?? 0;

  useEffect(() => {
    loadChat(id).then(() => readChat(id));
    const t = window.setInterval(() => loadChat(id), 4000);
    return () => window.clearInterval(t);
  }, [id, loadChat, readChat]);
  useEffect(() => { if (c?.unread) readChat(id); }, [c?.unread, id, readChat]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [count]);

  if (!c) return <div className="screen no-tabs"><Top title="Чат" small /><div className="empty">Загружаем переписку…</div></div>;

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    if (risky) haptic.warning(); else haptic.tap();
    setSending(true);
    try { await send(id, t); setText(''); } catch { /* toast shown */ } finally { setSending(false); }
  };

  return (
    <div className="chat">
      <div className="chat-top">
        <div className="chat-peer">
          {!inTelegram && <button className="icon-btn" onClick={nav.pop} aria-label="Назад"><Icon name="back" /></button>}
          <button style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textAlign: 'left' }}
            onClick={() => c.peer.role === 'dev' && nav.push('dev', { id: c.peer.refId })}>
            <Avatar name={c.peer.name} hue={c.peer.hue} size={40} online={c.peer.lastSeenMin <= 5} />
            <div style={{ minWidth: 0 }}><b>{c.peer.name}</b><span>{seen(c.peer.lastSeenMin)}</span></div>
          </button>
          <button className="icon-btn" aria-label="Пожаловаться" onClick={() => nav.push('complaint', { against: c.peer.refId, name: c.peer.name, deal: c.deal?.id })}>
            <Icon name="flag" size={20} />
          </button>
        </div>
        {c.deal && (
          <div className="deal-card">
            <span className="ic"><Icon name="shield" size={19} /></span>
            <div className="t">
              <b>Сделка #{c.deal.id} · {usdt(c.deal.amount)}</b>
              <span>{c.deal.title} · до {c.deal.due}</span>
            </div>
            <Pill tone={TONE[c.deal.status]}>{DEAL_STATUS[c.deal.status]}</Pill>
          </div>
        )}
      </div>

      <div className="msgs">
        {c.messages.length === 0 && <div className="empty">Напишите первое сообщение. Обсуждайте условия здесь: эта переписка будет доказательством, если понадобится арбитр.</div>}
        {c.messages.map((m) => (
          <div key={m.id} className={`msg ${m.from}`}>
            {m.file && <div className="att"><Icon name="doc" size={18} />{m.file}</div>}
            {m.text}
            <time>{msgTime(m)}</time>
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="composer">
        {risky && (
          <div className="warn"><Note tone="amber" icon="ban">Похоже на попытку договориться вне Trusty. Сделки и оплата вне гаранта не защищены, а за это блокируют аккаунт.</Note></div>
        )}
        <div className="composer-row">
          <button className="icon-btn" aria-label="Прикрепить файл" style={{ background: 'transparent' }}><Icon name="clip" /></button>
          <textarea rows={1} value={text} placeholder="Сообщение" aria-label="Сообщение"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="send" disabled={!text.trim() || sending} onClick={submit} aria-label="Отправить"><Icon name="send" size={20} /></button>
        </div>
      </div>
    </div>
  );
}
