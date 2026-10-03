import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ProblemError } from '@trainme/errors';

export const ROLES = ['member', 'curator', 'support', 'admin', 'service'] as const;
export type Role = (typeof ROLES)[number];

/** The caller as seen by services: Keycloak subject id, realm roles and plan claim. */
export interface AuthUser {
  id: string;
  roles: Role[];
  plan: string;
  /** From the token (profile bootstrap only; services never log or store it elsewhere). */
  email?: string;
  name?: string;
  /** Raw bearer token, forwarded on user-scoped service-to-service calls. */
  token: string;
}

export interface TokenVerifierOptions {
  /** Public issuer URL exactly as it appears in `iss` (e.g. http://localhost:8000/auth/realms/trainme). */
  issuer: string;
  /** Where this service fetches the realm keys (internal URL; may differ from the issuer host). */
  jwksUrl: string;
  /** Expected `aud` value added by the realm's audience mapper. */
  audience: string;
}

interface KeycloakClaims extends JWTPayload {
  realm_access?: { roles?: string[] };
  plan?: string;
  email?: string;
  name?: string;
}

/**
 * Verifies RS256 access tokens against the realm JWKS (cached and rotated by jose).
 * Any failure becomes a 401 problem; callers never see why a token was rejected.
 */
export function createTokenVerifier(opts: TokenVerifierOptions) {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
  return async function verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify<KeycloakClaims>(token, jwks, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
      });
      if (!payload.sub) throw new Error('missing sub');
      const roles = (payload.realm_access?.roles ?? []).filter((r): r is Role =>
        (ROLES as readonly string[]).includes(r),
      );
      return {
        id: payload.sub,
        roles,
        plan: payload.plan ?? 'FREE',
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.name ? { name: payload.name } : {}),
        token,
      };
    } catch {
      throw ProblemError.unauthorized();
    }
  };
}

export type TokenVerifier = ReturnType<typeof createTokenVerifier>;

/** Extracts the token from an `Authorization: Bearer …` header value. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

export function hasAnyRole(user: AuthUser, roles: readonly Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}
