import { describe, expect, it } from 'vitest';
import {
  compileEffectiveSchema,
  EntryValidator,
  evaluateMetric,
  parseExpr,
  evalExpr,
  type ActivitySnapshot,
  type Override,
} from './index.js';

const delivery: ActivitySnapshot = {
  code: 'cricket.fast.delivery',
  version: 1,
  name: 'Delivery',
  kind: 'DRILL',
  recordingMode: 'PER_ATTEMPT',
  grouping: { label: 'Over', size: 6 },
  maxEntries: 500,
  description: null,
  equipment: [],
  primaryMuscles: [],
  secondaryMuscles: [],
  targets: {},
  parameters: [
    {
      key: 'speed_kmph',
      label: 'Speed',
      type: 'DECIMAL',
      unit: 'km/h',
      dimension: 'speed',
      constraints: { min: 40, max: 170 },
      agg: 'AVG',
      required: false,
    },
    {
      key: 'yorker_attempted',
      label: 'Yorker attempted',
      type: 'BOOL',
      constraints: {},
      agg: 'COUNT_TRUE',
      required: true,
    },
    {
      key: 'yorker_accurate',
      label: 'Yorker accurate',
      type: 'BOOL',
      constraints: {},
      agg: 'COUNT_TRUE',
      required: true,
      condition: { when: { key: 'yorker_attempted', eq: true } },
    },
    { key: 'wide', label: 'Wide', type: 'BOOL', constraints: {}, agg: 'COUNT_TRUE', required: false },
  ],
  metrics: [
    {
      key: 'yorker_accuracy',
      label: 'Yorker accuracy',
      kind: 'RATIO',
      numerator: { fn: 'COUNT_TRUE', param: 'yorker_accurate' },
      denominator: { fn: 'COUNT_TRUE', param: 'yorker_attempted' },
      display: { format: 'PERCENT' },
    },
    {
      key: 'top_speed',
      label: 'Top speed',
      kind: 'SINGLE',
      numerator: { fn: 'MAX', param: 'speed_kmph' },
      display: { format: 'NUMBER', unit: 'km/h' },
    },
  ],
};
const ov = (o: Partial<Override>): Override => ({
  id: 'o' + Math.random(),
  target: 'PARAMETER',
  action: 'ADD',
  activityCode: 'cricket.fast.delivery',
  definition: {},
  ...o,
});

describe('compileEffectiveSchema', () => {
  it('applies ADD, MODIFY and HIDE (LLD §3 example)', () => {
    const { schema, issues } = compileEffectiveSchema({ activities: [delivery] }, [
      ov({ definition: { key: 'slower_ball', label: 'Slower ball', type: 'BOOL' } }),
      ov({
        target: 'METRIC',
        definition: {
          key: 'slower_ball_rate',
          label: 'Slower ball %',
          kind: 'RATIO',
          numerator: { fn: 'COUNT_TRUE', param: 'slower_ball' },
          denominator: { fn: 'COUNT', param: '*' },
        },
      }),
      ov({ action: 'MODIFY', itemKey: 'speed_kmph', definition: { label: 'Ball speed', constraints: { max: 165 } } }),
      ov({ action: 'HIDE', itemKey: 'wide' }),
    ]);
    expect(issues).toEqual([]);
    const a = schema.activities[0]!;
    expect(a.parameters.find((p) => p.key === 'slower_ball')).toMatchObject({ custom: true, agg: 'COUNT_TRUE' });
    expect(a.parameters.find((p) => p.key === 'speed_kmph')).toMatchObject({
      label: 'Ball speed',
      unit: 'km/h',
      constraints: { min: 40, max: 165 },
    });
    expect(a.parameters.find((p) => p.key === 'wide')?.hidden).toBe(true);
    expect(a.metrics.map((m) => m.key)).toContain('slower_ball_rate');
  });

  it('rejects type changes, unknown references and plan limits', () => {
    const r = compileEffectiveSchema({ activities: [delivery] }, [
      ov({ action: 'MODIFY', itemKey: 'speed_kmph', definition: { type: 'INT' } }),
      ov({ definition: { key: 'id', label: 'x', type: 'INT' } }),
      ov({
        target: 'METRIC',
        definition: {
          key: 'bad',
          label: 'Bad',
          kind: 'RATIO',
          numerator: { fn: 'COUNT_TRUE', param: 'nope' },
          denominator: { fn: 'COUNT' },
        },
      }),
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(['immutable-field', 'reserved-key', 'unknown-parameter']);
    const limited = compileEffectiveSchema(
      { activities: [delivery] },
      [ov({ definition: { key: 'x_y', label: 'x', type: 'INT' } })],
      { allowCustomItems: false },
    );
    expect(limited.issues[0]?.code).toBe('plan-limit');
  });
});

describe('EntryValidator', () => {
  const { schema } = compileEffectiveSchema({ activities: [delivery] }, [ov({ action: 'HIDE', itemKey: 'wide' })]);
  const v = new EntryValidator(schema);
  it('accepts a valid ball and enforces conditions both ways', () => {
    expect(
      v.validate('cricket.fast.delivery', { speed_kmph: 132.5, yorker_attempted: true, yorker_accurate: false }),
    ).toEqual([]);
    expect(v.validate('cricket.fast.delivery', { yorker_attempted: true })[0]).toMatchObject({
      pointer: '/values/yorker_accurate',
      code: 'required',
    });
    expect(v.validate('cricket.fast.delivery', { yorker_attempted: false, yorker_accurate: true })[0]).toMatchObject({
      pointer: '/values/yorker_accurate',
      code: 'condition-not-met',
    });
  });
  it('rejects ranges, hidden parameters and unknown activities', () => {
    expect(v.validate('cricket.fast.delivery', { speed_kmph: 200, yorker_attempted: false })[0]).toMatchObject({
      pointer: '/values/speed_kmph',
      code: 'maximum',
    });
    expect(v.validate('cricket.fast.delivery', { yorker_attempted: false, wide: true })[0]).toMatchObject({
      code: 'not-allowed',
    });
    expect(v.validate('nope', {})[0]?.code).toBe('unknown-activity');
  });
});

describe('metrics', () => {
  it('computes ratio and max metrics (12 of 18 yorkers = 66.7 %)', () => {
    const entries = [
      ...Array.from({ length: 12 }, () => ({
        values: { yorker_attempted: true, yorker_accurate: true, speed_kmph: 130 },
      })),
      ...Array.from({ length: 6 }, () => ({
        values: { yorker_attempted: true, yorker_accurate: false, speed_kmph: 138.2 },
      })),
      ...Array.from({ length: 32 }, () => ({ values: { yorker_attempted: false } })),
    ];
    const acc = evaluateMetric(delivery.metrics[0]!, entries);
    expect(acc).toMatchObject({ num: 12, den: 18 });
    expect(acc.value).toBeCloseTo(0.6667, 3);
    expect(evaluateMetric(delivery.metrics[1]!, entries).value).toBe(138.2);
  });
  it('evaluates safe arithmetic only', () => {
    expect(evalExpr(parseExpr('weight_kg * (1 + reps / 30)'), { weight_kg: 100, reps: 3 })).toBeCloseTo(110);
    expect(() => parseExpr('process.exit()')).toThrow();
  });
});
