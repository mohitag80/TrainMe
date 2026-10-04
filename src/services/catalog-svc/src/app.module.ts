import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { AdminController } from './api/admin.controller.js';
import { CatalogController } from './api/catalog.controller.js';
import { SearchController } from './api/search.controller.js';
import { CatalogAdminService } from './application/catalog-admin.service.js';
import { CatalogEditorService } from './application/catalog-editor.service.js';
import { CatalogQueryService } from './application/catalog-query.service.js';
import { CatalogSearchService } from './application/catalog-search.service.js';
import { SeedOnStart } from './application/seed.provider.js';
import type { CatalogConfig } from './config/catalog.config.js';

@Module({})
export class AppModule {
  static register(config: CatalogConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot({
          serviceName: config.SERVICE_NAME,
          databaseUrl: config.DATABASE_URL,
          redisUrl: config.REDIS_URL,
          kafkaBrokers: config.KAFKA_BROKERS,
          runOutboxRelay: config.RUN_OUTBOX_RELAY,
          dbPoolSize: config.DB_POOL_SIZE,
          config,
        }),
      ],
      controllers: [CatalogController, SearchController, AdminController],
      providers: [CatalogQueryService, CatalogSearchService, CatalogAdminService, CatalogEditorService, SeedOnStart],
    };
  }
}
