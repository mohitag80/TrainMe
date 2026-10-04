import { describe, expect, it } from 'vitest';
import { slug, validateActivity, type ActivityInput } from './catalog-editor.service.js';

const base: ActivityInput = {
  name: 'Table Tennis – Serve',
  categoryCode: 'table_tennis',
  kind: 'DRILL',
  recordingMode: 'PER_ATTEMPT',
  equipment: [],
  synonyms: [],
  parameters: [
    {
      key: 'spin',
      label: 'Spin',
      type: 'ENUM',
      constraints: { options: ['Top', 'Back', 'Side'] },
      agg: 'NONE',
      required: true,
    },
    { key: 'in_play', label: 'Landed in', type: 'BOOL', constraints: {}, agg: 'COUNT_TRUE', required: true },
  ],
  metrics: [
    {
      key: 'in_play_rate',
      label: 'Serves in',
      kind: 'RATIO',
      numerator: { fn: 'COUNT_TRUE', param: 'in_play' },
      denominator: { fn: 'COUNT', param: '*' },
      display: { format: 'PERCENT' },
    },
  ],
};

describe('catalog editor', () => {
  it('makes internal codes from names', () => {
    expect(slug('Table Tennis – Serve')).toBe('table_tennis_serve');
    expect(slug('  Ñandú 10K run ')).toBe('nandu_10k_run');
    expect(slug('100 m sprint')).toBe('x100_m_sprint');
  });

  it('accepts a valid activity', () => {
    expect(validateActivity(base)).toEqual([]);
  });

  it('names fields and stats by their label in errors', () => {
    const bad: ActivityInput = {
      ...base,
      parameters: [{ ...base.parameters[0]!, constraints: { options: [] } }, base.parameters[1]!],
      metrics: [{ ...base.metrics[0]!, numerator: { fn: 'COUNT_TRUE', param: 'missing' } }],
    };
    const messages = validateActivity(bad).map((e) => e.message);
    expect(messages.some((m) => m.startsWith('Field “Spin”'))).toBe(true);
    expect(messages.some((m) => m.startsWith('Stat “Serves in”'))).toBe(true);
    expect(messages.join(' ')).not.toContain('in_play_rate');
  });
});
