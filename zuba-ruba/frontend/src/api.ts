import { initData } from "./telegram";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type GlobalErrorListener = (error: ApiError) => void;
const listeners = new Set<GlobalErrorListener>();

export function onGlobalError(listener: GlobalErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const GLOBAL_CODES = new Set(["maintenance", "blocked", "unauthorized"]);

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Сессия устарела. Откройте приложение заново.",
  403: "Нет доступа.",
  404: "Не найдено.",
  429: "Слишком много запросов. Подождите немного.",
  503: "Сервис временно недоступен.",
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `tma ${initData()}`, ...options.headers };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: options.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, "network", "Нет соединения с сервером. Проверьте интернет.");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    const error = new ApiError(
      response.status,
      envelope?.code ?? `http_${response.status}`,
      envelope?.message ?? FALLBACK_MESSAGES[response.status] ?? "Что-то пошло не так. Попробуйте ещё раз.",
    );
    if (GLOBAL_CODES.has(error.code)) listeners.forEach((listener) => listener(error));
    throw error;
  }
  return payload as T;
}

export async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { headers: { Authorization: `tma ${initData()}` } });
  if (!response.ok) throw new ApiError(response.status, `http_${response.status}`, "Не удалось загрузить файл.");
  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>(path, { method: "POST", body, headers }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
