import type { User } from './types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let sessionListener: ((user: User, token: string) => void) | null = null;
let authLostListener: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSessionListener(listener: ((user: User, token: string) => void) | null) {
  sessionListener = listener;
}

export function setAuthLostListener(listener: (() => void) | null) {
  authLostListener = listener;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function performRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        accessToken = null;
        return false;
      }
      const data = (await response.json()) as { user: User; accessToken: string };
      accessToken = data.accessToken;
      sessionListener?.(data.user, data.accessToken);
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function bootstrapSession(): Promise<{ user: User; accessToken: string } | null> {
  const ok = await performRefresh();
  if (!ok) return null;
  try {
    const response = await request<{ user: User }>('/auth/me', { retry: false });
    return { user: response.user, accessToken: accessToken as string };
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, retry = true, headers: providedHeaders, ...rest } = options;
  const headers = new Headers(providedHeaders);
  if (auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers,
      body: payload,
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }

  if (response.status === 401 && auth && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    const refreshed = await performRefresh();
    if (refreshed) {
      return request<T>(path, { ...options, retry: false });
    }
    authLostListener?.();
    throw new ApiError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } })?.error;
    throw new ApiError(
      response.status,
      error?.code || 'REQUEST_FAILED',
      error?.message || 'Não foi possível concluir a solicitação.',
      error?.details,
    );
  }
  return data as T;
}

export function queryString(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, file: File, options?: RequestOptions) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { ...options, method: 'POST', body: form });
  },
};

export function resolveMediaUrl(path: string) {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (API_BASE === '/api') return path;
  try {
    return `${new URL(API_BASE).origin}${path.startsWith('/') ? path : `/${path}`}`;
  } catch {
    return path;
  }
}

export { API_BASE };
