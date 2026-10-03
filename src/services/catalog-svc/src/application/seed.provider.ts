import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Kysely } from '@trainme/db';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, OUTBOX, SERVICE_CONFIG } from '@trainme/service-kit';
import type { CatalogConfig } from '../config/catalog.config.js';
import type { CatalogDatabase } from '../infrastructure/catalog.database.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { CatalogSeeder } from './catalog-seeder.js';

export const defaultSeedFile = () => fileURLToPath(new URL('../seed/catalog.json', import.meta.url));

/** Seeds on start when SEED_CATALOG_ON_START=true (Compose); Kubernetes runs `node dist/seed.js` as a Job. */
@Injectable()
export class SeedOnStart implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<CatalogDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(SERVICE_CONFIG) private readonly config: CatalogConfig,
    private readonly admin: CatalogAdminService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_CATALOG_ON_START) return;
    const raw = await readFile(this.config.SEED_FILE ?? defaultSeedFile(), 'utf8');
    const result = await new CatalogSeeder(this.db, this.outbox, this.log).seed(raw);
    if (!result.skipped) await this.admin.invalidate();
  }
}
