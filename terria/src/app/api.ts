/**
 * Client for the TERRIA Worker API (docs/GAME_ARCHITECTURE.md).
 *
 * Auth: `Authorization: tma <initData>` inside Telegram, `dev <id>` outside
 * (?dev=<id>, default 1; the Worker only accepts it with DEV_AUTH=1).
 * `?api=<url>` points the client at another server; `?mock` runs the whole
 * API in the browser on top of the shared rules (src/app/mock.ts).
 */
import type { Good } from '../game/config.ts';
import type { CrystalPack } from '../game/config.ts';
import type {
  Action,
  CityResponse,
  MarketResponse,
  MeResponse,
  Order,
  PublicCity,
  RegionMaskDTO,
  Trade,
  WorldCitySummary,
} from '../game/types.ts';
import { initData } from './tg.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Transport {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
  /** Static region mask (served as an asset by the Worker). */
  region(id: number): Promise<RegionMaskDTO>;
}

function authHeader(): string {
  const data = initData();
  if (data) return `tma ${data}`;
  const q = new URLSearchParams(location.search);
  return `dev ${q.get('dev') || '1'}`;
}

export class HttpTransport implements Transport {
  private readonly base: string;
  constructor(base: string) {
    this.base = base.replace(/\/$/, '');
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: authHeader(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const e = (json ?? {}) as { error?: string; message?: string };
      throw new ApiError(res.status, e.error ?? 'http_' + res.status, e.message ?? `Ошибка сервера (${res.status})`);
    }
    return json as T;
  }

  async region(id: number): Promise<RegionMaskDTO> {
    const res = await fetch(`${this.base}/regions/${id}.json`);
    if (!res.ok) throw new ApiError(res.status, 'region', 'Не удалось загрузить участок');
    return (await res.json()) as RegionMaskDTO;
  }
}

export class Api {
  readonly t: Transport;
  readonly mock: boolean;
  constructor(t: Transport, mock: boolean) {
    this.t = t;
    this.mock = mock;
  }

  me = (): Promise<MeResponse> => this.t.request('GET', '/api/me');
  createCity = (name: string): Promise<MeResponse> => this.t.request('POST', '/api/city', { name });
  actions = (op: string, actions: Action[]): Promise<CityResponse> =>
    this.t.request('POST', '/api/city/actions', { op, actions });
  world = (): Promise<{ cities: WorldCitySummary[] }> => this.t.request('GET', '/api/world');
  publicCity = (id: number): Promise<PublicCity> => this.t.request('GET', `/api/city/${id}`);
  market = (): Promise<MarketResponse> => this.t.request('GET', '/api/market');
  orders = (res: Good, side: 'buy' | 'sell'): Promise<{ orders: Order[] }> =>
    this.t.request('GET', `/api/market/orders?res=${res}&side=${side}`);
  trades = (res: Good): Promise<{ trades: Trade[] }> => this.t.request('GET', `/api/market/trades?res=${res}`);
  system = (op: string, side: 'buy' | 'sell', res: Good, qty: number): Promise<CityResponse> =>
    this.t.request('POST', '/api/market/system', { op, side, res, qty });
  createOrder = (op: string, side: 'buy' | 'sell', res: Good, qty: number, total: number): Promise<CityResponse & { order: Order }> =>
    this.t.request('POST', '/api/market/orders', { op, side, res, qty, total });
  fill = (op: string, id: number, qty: number): Promise<CityResponse> =>
    this.t.request('POST', `/api/market/orders/${id}/fill`, { op, qty });
  cancel = (op: string, id: number): Promise<CityResponse> => this.t.request('POST', `/api/market/orders/${id}/cancel`, { op });
  shop = (): Promise<{ packs: CrystalPack[]; crystals: number }> => this.t.request('GET', '/api/shop');
  invoice = (pack: string): Promise<{ link: string }> => this.t.request('POST', '/api/shop/invoice', { pack });
  region = (id: number): Promise<RegionMaskDTO> => this.t.region(id);
}

export async function createApi(): Promise<Api> {
  const q = new URLSearchParams(location.search);
  if (q.has('mock')) {
    const { MockTransport } = await import('./mock.ts');
    return new Api(new MockTransport(q.get('mock') || ''), true);
  }
  return new Api(new HttpTransport(q.get('api') || ''), false);
}

/** Russian message for an error code (rules.ts ERRORS + server codes). */
export const SERVER_ERRORS: Record<string, string> = {
  unauthorized: 'Откройте игру из Telegram',
  no_city: 'У вас ещё нет города',
  full: 'Все участки заняты',
  conflict: 'Город изменился, попробуйте ещё раз',
  exchange_locked: 'Биржа откроется на ратуше 2 уровня',
  own_order: 'Это ваша заявка',
  expired: 'Заявка уже закрыта',
  bad_request: 'Неверный запрос',
  no_goods: 'Не хватает товара',
  quota: 'Дневной лимит продажи системе исчерпан',
  too_many_orders: 'Не больше 10 заявок одновременно',
};
