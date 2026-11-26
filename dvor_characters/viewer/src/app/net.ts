import { SERVER } from './api';
import { initData, shareMessage, switchInline } from './tg';
import type { HeroId } from './data';
import type { Boost } from './game/match';

export interface Peer { name: string; hero: HeroId; boost: Boost }
export type Msg = { t: string; [k: string]: unknown };

export const roomLink = (id: string): string => `https://t.me/dvor_app?startapp=r_${id}`;

export function newRoomId(): string {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
}

export class RoomLink {
  private ws: WebSocket;
  private subs = new Set<(m: Msg) => void>();
  private ping = 0;
  closed = false;

  constructor(readonly id: string, hello: Peer) {
    this.ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/room/${id}`);
    this.ws.onopen = () => {
      this.send({ t: 'hello', ...hello, initData: initData() });
      this.ping = window.setInterval(() => { if (this.ws.readyState === 1) this.ws.send('ping'); }, 20000);
    };
    this.ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m: Msg;
      try { m = JSON.parse(e.data); } catch { return; }
      for (const f of this.subs) f(m);
    };
    this.ws.onclose = () => {
      clearInterval(this.ping);
      if (this.closed) return;
      this.closed = true;
      for (const f of this.subs) f({ t: 'closed' });
    };
  }

  on(f: (m: Msg) => void): () => void {
    this.subs.add(f);
    return () => this.subs.delete(f);
  }

  send(m: Msg): void {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    clearInterval(this.ping);
    this.subs.clear();
    this.ws.close();
  }
}

export async function inviteFriend(id: string): Promise<'shared' | 'inline' | 'copied' | 'none'> {
  const data = initData();
  if (data) {
    try {
      const r = await fetch(`${SERVER}/api/room/share`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: data, room: id }),
      });
      const { id: prepared } = await r.json() as { id?: string };
      const sent = prepared ? await shareMessage(prepared) : null;
      if (sent !== null) return sent ? 'shared' : 'none';
    } catch {}
    if (switchInline(`r_${id}`)) return 'inline';
  }
  try {
    await navigator.clipboard.writeText(roomLink(id));
    return 'copied';
  } catch { return 'none'; }
}
