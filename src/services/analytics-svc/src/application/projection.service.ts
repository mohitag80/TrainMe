import { Inject, Injectable } from '@nestjs/common';
import type { JsonCache } from '@trainme/cache';
import { sql, type Transaction } from '@trainme/db';
import {
  EVENT_TYPES,
  TOPICS,
  type PrAchievedPayload,
  type SessionRefPayload,
  type SessionSnapshotPayload,
} from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import type { EffectiveSchema } from '@trainme/schema';
import { CACHE, LOGGER, OUTBOX } from '@trainme/service-kit';
import { addDays, isoWeekStart, localDate, monthEnd, monthStart, streaks } from '../domain/periods.js';
import { buildSessionStats, type SessionStats } from '../domain/session-stats.js';
import type { AnalyticsDatabase, MetricRollupTable } from '../infrastructure/analytics.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';

type Trx = Transaction<AnalyticsDatabase>;
type RollupRow = Omit<MetricRollupTable, 'updatedAt'>;

export const chartGroupKey = (userId: string, trackerId: string) => `ana:charts:${userId}:${trackerId}`;

/**
 * Keeps the read models in step with completed sessions (ADR-005): session facts → DAY rollups for the
 * affected date(s) → WEEK/MONTH rebuilt from DAY rows (exact, re-runnable), per-session metrics,
 * personal records and streaks. Runs inside the idempotent consumer's transaction.
 */
@Injectable()
export class ProjectionService {
  constructor(
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(CACHE) private readonly cache: JsonCache,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly trackers: TrackerClient,
  ) {}

  /** record.session.completed / .updated (full snapshot). */
  async applySnapshot(trx: Trx, s: SessionSnapshotPayload): Promise<void> {
    if (s.status !== 'COMPLETED') return;
    if (s.entriesOmitted) {
      this.log.warn(
        { sessionId: s.sessionId },
        'snapshot without entries (> 512 KB) – skipped until entry fetch is enabled',
      );
      return;
    }
    const schema = await this.trackers.schema(s.trackerId, s.schemaVersion);
    const stats = buildSessionStats(
      schema,
      s.entries.map((e) => ({ activity: e.activity, values: e.values })),
    );
    const previous = await trx
      .selectFrom('sessionFact')
      .select('sessionDate')
      .where('userId', '=', s.userId)
      .where('sessionId', '=', s.sessionId)
      .executeTakeFirst();

    await trx
      .insertInto('sessionFact')
      .values({
        userId: s.userId,
        sessionId: s.sessionId,
        trackerId: s.trackerId,
        sessionDate: s.sessionDate,
        sessionName: s.name,
        startedAt: new Date(s.startedAt),
        schemaVersion: s.schemaVersion,
        entryCount: s.entryCount,
        stats: JSON.stringify(stats),
        trainerId: s.trainerId ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['userId', 'sessionId']).doUpdateSet((eb) => ({
          sessionDate: eb.ref('excluded.sessionDate'),
          sessionName: eb.ref('excluded.sessionName'),
          startedAt: eb.ref('excluded.startedAt'),
          schemaVersion: eb.ref('excluded.schemaVersion'),
          entryCount: eb.ref('excluded.entryCount'),
          stats: eb.ref('excluded.stats'),
          trainerId: eb.ref('excluded.trainerId'),
          updatedAt: new Date(),
        })),
      )
      .execute();

    await trx.deleteFrom('sessionMetric').where('userId', '=', s.userId).where('sessionId', '=', s.sessionId).execute();
    const metricRows = Object.entries(stats).flatMap(([activityCode, a]) =>
      Object.entries(a.metrics).map(([metricKey, m]) => ({
        userId: s.userId,
        sessionId: s.sessionId,
        activityCode,
        metricKey,
        trackerId: s.trackerId,
        sessionDate: s.sessionDate,
        sessionName: s.name,
        startedAt: new Date(s.startedAt),
        num: m.num,
        den: m.den,
        value: m.value,
      })),
    );
    if (metricRows.length) await trx.insertInto('sessionMetric').values(metricRows).execute();

    const dates = new Set([
      s.sessionDate,
      ...(previous && previous.sessionDate !== s.sessionDate ? [previous.sessionDate] : []),
    ]);
    for (const d of dates) await this.rebuildRollups(trx, s.userId, s.trackerId, d);
    await this.updatePersonalRecords(trx, s, stats, schema);
    await this.updateStreak(trx, s.userId, s.trackerId, localDate(new Date(), s.timezone));
    await this.cache.invalidateGroup(chartGroupKey(s.userId, s.trackerId));
    this.log.info(
      {
        sessionId: s.sessionId,
        userId: s.userId,
        trackerId: s.trackerId,
        sessionDate: s.sessionDate,
        entries: s.entries.length,
        rolledUpDays: [...dates],
        replaced: !!previous,
      },
      previous ? 'session stats recalculated' : 'session stats calculated',
    );
  }

  /** record.session.deleted: remove its facts and rebuild that day's rollups. */
  async removeSession(trx: Trx, ref: SessionRefPayload): Promise<void> {
    const fact = await trx
      .deleteFrom('sessionFact')
      .where('userId', '=', ref.userId)
      .where('sessionId', '=', ref.sessionId)
      .returning(['sessionDate', 'trackerId'])
      .executeTakeFirst();
    if (!fact) {
      this.log.debug({ sessionId: ref.sessionId }, 'deleted session had no stats');
      return;
    }
    await trx
      .deleteFrom('sessionMetric')
      .where('userId', '=', ref.userId)
      .where('sessionId', '=', ref.sessionId)
      .execute();
    await this.rebuildRollups(trx, ref.userId, fact.trackerId, fact.sessionDate);
    this.log.info(
      { sessionId: ref.sessionId, userId: ref.userId, trackerId: fact.trackerId, sessionDate: fact.sessionDate },
      'session stats removed',
    );
    // No time zone on delete events: a +1 day tolerance keeps users east of UTC from losing today.
    await this.updateStreak(trx, ref.userId, fact.trackerId, addDays(localDate(new Date()), 1));
    await this.cache.invalidateGroup(chartGroupKey(ref.userId, fact.trackerId));
  }

  /** tracker.deleted: every read model of that tracker goes. */
  async removeTracker(trx: Trx, userId: string, trackerId: string): Promise<void> {
    for (const table of ['sessionFact', 'metricRollup', 'sessionMetric', 'personalRecord', 'streak'] as const) {
      await trx.deleteFrom(table).where('userId', '=', userId).where('trackerId', '=', trackerId).execute();
    }
    await this.cache.invalidateGroup(chartGroupKey(userId, trackerId));
    this.log.info({ userId, trackerId }, 'tracker stats removed');
  }

  /** user.deleted (erasure saga): all of the user's analytics rows. */
  async removeUser(trx: Trx, userId: string): Promise<void> {
    for (const table of ['sessionFact', 'metricRollup', 'sessionMetric', 'personalRecord', 'streak'] as const) {
      await trx.deleteFrom(table).where('userId', '=', userId).execute();
    }
    this.log.info({ userId }, 'user stats erased');
  }

  /** DAY from that day's session facts, then the enclosing WEEK and MONTH from DAY rows. */
  private async rebuildRollups(trx: Trx, userId: string, trackerId: string, date: string): Promise<void> {
    const facts = await trx
      .selectFrom('sessionFact')
      .select('stats')
      .where('userId', '=', userId)
      .where('trackerId', '=', trackerId)
      .where('sessionDate', '=', date)
      .execute();
    const day = new Map<string, RollupRow>();
    const row = (activityCode: string, itemType: 'P' | 'M', itemKey: string): RollupRow => {
      const k = `${activityCode}|${itemType}|${itemKey}`;
      let r = day.get(k);
      if (!r) {
        r = {
          userId,
          trackerId,
          activityCode,
          itemType,
          itemKey,
          granularity: 'DAY',
          periodStart: date,
          count: 0,
          sum: 0,
          min: null,
          max: null,
          trueCount: 0,
          num: null,
          den: null,
          mergeKind: 'SUM',
          sessionCount: 0,
        };
        day.set(k, r);
      }
      return r;
    };
    for (const { stats } of facts) {
      for (const [activityCode, a] of Object.entries(stats)) {
        for (const [key, p] of Object.entries(a.params)) {
          const r = row(activityCode, 'P', key);
          r.count += p.count;
          r.sum += p.sum;
          r.trueCount += p.trueCount;
          if (p.min !== null) r.min = r.min === null ? p.min : Math.min(r.min, p.min);
          if (p.max !== null) r.max = r.max === null ? p.max : Math.max(r.max, p.max);
          r.sessionCount++;
        }
        for (const [key, m] of Object.entries(a.metrics)) {
          const r = row(activityCode, 'M', key);
          r.mergeKind = m.merge;
          if (m.num !== null) {
            r.num =
              r.num === null
                ? m.num
                : m.merge === 'MAX'
                  ? Math.max(r.num, m.num)
                  : m.merge === 'MIN'
                    ? Math.min(r.num, m.num)
                    : r.num + m.num;
          }
          if (m.den !== null) r.den = (r.den ?? 0) + m.den;
          r.sessionCount++;
        }
      }
    }
    await trx
      .deleteFrom('metricRollup')
      .where('userId', '=', userId)
      .where('trackerId', '=', trackerId)
      .where('granularity', '=', 'DAY')
      .where('periodStart', '=', date)
      .execute();
    if (day.size)
      await trx
        .insertInto('metricRollup')
        .values([...day.values()])
        .execute();

    const week = isoWeekStart(date);
    await this.rebuildPeriod(trx, userId, trackerId, 'WEEK', week, addDays(week, 6));
    await this.rebuildPeriod(trx, userId, trackerId, 'MONTH', monthStart(date), monthEnd(date));
  }

  private async rebuildPeriod(
    trx: Trx,
    userId: string,
    trackerId: string,
    granularity: 'WEEK' | 'MONTH',
    from: string,
    to: string,
  ) {
    await trx
      .deleteFrom('metricRollup')
      .where('userId', '=', userId)
      .where('trackerId', '=', trackerId)
      .where('granularity', '=', granularity)
      .where('periodStart', '=', from)
      .execute();
    await sql`
      INSERT INTO metric_rollup (user_id, tracker_id, activity_code, item_type, item_key, granularity, period_start,
                                 count, sum, min, max, true_count, num, den, merge_kind, session_count)
      SELECT user_id, tracker_id, activity_code, item_type, item_key, ${granularity}, ${from}::date,
             sum(count), sum(sum), min(min), max(max), sum(true_count),
             CASE max(merge_kind) WHEN 'MAX' THEN max(num) WHEN 'MIN' THEN min(num) ELSE sum(num) END,
             sum(den), max(merge_kind), sum(session_count)
      FROM metric_rollup
      WHERE user_id = ${userId} AND tracker_id = ${trackerId} AND granularity = 'DAY'
        AND period_start BETWEEN ${from}::date AND ${to}::date
      GROUP BY user_id, tracker_id, activity_code, item_type, item_key`.execute(trx);
  }

  /**
   * FR-ANL-04: records for extreme metrics only (top speed, best time, heaviest lift): MAX metrics improve
   * upwards, MIN metrics downwards. Ratios are excluded until the catalog says whether higher is better
   * (a 0 % no-ball rate is good, a 0 % yorker accuracy is not). Improvements are announced (→ notification-svc).
   */
  private async updatePersonalRecords(
    trx: Trx,
    s: SessionSnapshotPayload,
    stats: SessionStats,
    schema: EffectiveSchema,
  ) {
    for (const [activityCode, a] of Object.entries(stats)) {
      const defs = schema.activities.find((x) => x.code === activityCode)?.metrics ?? [];
      for (const [metricKey, m] of Object.entries(a.metrics)) {
        if (m.value === null) continue;
        const def = defs.find((d) => d.key === metricKey);
        if (!def || def.hidden) continue;
        if (def.kind !== 'SINGLE' || m.merge === 'SUM') continue;
        const direction = m.merge === 'MIN' ? 'MIN' : 'MAX';
        const prev = await trx
          .selectFrom('personalRecord')
          .select(['bestValue'])
          .where('userId', '=', s.userId)
          .where('trackerId', '=', s.trackerId)
          .where('activityCode', '=', activityCode)
          .where('metricKey', '=', metricKey)
          .forUpdate()
          .executeTakeFirst();
        const better = !prev || (direction === 'MAX' ? m.value > prev.bestValue : m.value < prev.bestValue);
        if (!better) continue;
        await trx
          .insertInto('personalRecord')
          .values({
            userId: s.userId,
            trackerId: s.trackerId,
            activityCode,
            metricKey,
            bestValue: m.value,
            direction,
            sessionId: s.sessionId,
            sessionDate: s.sessionDate,
            achievedAt: new Date(s.endedAt ?? s.startedAt),
          })
          .onConflict((oc) =>
            oc.columns(['userId', 'trackerId', 'activityCode', 'metricKey']).doUpdateSet((eb) => ({
              bestValue: eb.ref('excluded.bestValue'),
              sessionId: eb.ref('excluded.sessionId'),
              sessionDate: eb.ref('excluded.sessionDate'),
              achievedAt: eb.ref('excluded.achievedAt'),
            })),
          )
          .execute();
        this.log.info(
          {
            userId: s.userId,
            trackerId: s.trackerId,
            activityCode,
            metricKey,
            value: m.value,
            previous: prev?.bestValue ?? null,
          },
          'personal best',
        );
        await this.outbox.enqueue<PrAchievedPayload>(trx, TOPICS.analytics, {
          type: EVENT_TYPES.prAchieved,
          userId: s.userId,
          subject: `tracker/${s.trackerId}`,
          data: {
            userId: s.userId,
            trackerId: s.trackerId,
            activityCode,
            metricKey,
            label: def.label,
            value: m.value,
            unit: def.display.rawUnit ?? def.display.unit ?? null,
            previousValue: prev?.bestValue ?? null,
            sessionId: s.sessionId,
          },
        });
      }
    }
  }

  private async updateStreak(trx: Trx, userId: string, trackerId: string, today: string) {
    const rows = await trx
      .selectFrom('sessionFact')
      .select('sessionDate')
      .distinct()
      .where('userId', '=', userId)
      .where('trackerId', '=', trackerId)
      .orderBy('sessionDate', 'desc')
      .limit(400)
      .execute();
    const dates = rows.map((r) => r.sessionDate);
    const { current, longest } = streaks(dates, today);
    await trx
      .insertInto('streak')
      .values({ userId, trackerId, currentDays: current, longestDays: longest, lastActive: dates[0] ?? null })
      .onConflict((oc) =>
        oc.columns(['userId', 'trackerId']).doUpdateSet((eb) => ({
          currentDays: eb.ref('excluded.currentDays'),
          longestDays: sql<number>`greatest(streak.longest_days, excluded.longest_days)`,
          lastActive: eb.ref('excluded.lastActive'),
        })),
      )
      .execute();
  }
}
