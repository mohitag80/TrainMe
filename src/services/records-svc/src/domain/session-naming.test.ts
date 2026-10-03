import { describe, expect, it } from 'vitest';
import { localDate, nameKey, nextFreeName, partOfDay } from './session-naming.js';

describe('session naming (ADR-015)', () => {
  it('normalises names like the database', () => {
    expect(nameKey('  Morning   NETS ')).toBe('morning nets');
  });
  it('suggests the next free suffix', () => {
    expect(nextFreeName('Morning Nets', new Set(['evening gym']))).toBeUndefined();
    expect(nextFreeName('Morning Nets', new Set(['morning nets']))).toBe('Morning Nets (2)');
    expect(nextFreeName('morning nets', new Set(['morning nets', 'morning nets (2)']))).toBe('morning nets (3)');
    expect(nextFreeName('  morning   NETS ', new Set(['morning nets']))).toBe('morning NETS (2)');
  });
  it('uses the local date and part of day of the time zone', () => {
    const t = new Date('2026-10-03T18:40:00Z'); // 00:10 on 4 Oct in India
    expect(localDate(t, 'Asia/Kolkata')).toBe('2026-10-04');
    expect(localDate(t, 'Europe/London')).toBe('2026-10-03');
    expect(partOfDay(new Date('2026-10-03T00:40:00Z'), 'Asia/Kolkata')).toBe('Morning');
    expect(partOfDay(t, 'Europe/London')).toBe('Evening');
  });
});
