import type { ColumnType } from 'kysely';
import type { OutboxEventTable, ProcessedEventTable } from '@trainme/kafka';
import type { SessionStats } from '../domain/session-stats.js';

type Json<T> = ColumnType<T, string, string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;
export type MergeKind = 'SUM' | 'MAX' | 'MIN';
export type Granularity = 'DAY' | 'WEEK' | 'MONTH';

export interface SessionFactTable {
  userId: string;
  sessionId: string;
  trackerId: string;
  sessionDate: string;
  sessionName: string;
  startedAt: Date;
  schemaVersion: number;
  entryCount: number;
  stats: Json<SessionStats>;
  updatedAt: Defaulted<Date>;
}

export interface MetricRollupTable {
  userId: string;
  trackerId: string;
  activityCode: string;
  itemType: 'P' | 'M';
  itemKey: string;
  granularity: Granularity;
  periodStart: string;
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  trueCount: number;
  num: number | null;
  den: number | null;
  mergeKind: MergeKind;
  sessionCount: number;
  updatedAt: Defaulted<Date>;
}

export interface SessionMetricTable {
  userId: string;
  sessionId: string;
  activityCode: string;
  metricKey: string;
  trackerId: string;
  sessionDate: string;
  sessionName: string;
  startedAt: Date;
  num: number | null;
  den: number | null;
  value: number | null;
}

export interface PersonalRecordTable {
  userId: string;
  trackerId: string;
  activityCode: string;
  metricKey: string;
  bestValue: number;
  direction: 'MAX' | 'MIN';
  sessionId: string;
  sessionDate: string;
  achievedAt: Date;
}

export interface StreakTable {
  userId: string;
  trackerId: string;
  currentDays: number;
  longestDays: number;
  lastActive: string | null;
}

export interface AnalyticsDatabase {
  sessionFact: SessionFactTable;
  metricRollup: MetricRollupTable;
  sessionMetric: SessionMetricTable;
  personalRecord: PersonalRecordTable;
  streak: StreakTable;
  outboxEvent: OutboxEventTable;
  processedEvent: ProcessedEventTable;
}
