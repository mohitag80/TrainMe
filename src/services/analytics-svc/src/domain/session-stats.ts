import {
  computeParamStats,
  evaluateMetric,
  metricMergeKind,
  type EffectiveSchema,
  type ParamStats,
} from '@trainme/schema';

export interface MetricStat {
  num: number | null;
  den: number | null;
  value: number | null;
  merge: 'SUM' | 'MAX' | 'MIN';
}

/** Per-session statistics by activity: additive parameter stats and metric results (stored in session_fact). */
export type SessionStats = Record<string, { params: Record<string, ParamStats>; metrics: Record<string, MetricStat> }>;

/**
 * Computes a session's statistics with the same metric evaluator the apps use for live stats, so the
 * numbers on the phone during a session and in the charts afterwards always agree.
 */
export function buildSessionStats(
  schema: EffectiveSchema,
  entries: { activity: string; values: Record<string, unknown> }[],
): SessionStats {
  const out: SessionStats = {};
  for (const activity of schema.activities) {
    const rows = entries.filter((e) => e.activity === activity.code).map((e) => ({ values: e.values }));
    if (rows.length === 0) continue;
    const metrics: Record<string, MetricStat> = {};
    for (const m of activity.metrics) {
      const r = evaluateMetric(m, rows);
      metrics[m.key] = { ...r, merge: metricMergeKind(m) };
    }
    out[activity.code] = { params: computeParamStats(activity.parameters, rows), metrics };
  }
  return out;
}
