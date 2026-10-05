import { NextResponse, type NextRequest } from 'next/server';
import { webConfig } from '@/lib/server/config';
import { logger } from '@/lib/server/log';
import { exchangeCode } from '@/lib/server/oidc';
import { createSession, SESSION_COOKIE, sessionCookieOptions, toSession } from '@/lib/server/session';

/** Keycloak redirects here with ?code&state; tokens stay in Valkey, the browser gets an opaque cookie. */
export async function GET(req: NextRequest) {
  const base = webConfig().publicUrl;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const log = await logger();
  if (!code || !state) {
    log.warn({ error: req.nextUrl.searchParams.get('error') }, 'login callback without code');
    return NextResponse.redirect(`${base}/login?error=missing_code`);
  }
  try {
    const { tokens, returnTo } = await exchangeCode(code, state);
    const session = toSession(tokens);
    const sid = await createSession(session);
    log.info(
      { userId: session.user.id, roles: session.user.roles, plan: session.user.plan, returnTo },
      'login completed',
    );
    const res = NextResponse.redirect(`${base}${returnTo}`);
    res.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions());
    return res;
  } catch (err) {
    log.warn({ err }, 'login failed');
    return NextResponse.redirect(`${base}/login?error=login_failed`);
  }
}
