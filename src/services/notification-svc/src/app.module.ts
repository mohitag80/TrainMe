import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule } from '@trainme/service-kit';
import { NotificationController } from './api/notification.controller.js';
import { DispatcherService } from './application/dispatcher.service.js';
import { NotificationEventConsumers } from './application/event-consumers.js';
import { InboxService } from './application/inbox.service.js';
import { ReminderSchedulerJob } from './application/reminder-scheduler.job.js';
import type { NotificationConfig } from './config/notification.config.js';
import { Mailer } from './infrastructure/mailer.js';

@Module({})
export class AppModule {
  static register(config: NotificationConfig): DynamicModule {
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
      // Static /notifications/preferences and /read-all are declared before /notifications/:id/read.
      controllers: [NotificationController],
      providers: [InboxService, DispatcherService, Mailer, ReminderSchedulerJob, NotificationEventConsumers],
    };
  }
}
