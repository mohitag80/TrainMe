import { NextResponse, type NextRequest } from 'next/server';
import { webConfig } from '@/lib/server/config';
import { logger } from '@/lib/server/log';
import { getSession } from '@/lib/server/session';

const FORWARD_REQUEST_HEADERS = ['content-type', 'if-match', 'if-none-match', 'x-request-id'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'etag', 'location', 'x-request-id', 'cache-control'];

/**
 * Same-origin API proxy for browser code: attaches the session's access token and forwards to Kong.
 * The token never reaches JavaScript in the browser.
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const started = performance.now();
  const log = await logger();
  const session = await getSession();
  if (!session) {
    log.info({ method: req.method, path: req.nextUrl.pathname }, 'api call without a session');
    return NextResponse.json(
      {
        type: 'https://trainme.app/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Session expired; sign in again',
      },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }
  const { path } = await ctx.params;
  const target = `${webConfig().apiUrl}/api/v1/${path.map(encodeURIComponent).join('/').replace(/%3A/gi, ':')}${req.nextUrl.search}`;
  const headers = new Headers({ authorization: `Bearer ${session.accessToken}`, accept: 'application/json' });
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // One id per browser call, passed to Kong and the services so their log lines can be matched up.
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  headers.set('x-request-id', requestId);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const apiPath = `/api/v1/${path.join('/')}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    log.error({ err, requestId, method: req.method, path: apiPath, userId: session.user.id }, 'api call failed');
    return NextResponse.json(
      {
        type: 'https://trainme.app/problems/upstream',
        title: 'Service unavailable',
        status: 503,
        detail: 'Please try again',
      },
      { status: 503, headers: { 'content-type': 'application/problem+json', 'x-request-id': requestId } },
    );
  }
  const line = {
    requestId,
    method: req.method,
    path: apiPath,
    status: upstream.status,
    ms: Math.round(performance.now() - started),
    userId: session.user.id,
  };
  if (upstream.status >= 500) log.error(line, 'api call');
  else if (upstream.status >= 400) log.warn(line, 'api call rejected');
  else if (hasBody) log.info(line, 'api call');
  else log.debug(line, 'api call');
  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new NextResponse(upstream.status === 204 || upstream.status === 304 ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: out,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
