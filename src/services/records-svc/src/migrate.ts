import { fileURLToPath } from 'node:url';
import { runMigrations } from '@trainme/db';
import { createLogger } from '@trainme/observability';

// Applies migrations/V*.sql; run by the container entrypoint (Compose) or a pre-install Job (Kubernetes).
const log = createLogger('records-svc-migrate', process.env.LOG_LEVEL ?? 'info');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  log.fatal('DATABASE_URL is required');
  process.exit(78);
}
try {
  await runMigrations({ databaseUrl, dir: fileURLToPath(new URL('../migrations', import.meta.url)), log });
} catch (err) {
  log.fatal({ err }, 'migration failed');
  process.exit(1);
}
