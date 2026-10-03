// Period boundaries for rollups. Dates are local calendar dates (YYYY-MM-DD); weeks are ISO (Monday start).

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function isoWeekStart(date: string): string {
  const d = toDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addDays(date: string, days: number): string {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export function monthEnd(date: string): string {
  const d = toDate(monthStart(date));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmt(d);
}

export function periodStart(granularity: 'DAY' | 'WEEK' | 'MONTH', date: string): string {
  return granularity === 'DAY' ? date : granularity === 'WEEK' ? isoWeekStart(date) : monthStart(date);
}

/** Current streak (consecutive days ending today or yesterday) and longest streak from distinct active dates. */
export function streaks(datesDesc: string[], today: string): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let prev: string | undefined;
  for (const d of datesDesc) {
    run = prev !== undefined && addDays(d, 1) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  const first = datesDesc[0];
  if (first === today || first === addDays(today, -1)) {
    current = 1;
    for (let i = 1; i < datesDesc.length && addDays(datesDesc[i]!, 1) === datesDesc[i - 1]; i++) current++;
  }
  return { current, longest };
}

/** Local calendar date of an instant in an IANA time zone (falls back to UTC). */
export function localDate(instant: Date, timeZone = 'UTC'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      instant,
    );
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}
