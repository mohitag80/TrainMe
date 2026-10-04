import 'server-only';

/** Runtime settings (read per request, so one image serves every environment). */
export function webConfig() {
  const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const issuer = process.env.OIDC_ISSUER_URL ?? `${publicUrl}/auth/realms/trainme`;
  return {
    publicUrl,
    /** Kong as seen from the web container (internal network). */
    apiUrl: (process.env.API_INTERNAL_URL ?? publicUrl).replace(/\/$/, ''),
    /** Public issuer: the browser is redirected here to log in. */
    issuer,
    /** Same realm reached over the internal network for token calls (back channel). */
    issuerInternal: process.env.OIDC_INTERNAL_URL ?? issuer,
    clientId: process.env.OIDC_CLIENT_ID ?? 'trainme-web',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    secureCookies: publicUrl.startsWith('https://'),
  };
}
