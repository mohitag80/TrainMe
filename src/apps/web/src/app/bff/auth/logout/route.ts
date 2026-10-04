import { NextResponse } from 'next/server';
import { logoutUrl } from '@/lib/server/oidc';
import { destroySession, SESSION_COOKIE } from '@/lib/server/session';

/** Ends the local session and the Keycloak SSO session. */
export async function POST() {
  const s = await destroySession();
  const res = NextResponse.redirect(logoutUrl(s?.idToken ?? ''), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
