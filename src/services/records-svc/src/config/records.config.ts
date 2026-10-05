import { loadConfig, platformConfigSchema, z } from '@trainme/config';

export const recordsConfigSchema = platformConfigSchema.extend({
  TRACKER_SVC_URL: z.string().url(),
  /** Trainer connection checks (v1.4). */
  PROFILE_SVC_URL: z.string().url(),
  OIDC_TOKEN_URL: z.string().url(),
  SERVICE_CLIENT_ID: z.string().default('trainme-services'),
  SERVICE_CLIENT_SECRET: z.string().min(1),
  /** Abuse guard only; the product allows any number of sessions per day (ADR-015). */
  MAX_SESSIONS_PER_DAY: z.coerce.number().int().positive().default(50),
  /** FR-REC-13: idle in-progress sessions are closed after this many hours, or at local midnight + 2 h. */
  AUTO_CLOSE_IDLE_HOURS: z.coerce.number().positive().default(3),
  AUTO_CLOSE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(600),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  RUN_CONSUMERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type RecordsConfig = z.infer<typeof recordsConfigSchema>;

export const loadRecordsConfig = (): RecordsConfig => loadConfig(recordsConfigSchema);
