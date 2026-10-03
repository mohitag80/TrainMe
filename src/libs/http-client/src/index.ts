import { ProblemError } from '@trainme/errors';
import type { Logger } from '@trainme/observability';

export interface TokenProvider {
  token(): Promise<string>;
}

/** Client-credentials token for calls made by a service itself (consumers, jobs); cached until ~30 s before expiry. */
export class ClientCredentialsTokenProvider implements TokenProvider {
  private cached?: { value: string; expiresAt: number };
  private inflight?: Promise<string>;

  constructor(private readonly opts: { tokenUrl: string; clientId: string; clientSecret: string }) {}

  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.value;
    this.inflight ??= this.fetchToken().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(this.opts.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 30) * 1000 };
    return body.access_token;
  }
}

export interface ServiceClientOptions {
  /** Target service name, used in errors and logs. */
  name: string;
  baseUrl: string;
  log: Logger;
  timeoutMs?: number;
  /** Extra attempts for idempotent requests (GET) on network errors and 5xx. */
  retries?: number;
  /** Consecutive failures that open the circuit, and how long it stays open. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  /** Used when the caller does not forward a user token. */
  serviceToken?: TokenProvider;
}

export interface RequestOptions {
  /** User token to forward (user-scoped call); otherwise the service token is used. */
  bearer?: string;
  headers?: Record<string, string>;
  requestId?: string;
}

/** Non-2xx answer from another service; 4xx are passed through as-is, never retried. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    service: string,
  ) {
    super(`${service} answered ${status}`);
  }
}

/**
 * REST client for calls between services (LLD §7): per-attempt timeout, retries with jittered back-off for
 * GETs, and a circuit breaker so a failing dependency fails fast with 503 instead of piling up requests.
 */
export class ServiceClient {
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly opts: ServiceClientOptions) {}

  get<T>(path: string, o: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, o);
  }

  post<T>(path: string, body: unknown, o: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, o);
  }

  private async request<T>(method: string, path: string, body: unknown, o: RequestOptions): Promise<T> {
    if (Date.now() < this.openUntil) throw ProblemError.upstream(this.opts.name);
    const attempts = method === 'GET' ? 1 + (this.opts.retries ?? 2) : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await this.once<T>(method, path, body, o);
        this.failures = 0;
        return result;
      } catch (err) {
        if (err instanceof UpstreamError && err.status < 500) throw err; // caller's problem, not the dependency's
        lastErr = err;
        if (attempt < attempts) await sleep(100 * 2 ** attempt * (0.5 + Math.random()));
      }
    }
    this.failures++;
    if (this.failures >= (this.opts.breakerThreshold ?? 5)) {
      this.openUntil = Date.now() + (this.opts.breakerCooldownMs ?? 10_000);
      this.opts.log.warn({ service: this.opts.name }, 'circuit opened');
    }
    this.opts.log.error({ err: lastErr, service: this.opts.name, path }, 'upstream call failed');
    throw ProblemError.upstream(this.opts.name);
  }

  private async once<T>(method: string, path: string, body: unknown, o: RequestOptions): Promise<T> {
    const token = o.bearer ?? (this.opts.serviceToken ? await this.opts.serviceToken.token() : undefined);
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(o.requestId ? { 'x-request-id': o.requestId } : {}),
        ...o.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 2_000),
    });
    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new UpstreamError(res.status, parsed, this.opts.name);
    return parsed as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
