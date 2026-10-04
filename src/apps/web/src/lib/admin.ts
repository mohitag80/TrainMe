// Catalog editor (Admin Console) shapes and plain-language labels. Codes and keys are generated from names
// and never shown; admins only see names and the category path ("Sports › Racquet Sports › Table Tennis").
import type { DataType, MetricDefinition, ParameterDefinition, RecordingMode } from '@trainme/schema';

export type Status = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface TreeNode {
  code: string;
  name: string;
  kind: string;
  level: number;
  parentCode: string | null;
  path: string[];
  templates: number;
  activities: number;
}

export interface ActivityRow {
  code: string;
  name: string;
  version: number;
  status: Status;
  publishedVersion: number | null;
  hasDraft: boolean;
  kind: string;
  recordingMode: RecordingMode;
  placements: string[][];
  usedBy: string[];
}

export interface ProfileRow {
  code: string;
  name: string;
  version: number;
  status: Status;
  publishedVersion: number | null;
  hasDraft: boolean;
  categoryCode: string | null;
  placement: string[];
  activityCount: number;
}

export interface VersionInfo {
  version: number;
  status: Status;
  createdAt: string;
}

export interface ActivityDoc {
  code: string;
  version: number;
  status: Status;
  name: string;
  categoryCode: string | null;
  placements: string[][];
  kind: string;
  recordingMode: RecordingMode;
  description: string | null;
  level: string | null;
  equipment: string[];
  synonyms: string[];
  parameters: ParameterDefinition[];
  metrics: MetricDefinition[];
  versions: VersionInfo[];
  usedBy: string[];
}

export interface ProfileDoc {
  code: string;
  version: number;
  status: Status;
  name: string;
  description: string | null;
  categoryCode: string | null;
  placement: string[];
  activities: { code: string; name: string; status: Status; recordingMode: RecordingMode; placements: string[][] }[];
  versions: VersionInfo[];
}

export const pathText = (path: string[]) => path.join(' › ');

export const STATUS_LABEL: Record<Status, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' };
export const STATUS_TONE: Record<Status, 'warn' | 'ok' | 'default'> = {
  DRAFT: 'warn',
  PUBLISHED: 'ok',
  RETIRED: 'default',
};

export const CATEGORY_KINDS: { value: string; label: string; hint: string }[] = [
  { value: 'SPORT', label: 'Sport', hint: 'e.g. Table Tennis, Hockey' },
  { value: 'AREA', label: 'Group or area', hint: 'e.g. Racquet Sports, Cardio' },
  { value: 'DISCIPLINE', label: 'Discipline or event', hint: 'e.g. Sprints, Doubles' },
  { value: 'ROLE_GROUP', label: 'Group of positions', hint: 'e.g. Bowling, Defence' },
  { value: 'ROLE', label: 'Position or role', hint: 'e.g. Goalkeeper, Spin Bowler' },
  { value: 'MUSCLE_GROUP', label: 'Muscle group', hint: 'e.g. Legs' },
  { value: 'MUSCLE', label: 'Muscle', hint: 'e.g. Hamstrings' },
];
export const categoryKindLabel = (kind: string) =>
  CATEGORY_KINDS.find((k) => k.value === kind)?.label ?? (kind === 'DOMAIN' ? 'Top level' : 'Area');

/** Sensible type for a new child: under "Racquet Sports" a sport, under a sport a position, … */
export function suggestedKind(parent: TreeNode | undefined): string {
  switch (parent?.kind) {
    case 'DOMAIN':
      return parent.name.toLowerCase().includes('sport') ? 'SPORT' : 'AREA';
    case 'AREA':
      return parent.path[0]?.toLowerCase().includes('sport') ? 'SPORT' : 'AREA';
    case 'SPORT':
      return 'ROLE';
    case 'ROLE_GROUP':
      return 'ROLE';
    case 'MUSCLE_GROUP':
      return 'MUSCLE';
    default:
      return 'AREA';
  }
}

export const ACTIVITY_KINDS = [
  { value: 'DRILL', label: 'Drill' },
  { value: 'EXERCISE', label: 'Exercise' },
  { value: 'TEST', label: 'Fitness test' },
  { value: 'MATCH', label: 'Match or game' },
  { value: 'LOG', label: 'Check-in or log' },
];
export const activityKindLabel = (k: string) => ACTIVITY_KINDS.find((x) => x.value === k)?.label ?? 'Activity';

export const RECORDING_MODES: { value: RecordingMode; label: string; hint: string }[] = [
  { value: 'PER_ATTEMPT', label: 'Each ball / attempt', hint: 'one entry per delivery, shot or rep' },
  { value: 'PER_SET', label: 'Each set', hint: 'one entry per set or block' },
  { value: 'PER_SESSION', label: 'Once per session', hint: 'a single summary entry' },
];

export const ANSWER_TYPES: { value: DataType; label: string }[] = [
  { value: 'DECIMAL', label: 'Number (e.g. speed, weight)' },
  { value: 'INT', label: 'Whole number (e.g. reps, count)' },
  { value: 'DURATION', label: 'Time' },
  { value: 'BOOL', label: 'Yes / No switch' },
  { value: 'ENUM', label: 'Pick one of a list' },
  { value: 'TEXT', label: 'Short note' },
];

export const LEVELS = [
  { value: '', label: 'Any level' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

/** Internal key from a label: "Landed in?" → "landed_in" (unique within the activity). */
export function keyFrom(label: string, taken: Iterable<string>): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'x$1')
      .slice(0, 48) || 'field';
  const used = new Set(taken);
  if (!used.has(base) && base.length >= 2) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Option values are stored as keys and shown with their original wording via humanize(). */
export const optionValue = (text: string) => keyFrom(text, []);

// ---------------------------------------------------------------- stats in plain words

export type StatChoice =
  | { kind: 'percent'; yes: string; of: string } // % of entries (of = '*') or of entries where `of` is on
  | { kind: 'count' } // number of entries
  | { kind: 'number'; fn: 'MAX' | 'MIN' | 'AVG' | 'SUM'; param: string };

export const NUMBER_STATS = [
  { value: 'MAX', label: 'Best (highest)' },
  { value: 'MIN', label: 'Lowest' },
  { value: 'AVG', label: 'Average' },
  { value: 'SUM', label: 'Total' },
] as const;

/** Builds a metric definition from the editor's plain-language choice. */
export function buildMetric(
  label: string,
  choice: StatChoice,
  params: ParameterDefinition[],
  taken: string[],
): MetricDefinition {
  const key = keyFrom(label, taken);
  if (choice.kind === 'percent')
    return {
      key,
      label,
      kind: 'RATIO',
      numerator: { fn: 'COUNT_TRUE', param: choice.yes },
      denominator: choice.of === '*' ? { fn: 'COUNT', param: '*' } : { fn: 'COUNT_TRUE', param: choice.of },
      display: { format: 'PERCENT', decimals: 1 },
    };
  if (choice.kind === 'count')
    return {
      key,
      label,
      kind: 'SINGLE',
      numerator: { fn: 'COUNT', param: '*' },
      display: { format: 'NUMBER', decimals: 0 },
    };
  const p = params.find((x) => x.key === choice.param);
  const unit = p?.unit ? { unit: p.unit, rawUnit: p.unit, ...(p.dimension ? { dimension: p.dimension } : {}) } : {};
  const display = { format: 'NUMBER', decimals: 1, ...unit };
  return choice.fn === 'AVG'
    ? {
        key,
        label,
        kind: 'RATIO',
        numerator: { fn: 'SUM', param: choice.param },
        denominator: { fn: 'COUNT', param: choice.param },
        display,
      }
    : { key, label, kind: 'SINGLE', numerator: { fn: choice.fn, param: choice.param }, display };
}

/** "Seam accuracy – % of entries where Seam accurate is on" etc. */
export function describeMetric(m: MetricDefinition, params: ParameterDefinition[]): string {
  const name = (k?: string) => params.find((p) => p.key === k)?.label ?? 'a field';
  const n = Array.isArray(m.numerator) ? m.numerator[0] : m.numerator;
  const d = Array.isArray(m.denominator) ? m.denominator[0] : m.denominator;
  if (m.display.format === 'PERCENT') {
    const what = n?.fn === 'COUNT_TRUE' ? `“${name(n.param)}”` : 'Entries';
    if (!d || d.param === '*') return `${what} as a % of all entries`;
    return d.fn === 'COUNT_TRUE'
      ? `${what} as a % of entries where “${name(d.param)}” is on`
      : `${what} as a % of entries with “${name(d.param)}”`;
  }
  if (m.kind === 'RATIO' && n?.fn === 'SUM') return `Average of “${name(n.param)}”`;
  if (n?.fn === 'COUNT') return 'Number of entries';
  const word = n?.fn === 'MAX' ? 'Best (highest)' : n?.fn === 'MIN' ? 'Lowest' : n?.fn === 'SUM' ? 'Total' : 'Value';
  return `${word} “${name(n?.param)}”`;
}
