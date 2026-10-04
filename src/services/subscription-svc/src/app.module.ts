import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { SubscriptionController } from './api/subscription.controller.js';
import { SubscriptionService } from './application/subscription.service.js';
import { UserEventsConsumer } from './application/user-events.consumer.js';
import type { SubscriptionConfig } from './config/subscription.config.js';
import { KeycloakAdminClient } from './infrastructure/keycloak-admin.client.js';

@Module({})
export class AppModule {
  static register(config: SubscriptionConfig): DynamicModule {
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
      controllers: [SubscriptionController],
      providers: [SubscriptionService, KeycloakAdminClient, UserEventsConsumer],
    };
  }
}
