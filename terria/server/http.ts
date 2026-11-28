import { ERRORS } from '../src/game/rules.ts';

export const SERVER_ERRORS: Record<string, string> = {
  ...ERRORS,
  unauthorized: 'Откройте игру через Telegram',
  no_city: 'У вас ещё нет города',
  full: 'Все 1000 мест заняты. Вы в очереди — загляните чуть позже',
  conflict: 'Город изменился, попробуйте ещё раз',
  exchange_locked: 'Биржа открывается с ратуши 2 уровня',
  own_order: 'Нельзя исполнить свою заявку',
  expired: 'Заявка уже закрыта',
  bad_request: 'Неверный запрос',
  too_many_orders: 'Не больше 10 открытых заявок',
  quota: 'Дневной лимит продажи системе исчерпан',
  no_goods: 'Не хватает товара',
  bot_not_configured: 'Платежи ещё не подключены',
  not_found: 'Не найдено',
  internal: 'Ошибка сервера, попробуйте позже',
};

export class ApiFail extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? SERVER_ERRORS[code] ?? code);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiFail) return json({ error: e.code, message: e.message }, e.status);
  console.error('internal error', e instanceof Error ? e.stack ?? e.message : e);
  return json({ error: 'internal', message: SERVER_ERRORS.internal }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    const body = (await req.json()) as T;
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    throw new ApiFail(400, 'bad_request');
  }
}

export function str(v: unknown, max = 64): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new ApiFail(400, 'bad_request');
  return v;
}
export function int(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ApiFail(400, 'bad_request');
  return v;
}
export function num(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ApiFail(400, 'bad_request');
  return v;
}

/** D1 errors raised by the CHECK / guard tricks. */
export function isGuardConflict(e: unknown): boolean {
  return /NOT NULL constraint failed: guard\.x/i.test(errText(e));
}
export function isCheckFail(e: unknown): boolean {
  return /CHECK constraint failed/i.test(errText(e));
}
export function isUniqueFail(e: unknown): boolean {
  return /UNIQUE constraint failed|PRIMARY KEY/i.test(errText(e));
}
function errText(e: unknown): string {
  if (e instanceof Error) return `${e.message} ${(e as { cause?: unknown }).cause ?? ''}`;
  return String(e);
}
