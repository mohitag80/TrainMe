import { UnitRegistry, type DisplayUnits, type UnitPreferences } from '@trainme/units';
import type { EffectiveParameter, MetricDefinition } from '@trainme/schema';

export const units = new UnitRegistry();

/** Unit shown for a parameter (tracker choice → profile Metric/Imperial → canonical), ADR-014. */
export function displayUnitFor(
  p: Pick<EffectiveParameter, 'key' | 'unit'>,
  activityCode: string,
  displayUnits: DisplayUnits,
  prefs: UnitPreferences,
): string | undefined {
  if (!p.unit) return undefined;
  return units.resolveDisplayUnit({
    canonicalUnit: p.unit,
    activityCode,
    paramKey: p.key,
    displayUnits,
    preferences: prefs,
  });
}

/** Formats a metric value with its display rules and the user's unit choice. */
export function formatMetric(
  m: Pick<MetricDefinition, 'display' | 'kind'>,
  value: number | null | undefined,
  prefs: UnitPreferences = {},
): string {
  if (value === null || value === undefined) return '–';
  const d = m.display;
  if (d.format === 'PERCENT') return `${(value * 100).toFixed(d.decimals ?? 1)} %`;
  const raw = d.rawUnit ?? d.unit;
  let v = value * (d.scale ?? 1);
  let unit = d.unit;
  if (raw && d.unit && units.isConvertible(raw, d.unit)) {
    const target = units.resolveDisplayUnit({
      canonicalUnit: d.unit,
      activityCode: '',
      paramKey: '',
      preferences: prefs,
    });
    v = units.convert(value, raw, target);
    unit = target;
  }
  if (d.format === 'PACE' || d.format === 'DURATION') {
    const total = d.format === 'PACE' ? v * 60 : v;
    const mm = Math.floor(total / 60);
    const ss = Math.round(total % 60);
    return `${mm}:${String(ss).padStart(2, '0')}${unit ? ` ${unit}` : ''}`;
  }
  return `${v.toFixed(d.decimals ?? 1)}${unit ? ` ${unit}` : ''}`;
}

export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Default session name: "<tracker> – <part of day>" (FR-REC-19). */
export function defaultSessionName(trackerName: string, at = new Date()): string {
  const h = at.getHours();
  const part = h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night';
  return `${trackerName} – ${part}`;
}
