import { readFile } from 'node:fs/promises';
import { createDatabase } from '@trainme/db';
import { OutboxWriter } from '@trainme/kafka';
import { createLogger } from '@trainme/observability';
import { CatalogSeeder } from './application/catalog-seeder.js';
import { defaultSeedFile } from './application/seed.provider.js';
import type { CatalogDatabase } from './infrastructure/catalog.database.js';

// Kubernetes PostSync Job (LLD §11): `node dist/seed.js [path/to/catalog.json]`.
const log = createLogger('catalog-seed', process.env.LOG_LEVEL ?? 'info');
const db = createDatabase<CatalogDatabase>({ url: process.env.DATABASE_URL ?? '', applicationName: 'catalog-seed' });
try {
  const raw = await readFile(process.argv[2] ?? process.env.SEED_FILE ?? defaultSeedFile(), 'utf8');
  const result = await new CatalogSeeder(db, new OutboxWriter('trainme/catalog-svc'), log).seed(raw);
  log.info(result, 'seed finished');
} catch (err) {
  log.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
