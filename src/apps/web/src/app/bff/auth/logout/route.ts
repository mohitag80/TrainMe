import { NextResponse } from 'next/server';
import { logger } from '@/lib/server/log';
import { logoutUrl } from '@/lib/server/oidc';
import { destroySession, SESSION_COOKIE } from '@/lib/server/session';

/** Ends the local session and the Keycloak SSO session. */
export async function POST() {
  const s = await destroySession();
  (await logger()).info({ userId: s?.user.id ?? null }, 'logout');
  const res = NextResponse.redirect(logoutUrl(s?.idToken ?? ''), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
