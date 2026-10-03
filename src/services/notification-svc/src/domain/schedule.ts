// Reminder schedule maths in the user's time zone (FR-NTF-01: delivered within ±1 min of local time).

const parts = (instant: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const isoDow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as 'Mon']!;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute), isoDow };
};

/** UTC instant of a local wall-clock time; corrects for the zone offset (and DST) in two passes. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), timeZone);
    const asIf = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asIf;
  }
  return new Date(guess);
}

/** Next firing strictly after `after` for days (ISO 1–7) at HH:MM local time. */
export function nextFireAt(daysOfWeek: number[], timeOfDay: string, timeZone: string, after: Date = new Date()): Date {
  const [hh, mm] = timeOfDay.split(':').map(Number) as [number, number];
  const start = parts(after, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + offset));
    const isoDow = ((day.getUTCDay() + 6) % 7) + 1;
    if (!daysOfWeek.includes(isoDow)) continue;
    const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, timeZone);
    if (candidate > after) return candidate;
  }
  throw new Error('no firing day');
}

/** True when the local time of `instant` falls inside [start, end) (may wrap midnight). */
export function inQuietHours(instant: Date, timeZone: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const p = parts(instant, timeZone);
  const now = p.hh * 60 + p.mm;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = toMin(start);
  const e = toMin(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}
