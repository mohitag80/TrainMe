import type { ColumnType } from 'kysely';
import type { OutboxEventTable, ProcessedEventTable } from '@trainme/kafka';

type Json<T> = ColumnType<T, string, string>;
type Generated<T> = ColumnType<T, never, never>;

export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'DISCARDED';

export interface ActivitySessionTable {
  id: string;
  userId: string;
  trackerId: string;
  sessionDate: string;
  name: string;
  nameKey: Generated<string>;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  timezone: string;
  schemaVersion: number;
  clientSessionId: string;
  lastBatchSeq: number;
  entryCount: number;
  lastSyncedAt: Date | null;
  isAutoClosed: boolean;
  notes: string | null;
  tags: string[];
  source: 'MOBILE' | 'WEB' | 'IMPORT';
  rowVersion: number;
  deletedAt: Date | null;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: ColumnType<Date, never, Date>;
}

export interface SessionLocatorTable {
  sessionId: string;
  userId: string;
  sessionDate: string;
}

export interface ActivityEntryTable {
  id: string;
  userId: string;
  sessionId: string;
  sessionDate: string;
  clientEntryId: string;
  activityCode: string;
  seqNo: number;
  groupNo: number | null;
  recordedAt: Date;
  values: Json<Record<string, unknown>>;
  rowVersion: number;
  deletedAt: Date | null;
}

export interface RecordsDatabase {
  activitySession: ActivitySessionTable;
  sessionLocator: SessionLocatorTable;
  activityEntry: ActivityEntryTable;
  outboxEvent: OutboxEventTable;
  processedEvent: ProcessedEventTable;
}
