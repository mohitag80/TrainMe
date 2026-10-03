import { evalExpr, parseExpr, type ExprNode } from './expr.js';
import type { MetricDefinition, MetricTerm, ParameterDefinition, WhereValue } from './types.js';

export interface EntryValues {
  values: Record<string, unknown>;
}

/** Additive per-parameter statistics; rollups add them up, so any period is exact. */
export interface ParamStats {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  trueCount: number;
}

/** num/den are additive (SUM/COUNT terms) or extremes (MAX/MIN); value = num ÷ den or num. */
export interface MetricResult {
  num: number | null;
  den: number | null;
  value: number | null;
}

export type MergeKind = 'SUM' | 'MAX' | 'MIN';

const exprCache = new Map<string, ExprNode>();
const parsed = (src: string) => {
  let n = exprCache.get(src);
  if (!n) {
    n = parseExpr(src);
    exprCache.set(src, n);
  }
  return n;
};

function matches(values: Record<string, unknown>, where?: Record<string, WhereValue>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = values[k];
    if (cond === null || typeof cond !== 'object') return v === cond;
    if (cond.in && !cond.in.includes(v as string | number | boolean)) return false;
    if ('ne' in cond && v === cond.ne) return false;
    if (cond.gte !== undefined && !(typeof v === 'number' && v >= cond.gte)) return false;
    if (cond.lte !== undefined && !(typeof v === 'number' && v <= cond.lte)) return false;
    return true;
  });
}

function termValue(t: MetricTerm, values: Record<string, unknown>): number | undefined {
  if (!matches(values, t.where)) return undefined;
  if (t.fn === 'COUNT')
    return t.param === undefined || t.param === '*' || (values[t.param] !== undefined && values[t.param] !== null)
      ? 1
      : undefined;
  if (t.fn === 'COUNT_TRUE') return t.param !== undefined && values[t.param] === true ? 1 : undefined;
  const v = t.expr ? evalExpr(parsed(t.expr), values) : t.param ? values[t.param] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function evalTerms(spec: MetricTerm | MetricTerm[], entries: EntryValues[]): number | null {
  const list = Array.isArray(spec) ? spec : [spec];
  let acc: number | null = null;
  for (const t of list) {
    for (const e of entries) {
      const v = termValue(t, e.values);
      if (v === undefined) continue;
      if (t.fn === 'MAX') acc = acc === null ? v : Math.max(acc, v);
      else if (t.fn === 'MIN') acc = acc === null ? v : Math.min(acc, v);
      else acc = (acc ?? 0) + v;
    }
    // COUNT/SUM over zero matching entries is 0, not "no data".
    if (acc === null && t.fn !== 'MAX' && t.fn !== 'MIN') acc = 0;
  }
  return acc;
}

/** Evaluates a metric over a set of entries (one session, or anything else). */
export function evaluateMetric(metric: MetricDefinition, entries: EntryValues[]): MetricResult {
  const num = evalTerms(metric.numerator, entries);
  if (metric.kind === 'SINGLE') return { num, den: null, value: num };
  const den = metric.denominator ? evalTerms(metric.denominator, entries) : null;
  return { num, den, value: num !== null && den ? num / den : null };
}

/** How results combine across sessions/periods: additive, or greatest/least for MAX/MIN metrics. */
export function metricMergeKind(metric: MetricDefinition): MergeKind {
  const first = Array.isArray(metric.numerator) ? metric.numerator[0] : metric.numerator;
  return first?.fn === 'MAX' ? 'MAX' : first?.fn === 'MIN' ? 'MIN' : 'SUM';
}

/** Per-parameter statistics for numeric and BOOL parameters. */
export function computeParamStats(params: ParameterDefinition[], entries: EntryValues[]): Record<string, ParamStats> {
  const out: Record<string, ParamStats> = {};
  for (const p of params) {
    if (p.type === 'ENUM' || p.type === 'TEXT') continue;
    const s: ParamStats = { count: 0, sum: 0, min: null, max: null, trueCount: 0 };
    for (const e of entries) {
      const v = e.values[p.key];
      if (v === undefined || v === null) continue;
      s.count++;
      if (typeof v === 'boolean') {
        if (v) s.trueCount++;
      } else if (typeof v === 'number') {
        s.sum += v;
        s.min = s.min === null ? v : Math.min(s.min, v);
        s.max = s.max === null ? v : Math.max(s.max, v);
      }
    }
    if (s.count > 0) out[p.key] = s;
  }
  return out;
}
