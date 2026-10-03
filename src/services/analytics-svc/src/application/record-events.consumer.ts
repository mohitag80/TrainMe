import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from '@trainme/db';
import { EVENT_TYPES, TOPICS, type SessionRefPayload, type SessionSnapshotPayload } from '@trainme/events';
import { EventConsumer, type Kafka } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, HealthRegistry, KAFKA, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { AnalyticsConfig } from '../config/analytics.config.js';
import type { AnalyticsDatabase } from '../infrastructure/analytics.database.js';
import { ProjectionService } from './projection.service.js';

/** Consumes record.events (group analytics-svc.rollups); only completed/updated/deleted sessions are aggregated. */
@Injectable()
export class RecordEventsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer?: EventConsumer<AnalyticsDatabase>;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(DATABASE) private readonly db: Kysely<AnalyticsDatabase>,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(SERVICE_CONFIG) private readonly config: AnalyticsConfig,
    private readonly health: HealthRegistry,
    private readonly projection: ProjectionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.RUN_CONSUMERS) return;
    this.consumer = new EventConsumer<AnalyticsDatabase>({
      kafka: this.kafka,
      db: this.db,
      log: this.log,
      groupId: 'analytics-svc.rollups',
      topics: [TOPICS.record],
      handlers: {
        [EVENT_TYPES.sessionCompleted]: (e, trx) =>
          this.projection.applySnapshot(trx, e.data as SessionSnapshotPayload),
        [EVENT_TYPES.sessionUpdated]: (e, trx) => this.projection.applySnapshot(trx, e.data as SessionSnapshotPayload),
        [EVENT_TYPES.sessionDeleted]: (e, trx) => this.projection.removeSession(trx, e.data as SessionRefPayload),
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
