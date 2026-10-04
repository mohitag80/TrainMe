import { NextResponse, type NextRequest } from 'next/server';
import { webConfig } from '@/lib/server/config';
import { getSession } from '@/lib/server/session';

const FORWARD_REQUEST_HEADERS = ['content-type', 'if-match', 'if-none-match', 'x-request-id'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'etag', 'location', 'x-request-id', 'cache-control'];

/**
 * Same-origin API proxy for browser code: attaches the session's access token and forwards to Kong.
 * The token never reaches JavaScript in the browser.
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) {
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
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
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
