import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import type { JsonCache } from '@trainme/cache';
import { ProblemError } from '@trainme/errors';
import { ClientCredentialsTokenProvider, ServiceClient, UpstreamError } from '@trainme/http-client';
import type { Logger } from '@trainme/observability';
import type { EffectiveSchema } from '@trainme/schema';
import { CACHE, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { AnalyticsConfig } from '../config/analytics.config.js';

export type TrackerSchema = { trackerId: string; schemaVersion: number } & EffectiveSchema;

/** Effective schemas from tracker-svc: pinned versions (immutable, cached) for projections; latest for labels. */
@Injectable()
export class TrackerClient {
  private readonly http: ServiceClient;

  constructor(
    @Inject(SERVICE_CONFIG) config: AnalyticsConfig,
    @Inject(LOGGER) log: Logger,
    @Inject(CACHE) private readonly cache: JsonCache,
  ) {
    this.http = new ServiceClient({
      name: 'tracker-svc',
      baseUrl: config.TRACKER_SVC_URL,
      log,
      timeoutMs: 2_000,
      serviceToken: new ClientCredentialsTokenProvider({
        tokenUrl: config.OIDC_TOKEN_URL,
        clientId: config.SERVICE_CLIENT_ID,
        clientSecret: config.SERVICE_CLIENT_SECRET,
      }),
    });
  }

  /** Without a user: service token (background projection). With a user: their token, so ownership is enforced. */
  async schema(trackerId: string, version?: number, user?: AuthUser): Promise<TrackerSchema> {
    const load = async () => {
      try {
        return await this.http.get<TrackerSchema>(
          `/api/v1/trackers/${trackerId}/schema${version ? `?version=${version}` : ''}`,
          user ? { bearer: user.token } : {},
        );
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404) throw ProblemError.notFound(`Tracker ${trackerId}`);
        throw err;
      }
    };
    return version && !user ? this.cache.getOrLoad(`ana:schema:${trackerId}:v${version}`, 0, load) : load();
  }
}
