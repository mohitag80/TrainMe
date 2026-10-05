import 'server-only';
import { redirect } from 'next/navigation';
import { webConfig } from './config';
import { logger } from './log';
import { getSession, type Session } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: {
      type?: string;
      title?: string;
      detail?: string;
      errors?: { pointer: string; message: string }[];
      [k: string]: unknown;
    },
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
}

/** Server components: the signed-in session, or a redirect to the login page. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

/** Calls a TrainMe API through Kong with the user's token (server side). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = await requireSession();
  const res = await fetch(`${webConfig().apiUrl}/api/v1${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${s.accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  // A rejected token (revoked, or issued for an older public URL) means signing in again, not an error page.
  if (res.status === 401) {
    (await logger()).info({ userId: s.user.id, path }, 'token rejected – signing in again');
    redirect('/bff/auth/login');
  }
  if (res.status >= 500)
    (await logger()).error({ userId: s.user.id, path, status: res.status }, 'page data call failed');
  else (await logger()).debug({ userId: s.user.id, path, status: res.status }, 'page data call');
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}
