import { CamelCasePlugin } from 'kysely';
import { describe, expect, it } from 'vitest';

// Guards the fix for JSONB documents being camel-cased (metric `where: { length_landed }` became `lengthLanded`).
describe('CamelCasePlugin configuration', () => {
  it('maps column names but keeps keys inside JSON values', () => {
    const plugin = new CamelCasePlugin({ maintainNestedObjectKeys: true }) as unknown as {
      mapRow(row: Record<string, unknown>): Record<string, unknown>;
    };
    const row = plugin.mapRow({ base_snapshot: { speed_kmph: 1, where: { length_landed: 'good' } } });
    expect(row).toEqual({ baseSnapshot: { speed_kmph: 1, where: { length_landed: 'good' } } });
  });
});
