import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { webConfig } from './config';
import { redis } from './redis';

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in: number;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Reads JWT claims without verifying: only used on tokens we just received from our own Keycloak. */
export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Authorization Code + PKCE (FR-IAM-03): the verifier never leaves the server; state is single-use and
 * expires after 10 minutes.
 */
export async function authorizeUrl(returnTo: string, register = false): Promise<string> {
  const c = webConfig();
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await redis().set(`web:oidc:${state}`, JSON.stringify({ verifier, returnTo }), 'EX', 600);
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: `${c.publicUrl}/bff/auth/callback`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const endpoint = register ? 'registrations' : 'auth';
  return `${c.issuer}/protocol/openid-connect/${endpoint}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const c = webConfig();
  const res = await fetch(`${c.issuerInternal}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, ...body }),
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  return (await res.json()) as TokenSet;
}

export async function exchangeCode(code: string, state: string): Promise<{ tokens: TokenSet; returnTo: string }> {
  const raw = await redis().getdel(`web:oidc:${state}`);
  if (!raw) throw new Error('unknown or expired login state');
  const { verifier, returnTo } = JSON.parse(raw) as { verifier: string; returnTo: string };
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: `${webConfig().publicUrl}/bff/auth/callback`,
  });
  return { tokens, returnTo };
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export function logoutUrl(idToken: string): string {
  const c = webConfig();
  const params = new URLSearchParams({
    post_logout_redirect_uri: `${c.publicUrl}/`,
    client_id: c.clientId,
    ...(idToken ? { id_token_hint: idToken } : {}),
  });
  return `${c.issuer}/protocol/openid-connect/logout?${params}`;
}

/** Only same-site relative paths are accepted as return targets (open-redirect guard). */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}
