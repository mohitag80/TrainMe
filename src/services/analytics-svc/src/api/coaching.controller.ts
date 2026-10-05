import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '@trainme/auth';
import { CurrentUser, ZodPipe } from '@trainme/service-kit';
import { CoachingAnalyticsService } from '../application/coaching-analytics.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const seriesQuery = z
  .object({
    traineeId: z.uuid(),
    trackerId: z.uuid(),
    activity: z.string().min(2).max(80),
    metric: z.string().min(1).max(64).optional(),
    param: z.string().min(1).max(64).optional(),
    agg: z.enum(['AVG', 'SUM', 'MIN', 'MAX', 'COUNT', 'COUNT_TRUE', 'PCT_TRUE']).optional(),
    granularity: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
    from: isoDate.default(() => daysAgo(730)),
    to: isoDate.default(() => daysAgo(-1)),
  })
  .refine((q) => !!q.metric !== !!q.param, 'Pass exactly one of metric or param');

/** Trainer analytics (docs/12 §5): only sessions where the caller was the assigned trainer. */
@Controller('analytics/coaching')
export class CoachingController {
  constructor(private readonly coaching: CoachingAnalyticsService) {}

  @Get('trainees/:traineeId/trackers')
  trackers(
    @CurrentUser() user: AuthUser,
    @Param('traineeId', new ZodPipe(z.uuid(), '/path/traineeId')) traineeId: string,
  ) {
    return this.coaching.traineeTrackers(user, traineeId);
  }

  @Get('series')
  series(@CurrentUser() user: AuthUser, @Query(new ZodPipe(seriesQuery, '/query')) q: z.infer<typeof seriesQuery>) {
    return this.coaching.series(user, q);
  }
}
