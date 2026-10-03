import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from '@trainme/db';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { NotificationConfig } from '../config/notification.config.js';
import { nextFireAt } from '../domain/schedule.js';
import type { NotificationDatabase } from '../infrastructure/notification.database.js';
import { DispatcherService } from './dispatcher.service.js';

/** Fires due reminders (partial index on next_fire_at); SKIP LOCKED lets several replicas share the work. */
@Injectable()
export class ReminderSchedulerJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<NotificationDatabase>,
    @Inject(SERVICE_CONFIG) private readonly config: NotificationConfig,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly dispatcher: DispatcherService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.run().catch((err) => this.log.error({ err }, 'reminder run failed')),
      this.config.SCHEDULER_INTERVAL_SECONDS * 1000,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const due = await trx
        .selectFrom('reminder')
        .select(['id', 'userId', 'trackerId', 'title', 'daysOfWeek', 'timeOfDay', 'timezone', 'channel'])
        .where('isEnabled', '=', true)
        .where('nextFireAt', '<=', new Date())
        .orderBy('nextFireAt')
        .limit(200)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const r of due) {
        await this.dispatcher.dispatch(
          {
            userId: r.userId,
            template: 'reminder',
            title: r.title,
            body: `Time for: ${r.title}`,
            data: { reminderId: r.id, trackerId: r.trackerId },
            channels: [r.channel],
          },
          trx,
        );
        await trx
          .updateTable('reminder')
          .set({ nextFireAt: nextFireAt(r.daysOfWeek, r.timeOfDay, r.timezone), updatedAt: new Date() })
          .where('id', '=', r.id)
          .execute();
      }
      if (due.length) this.log.info({ fired: due.length }, 'reminders fired');
      return due.length;
    });
  }
}
