import { Inject, Injectable } from '@nestjs/common';
import { ClientCredentialsTokenProvider, ServiceClient } from '@trainme/http-client';
import type { Logger } from '@trainme/observability';
import { LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';

/** Asks user-profile-svc whether a trainer and trainee are actively connected (docs/12 §2). Service token only. */
@Injectable()
export class ProfileClient {
  private readonly http: ServiceClient;

  constructor(@Inject(SERVICE_CONFIG) config: RecordsConfig, @Inject(LOGGER) log: Logger) {
    this.http = new ServiceClient({
      name: 'user-profile-svc',
      baseUrl: config.PROFILE_SVC_URL,
      log,
      timeoutMs: 1_500,
      serviceToken: new ClientCredentialsTokenProvider({
        tokenUrl: config.OIDC_TOKEN_URL,
        clientId: config.SERVICE_CLIENT_ID,
        clientSecret: config.SERVICE_CLIENT_SECRET,
      }),
    });
  }

  async isConnected(trainerId: string, traineeId: string, requestId?: string): Promise<boolean> {
    const r = await this.http.get<{ active: boolean }>(
      `/api/v1/profiles/internal/connections/check?trainerId=${trainerId}&traineeId=${traineeId}`,
      requestId ? { requestId } : {},
    );
    return r.active;
  }
}
