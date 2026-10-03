import type { ColumnType } from 'kysely';
import type { OutboxEventTable, ProcessedEventTable } from '@trainme/kafka';

type Json<T> = ColumnType<T, string, string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;
export type Channel = 'PUSH' | 'EMAIL' | 'IN_APP';

export interface UserContactTable {
  userId: string;
  email: string | null;
  displayName: string;
  timezone: string;
  locale: string;
  isDeleted: boolean;
  updatedAt: Defaulted<Date>;
}

export interface NotificationPreferenceTable {
  userId: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  updatedAt: Defaulted<Date>;
}

export interface ReminderTable {
  id: string;
  userId: string;
  trackerId: string | null;
  title: string;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  channel: Channel;
  isEnabled: boolean;
  nextFireAt: Date;
  createdAt: ColumnType<Date, never, never>;
  updatedAt: Defaulted<Date>;
}

export interface NotificationTable {
  id: string;
  userId: string;
  channel: Channel;
  template: string;
  title: string;
  body: string;
  data: Json<Record<string, unknown>>;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  error: string | null;
  readAt: Date | null;
  createdAt: Defaulted<Date>;
  sentAt: Date | null;
}

export interface NotificationDatabase {
  userContact: UserContactTable;
  notificationPreference: NotificationPreferenceTable;
  reminder: ReminderTable;
  notification: NotificationTable;
  processedEvent: ProcessedEventTable;
  outboxEvent: OutboxEventTable;
}
