import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, ZodPipe } from '@trainme/service-kit';
import { AnalyticsQueryService } from '../application/analytics-query.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
// Local dates run up to UTC+14, so open-ended ranges end one day after today's UTC date.
const today = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const seriesQuery = z
  .object({
    trackerId: z.uuid(),
    activity: z.string().min(2).max(80),
    metric: z.string().min(1).max(64).optional(),
    param: z.string().min(1).max(64).optional(),
    agg: z.enum(['AVG', 'SUM', 'MIN', 'MAX', 'COUNT', 'COUNT_TRUE', 'PCT_TRUE']).optional(),
    granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !!q.metric !== !!q.param, 'Pass exactly one of metric or param');
const summaryQuery = z.object({
  trackerId: z.uuid(),
  period: z.enum(['WEEK', 'MONTH']).default('WEEK'),
  date: isoDate.optional(),
});
const dayQuery = z.object({ trackerId: z.uuid(), date: isoDate });
const recordsQuery = z.object({ trackerId: z.uuid().optional() });
const searchQuery = z.object({
  trackerId: z.uuid(),
  metric: z.string().min(1).max(64),
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
  minDen: z.coerce.number().int().min(0).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(['value_desc', 'value_asc', 'date_desc']).default('value_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Analytics API (LLD §4.6). Values are in canonical units; clients convert with @trainme/units. */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsQueryService) {}

  @Get('series')
  series(@CurrentUser() user: AuthUser, @Query(new ZodPipe(seriesQuery, '/query')) q: z.infer<typeof seriesQuery>) {
    const range = { DAY: 30, WEEK: 7 * 26, MONTH: 365 }[q.granularity];
    return this.analytics.series(user, {
      trackerId: q.trackerId,
      activity: q.activity,
      item: (q.metric ?? q.param)!,
      itemType: q.metric ? 'metric' : 'param',
      granularity: q.granularity,
      from: q.from ?? daysAgo(range),
      to: q.to ?? today(),
      ...(q.agg ? { agg: q.agg } : {}),
    });
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(summaryQuery, '/query')) q: z.infer<typeof summaryQuery>) {
    return this.analytics.summary(user, q.trackerId, q.period, q.date ?? today());
  }

  @Get('day')
  day(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dayQuery, '/query')) q: z.infer<typeof dayQuery>) {
    return this.analytics.day(user, q.trackerId, q.date);
  }

  @Get('records')
  records(@CurrentUser() user: AuthUser, @Query(new ZodPipe(recordsQuery, '/query')) q: z.infer<typeof recordsQuery>) {
    return this.analytics.records(user, q.trackerId);
  }

  @Get('streaks')
  streaks(@CurrentUser() user: AuthUser) {
    return this.analytics.streaks(user);
  }

  @Get('sessions/search')
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(searchQuery, '/query')) q: z.infer<typeof searchQuery>) {
    return this.analytics.searchSessions(user, {
      ...q,
      from: q.from ?? daysAgo(182),
      to: q.to ?? today(),
    } as Parameters<AnalyticsQueryService['searchSessions']>[1]);
  }
}
