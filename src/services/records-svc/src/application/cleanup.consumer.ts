import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely, Transaction } from '@trainme/db';
import { EVENT_TYPES, TOPICS, type TrackerPayload, type UserDeletedPayload } from '@trainme/events';
import { EventConsumer, type Kafka } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { DATABASE, HealthRegistry, KAFKA, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { SESSION_COLUMNS } from './session.service.js';
import { SessionEvents } from './session-events.js';

type Trx = Transaction<RecordsDatabase>;

/**
 * Data clean-up (group records-svc.cleanup): a deleted tracker's sessions are soft-deleted and announced
 * (analytics drops their facts); user.deleted erases the user's sessions and entries outright.
 */
@Injectable()
export class CleanupConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer?: EventConsumer<RecordsDatabase>;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka,
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(SERVICE_CONFIG) private readonly config: RecordsConfig,
    private readonly health: HealthRegistry,
    private readonly events: SessionEvents,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.RUN_CONSUMERS) return;
    this.consumer = new EventConsumer<RecordsDatabase>({
      kafka: this.kafka,
      db: this.db,
      log: this.log,
      groupId: 'records-svc.cleanup',
      topics: [TOPICS.tracker, TOPICS.user],
      handlers: {
        [EVENT_TYPES.trackerDeleted]: (e, trx) => this.trackerDeleted(trx, e.data as TrackerPayload),
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

  private async trackerDeleted(trx: Trx, t: TrackerPayload) {
    const sessions = await trx
      .updateTable('activitySession')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('userId', '=', t.userId)
      .where('trackerId', '=', t.trackerId)
      .where('deletedAt', 'is', null)
      .returning([...SESSION_COLUMNS])
      .execute();
    for (const s of sessions) await this.events.deleted(trx, s);
    if (sessions.length)
      this.log.info({ trackerId: t.trackerId, sessions: sessions.length }, 'sessions of deleted tracker removed');
  }

  /** Right to erasure (FR-PRF-04): entries cascade from their sessions; locator rows go too. */
  private async userDeleted(trx: Trx, userId: string) {
    const r = await trx.deleteFrom('activitySession').where('userId', '=', userId).executeTakeFirst();
    await trx.deleteFrom('sessionLocator').where('userId', '=', userId).execute();
    // Feedback on the erased trainee's sessions, and feedback the erased person wrote as a trainer.
    await trx
      .deleteFrom('sessionFeedback')
      .where((eb) => eb.or([eb('traineeId', '=', userId), eb('authorId', '=', userId)]))
      .execute();
    // Sessions where the erased person was the trainer stay with the trainee, without the trainer link.
    await trx.updateTable('activitySession').set({ trainerId: null }).where('trainerId', '=', userId).execute();
    this.log.info({ sessions: Number(r.numDeletedRows) }, 'user data erased');
  }
}
