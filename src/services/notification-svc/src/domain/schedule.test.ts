import { describe, expect, it } from 'vitest';
import { inQuietHours, nextFireAt } from './schedule.js';

describe('reminder schedule', () => {
  it('fires at the next matching local weekday/time (Asia/Kolkata = UTC+5:30)', () => {
    // Sat 3 Oct 2026 18:00 UTC = 23:30 IST; next Mon/Wed/Fri 06:00 IST is Mon 5 Oct 00:30 UTC.
    expect(nextFireAt([1, 3, 5], '06:00', 'Asia/Kolkata', new Date('2026-10-03T18:00:00Z')).toISOString()).toBe(
      '2026-10-05T00:30:00.000Z',
    );
    // Same day, later time.
    expect(nextFireAt([6], '23:45', 'Asia/Kolkata', new Date('2026-10-03T18:00:00Z')).toISOString()).toBe(
      '2026-10-03T18:15:00.000Z',
    );
  });
  it('handles DST zones', () => {
    // London is UTC+1 in summer (BST) and UTC+0 after 25 Oct 2026.
    expect(nextFireAt([1], '07:00', 'Europe/London', new Date('2026-10-20T12:00:00Z')).toISOString()).toBe(
      '2026-10-26T07:00:00.000Z',
    );
    expect(nextFireAt([1], '07:00', 'Europe/London', new Date('2026-10-01T12:00:00Z')).toISOString()).toBe(
      '2026-10-05T06:00:00.000Z',
    );
  });
  it('detects quiet hours across midnight', () => {
    expect(inQuietHours(new Date('2026-10-03T17:00:00Z'), 'Asia/Kolkata', '22:00', '07:00')).toBe(true); // 22:30 IST
    expect(inQuietHours(new Date('2026-10-03T06:00:00Z'), 'Asia/Kolkata', '22:00', '07:00')).toBe(false); // 11:30 IST
  });
});
