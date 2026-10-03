import { describe, expect, it } from 'vitest';
import { isoWeekStart, monthEnd, monthStart, streaks } from './periods.js';

describe('periods', () => {
  it('uses ISO weeks and calendar months', () => {
    expect(isoWeekStart('2026-10-04')).toBe('2026-09-28'); // Sunday → previous Monday
    expect(isoWeekStart('2026-09-28')).toBe('2026-09-28');
    expect(monthStart('2026-10-04')).toBe('2026-10-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
  });
  it('computes current and longest streaks', () => {
    expect(streaks(['2026-10-04', '2026-10-03', '2026-10-02', '2026-09-20', '2026-09-19'], '2026-10-04')).toEqual({
      current: 3,
      longest: 3,
    });
    expect(streaks(['2026-10-02', '2026-10-01'], '2026-10-04')).toEqual({ current: 0, longest: 2 });
    expect(streaks([], '2026-10-04')).toEqual({ current: 0, longest: 0 });
  });
});
