import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { SearchController } from './api/search.controller.js';
import { SessionController } from './api/session.controller.js';
import { AutoCloseJob } from './application/auto-close.job.js';
import { CheckpointService } from './application/checkpoint.service.js';
import { CleanupConsumer } from './application/cleanup.consumer.js';
import { HistorySearchService } from './application/history-search.service.js';
import { SessionEvents } from './application/session-events.js';
import { SessionService } from './application/session.service.js';
import type { RecordsConfig } from './config/records.config.js';
import { TrackerClient } from './infrastructure/tracker.client.js';

@Module({})
export class AppModule {
  static register(config: RecordsConfig): DynamicModule {
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
      // SearchController first: its static paths (/sessions/search) must not be captured by /sessions/:id.
      controllers: [SearchController, SessionController],
      providers: [
        SessionService,
        CheckpointService,
        HistorySearchService,
        SessionEvents,
        AutoCloseJob,
        TrackerClient,
        CleanupConsumer,
      ],
    };
  }
}
