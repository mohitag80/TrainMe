import type { ColumnType, Generated } from 'kysely';
import type { OutboxEventTable, ProcessedEventTable } from '@trainme/kafka';
import type { EffectiveSchema, TemplateSnapshot } from '@trainme/schema';

type Json<T> = ColumnType<T, string, string>;

export interface UserTrackerTable {
  id: string;
  userId: string;
  templateCode: string | null;
  templateVersion: number | null;
  displayName: string;
  status: 'ACTIVE' | 'ARCHIVED';
  baseSnapshot: Json<Pick<TemplateSnapshot, 'activities'> & Partial<TemplateSnapshot>>;
  schemaVersion: number;
  displayUnits: Json<Record<string, string>>;
  rowVersion: number;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
  deletedAt: Date | null;
}

export interface TrackerSchemaTable {
  trackerId: string;
  version: number;
  effectiveSchema: Json<EffectiveSchema>;
  createdAt: ColumnType<Date, never, never>;
}

export interface TrackerOverrideTable {
  id: string;
  trackerId: string;
  target: 'ACTIVITY' | 'PARAMETER' | 'METRIC';
  action: 'ADD' | 'MODIFY' | 'HIDE';
  activityCode: string;
  itemKey: string | null;
  definition: Json<Record<string, unknown>>;
  createdInVersion: number;
  createdAt: Generated<Date>;
}

export interface UserEntitlementTable {
  userId: string;
  planCode: string;
  entitlements: Json<Record<string, unknown>>;
  updatedAt: ColumnType<Date, Date | undefined, Date>;
}

export interface TemplateReleaseTable {
  templateCode: string;
  latestVersion: number;
  name: string;
  publishedAt: ColumnType<Date, Date | undefined, Date>;
}

export interface TrackerDatabase {
  userTracker: UserTrackerTable;
  trackerSchema: TrackerSchemaTable;
  trackerOverride: TrackerOverrideTable;
  userEntitlement: UserEntitlementTable;
  templateRelease: TemplateReleaseTable;
  outboxEvent: OutboxEventTable;
  processedEvent: ProcessedEventTable;
}
