import { inTelegram } from './tg';

export const live = inTelegram;

export class ApiError extends Error {
  status: number;
  banned?: { until: string | null };
  constructor(status: number, message: string, banned?: { until: string | null }) {
    super(message);
    this.status = status;
    this.banned = banned;
  }
}

function initData(): string {
  return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? '';
}

function messageOf(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return 'Проверьте заполнение полей';
  if (status >= 500) return 'Сервер временно недоступен, попробуйте ещё раз';
  return 'Не получилось, попробуйте ещё раз';
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `tma ${initData()}` };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  if (res.ok) return (await res.json()) as T;
  let detail: unknown = null;
  try {
    detail = (await res.json()).detail;
  } catch {
  }
  if (res.status === 403 && detail && typeof detail === 'object' && 'banned' in (detail as object)) {
    throw new ApiError(403, 'Аккаунт заблокирован', detail as { until: string | null });
  }
  throw new ApiError(res.status, messageOf(res.status, detail));
}
