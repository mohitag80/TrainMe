import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { AnalyticsController } from './api/analytics.controller.js';
import { CoachingController } from './api/coaching.controller.js';
import { CoachingAnalyticsService } from './application/coaching-analytics.service.js';
import { AnalyticsQueryService } from './application/analytics-query.service.js';
import { ProjectionService } from './application/projection.service.js';
import { RecordEventsConsumer } from './application/record-events.consumer.js';
import type { AnalyticsConfig } from './config/analytics.config.js';
import { TrackerClient } from './infrastructure/tracker.client.js';

@Module({})
export class AppModule {
  static register(config: AnalyticsConfig): DynamicModule {
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
      controllers: [AnalyticsController, CoachingController],
      providers: [
        CoachingAnalyticsService,
        AnalyticsQueryService,
        ProjectionService,
        RecordEventsConsumer,
        TrackerClient,
      ],
    };
  }
}
