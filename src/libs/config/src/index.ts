import { z } from 'zod';

/** Settings every service shares; service schemas extend this object. */
export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** Settings shared by every backend service (names fixed by docs/10 §7). */
export const platformConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
  RUN_OUTBOX_RELAY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_JWKS_URL: z.string().url(),
  OIDC_AUDIENCE: z.string().default('trainme-api'),
});

/** Comma-separated env value to a trimmed, non-empty string array. */
export const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Strict boolean parsing ("true"/"false"/"1"/"0"), unlike z.coerce.boolean. */
export const envBoolean = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * Parses `process.env` against the schema once at boot.
 * A misconfigured service must not start, so failures list every bad key and exit.
 */
export function loadConfig<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid configuration:\n${lines.join('\n')}`);
    process.exit(78); // EX_CONFIG
  }
  return parsed.data;
}

export { z };
