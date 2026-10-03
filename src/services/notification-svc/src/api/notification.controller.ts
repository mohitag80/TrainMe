import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, ZodPipe } from '@trainme/service-kit';
import { InboxService } from '../application/inbox.service.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const reminderBody = z.object({
  title: z.string().trim().min(1).max(120),
  trackerId: z.uuid().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  timeOfDay: time,
  timezone: z
    .string()
    .min(1)
    .max(40)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown IANA time zone'),
  channel: z.enum(['PUSH', 'EMAIL', 'IN_APP']).default('PUSH'),
  isEnabled: z.boolean().optional(),
});
const prefsBody = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  quietStart: time.nullable(),
  quietEnd: time.nullable(),
});
const inboxQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
const idParam = new ZodPipe(z.uuid(), '/path/id');

/** Reminders, inbox and preferences (LLD §4.7). */
@Controller()
export class NotificationController {
  constructor(private readonly inbox: InboxService) {}

  @Get('reminders')
  async reminders(@CurrentUser() user: AuthUser) {
    return { items: await this.inbox.reminders(user) };
  }

  @Post('reminders')
  createReminder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(reminderBody, '/body')) body: z.infer<typeof reminderBody>,
  ) {
    return this.inbox.createReminder(user, body);
  }

  @Put('reminders/:id')
  updateReminder(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(reminderBody, '/body')) body: z.infer<typeof reminderBody>,
  ) {
    return this.inbox.updateReminder(user, id, body);
  }

  @Delete('reminders/:id')
  @HttpCode(204)
  async deleteReminder(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    await this.inbox.deleteReminder(user, id);
  }

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(inboxQuery, '/query')) q: z.infer<typeof inboxQuery>) {
    return this.inbox.inbox(user, q.limit, q.cursor);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.inbox.markRead(user);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', idParam) id: string) {
    return this.inbox.markRead(user, id);
  }

  @Get('notifications/preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.inbox.preferences(user);
  }

  @Put('notifications/preferences')
  setPreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(prefsBody, '/body')) body: z.infer<typeof prefsBody>,
  ) {
    return this.inbox.setPreferences(user, body);
  }
}
