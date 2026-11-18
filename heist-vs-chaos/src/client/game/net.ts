// WebSocket link to the authoritative server. Reconnects forever with capped backoff and always receives the
// full current state on (re)connect, so a page reload or network blip never restarts or desyncs the game.
import type { PublicState } from '../../shared/types.js';

export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private offsets: number[] = [];
  offset = 0;
  connected = false;
  lastMessageAt = 0;

  constructor(
    private onState: (s: PublicState) => void,
    private onConn: (up: boolean) => void,
    private broadcast: boolean,
  ) {
    this.connect();
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('p');
      // Watchdog: no message for 20 s -> force reconnect.
      if (this.connected && Date.now() - this.lastMessageAt > 20000) this.ws?.close();
    }, 10000);
  }

  now(): number {
    return Date.now() + this.offset;
  }

  private sample(serverNow: number): void {
    this.offsets.push(serverNow - Date.now());
    if (this.offsets.length > 9) this.offsets.shift();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)]!;
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws${this.broadcast ? '?broadcast=1' : ''}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.lastMessageAt = Date.now();
      this.onConn(true);
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      try {
        const m = JSON.parse(String(ev.data)) as { t: string; s?: PublicState; now?: number };
        if (m.t === 'state' && m.s) {
          this.sample(m.s.serverNow);
          this.onState(m.s);
        } else if (m.t === 'time' && m.now) this.sample(m.now);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.onConn(false);
      this.ws = null;
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }
}
