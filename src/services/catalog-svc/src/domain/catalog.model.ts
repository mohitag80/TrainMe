// Shapes served by catalog-svc and copied by tracker-svc into a tracker's base snapshot.

export type {
  ActivitySnapshot,
  Aggregation,
  DataType,
  MetricDefinition,
  MetricTerm,
  ParameterCondition,
  ParameterConstraints,
  ParameterDefinition,
  TemplateSnapshot,
} from '@trainme/schema';

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
