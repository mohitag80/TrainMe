import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import type { JsonCache } from '@trainme/cache';
import { ProblemError } from '@trainme/errors';
import { ClientCredentialsTokenProvider, ServiceClient, UpstreamError } from '@trainme/http-client';
import type { Logger } from '@trainme/observability';
import { EntryValidator, type EffectiveSchema } from '@trainme/schema';
import { CACHE, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';

export type TrackerSchema = { trackerId: string; schemaVersion: number } & EffectiveSchema;

/**
 * Fetches pinned schema versions from tracker-svc. Versions are immutable, so they are cached in Valkey
 * without expiry and their compiled validators are kept in memory (bounded).
 */
@Injectable()
export class TrackerClient {
  private readonly http: ServiceClient;
  private readonly validators = new Map<string, EntryValidator>();

  constructor(
    @Inject(SERVICE_CONFIG) config: RecordsConfig,
    @Inject(LOGGER) log: Logger,
    @Inject(CACHE) private readonly cache: JsonCache,
  ) {
    this.http = new ServiceClient({
      name: 'tracker-svc',
      baseUrl: config.TRACKER_SVC_URL,
      log,
      timeoutMs: 1_500,
      serviceToken: new ClientCredentialsTokenProvider({
        tokenUrl: config.OIDC_TOKEN_URL,
        clientId: config.SERVICE_CLIENT_ID,
        clientSecret: config.SERVICE_CLIENT_SECRET,
      }),
    });
  }

  /**
   * With a user, the call is made with the user's token, so tracker-svc enforces ownership (404 otherwise).
   * Without one (background jobs), the service token is used.
   */
  async schema(trackerId: string, version: number | undefined, user?: AuthUser): Promise<TrackerSchema> {
    const load = async () => {
      try {
        const q = version ? `?version=${version}` : '';
        return await this.http.get<TrackerSchema>(
          `/api/v1/trackers/${trackerId}/schema${q}`,
          user ? { bearer: user.token } : {},
        );
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404)
          throw ProblemError.notFound(`Tracker ${trackerId}${version ? ` schema v${version}` : ''}`);
        throw err;
      }
    };
    // Ownership must be checked on every user-initiated latest-version lookup, so only pinned versions are cached.
    if (!version) return load();
    return this.cache.getOrLoad(`rec:schema:${trackerId}:v${version}`, 0, load);
  }

  async validator(trackerId: string, version: number, user?: AuthUser): Promise<EntryValidator> {
    const key = `${trackerId}:${version}`;
    let v = this.validators.get(key);
    if (!v) {
      v = new EntryValidator(await this.schema(trackerId, version, user));
      if (this.validators.size > 500) this.validators.delete(this.validators.keys().next().value!);
      this.validators.set(key, v);
    }
    return v;
  }
}
