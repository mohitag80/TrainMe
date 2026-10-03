import type { ColumnType, Generated } from 'kysely';

/** `outbox_event` – present in every database that publishes events (LLD §2.6). */
export interface OutboxEventTable {
  id: string;
  topic: string;
  messageKey: string;
  eventType: string;
  payload: ColumnType<unknown, string, string>;
  createdAt: Generated<Date>;
  publishedAt: Date | null;
  attempts: Generated<number>;
}

/** `processed_event` – idempotency ledger in every database that consumes events. */
export interface ProcessedEventTable {
  eventId: string;
  consumer: string;
  processedAt: Generated<Date>;
}

export interface OutboxTables {
  outboxEvent: OutboxEventTable;
}

export interface ConsumerTables {
  processedEvent: ProcessedEventTable;
}
