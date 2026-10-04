import { NextResponse, type NextRequest } from 'next/server';
import { webConfig } from '@/lib/server/config';
import { exchangeCode } from '@/lib/server/oidc';
import { createSession, SESSION_COOKIE, sessionCookieOptions, toSession } from '@/lib/server/session';

/** Keycloak redirects here with ?code&state; tokens stay in Valkey, the browser gets an opaque cookie. */
export async function GET(req: NextRequest) {
  const base = webConfig().publicUrl;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) return NextResponse.redirect(`${base}/login?error=missing_code`);
  try {
    const { tokens, returnTo } = await exchangeCode(code, state);
    const sid = await createSession(toSession(tokens));
    const res = NextResponse.redirect(`${base}${returnTo}`);
    res.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions());
    return res;
  } catch {
    return NextResponse.redirect(`${base}/login?error=login_failed`);
  }
}
