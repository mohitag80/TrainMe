import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, ZodPipe } from '@trainme/service-kit';
import { HistorySearchService, type EntryFilter } from '../application/history-search.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const sessionsQuery = z.object({
  q: z.string().trim().min(1).max(100),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
// where=speed_kmph:gte:140,line:in:off_stump|middle
const filterList = z
  .string()
  .max(500)
  .transform((v) =>
    v
      .split(',')
      .filter(Boolean)
      .map((part) => {
        const [key = '', op = '', ...rest] = part.split(':');
        return { key, op, value: rest.join(':') };
      }),
  )
  .pipe(
    z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
          op: z.enum(['eq', 'ne', 'gte', 'lte', 'in']),
          value: z.string().min(1).max(100),
        }),
      )
      .max(5),
  );
const entriesQuery = z.object({
  trackerId: z.uuid(),
  activity: z.string().min(2).max(80),
  from: isoDate.optional(),
  to: isoDate.optional(),
  where: filterList.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller()
export class SearchController {
  constructor(private readonly search: HistorySearchService) {}

  @Get('sessions/search')
  async sessions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(sessionsQuery, '/query')) q: z.infer<typeof sessionsQuery>,
  ) {
    return {
      items: await this.search.sessions(user, q.q, q.limit, {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
      }),
    };
  }

  @Get('entries/search')
  async entries(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(entriesQuery, '/query')) q: z.infer<typeof entriesQuery>,
  ) {
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const from = q.from ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString().slice(0, 10);
    const items = await this.search.entries(user, {
      trackerId: q.trackerId,
      activity: q.activity,
      from,
      to,
      filters: (q.where ?? []) as EntryFilter[],
      limit: q.limit,
    });
    return { items };
  }
}
