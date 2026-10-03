import type { Kysely, Transaction } from 'kysely';
import { newId } from '@trainme/db';
import type { CloudEvent, EventType, Topic } from '@trainme/events';
import type { OutboxTables } from './tables.js';

export interface NewEvent<T> {
  type: EventType;
  /** Data owner; `system` for catalog-wide events. */
  userId: string;
  /** Kafka key; defaults to userId (per-user ordering). */
  key?: string;
  subject?: string;
  data: T;
  traceparent?: string;
}

/** Builds a CloudEvents 1.0 envelope; the id is a UUIDv7 so consumers can de-duplicate. */
export function buildEvent<T>(source: string, e: NewEvent<T>): CloudEvent<T> {
  return {
    specversion: '1.0',
    id: newId(),
    source,
    type: e.type,
    time: new Date().toISOString(),
    ...(e.subject ? { subject: e.subject } : {}),
    datacontenttype: 'application/json',
    ...(e.traceparent ? { traceparent: e.traceparent } : {}),
    userid: e.userId,
    data: e.data,
  };
}

/**
 * Writes events in the caller's transaction (transactional outbox), so a state change and its
 * event commit or roll back together. The relay publishes them afterwards.
 */
export class OutboxWriter {
  constructor(private readonly source: string) {}

  async enqueue<T>(
    trx: Transaction<OutboxTables> | Kysely<OutboxTables>,
    topic: Topic,
    e: NewEvent<T>,
  ): Promise<CloudEvent<T>> {
    const event = buildEvent(this.source, e);
    await trx
      .insertInto('outboxEvent')
      .values({
        id: event.id,
        topic,
        messageKey: e.key ?? e.userId,
        eventType: e.type,
        payload: JSON.stringify(event),
        publishedAt: null,
      })
      .execute();
    return event;
  }
}
