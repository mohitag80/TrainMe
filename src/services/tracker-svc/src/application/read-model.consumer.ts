import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely, Transaction } from '@trainme/db';
import {
  EVENT_TYPES,
  TOPICS,
  type SubscriptionPayload,
  type TemplatePublishedPayload,
  type TrackerPayload,
  type UserDeletedPayload,
} from '@trainme/events';
import { EventConsumer, type Kafka, type OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, HealthRegistry, KAFKA, LOGGER, OUTBOX, SERVICE_CONFIG } from '@trainme/service-kit';
import type { TrackerConfig } from '../config/tracker.config.js';
import type { TrackerDatabase } from '../infrastructure/tracker.database.js';

type Trx = Transaction<TrackerDatabase>;

/**
 * Local read models fed by events (group tracker-svc.read-models): plan entitlements from subscription.*,
 * latest template versions from catalog.template.* ("upgrade available") and the user.deleted erasure step.
 */
@Injectable()
export class ReadModelConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer?: EventConsumer<TrackerDatabase>;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(DATABASE) private readonly db: Kysely<TrackerDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(SERVICE_CONFIG) private readonly config: TrackerConfig,
    private readonly health: HealthRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.RUN_CONSUMERS) return;
    const entitlement = (e: { data: unknown }, trx: Trx) => this.entitlement(trx, e.data as SubscriptionPayload);
    this.consumer = new EventConsumer<TrackerDatabase>({
      kafka: this.kafka,
      db: this.db,
      log: this.log,
      groupId: 'tracker-svc.read-models',
      topics: [TOPICS.subscription, TOPICS.catalog, TOPICS.user],
      handlers: {
        [EVENT_TYPES.subscriptionActivated]: entitlement,
        [EVENT_TYPES.subscriptionChanged]: entitlement,
        [EVENT_TYPES.subscriptionCanceled]: entitlement,
        [EVENT_TYPES.templatePublished]: (e, trx) => this.templatePublished(trx, e.data as TemplatePublishedPayload),
        [EVENT_TYPES.userDeleted]: (e, trx) => this.userDeleted(trx, (e.data as UserDeletedPayload).userId),
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

  private async entitlement(trx: Trx, s: SubscriptionPayload) {
    const row = { planCode: s.planCode, entitlements: JSON.stringify(s.entitlements), updatedAt: new Date() };
    await trx
      .insertInto('userEntitlement')
      .values({ userId: s.userId, ...row })
      .onConflict((oc) => oc.column('userId').doUpdateSet(row))
      .execute();
  }

  /** Keeps the highest published version per template (events can arrive out of order across retries). */
  private async templatePublished(trx: Trx, t: TemplatePublishedPayload) {
    await trx
      .insertInto('templateRelease')
      .values({ templateCode: t.templateCode, latestVersion: t.version, name: t.name })
      .onConflict((oc) =>
        oc
          .column('templateCode')
          .doUpdateSet({ latestVersion: t.version, name: t.name, publishedAt: new Date() })
          .where('templateRelease.latestVersion', '<', t.version),
      )
      .execute();
  }

  /** Erasure saga step: soft-delete every tracker and announce each deletion (records-svc purges sessions). */
  private async userDeleted(trx: Trx, userId: string) {
    const trackers = await trx
      .updateTable('userTracker')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('userId', '=', userId)
      .where('deletedAt', 'is', null)
      .returning(['id', 'displayName', 'templateCode', 'schemaVersion', 'status'])
      .execute();
    for (const t of trackers) {
      await this.outbox.enqueue<TrackerPayload>(trx, TOPICS.tracker, {
        type: EVENT_TYPES.trackerDeleted,
        userId,
        subject: `tracker/${t.id}`,
        data: {
          trackerId: t.id,
          userId,
          displayName: t.displayName,
          templateCode: t.templateCode,
          schemaVersion: t.schemaVersion,
          status: t.status,
        },
      });
    }
    await trx.deleteFrom('userEntitlement').where('userId', '=', userId).execute();
  }
}
