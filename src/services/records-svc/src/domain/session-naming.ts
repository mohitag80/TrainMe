// Session identity rules (FR-REC-17..20, ADR-015): the pair (session date, name) is unique per user.

/** Same normalisation as the generated column `name_key`: trimmed, single spaces, lower case. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Morning 05–12, Afternoon 12–17, Evening 17–21, Night 21–05 (local time). */
export function partOfDay(instant: Date, timeZone: string): 'Morning' | 'Afternoon' | 'Evening' | 'Night' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant),
  );
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

/** Server fallback when no name is sent (imports); apps propose "<tracker> – <part of day>" themselves. */
export function defaultSessionName(instant: Date, timeZone: string): string {
  return `Session – ${partOfDay(instant, timeZone)}`;
}

/** Trims and collapses inner whitespace; the stored name keeps the user's capitalisation. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** First free "<name> (n)" (n ≥ 2) given the day's existing name keys; undefined when the name itself is free. */
export function nextFreeName(name: string, takenKeys: Set<string>): string | undefined {
  if (!takenKeys.has(nameKey(name))) return undefined;
  const base = cleanName(name).slice(0, 74);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!takenKeys.has(nameKey(candidate))) return candidate;
  }
  return `${base} (${Date.now() % 100000})`;
}
