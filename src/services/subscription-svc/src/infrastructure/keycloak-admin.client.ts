import { Inject, Injectable } from '@nestjs/common';
import { ClientCredentialsTokenProvider, ServiceClient } from '@trainme/http-client';
import type { Logger } from '@trainme/observability';
import { LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { SubscriptionConfig } from '../config/subscription.config.js';

interface KeycloakUser {
  id: string;
  attributes?: Record<string, string[]>;
  [k: string]: unknown;
}

/** Keeps the Keycloak user attribute `plan` (→ token claim) in step with the subscription. */
@Injectable()
export class KeycloakAdminClient {
  private readonly http: ServiceClient;

  constructor(
    @Inject(SERVICE_CONFIG) config: SubscriptionConfig,
    @Inject(LOGGER) private readonly log: Logger,
  ) {
    this.http = new ServiceClient({
      name: 'keycloak',
      baseUrl: config.KEYCLOAK_ADMIN_URL,
      log,
      timeoutMs: 3_000,
      serviceToken: new ClientCredentialsTokenProvider({
        tokenUrl: config.OIDC_TOKEN_URL,
        clientId: config.SERVICE_CLIENT_ID,
        clientSecret: config.SERVICE_CLIENT_SECRET,
      }),
    });
  }

  /**
   * Best effort: the subscription is already committed; a failure is logged and the claim catches up on
   * the next plan change. Read-modify-write so other attributes are preserved.
   */
  async setPlan(userId: string, plan: string): Promise<void> {
    try {
      const user = await this.http.get<KeycloakUser>(`/users/${userId}`);
      const attributes = { ...(user.attributes ?? {}), plan: [plan] };
      await this.http.put(`/users/${userId}`, { ...user, attributes });
    } catch (err) {
      this.log.error({ err, userId, plan }, 'could not update plan attribute in Keycloak');
    }
  }
}
