import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/server/log';
import { authorizeUrl, safeReturnTo } from '@/lib/server/oidc';

/** Starts the Keycloak login (or registration with ?register=1). */
export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'));
  const register = req.nextUrl.searchParams.get('register') === '1';
  (await logger()).info({ returnTo, register }, register ? 'registration started' : 'login started');
  return NextResponse.redirect(await authorizeUrl(returnTo, req.nextUrl.searchParams.get('register') === '1'));
}
