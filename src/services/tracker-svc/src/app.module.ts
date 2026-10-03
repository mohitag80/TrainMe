import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { TrackerController } from './api/tracker.controller.js';
import { TrackerService } from './application/tracker.service.js';
import type { TrackerConfig } from './config/tracker.config.js';
import { CatalogClient } from './infrastructure/catalog.client.js';

@Module({})
export class AppModule {
  static register(config: TrackerConfig): DynamicModule {
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
      controllers: [TrackerController],
      providers: [TrackerService, CatalogClient],
    };
  }
}
