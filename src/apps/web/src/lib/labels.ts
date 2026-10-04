// User-facing wording for schema concepts: no data types, keys or codes ever reach the screen.
import type { EffectiveParameter, RecordingMode } from '@trainme/schema';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'to', 'the', 'in', 'on', 'or']);

/** "outside_off" → "Outside off", "back_of_length" → "Back of length". */
export function humanize(value: string): string {
  const words = value.replaceAll('_', ' ').replaceAll('.', ' ').trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : SMALL_WORDS.has(w) ? w : w)).join(' ');
}

export function recordingModeLabel(mode: RecordingMode): string {
  return mode === 'PER_ATTEMPT' ? 'Each ball / attempt' : mode === 'PER_SET' ? 'Each set' : 'Once per session';
}

/** How the value is entered, in plain words (replaces BOOL / ENUM / DECIMAL …). */
export function inputLabel(p: EffectiveParameter): string {
  const c = p.constraints;
  switch (p.type) {
    case 'BOOL':
      return 'Yes / No switch';
    case 'ENUM':
      return `Pick one of ${c.options?.length ?? 0}`;
    case 'INT':
      return 'Whole number';
    case 'DECIMAL':
      return 'Number';
    case 'DURATION':
      return 'Time';
    case 'TEXT':
      return 'Short note';
  }
}

/** "40 – 170", "max 100", or "" for unbounded values. */
export function rangeLabel(p: EffectiveParameter): string {
  const { min, max } = p.constraints;
  if (min !== undefined && max !== undefined) return `${min} – ${max}`;
  if (max !== undefined) return `up to ${max}`;
  if (min !== undefined) return `at least ${min}`;
  return '';
}

/** "Yorker attempted" → "Yorker", "Seam-up / hit the seam attempted" → "Seam-up / hit the seam". */
export function skillName(parentLabel: string): string {
  return parentLabel.replace(/\s+(attempted|attempt|tried)$/i, '').trim();
}

export type ParamRow =
  | { kind: 'single'; param: EffectiveParameter }
  /** An "attempted → accurate" pair recorded as one switch plus a result (FR-CAT-09). */
  | { kind: 'skill'; name: string; attempted: EffectiveParameter; result: EffectiveParameter };

/**
 * Groups parameters for display: a yes/no parameter whose only dependant is a yes/no "result" shown when it is on
 * becomes one skill row; everything else stays a single row (in schema order).
 */
export function groupParameters(params: EffectiveParameter[]): ParamRow[] {
  const visible = params.filter((p) => !p.hidden);
  const children = new Map<string, EffectiveParameter[]>();
  for (const p of visible) {
    if (p.condition) children.set(p.condition.when.key, [...(children.get(p.condition.when.key) ?? []), p]);
  }
  const rows: ParamRow[] = [];
  const used = new Set<string>();
  for (const p of visible) {
    if (used.has(p.key)) continue;
    const kids = children.get(p.key) ?? [];
    const result = kids.length === 1 ? kids[0]! : undefined;
    if (p.type === 'BOOL' && result && result.type === 'BOOL' && result.condition?.when.eq === true) {
      rows.push({ kind: 'skill', name: skillName(p.label), attempted: p, result });
      used.add(p.key).add(result.key);
    } else {
      rows.push({ kind: 'single', param: p });
      used.add(p.key);
    }
  }
  return rows;
}

/** "Only when Line is Wide" / "Only when No-ball is on" for conditional parameters outside skill pairs. */
export function conditionLabel(p: EffectiveParameter, all: EffectiveParameter[]): string {
  if (!p.condition) return '';
  const parent = all.find((x) => x.key === p.condition!.when.key);
  const name = parent?.label ?? humanize(p.condition.when.key);
  const eq = p.condition.when.eq;
  return typeof eq === 'boolean'
    ? `Only when “${name}” is ${eq ? 'on' : 'off'}`
    : `Only when “${name}” is ${humanize(String(eq))}`;
}
