import { describe, expect, it } from 'vitest';
import { UnitRegistry } from './convert.js';

const units = new UnitRegistry();

describe('UnitRegistry', () => {
  it('converts the documented examples (LLD §3.1)', () => {
    expect(units.toDisplay(142, 'km/h', 'mph')).toBe(88.2);
    expect(units.toCanonical(100, 'lb', 'kg')).toBe(45.359237);
    expect(units.toDisplay(45.359237, 'kg', 'lb')).toBe(100);
    expect(units.rangeToDisplay(40, 170, 'km/h', 'mph')).toEqual({ min: 24.9, max: 105.6 });
  });

  it('rejects cross-dimension conversion', () => {
    expect(() => units.convert(1, 'kg', 'km')).toThrow();
  });

  it('resolves the display unit in priority order', () => {
    const base = { canonicalUnit: 'kg', activityCode: 'gym.bench', paramKey: 'weight_kg' };
    expect(units.resolveDisplayUnit(base)).toBe('kg');
    expect(units.resolveDisplayUnit({ ...base, preferences: { mass: 'IMPERIAL' } })).toBe('lb');
    expect(
      units.resolveDisplayUnit({ ...base, preferences: { mass: 'IMPERIAL' }, displayUnits: { '*.mass': 'st' } }),
    ).toBe('st');
    expect(units.resolveDisplayUnit({ ...base, displayUnits: { '*.mass': 'st', 'gym.bench.weight_kg': 'g' } })).toBe(
      'g',
    );
    expect(units.resolveDisplayUnit({ ...base, displayUnits: { 'gym.bench.weight_kg': 'km' } })).toBe('kg');
  });
});
