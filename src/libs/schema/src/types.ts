// Catalog shapes (served by catalog-svc, copied into a tracker's base snapshot) and tracker overrides.

export type DataType = 'INT' | 'DECIMAL' | 'BOOL' | 'ENUM' | 'TEXT' | 'DURATION';
export type Aggregation = 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_TRUE' | 'PCT_TRUE' | 'NONE';
export type RecordingMode = 'PER_SESSION' | 'PER_SET' | 'PER_ATTEMPT';

export interface ParameterConstraints {
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Key of a numeric parameter of the same entry this value may not exceed (made ≤ attempted). */
  maxRef?: string;
}

export interface ParameterCondition {
  when: { key: string; eq: boolean | string };
}

export interface ParameterDefinition {
  key: string;
  label: string;
  type: DataType;
  /** Canonical storage unit (ADR-014). */
  unit?: string;
  dimension?: string;
  allowedUnits?: string[];
  constraints: ParameterConstraints;
  condition?: ParameterCondition;
  agg: Aggregation;
  required: boolean;
  description?: string;
}

export type WhereValue =
  boolean | string | number | { in?: (string | number | boolean)[]; ne?: unknown; gte?: number; lte?: number };

export interface MetricTerm {
  fn: 'COUNT' | 'COUNT_TRUE' | 'SUM' | 'MAX' | 'MIN';
  param?: string;
  expr?: string;
  where?: Record<string, WhereValue>;
}

export interface MetricDisplay {
  format: string;
  decimals?: number;
  unit?: string;
  rawUnit?: string;
  dimension?: string;
  scale?: number;
}

export interface MetricDefinition {
  key: string;
  label: string;
  kind: 'RATIO' | 'SINGLE';
  numerator: MetricTerm | MetricTerm[];
  denominator?: MetricTerm | MetricTerm[];
  display: MetricDisplay;
}

export interface ActivitySnapshot {
  code: string;
  version: number;
  name: string;
  kind: string;
  recordingMode: RecordingMode;
  grouping: { label: string; size: number } | null;
  maxEntries: number;
  description: string | null;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  targets: Record<string, unknown>;
  parameters: ParameterDefinition[];
  metrics: MetricDefinition[];
}

export interface TemplateSnapshot {
  code: string;
  version: number;
  name: string;
  description: string | null;
  categoryCode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  activities: ActivitySnapshot[];
}

// ------------------------------------------------------------------ overrides (FR-TRK-02..04)

export type OverrideTarget = 'ACTIVITY' | 'PARAMETER' | 'METRIC';
export type OverrideAction = 'ADD' | 'MODIFY' | 'HIDE';

export interface Override {
  id: string;
  target: OverrideTarget;
  action: OverrideAction;
  activityCode: string;
  /** Parameter or metric key; absent for ACTIVITY overrides. */
  itemKey?: string | null;
  definition: Record<string, unknown>;
}

// ------------------------------------------------------------------ compiled result

export interface EffectiveParameter extends ParameterDefinition {
  hidden?: boolean;
  custom?: boolean;
}

export interface EffectiveMetric extends MetricDefinition {
  hidden?: boolean;
  custom?: boolean;
}

export interface EffectiveActivity {
  code: string;
  name: string;
  kind: string;
  recordingMode: RecordingMode;
  grouping: { label: string; size: number } | null;
  maxEntries: number;
  targets: Record<string, unknown>;
  hidden?: boolean;
  custom?: boolean;
  parameters: EffectiveParameter[];
  metrics: EffectiveMetric[];
  /** JSON Schema (2020-12) for one entry's `values` document. */
  entryJsonSchema: Record<string, unknown>;
}

export interface EffectiveSchema {
  activities: EffectiveActivity[];
}

export interface SchemaIssue {
  pointer: string;
  code: string;
  message: string;
}
