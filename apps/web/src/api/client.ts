const API_URL = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = localStorage.getItem("jsp_access_token");
let refreshToken: string | null = localStorage.getItem("jsp_refresh_token");
let onSessionExpired: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function onSessionExpire(cb: () => void): void {
  onSessionExpired = cb;
}

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  if (tokens) {
    localStorage.setItem("jsp_access_token", tokens.accessToken);
    localStorage.setItem("jsp_refresh_token", tokens.refreshToken);
  } else {
    localStorage.removeItem("jsp_access_token");
    localStorage.removeItem("jsp_refresh_token");
  }
}

let refreshPromise: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (!refreshToken) throw new ApiClientError(401, "No refresh token available");
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    setTokens(null);
    throw new ApiClientError(401, "Session expired");
  }
  const data = await res.json();
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, allowRetry = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && allowRetry && refreshToken) {
    refreshPromise ??= refresh().finally(() => {
      refreshPromise = null;
    });
    try {
      await refreshPromise;
      return apiFetch<T>(path, options, false);
    } catch (err) {
      onSessionExpired?.();
      throw err;
    }
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiClientError(res.status, body?.error?.message ?? res.statusText, body?.error?.code, body?.error?.details);
  }
  return body as T;
}

export const api = {
  get: <T,>(path: string) => apiFetch<T>(path),
  post: <T,>(path: string, data?: unknown) => apiFetch<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T,>(path: string, data?: unknown) => apiFetch<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T,>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

export { API_URL };
