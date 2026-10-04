import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { webConfig } from './config';
import { decodeJwt, refreshTokens, type TokenSet } from './oidc';
import { redis } from './redis';

export const SESSION_COOKIE = 'tm_sid';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  roles: string[];
  plan: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  user: SessionUser;
}

const key = (sid: string) => `web:sess:${sid}`;

/** Builds the session (and the user shown in the UI) from a token response; claims come from our own Keycloak. */
export function toSession(t: TokenSet): Session {
  const claims = decodeJwt(t.access_token);
  const roles = ((claims.realm_access as { roles?: string[] } | undefined)?.roles ?? []).filter((r) =>
    ['member', 'curator', 'support', 'admin'].includes(r),
  );
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken: t.id_token ?? '',
    expiresAt: Date.now() + t.expires_in * 1000,
    refreshExpiresAt: Date.now() + (t.refresh_expires_in || 1800) * 1000,
    user: {
      id: String(claims.sub),
      name: String(claims.name ?? claims.preferred_username ?? 'Athlete'),
      email: (claims.email as string | undefined) ?? null,
      roles,
      plan: String(claims.plan ?? 'FREE'),
    },
  };
}

export async function createSession(s: Session): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  await redis().set(key(sid), JSON.stringify(s), 'PX', Math.max(s.refreshExpiresAt - Date.now(), 60_000));
  return sid;
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: webConfig().secureCookies, path: '/' };
}

/**
 * Current session with a fresh access token (refreshed when < 30 s remain). Returns null when there is no
 * session or the refresh token expired; the caller then sends the user to log in.
 */
export async function getSession(): Promise<Session | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const raw = await redis().get(key(sid));
  if (!raw) return null;
  let s = JSON.parse(raw) as Session;
  if (s.expiresAt - 30_000 < Date.now()) {
    try {
      s = toSession(await refreshTokens(s.refreshToken));
      await redis().set(key(sid), JSON.stringify(s), 'PX', Math.max(s.refreshExpiresAt - Date.now(), 60_000));
    } catch {
      await redis().del(key(sid));
      return null;
    }
  }
  return s;
}

export async function destroySession(): Promise<Session | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const raw = await redis().get(key(sid));
  await redis().del(key(sid));
  return raw ? (JSON.parse(raw) as Session) : null;
}

/** Re-reads the user from a forced token refresh (e.g. after a plan change). */
export async function refreshSessionUser(): Promise<Session | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  const raw = sid ? await redis().get(key(sid)) : null;
  if (!sid || !raw) return null;
  const s = toSession(await refreshTokens((JSON.parse(raw) as Session).refreshToken));
  await redis().set(key(sid), JSON.stringify(s), 'PX', Math.max(s.refreshExpiresAt - Date.now(), 60_000));
  return s;
}
