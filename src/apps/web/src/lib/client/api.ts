'use client';

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: { pointer: string; code: string; message: string }[];
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
}

/** Browser calls go to the same-origin BFF proxy, which adds the access token. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`/bff/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) {
    window.location.href = `/bff/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, { title: 'Signing in again…' });
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}

/** Human-readable message for a failed call (first field error first). */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const first = err.problem.errors?.[0];
    return first ? `${first.message} (${first.pointer.replace(/^\/(body|query|values)\//, '')})` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
