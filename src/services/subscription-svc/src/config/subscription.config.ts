import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const subscriptionConfigSchema = platformConfigSchema.extend({
  PAYMENT_PROVIDER: z.enum(['MOCK', 'STRIPE', 'RAZORPAY']).default('MOCK'),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  /** Browser origin, for the checkout and return URLs. */
  PUBLIC_URL: z.string().url(),
  OIDC_TOKEN_URL: z.string().url(),
  SERVICE_CLIENT_ID: z.string().default('trainme-services'),
  SERVICE_CLIENT_SECRET: z.string().min(1),
  /** Keycloak admin API of the realm, used to keep the token's `plan` claim in sync. */
  KEYCLOAK_ADMIN_URL: z.string().url(),
});

export type SubscriptionConfig = z.infer<typeof subscriptionConfigSchema>;

export const loadSubscriptionConfig = (): SubscriptionConfig => loadConfig(subscriptionConfigSchema);
