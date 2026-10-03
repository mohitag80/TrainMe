import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const trackerConfigSchema = platformConfigSchema.extend({
  CATALOG_SVC_URL: z.string().url(),
  OIDC_TOKEN_URL: z.string().url(),
  SERVICE_CLIENT_ID: z.string().default('trainme-services'),
  SERVICE_CLIENT_SECRET: z.string().min(1),
});

export type TrackerConfig = z.infer<typeof trackerConfigSchema>;

export const loadTrackerConfig = (): TrackerConfig => loadConfig(trackerConfigSchema);
