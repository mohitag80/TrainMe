import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import type { JsonCache } from '@trainme/cache';
import { isQueryTimeout, setLocalStatementTimeout, type Kysely } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { CACHE, DATABASE, SERVICE_CONFIG } from '@trainme/service-kit';
import type { AnalyticsConfig } from '../config/analytics.config.js';
import { addDays, isoWeekStart, monthStart, periodStart } from '../domain/periods.js';
import type { AnalyticsDatabase, Granularity } from '../infrastructure/analytics.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';
import { chartGroupKey } from './projection.service.js';

export type ParamAgg = 'AVG' | 'SUM' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_TRUE' | 'PCT_TRUE';

export interface SeriesQuery {
  trackerId: string;
  activity: string;
  item: string;
  itemType: 'metric' | 'param';
  granularity: Granularity;
  from: string;
  to: string;
  agg?: ParamAgg;
}

type RollupValues = {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  trueCount: number;
  num: number | null;
  den: number | null;
  mergeKind: string;
};

/** Value of one rollup row: ratios are Σnum ÷ Σden; parameter statistics by the requested aggregation. */
export function rollupValue(r: RollupValues, itemType: 'P' | 'M', agg: ParamAgg = 'AVG'): number | null {
  if (itemType === 'M') return r.num === null ? null : r.den !== null ? (r.den === 0 ? null : r.num / r.den) : r.num;
  switch (agg) {
    case 'AVG':
      return r.count ? r.sum / r.count : null;
    case 'SUM':
      return r.sum;
    case 'MIN':
      return r.min;
    case 'MAX':
      return r.max;
    case 'COUNT':
      return r.count;
    case 'COUNT_TRUE':
      return r.trueCount;
    case 'PCT_TRUE':
      return r.count ? r.trueCount / r.count : null;
  }
}

@Injectable()
export class AnalyticsQueryService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<AnalyticsDatabase>,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(SERVICE_CONFIG) private readonly config: AnalyticsConfig,
    private readonly trackers: TrackerClient,
  ) {}

  /** FR-ANL-01/02/08: one series from pre-aggregated rollups (PK range scan), cached 5 min per user+tracker. */
  async series(user: AuthUser, q: SeriesQuery) {
    const key = `ana:chart:${user.id}:${q.trackerId}:${createHash('sha1').update(JSON.stringify(q)).digest('hex')}`;
    const cached = await this.cache.get<unknown>(key);
    if (cached) return cached;
    const itemType = q.itemType === 'metric' ? 'M' : 'P';
    const rows = await this.db
      .selectFrom('metricRollup')
      .select(['periodStart', 'count', 'sum', 'min', 'max', 'trueCount', 'num', 'den', 'mergeKind', 'sessionCount'])
      .where('userId', '=', user.id)
      .where('trackerId', '=', q.trackerId)
      .where('activityCode', '=', q.activity)
      .where('itemType', '=', itemType)
      .where('itemKey', '=', q.item)
      .where('granularity', '=', q.granularity)
      .where('periodStart', '>=', periodStart(q.granularity, q.from))
      .where('periodStart', '<=', q.to)
      .orderBy('periodStart')
      .execute();
    const result = {
      trackerId: q.trackerId,
      activity: q.activity,
      item: q.item,
      itemType: q.itemType,
      granularity: q.granularity,
      ...(itemType === 'P' ? { agg: q.agg ?? 'AVG' } : {}),
      points: rows.map((r) => ({
        period: r.periodStart,
        value: rollupValue(r, itemType, q.agg),
        ...(itemType === 'M' ? { num: r.num, den: r.den } : { count: r.count }),
        sessionCount: r.sessionCount,
      })),
    };
    await this.cache.setTracked(chartGroupKey(user.id, q.trackerId), key, result, 300);
    return result;
  }

  /** FR-ANL-03: every visible metric for the current vs previous week/month, with labels from the schema. */
  async summary(user: AuthUser, trackerId: string, period: 'WEEK' | 'MONTH', date: string) {
    const schema = await this.trackers.schema(trackerId, undefined, user); // also proves ownership
    const current = period === 'WEEK' ? isoWeekStart(date) : monthStart(date);
    const previous = period === 'WEEK' ? addDays(current, -7) : monthStart(addDays(current, -1));
    const rows = await this.db
      .selectFrom('metricRollup')
      .select([
        'activityCode',
        'itemKey',
        'periodStart',
        'count',
        'sum',
        'min',
        'max',
        'trueCount',
        'num',
        'den',
        'mergeKind',
        'sessionCount',
      ])
      .where('userId', '=', user.id)
      .where('trackerId', '=', trackerId)
      .where('itemType', '=', 'M')
      .where('granularity', '=', period)
      .where('periodStart', 'in', [current, previous])
      .execute();
    const at = (a: string, k: string, p: string) =>
      rows.find((r) => r.activityCode === a && r.itemKey === k && r.periodStart === p);
    const activities = schema.activities
      .filter((a) => !a.hidden)
      .map((a) => ({
        activity: a.code,
        name: a.name,
        metrics: a.metrics
          .filter((m) => !m.hidden)
          .map((m) => {
            const cur = at(a.code, m.key, current);
            const prev = at(a.code, m.key, previous);
            const cv = cur ? rollupValue(cur, 'M') : null;
            const pv = prev ? rollupValue(prev, 'M') : null;
            return {
              key: m.key,
              label: m.label,
              kind: m.kind,
              display: m.display,
              current: cur ? { value: cv, num: cur.num, den: cur.den, sessions: cur.sessionCount } : null,
              previous: prev ? { value: pv, num: prev.num, den: prev.den, sessions: prev.sessionCount } : null,
              change: cv !== null && pv !== null ? cv - pv : null,
            };
          })
          .filter((m) => m.current || m.previous),
      }))
      .filter((a) => a.metrics.length);
    return { trackerId, period, currentPeriod: current, previousPeriod: previous, activities };
  }

  /** FR-ANL-11: each named session of a day with its metric values (session_metric by date). */
  async day(user: AuthUser, trackerId: string, date: string) {
    const rows = await this.db
      .selectFrom('sessionMetric')
      .select(['sessionId', 'sessionName', 'startedAt', 'activityCode', 'metricKey', 'num', 'den', 'value'])
      .where('userId', '=', user.id)
      .where('trackerId', '=', trackerId)
      .where('sessionDate', '=', date)
      .orderBy('startedAt')
      .execute();
    const sessions = new Map<
      string,
      {
        sessionId: string;
        name: string;
        startedAt: Date;
        metrics: Record<string, { num: number | null; den: number | null; value: number | null }>;
      }
    >();
    for (const r of rows) {
      const s = sessions.get(r.sessionId) ?? {
        sessionId: r.sessionId,
        name: r.sessionName,
        startedAt: r.startedAt,
        metrics: {},
      };
      s.metrics[`${r.activityCode}.${r.metricKey}`] = { num: r.num, den: r.den, value: r.value };
      sessions.set(r.sessionId, s);
    }
    return { trackerId, date, sessions: [...sessions.values()] };
  }

  async records(user: AuthUser, trackerId?: string) {
    let q = this.db.selectFrom('personalRecord').selectAll().where('userId', '=', user.id);
    if (trackerId) q = q.where('trackerId', '=', trackerId);
    return { items: await q.orderBy('achievedAt', 'desc').execute() };
  }

  async streaks(user: AuthUser) {
    return { items: await this.db.selectFrom('streak').selectAll().where('userId', '=', user.id).execute() };
  }

  /** S6: sessions by metric value (threshold and/or best first) within a date range – ix_session_metric__lookup. */
  async searchSessions(
    user: AuthUser,
    q: {
      trackerId: string;
      metric: string;
      min?: number;
      max?: number;
      minDen?: number;
      from: string;
      to: string;
      sort: 'value_desc' | 'value_asc' | 'date_desc';
      limit: number;
    },
  ) {
    try {
      return await this.db.transaction().execute(async (trx) => {
        await setLocalStatementTimeout(trx, this.config.SEARCH_TIMEOUT_MS);
        let query = trx
          .selectFrom('sessionMetric')
          .select(['sessionId', 'sessionName', 'sessionDate', 'activityCode', 'metricKey', 'value', 'num', 'den'])
          .where('userId', '=', user.id)
          .where('trackerId', '=', q.trackerId)
          .where('metricKey', '=', q.metric)
          .where('sessionDate', '>=', q.from)
          .where('sessionDate', '<=', q.to)
          .where('value', 'is not', null);
        if (q.min !== undefined) query = query.where('value', '>=', q.min);
        if (q.max !== undefined) query = query.where('value', '<=', q.max);
        if (q.minDen !== undefined) query = query.where('den', '>=', q.minDen);
        query =
          q.sort === 'date_desc'
            ? query.orderBy('sessionDate', 'desc')
            : query.orderBy('value', q.sort === 'value_asc' ? 'asc' : 'desc').orderBy('sessionDate', 'desc');
        return { items: await query.limit(q.limit).execute() };
      });
    } catch (err) {
      if (isQueryTimeout(err)) throw ProblemError.timeout();
      throw err;
    }
  }
}
