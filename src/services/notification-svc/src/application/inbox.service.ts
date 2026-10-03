import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { newId, type Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { DATABASE } from '@trainme/service-kit';
import { nextFireAt } from '../domain/schedule.js';
import type { Channel, NotificationDatabase } from '../infrastructure/notification.database.js';

export interface ReminderInput {
  title: string;
  trackerId?: string | null;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  channel: Channel;
  isEnabled?: boolean;
}

const REMINDER_COLUMNS = [
  'id',
  'trackerId',
  'title',
  'daysOfWeek',
  'timeOfDay',
  'timezone',
  'channel',
  'isEnabled',
  'nextFireAt',
  'createdAt',
] as const;

/** Reminders, inbox and preferences of the caller (FR-NTF-01/04, FR-PRF-05). */
@Injectable()
export class InboxService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<NotificationDatabase>) {}

  reminders(user: AuthUser) {
    return this.db
      .selectFrom('reminder')
      .select([...REMINDER_COLUMNS])
      .where('userId', '=', user.id)
      .orderBy('createdAt')
      .execute();
  }

  async createReminder(user: AuthUser, r: ReminderInput) {
    const count = await this.db
      .selectFrom('reminder')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= 50) throw ProblemError.tooManyRequests('At most 50 reminders');
    return this.db
      .insertInto('reminder')
      .values({
        id: newId(),
        userId: user.id,
        trackerId: r.trackerId ?? null,
        title: r.title,
        daysOfWeek: r.daysOfWeek,
        timeOfDay: r.timeOfDay,
        timezone: r.timezone,
        channel: r.channel,
        isEnabled: r.isEnabled ?? true,
        nextFireAt: nextFireAt(r.daysOfWeek, r.timeOfDay, r.timezone),
      })
      .returning([...REMINDER_COLUMNS])
      .executeTakeFirstOrThrow();
  }

  async updateReminder(user: AuthUser, id: string, r: ReminderInput) {
    const row = await this.db
      .updateTable('reminder')
      .set({
        trackerId: r.trackerId ?? null,
        title: r.title,
        daysOfWeek: r.daysOfWeek,
        timeOfDay: r.timeOfDay,
        timezone: r.timezone,
        channel: r.channel,
        isEnabled: r.isEnabled ?? true,
        nextFireAt: nextFireAt(r.daysOfWeek, r.timeOfDay, r.timezone),
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .returning([...REMINDER_COLUMNS])
      .executeTakeFirst();
    if (!row) throw ProblemError.notFound(`Reminder ${id}`);
    return row;
  }

  async deleteReminder(user: AuthUser, id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('reminder')
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (r.numDeletedRows === 0n) throw ProblemError.notFound(`Reminder ${id}`);
  }

  /** In-app inbox, newest first, keyset pagination on (created_at, id). */
  async inbox(user: AuthUser, limit: number, cursor?: string) {
    let q = this.db
      .selectFrom('notification')
      .select(['id', 'template', 'title', 'body', 'data', 'readAt', 'createdAt'])
      .where('userId', '=', user.id)
      .where('channel', '=', 'IN_APP');
    if (cursor) {
      const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
      q = q.where((eb) =>
        eb.or([eb('createdAt', '<', new Date(ts!)), eb.and([eb('createdAt', '=', new Date(ts!)), eb('id', '<', id!)])]),
      );
    }
    const rows = await q
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const unread = await this.db
      .selectFrom('notification')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('userId', '=', user.id)
      .where('channel', '=', 'IN_APP')
      .where('readAt', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      items,
      unread: Number(unread.n),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url')
          : null,
    };
  }

  async markRead(user: AuthUser, id?: string): Promise<{ updated: number }> {
    let q = this.db
      .updateTable('notification')
      .set({ readAt: new Date() })
      .where('userId', '=', user.id)
      .where('readAt', 'is', null);
    if (id) q = q.where('id', '=', id);
    const r = await q.executeTakeFirst();
    return { updated: Number(r.numUpdatedRows) };
  }

  async preferences(user: AuthUser) {
    const p = await this.db
      .selectFrom('notificationPreference')
      .selectAll()
      .where('userId', '=', user.id)
      .executeTakeFirst();
    return (
      p ?? {
        userId: user.id,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
        quietStart: null,
        quietEnd: null,
      }
    );
  }

  async setPreferences(
    user: AuthUser,
    p: {
      emailEnabled: boolean;
      pushEnabled: boolean;
      inAppEnabled: boolean;
      quietStart: string | null;
      quietEnd: string | null;
    },
  ) {
    return this.db
      .insertInto('notificationPreference')
      .values({ userId: user.id, ...p })
      .onConflict((oc) => oc.column('userId').doUpdateSet({ ...p, updatedAt: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
