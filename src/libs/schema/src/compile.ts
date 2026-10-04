import { UnitRegistry } from '@trainme/units';
import { exprVariables, parseExpr } from './expr.js';
import type {
  ActivitySnapshot,
  Aggregation,
  DataType,
  EffectiveActivity,
  EffectiveMetric,
  EffectiveParameter,
  EffectiveSchema,
  MetricDefinition,
  MetricTerm,
  Override,
  ParameterDefinition,
  SchemaIssue,
} from './types.js';

export interface CompileOptions {
  /** Visible parameters per activity (LLD §3 rule 5). */
  maxParametersPerActivity?: number;
  /** Custom (user-added) metrics per tracker. */
  maxCustomMetrics?: number;
  /** Plan entitlement `customParams`; false rejects ADD of parameters/metrics/activities. */
  allowCustomItems?: boolean;
  units?: UnitRegistry;
}

export interface CompileResult {
  schema: EffectiveSchema;
  issues: SchemaIssue[];
}

const DATA_TYPES: DataType[] = ['INT', 'DECIMAL', 'BOOL', 'ENUM', 'TEXT', 'DURATION'];
const AGGREGATIONS: Aggregation[] = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_TRUE', 'PCT_TRUE', 'NONE'];
const NUMERIC: DataType[] = ['INT', 'DECIMAL', 'DURATION'];
const KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
const CUSTOM_ACTIVITY_RE = /^custom\.[a-z0-9_]{2,60}$/;
export const RESERVED_KEYS = new Set([
  'id',
  'seq',
  'seq_no',
  'group',
  'group_no',
  'recorded_at',
  'client_entry_id',
  'values',
  'activity',
]);
const MODIFIABLE_PARAM_FIELDS = new Set(['label', 'constraints', 'agg', 'required', 'condition', 'description']);
const MAX_TEXT = 500;

type Draft = Omit<EffectiveActivity, 'entryJsonSchema'>;

const clone = <T>(v: T): T => structuredClone(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Compiles template ⊕ ordered overrides into the effective schema (LLD §3): applies ADD/MODIFY/HIDE,
 * enforces the rules (immutable type/unit, conditions on BOOL/ENUM of the same activity, depth ≤ 2,
 * metric references, plan limits) and emits a JSON Schema per activity. Never throws on bad input.
 */
export function compileEffectiveSchema(
  base: { activities: ActivitySnapshot[] },
  overrides: Override[],
  opts: CompileOptions = {},
): CompileResult {
  const issues: SchemaIssue[] = [];
  const units = opts.units ?? new UnitRegistry();
  const activities = new Map<string, Draft>();
  for (const a of base.activities) activities.set(a.code, draftFromSnapshot(a));

  for (const o of overrides) {
    const at = `/overrides/${o.id}`;
    const fail = (code: string, message: string) => issues.push({ pointer: at, code, message });
    if (o.action === 'ADD' && opts.allowCustomItems === false && !isCatalogActivity(o)) {
      fail('plan-limit', 'Your plan does not allow custom parameters, metrics or activities');
      continue;
    }
    if (o.target === 'ACTIVITY') {
      applyActivityOverride(o, activities, fail);
      continue;
    }
    const act = activities.get(o.activityCode);
    if (!act) {
      fail('unknown-activity', `Activity ${o.activityCode} is not in this tracker`);
      continue;
    }
    if (o.target === 'PARAMETER') applyParameterOverride(o, act, units, fail);
    else applyMetricOverride(o, act, fail);
  }

  const maxParams = opts.maxParametersPerActivity ?? 30;
  let customMetrics = 0;
  for (const act of activities.values()) {
    const at = `/activities/${act.code}`;
    const visible = act.parameters.filter((p) => !p.hidden);
    if (visible.length > maxParams) {
      issues.push({
        pointer: at,
        code: 'too-many-parameters',
        message: `At most ${maxParams} visible parameters per activity`,
      });
    }
    validateConditions(act, at, issues);
    for (const m of act.metrics) {
      if (m.custom && !m.hidden) customMetrics++;
      validateMetric(m, act.parameters, `${at}/metrics/${m.key}`, issues);
    }
  }
  const maxMetrics = opts.maxCustomMetrics ?? 10;
  if (customMetrics > maxMetrics) {
    issues.push({
      pointer: '/metrics',
      code: 'too-many-metrics',
      message: `At most ${maxMetrics} custom metrics per tracker`,
    });
  }

  const schema: EffectiveSchema = {
    activities: [...activities.values()].map((a) => ({ ...a, entryJsonSchema: buildEntryJsonSchema(a.parameters) })),
  };
  return { schema, issues };
}

// ------------------------------------------------------------------ override application

/** A catalog activity's published snapshot as an editable draft (template activities and catalog adds). */
function draftFromSnapshot(a: ActivitySnapshot): Draft {
  return {
    code: a.code,
    name: a.name,
    kind: a.kind,
    recordingMode: a.recordingMode,
    grouping: a.grouping,
    maxEntries: a.maxEntries,
    targets: a.targets,
    parameters: clone(a.parameters),
    metrics: clone(a.metrics),
  };
}

/** ACTIVITY ADD that copies a published catalog activity (snapshot stored by tracker-svc, never by the client). */
export const isCatalogActivity = (o: Override): boolean =>
  o.target === 'ACTIVITY' && o.action === 'ADD' && o.definition.source === 'CATALOG' && isObj(o.definition.snapshot);

function applyActivityOverride(o: Override, activities: Map<string, Draft>, fail: (c: string, m: string) => void) {
  const d = o.definition;
  if (o.action === 'ADD' && isCatalogActivity(o)) {
    const snap = d.snapshot as ActivitySnapshot;
    if (snap.code !== o.activityCode) return fail('invalid-snapshot', 'Catalog snapshot does not match the activity code');
    if (activities.has(snap.code)) return fail('duplicate', `Activity ${snap.code} is already in this tracker`);
    activities.set(snap.code, draftFromSnapshot(snap));
    return;
  }
  if (o.action === 'ADD') {
    const code = String(d.code ?? o.activityCode);
    const mode = d.recordingMode;
    if (!CUSTOM_ACTIVITY_RE.test(code)) return fail('invalid-code', 'Custom activity codes look like custom.my_drill');
    if (activities.has(code)) return fail('duplicate', `Activity ${code} already exists`);
    if (typeof d.name !== 'string' || d.name.trim().length === 0 || d.name.length > 160)
      return fail('invalid-name', 'Name is required (≤ 160 characters)');
    if (mode !== 'PER_SESSION' && mode !== 'PER_SET' && mode !== 'PER_ATTEMPT')
      return fail('invalid-recording-mode', 'recordingMode must be PER_SESSION, PER_SET or PER_ATTEMPT');
    const grouping = isObj(d.grouping)
      ? { label: String(d.grouping.label ?? 'Group'), size: Number(d.grouping.size ?? 1) }
      : null;
    activities.set(code, {
      code,
      name: d.name.trim(),
      kind: 'LOG',
      recordingMode: mode,
      grouping,
      maxEntries: 500,
      targets: {},
      custom: true,
      parameters: [],
      metrics: [],
    });
    return;
  }
  const act = activities.get(o.activityCode);
  if (!act) return fail('unknown-activity', `Activity ${o.activityCode} is not in this tracker`);
  if (o.action === 'HIDE') act.hidden = true;
  else if (typeof d.name === 'string' && d.name.trim()) act.name = d.name.trim();
  else fail('invalid-modify', 'Only the activity name can be changed');
}

function applyParameterOverride(o: Override, act: Draft, units: UnitRegistry, fail: (c: string, m: string) => void) {
  const key = o.itemKey ?? (o.definition.key as string | undefined);
  const existing = act.parameters.find((p) => p.key === key);
  if (o.action === 'ADD') {
    const parsed = parseParameter(o.definition, units);
    if ('error' in parsed) return fail(parsed.code, parsed.error);
    if (act.parameters.some((p) => p.key === parsed.key))
      return fail('duplicate', `Parameter ${parsed.key} already exists`);
    act.parameters.push({ ...parsed, custom: true });
    return;
  }
  if (!existing) return fail('unknown-parameter', `Parameter ${key} is not in ${act.code}`);
  if (o.action === 'HIDE') {
    existing.hidden = true;
    return;
  }
  const changes = o.definition;
  const forbidden = Object.keys(changes).filter((k) => !MODIFIABLE_PARAM_FIELDS.has(k));
  if (forbidden.length) {
    return fail(
      'immutable-field',
      `${forbidden.join(', ')} cannot be changed; add a new parameter instead (type and unit keep history valid)`,
    );
  }
  const next: EffectiveParameter = clone(existing);
  if (typeof changes.label === 'string') next.label = changes.label.trim();
  if (typeof changes.description === 'string') next.description = changes.description;
  if (typeof changes.required === 'boolean') next.required = changes.required;
  if ('condition' in changes) {
    if (changes.condition === null) delete next.condition;
    else next.condition = changes.condition as EffectiveParameter['condition'];
  }
  if (typeof changes.agg === 'string') next.agg = changes.agg as Aggregation;
  if (isObj(changes.constraints)) {
    const c = changes.constraints;
    if (Array.isArray(c.options)) {
      const before = existing.constraints.options ?? [];
      if (!before.every((opt) => (c.options as unknown[]).includes(opt))) {
        return fail('options-removed', 'Options can only be added; removing one would orphan recorded values');
      }
    }
    next.constraints = { ...existing.constraints, ...(c as EffectiveParameter['constraints']) };
  }
  const problem = checkParameter(next, units);
  if (problem) return fail(problem.code, problem.error);
  Object.assign(existing, next);
}

function applyMetricOverride(o: Override, act: Draft, fail: (c: string, m: string) => void) {
  const key = o.itemKey ?? (o.definition.key as string | undefined);
  const existing = act.metrics.find((m) => m.key === key);
  if (o.action === 'ADD') {
    const d = o.definition as unknown as MetricDefinition;
    if (typeof d.key !== 'string' || !KEY_RE.test(d.key))
      return fail('invalid-key', 'Metric key must be snake_case (2–64 characters)');
    if (act.metrics.some((m) => m.key === d.key)) return fail('duplicate', `Metric ${d.key} already exists`);
    if (d.kind !== 'RATIO' && d.kind !== 'SINGLE') return fail('invalid-kind', 'kind must be RATIO or SINGLE');
    if (typeof d.label !== 'string' || !d.label.trim()) return fail('invalid-label', 'Label is required');
    act.metrics.push({
      key: d.key,
      label: d.label.trim(),
      kind: d.kind,
      numerator: d.numerator,
      ...(d.denominator ? { denominator: d.denominator } : {}),
      display: isObj(d.display)
        ? (d.display as unknown as MetricDefinition['display'])
        : { format: d.kind === 'RATIO' ? 'PERCENT' : 'NUMBER', decimals: 1 },
      custom: true,
    });
    return;
  }
  if (!existing) return fail('unknown-metric', `Metric ${key} is not in ${act.code}`);
  if (o.action === 'HIDE') {
    existing.hidden = true;
    return;
  }
  const d = o.definition;
  if (typeof d.label === 'string' && d.label.trim()) existing.label = d.label.trim();
  if (isObj(d.display))
    existing.display = { ...existing.display, ...(d.display as Partial<MetricDefinition['display']>) };
}

// ------------------------------------------------------------------ validation

type Parsed = ParameterDefinition | { error: string; code: string };

/** Validates a user-supplied parameter definition (ADD) and fills dimension from the unit registry. */
export function parseParameter(raw: Record<string, unknown>, units: UnitRegistry = new UnitRegistry()): Parsed {
  const type = raw.type as DataType;
  const p: ParameterDefinition = {
    key: String(raw.key ?? ''),
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    type,
    constraints: isObj(raw.constraints) ? (raw.constraints as ParameterDefinition['constraints']) : {},
    agg: (raw.agg as Aggregation) ?? defaultAggregation(type),
    required: raw.required === true,
    ...(typeof raw.unit === 'string' && raw.unit ? { unit: raw.unit } : {}),
    ...(isObj(raw.condition) ? { condition: raw.condition as unknown as ParameterDefinition['condition'] } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
  };
  const problem = checkParameter(p, units);
  if (problem) return problem;
  const dim = p.unit ? units.get(p.unit)?.dimension : undefined;
  return dim ? { ...p, dimension: dim } : p;
}

function checkParameter(p: ParameterDefinition, units: UnitRegistry): { error: string; code: string } | undefined {
  if (!KEY_RE.test(p.key))
    return { code: 'invalid-key', error: 'Key must be snake_case, 2–64 characters, starting with a letter' };
  if (RESERVED_KEYS.has(p.key)) return { code: 'reserved-key', error: `${p.key} is reserved` };
  if (!p.label || p.label.length > 120) return { code: 'invalid-label', error: 'Label is required (≤ 120 characters)' };
  if (!DATA_TYPES.includes(p.type))
    return { code: 'invalid-type', error: `type must be one of ${DATA_TYPES.join(', ')}` };
  if (!AGGREGATIONS.includes(p.agg))
    return { code: 'invalid-agg', error: `agg must be one of ${AGGREGATIONS.join(', ')}` };
  const numeric = NUMERIC.includes(p.type);
  if ((p.agg === 'COUNT_TRUE' || p.agg === 'PCT_TRUE') && p.type !== 'BOOL')
    return { code: 'invalid-agg', error: `${p.agg} needs a BOOL parameter` };
  if (['SUM', 'AVG', 'MIN', 'MAX'].includes(p.agg) && !numeric)
    return { code: 'invalid-agg', error: `${p.agg} needs a numeric parameter` };
  const c = p.constraints;
  if (p.type === 'ENUM') {
    const opts = c.options;
    if (
      !Array.isArray(opts) ||
      opts.length === 0 ||
      opts.length > 50 ||
      opts.some((x) => typeof x !== 'string' || !x) ||
      new Set(opts).size !== opts.length
    ) {
      return { code: 'invalid-options', error: 'ENUM needs 1–50 distinct non-empty options' };
    }
  }
  if (c.min !== undefined && c.max !== undefined && c.min > c.max)
    return { code: 'invalid-range', error: 'min must be ≤ max' };
  if ((c.min !== undefined || c.max !== undefined || c.step !== undefined) && !numeric)
    return { code: 'invalid-range', error: 'min/max/step apply to numeric types only' };
  if (p.unit) {
    if (!numeric) return { code: 'invalid-unit', error: 'Only numeric parameters have units' };
    if (!units.get(p.unit)) return { code: 'unknown-unit', error: `Unknown unit ${p.unit}` };
  }
  return undefined;
}

function defaultAggregation(type: DataType): Aggregation {
  return type === 'BOOL'
    ? 'COUNT_TRUE'
    : type === 'ENUM'
      ? 'COUNT'
      : type === 'TEXT'
        ? 'NONE'
        : type === 'DECIMAL'
          ? 'AVG'
          : 'SUM';
}

/** Conditions: parent is a visible BOOL/ENUM of the same activity, value type matches, depth ≤ 2, no cycles. */
function validateConditions(act: Draft, at: string, issues: SchemaIssue[]) {
  const byKey = new Map(act.parameters.map((p) => [p.key, p]));
  for (const p of act.parameters) {
    if (p.hidden) continue;
    const pointer = `${at}/parameters/${p.key}`;
    if (p.constraints.maxRef) {
      const ref = byKey.get(p.constraints.maxRef);
      if (!ref || !NUMERIC.includes(ref.type))
        issues.push({ pointer, code: 'invalid-max-ref', message: 'maxRef must name a numeric parameter' });
    }
    if (!p.condition) continue;
    const { key, eq } = p.condition.when ?? ({} as { key?: string; eq?: unknown });
    const parent = key ? byKey.get(key) : undefined;
    if (!parent || key === p.key) {
      issues.push({
        pointer,
        code: 'invalid-condition',
        message: `Condition must reference another parameter of ${act.code}`,
      });
      continue;
    }
    if (parent.hidden)
      issues.push({
        pointer,
        code: 'hidden-parent',
        message: `${p.key} depends on hidden ${parent.key}; hide it too or remove the condition`,
      });
    if (parent.type === 'BOOL' && typeof eq !== 'boolean')
      issues.push({ pointer, code: 'invalid-condition', message: 'A BOOL condition needs true/false' });
    else if (parent.type === 'ENUM' && !(parent.constraints.options ?? []).includes(String(eq)))
      issues.push({ pointer, code: 'invalid-condition', message: `${String(eq)} is not an option of ${parent.key}` });
    else if (parent.type !== 'BOOL' && parent.type !== 'ENUM')
      issues.push({
        pointer,
        code: 'invalid-condition',
        message: 'Conditions may only reference BOOL or ENUM parameters',
      });
    let depth = 1;
    const seen = new Set([p.key]);
    let cur = parent;
    while (cur?.condition) {
      if (seen.has(cur.key)) {
        issues.push({ pointer, code: 'condition-cycle', message: 'Conditions form a cycle' });
        break;
      }
      seen.add(cur.key);
      depth++;
      cur = byKey.get(cur.condition.when.key)!;
    }
    if (depth > 2)
      issues.push({ pointer, code: 'condition-depth', message: 'Conditions may be nested at most 2 levels' });
  }
}

const terms = (t: MetricTerm | MetricTerm[] | undefined): MetricTerm[] =>
  t === undefined ? [] : Array.isArray(t) ? t : [t];

function validateMetric(m: EffectiveMetric, params: EffectiveParameter[], pointer: string, issues: SchemaIssue[]) {
  const byKey = new Map(params.map((p) => [p.key, p]));
  const push = (code: string, message: string) => issues.push({ pointer, code, message });
  if (m.kind === 'RATIO' && !m.denominator) push('invalid-metric', 'RATIO metrics need a denominator');
  for (const t of [...terms(m.numerator), ...terms(m.denominator)]) {
    if (m.kind === 'RATIO' && (t.fn === 'MAX' || t.fn === 'MIN'))
      push('invalid-metric', 'MAX/MIN are only allowed in SINGLE metrics');
    const refs: string[] = [];
    if (t.expr) {
      try {
        refs.push(...exprVariables(parseExpr(t.expr)));
      } catch (err) {
        push('invalid-expr', (err as Error).message);
      }
    } else if (t.param && t.param !== '*') refs.push(t.param);
    for (const r of refs) {
      const p = byKey.get(r);
      if (!p) push('unknown-parameter', `Metric references unknown parameter ${r}`);
      else if (t.fn === 'COUNT_TRUE' && p.type !== 'BOOL')
        push('invalid-metric', `COUNT_TRUE needs a BOOL parameter (${r})`);
      else if (['SUM', 'MAX', 'MIN'].includes(t.fn) && !NUMERIC.includes(p.type))
        push('invalid-metric', `${t.fn} needs a numeric parameter (${r})`);
    }
    for (const w of Object.keys(t.where ?? {}))
      if (!byKey.has(w)) push('unknown-parameter', `where references unknown parameter ${w}`);
  }
}

// ------------------------------------------------------------------ JSON Schema

/** JSON Schema 2020-12 for one entry's `values`; hidden parameters are not allowed in new entries. */
export function buildEntryJsonSchema(params: EffectiveParameter[]): Record<string, unknown> {
  const visible = params.filter((p) => !p.hidden);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const allOf: unknown[] = [];
  for (const p of visible) {
    properties[p.key] = valueSchema(p);
    if (!p.condition) {
      if (p.required) required.push(p.key);
      continue;
    }
    const { key, eq } = p.condition.when;
    allOf.push({
      if: { properties: { [key]: { const: eq } }, required: [key] },
      then: p.required ? { required: [p.key] } : {},
      else: { not: { required: [p.key] } },
    });
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
    ...(allOf.length ? { allOf } : {}),
  };
}

function valueSchema(p: EffectiveParameter): Record<string, unknown> {
  const c = p.constraints;
  const range = {
    ...(c.min !== undefined ? { minimum: c.min } : {}),
    ...(c.max !== undefined ? { maximum: c.max } : {}),
  };
  switch (p.type) {
    case 'INT':
      return { type: 'integer', ...range };
    case 'DECIMAL':
      return { type: 'number', ...range };
    case 'DURATION':
      return { type: 'number', minimum: 0, ...range };
    case 'BOOL':
      return { type: 'boolean' };
    case 'ENUM':
      return { type: 'string', enum: c.options ?? [] };
    case 'TEXT':
      return { type: 'string', maxLength: MAX_TEXT };
  }
}
