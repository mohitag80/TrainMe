import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { sql, type Kysely } from '@trainme/db';
import type { Logger } from '@trainme/observability';
import type { ParamStats } from '@trainme/schema';
import { DATABASE, LOGGER } from '@trainme/service-kit';
import { periodStart } from '../domain/periods.js';
import type { MetricStat, SessionStats } from '../domain/session-stats.js';
import type { AnalyticsDatabase } from '../infrastructure/analytics.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';
import { rollupValue, type ParamAgg } from './analytics-query.service.js';

export interface CoachingSeriesQuery {
  traineeId: string;
  trackerId: string;
  activity: string;
  metric?: string;
  param?: string;
  agg?: ParamAgg;
  granularity: 'DAY' | 'WEEK' | 'MONTH';
  from: string;
  to: string;
}

/**
 * Trainer views of a trainee (FR-COA-08): built only from session_fact rows whose trainer_id is the caller, so a
 * trainer never sees sessions or chart data from the trainee's other trainers or solo sessions. Periods are merged
 * with the rollup rules (ratios add num/den, extremes keep max/min, parameter stats add up).
 */
@Injectable()
export class CoachingAnalyticsService {
  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    @Inject(DATABASE) private readonly db: Kysely<AnalyticsDatabase>,
    private readonly trackers: TrackerClient,
  ) {}

  /** Trackers of the trainee that appear in the caller's sessions, with their chartable metrics and fields. */
  async traineeTrackers(user: AuthUser, traineeId: string) {
    const rows = await this.db
      .selectFrom('sessionFact')
      .select((eb) => [
        'trackerId',
        eb.fn.max('schemaVersion').as('version'),
        eb.fn.countAll<number>().as('sessions'),
        eb.fn.max('sessionDate').as('lastDate'),
      ])
      .where('trainerId', '=', user.id)
      .where('userId', '=', traineeId)
      .groupBy('trackerId')
      .execute();
    const items = [];
    for (const r of rows) {
      // Service token: the trainer cannot read the trainee's tracker directly.
      const schema = await this.trackers.schema(r.trackerId, Number(r.version));
      items.push({
        trackerId: r.trackerId,
        sessions: Number(r.sessions),
        lastDate: r.lastDate,
        activities: schema.activities
          .filter((a) => !a.hidden)
          .map((a) => ({
            code: a.code,
            name: a.name,
            metrics: a.metrics
              .filter((m) => !m.hidden)
              .map((m) => ({ key: m.key, label: m.label, kind: m.kind, display: m.display })),
            params: a.parameters
              .filter((p) => !p.hidden && ['INT', 'DECIMAL', 'DURATION'].includes(p.type))
              .map((p) => ({ key: p.key, label: p.label, unit: p.unit ?? null, dimension: p.dimension ?? null })),
          })),
      });
    }
    this.log.debug({ trainerId: user.id, traineeId, trackers: items.length }, 'coaching trackers');
    return { items };
  }

  async series(user: AuthUser, q: CoachingSeriesQuery) {
    const started = Date.now();
    const rows = await this.db
      .selectFrom('sessionFact')
      .select(['sessionDate', 'stats'])
      .where('trainerId', '=', user.id)
      .where('userId', '=', q.traineeId)
      .where('trackerId', '=', q.trackerId)
      .where('sessionDate', '>=', q.from)
      .where('sessionDate', '<=', q.to)
      .where(sql<boolean>`stats ? ${q.activity}`)
      .orderBy('sessionDate')
      .execute();
    type Acc = { metric?: MetricStat; param?: ParamStats; sessions: number };
    const buckets = new Map<string, Acc>();
    for (const r of rows) {
      const a = (r.stats as SessionStats)[q.activity];
      if (!a) continue;
      const period = periodStart(q.granularity, r.sessionDate);
      const acc = buckets.get(period) ?? { sessions: 0 };
      acc.sessions++;
      if (q.metric) {
        const m = a.metrics[q.metric];
        if (m) acc.metric = acc.metric ? mergeMetric(acc.metric, m) : { ...m };
      } else if (q.param) {
        const p = a.params[q.param];
        if (p) acc.param = acc.param ? mergeParam(acc.param, p) : { ...p };
      }
      buckets.set(period, acc);
    }
    const points = [...buckets.entries()].map(([period, acc]) => {
      if (q.metric) {
        const m = acc.metric;
        const value = !m || m.num === null ? null : m.den !== null ? (m.den === 0 ? null : m.num / m.den) : m.num;
        return { period, value, num: m?.num ?? null, den: m?.den ?? null, sessionCount: acc.sessions };
      }
      const p = acc.param;
      return {
        period,
        value: p ? rollupValue({ ...p, num: null, den: null, mergeKind: 'SUM' }, 'P', q.agg ?? 'AVG') : null,
        count: p?.count ?? 0,
        sessionCount: acc.sessions,
      };
    });
    this.log.debug(
      {
        trainerId: user.id,
        traineeId: q.traineeId,
        item: q.metric ?? q.param,
        sessions: rows.length,
        points: points.length,
        ms: Date.now() - started,
      },
      'coaching chart built',
    );
    return {
      trackerId: q.trackerId,
      activity: q.activity,
      item: q.metric ?? q.param,
      granularity: q.granularity,
      points,
    };
  }
}

function mergeMetric(a: MetricStat, b: MetricStat): MetricStat {
  const pick = (x: number | null, y: number | null, f: (p: number, q: number) => number) =>
    x === null ? y : y === null ? x : f(x, y);
  if (a.merge === 'MAX') return { ...a, num: pick(a.num, b.num, Math.max), den: pick(a.den, b.den, (p, q) => p + q) };
  if (a.merge === 'MIN') return { ...a, num: pick(a.num, b.num, Math.min), den: pick(a.den, b.den, (p, q) => p + q) };
  return { ...a, num: pick(a.num, b.num, (p, q) => p + q), den: pick(a.den, b.den, (p, q) => p + q) };
}

function mergeParam(a: ParamStats, b: ParamStats): ParamStats {
  const ext = (x: number | null, y: number | null, f: (p: number, q: number) => number) =>
    x === null ? y : y === null ? x : f(x, y);
  return {
    count: a.count + b.count,
    sum: a.sum + b.sum,
    min: ext(a.min, b.min, Math.min),
    max: ext(a.max, b.max, Math.max),
    trueCount: a.trueCount + b.trueCount,
  };
}
