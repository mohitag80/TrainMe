// Shapes served by catalog-svc and copied by tracker-svc into a tracker's base snapshot.

export type DataType = 'INT' | 'DECIMAL' | 'BOOL' | 'ENUM' | 'TEXT' | 'DURATION';
export type Aggregation = 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_TRUE' | 'PCT_TRUE' | 'NONE';

export interface ParameterConstraints {
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Key of a numeric parameter this value may not exceed (e.g. made ≤ attempted). */
  maxRef?: string;
}

export interface ParameterCondition {
  when: { key: string; eq: boolean | string };
}

export interface ParameterDefinition {
  key: string;
  label: string;
  type: DataType;
  unit?: string;
  dimension?: string;
  allowedUnits?: string[];
  constraints: ParameterConstraints;
  condition?: ParameterCondition;
  agg: Aggregation;
  required: boolean;
  description?: string;
}

export interface MetricTerm {
  fn: 'COUNT' | 'COUNT_TRUE' | 'SUM' | 'MAX' | 'MIN';
  param?: string;
  expr?: string;
  where?: Record<string, unknown>;
}

export interface MetricDefinition {
  key: string;
  label: string;
  kind: 'RATIO' | 'SINGLE';
  numerator: MetricTerm | MetricTerm[];
  denominator?: MetricTerm | MetricTerm[];
  display: { format: string; decimals?: number; unit?: string; rawUnit?: string; dimension?: string; scale?: number };
}

export interface ActivitySnapshot {
  code: string;
  version: number;
  name: string;
  kind: string;
  recordingMode: 'PER_SESSION' | 'PER_SET' | 'PER_ATTEMPT';
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

export interface TemplateSummary {
  code: string;
  version: number;
  name: string;
  description: string | null;
  categoryCode: string;
  activityCount: number;
}

export interface CategoryNode {
  code: string;
  name: string;
  kind: string;
  level: number;
  parentCode: string | null;
  templateCount: number;
}
