import { Inject, Injectable } from '@nestjs/common';
import { newId, type Kysely, type Transaction } from '@trainme/db';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER } from '@trainme/service-kit';
import { inQuietHours } from '../domain/schedule.js';
import { Mailer } from '../infrastructure/mailer.js';
import type { Channel, NotificationDatabase } from '../infrastructure/notification.database.js';

export interface NewNotification {
  userId: string;
  template: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels: Channel[];
}

type Db = Kysely<NotificationDatabase> | Transaction<NotificationDatabase>;

/**
 * Creates one row per channel and delivers it, honouring preferences and quiet hours (FR-NTF-03).
 * IN_APP is always stored for the inbox; PUSH is logged as SKIPPED until FCM/APNs keys are configured.
 */
@Injectable()
export class DispatcherService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<NotificationDatabase>,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly mailer: Mailer,
  ) {}

  async dispatch(n: NewNotification, db: Db = this.db): Promise<void> {
    const contact = await db
      .selectFrom('userContact')
      .select(['email', 'timezone', 'isDeleted'])
      .where('userId', '=', n.userId)
      .executeTakeFirst();
    if (contact?.isDeleted) {
      this.log.debug({ userId: n.userId, template: n.template }, 'notification skipped – account deleted');
      return;
    }
    const pref = await db
      .selectFrom('notificationPreference')
      .selectAll()
      .where('userId', '=', n.userId)
      .executeTakeFirst();
    const quiet = inQuietHours(
      new Date(),
      contact?.timezone ?? 'UTC',
      pref?.quietStart ?? null,
      pref?.quietEnd ?? null,
    );
    for (const channel of new Set<Channel>(['IN_APP', ...n.channels])) {
      const enabled =
        channel === 'EMAIL'
          ? (pref?.emailEnabled ?? true)
          : channel === 'PUSH'
            ? (pref?.pushEnabled ?? true)
            : (pref?.inAppEnabled ?? true);
      let status: 'SENT' | 'SKIPPED' | 'FAILED' = 'SENT';
      let error: string | null = null;
      if (!enabled) [status, error] = ['SKIPPED', 'disabled by user'];
      else if (channel === 'PUSH')
        [status, error] = ['SKIPPED', quiet ? 'quiet hours' : 'push provider not configured'];
      else if (channel === 'EMAIL') {
        if (quiet) [status, error] = ['SKIPPED', 'quiet hours'];
        else if (!contact?.email) [status, error] = ['SKIPPED', 'no email address'];
        else {
          try {
            await this.mailer.send(contact.email, n.title, n.body);
          } catch (err) {
            [status, error] = ['FAILED', (err as Error).message.slice(0, 300)];
            this.log.warn({ err, userId: n.userId }, 'email delivery failed');
          }
        }
      }
      this.log.info(
        { userId: n.userId, template: n.template, channel, status, reason: error },
        'notification ' + status.toLowerCase(),
      );
      await db
        .insertInto('notification')
        .values({
          id: newId(),
          userId: n.userId,
          channel,
          template: n.template,
          title: n.title,
          body: n.body,
          data: JSON.stringify(n.data ?? {}),
          status,
          error,
          readAt: null,
          sentAt: status === 'SENT' ? new Date() : null,
        })
        .execute();
    }
  }
}
