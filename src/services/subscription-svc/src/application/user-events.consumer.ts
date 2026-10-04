import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from '@trainme/db';
import { EVENT_TYPES, TOPICS, type UserDeletedPayload } from '@trainme/events';
import { EventConsumer, type Kafka } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, HealthRegistry, KAFKA, LOGGER } from '@trainme/service-kit';
import type { BillingDatabase } from '../infrastructure/billing.database.js';
import { SubscriptionService } from './subscription.service.js';

/** Erasure saga step (group subscription-svc.erasure): a deleted user's subscription is canceled. */
@Injectable()
export class UserEventsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer?: EventConsumer<BillingDatabase>;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(DATABASE) private readonly db: Kysely<BillingDatabase>,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly health: HealthRegistry,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.consumer = new EventConsumer({
      kafka: this.kafka,
      db: this.db,
      log: this.log,
      groupId: 'subscription-svc.erasure',
      topics: [TOPICS.user],
      handlers: {
        [EVENT_TYPES.userDeleted]: (e, trx) =>
          this.subscriptions.cancelForErasure(trx, (e.data as UserDeletedPayload).userId),
      },
    });
    await this.consumer.start();
    this.health.register('kafka-consumer', async () => {
      if (!this.consumer?.isConnected) throw new Error('consumer disconnected');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
