import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { CoachingController } from './api/coaching.controller.js';
import { ProfileController } from './api/profile.controller.js';
import { CoachingService } from './application/coaching.service.js';
import { ProfileService } from './application/profile.service.js';
import type { ProfileConfig } from './config/profile.config.js';

@Module({})
export class AppModule {
  static register(config: ProfileConfig): DynamicModule {
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
      controllers: [ProfileController, CoachingController],
      providers: [ProfileService, CoachingService],
    };
  }
}
