import type { ColumnType, Generated } from 'kysely';
import type { OutboxEventTable } from '@trainme/kafka';

/** JSONB column: read as T, written as a JSON string (pg would turn JS arrays into PG arrays). */
type Json<T> = ColumnType<T, string, string>;
type CreatedAt = ColumnType<Date, never, never>;

export interface UnitDimensionTable {
  code: string;
  name: string;
  baseUnit: string;
}

export interface UnitTable {
  code: string;
  dimension: string | null;
  label: string;
  toBase: number | null;
  system: 'METRIC' | 'IMPERIAL' | 'BOTH';
  counterpart: string | null;
  decimals: number;
  step: number | null;
}

export interface CategoryTable {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  description: string | null;
  level: number;
  kind: string;
  sortOrder: number;
  status: 'ACTIVE' | 'RETIRED';
  source: 'SEED' | 'ADMIN' | 'IMPORT';
  i18n: Generated<Json<Record<string, unknown>>>;
  createdAt: CreatedAt;
  updatedAt: ColumnType<Date, never, Date>;
}

export interface ParameterSetTable {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string | null;
  contentHash: string;
  createdAt: CreatedAt;
}

export interface ActivityDefinitionTable {
  id: string;
  code: string;
  version: number;
  name: string;
  kind: string;
  recordingMode: 'PER_SESSION' | 'PER_SET' | 'PER_ATTEMPT';
  grouping: Json<{ label: string; size: number } | null> | null;
  maxEntries: number;
  categoryCodes: string[];
  sports: string[];
  roles: string[];
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  mechanic: string | null;
  force: string | null;
  level: string | null;
  synonyms: string[];
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  source: 'SEED' | 'ADMIN' | 'IMPORT';
  license: string | null;
  contentHash: string;
  createdAt: CreatedAt;
}

export interface ActivityParameterSetTable {
  activityId: string;
  parameterSetId: string;
  sortOrder: number;
}

export interface ParameterDefinitionTable {
  id: string;
  activityId: string | null;
  parameterSetId: string | null;
  key: string;
  label: string;
  dataType: string;
  unit: string | null;
  dimension: string | null;
  allowedUnits: string[] | null;
  constraints: Json<Record<string, unknown>>;
  condition: Json<Record<string, unknown>> | null;
  defaultAgg: string;
  isRequired: boolean;
  description: string | null;
  sortOrder: number;
}

export interface MetricDefinitionTable {
  id: string;
  activityId: string | null;
  parameterSetId: string | null;
  key: string;
  label: string;
  kind: 'RATIO' | 'SINGLE';
  numerator: Json<unknown>;
  denominator: Json<unknown> | null;
  display: Json<Record<string, unknown>>;
  sortOrder: number;
}

export interface ProfileTemplateTable {
  id: string;
  categoryId: string;
  code: string;
  version: number;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  ownerType: Generated<'SYSTEM' | 'COACH' | 'USER'>;
  ownerId: string | null;
  source: 'SEED' | 'ADMIN' | 'IMPORT';
  contentHash: string;
  createdAt: CreatedAt;
  publishedAt: Date | null;
}

export interface TemplateActivityTable {
  profileTemplateId: string;
  activityId: string;
  sortOrder: number;
  targets: Json<Record<string, unknown>>;
}

export interface CatalogSearchDocTable {
  itemType: 'CATEGORY' | 'TEMPLATE' | 'ACTIVITY';
  itemCode: string;
  locale: string;
  name: string;
  synonyms: string[];
  description: string | null;
  kind: string | null;
  sports: string[];
  roles: string[];
  categories: string[];
  muscles: string[];
  equipment: string[];
  level: string | null;
  popularity: number;
  status: string;
}

export interface CatalogSeedRunTable {
  contentHash: string;
  version: string;
  stats: Json<Record<string, unknown>>;
  appliedAt: CreatedAt;
}

export interface CatalogAuditTable {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityCode: string;
  details: Json<Record<string, unknown>>;
  createdAt: CreatedAt;
}

export interface CatalogDatabase {
  unitDimension: UnitDimensionTable;
  unit: UnitTable;
  category: CategoryTable;
  parameterSet: ParameterSetTable;
  activityDefinition: ActivityDefinitionTable;
  activityParameterSet: ActivityParameterSetTable;
  parameterDefinition: ParameterDefinitionTable;
  metricDefinition: MetricDefinitionTable;
  profileTemplate: ProfileTemplateTable;
  templateActivity: TemplateActivityTable;
  catalogSearchDoc: CatalogSearchDocTable;
  catalogSeedRun: CatalogSeedRunTable;
  catalogAudit: CatalogAuditTable;
  outboxEvent: OutboxEventTable;
}
