import Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { EffectiveActivity, EffectiveSchema, SchemaIssue } from './types.js';

// ajv is CommonJS; under NodeNext the default import is the module object or the class itself.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (
  opts: object,
) => {
  compile(schema: object): ValidateFunction;
};

/**
 * Validates entry `values` against a compiled effective schema (types, ranges, options, conditions)
 * plus `maxRef` (made ≤ attempted). Same code on device and server, so results always agree.
 */
export class EntryValidator {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });
  private readonly compiled = new Map<string, ValidateFunction>();
  private readonly activities: Map<string, EffectiveActivity>;

  constructor(schema: EffectiveSchema) {
    this.activities = new Map(schema.activities.map((a) => [a.code, a]));
  }

  activity(code: string): EffectiveActivity | undefined {
    return this.activities.get(code);
  }

  validate(activityCode: string, values: unknown): SchemaIssue[] {
    const act = this.activities.get(activityCode);
    if (!act || act.hidden)
      return [
        {
          pointer: '/activity',
          code: 'unknown-activity',
          message: `Activity ${activityCode} is not recordable in this tracker`,
        },
      ];
    let fn = this.compiled.get(activityCode);
    if (!fn) {
      fn = this.ajv.compile(act.entryJsonSchema);
      this.compiled.set(activityCode, fn);
    }
    const issues: SchemaIssue[] = [];
    if (!fn(values)) issues.push(...(fn.errors ?? []).map((e) => toIssue(e, act)));
    if (issues.length === 0 && values && typeof values === 'object') {
      const v = values as Record<string, unknown>;
      for (const p of act.parameters) {
        const ref = p.constraints.maxRef;
        if (
          ref &&
          typeof v[p.key] === 'number' &&
          typeof v[ref] === 'number' &&
          (v[p.key] as number) > (v[ref] as number)
        ) {
          issues.push({ pointer: `/values/${p.key}`, code: 'max-ref', message: `must be ≤ ${ref}` });
        }
      }
    }
    return dedupe(issues);
  }
}

function toIssue(e: ErrorObject, act: EffectiveActivity): SchemaIssue {
  const params = e.params as Record<string, unknown>;
  if (e.keyword === 'required')
    return { pointer: `/values/${String(params.missingProperty)}`, code: 'required', message: 'is required' };
  if (e.keyword === 'additionalProperties') {
    const key = String(params.additionalProperty);
    return {
      pointer: `/values/${key}`,
      code: 'not-allowed',
      message: 'is not a recordable parameter of this activity',
    };
  }
  if (e.keyword === 'not') {
    // From an `else: {not: {required: [child]}}` branch: the child was sent although its condition is false.
    const idx = Number(/allOf\/(\d+)\/else/.exec(e.schemaPath)?.[1]);
    const conditional = act.parameters.filter((p) => !p.hidden && p.condition);
    const child = Number.isInteger(idx) ? conditional[idx] : undefined;
    return child
      ? {
          pointer: `/values/${child.key}`,
          code: 'condition-not-met',
          message: `only allowed when ${child.condition!.when.key} = ${String(child.condition!.when.eq)}`,
        }
      : { pointer: '/values', code: 'condition-not-met', message: e.message ?? 'condition not met' };
  }
  return { pointer: `/values${e.instancePath}`, code: e.keyword, message: e.message ?? 'is invalid' };
}

function dedupe(issues: SchemaIssue[]): SchemaIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.pointer}|${i.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
