import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const analyticsConfigSchema = platformConfigSchema.extend({
  TRACKER_SVC_URL: z.string().url(),
  OIDC_TOKEN_URL: z.string().url(),
  SERVICE_CLIENT_ID: z.string().default('trainme-services'),
  SERVICE_CLIENT_SECRET: z.string().min(1),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  RUN_CONSUMERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;

export const loadAnalyticsConfig = (): AnalyticsConfig => loadConfig(analyticsConfigSchema);
