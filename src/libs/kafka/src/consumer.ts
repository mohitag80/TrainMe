import { Partitioners, type Consumer, type Kafka, type KafkaMessage, type Producer } from 'kafkajs';
import { sql, type Kysely, type Transaction } from 'kysely';
import { dlqTopic, type CloudEvent } from '@trainme/events';
import { eventsProcessed, type Logger } from '@trainme/observability';
import type { ConsumerTables } from './tables.js';

export type EventHandler<DB> = (event: CloudEvent<never>, trx: Transaction<DB>) => Promise<void>;

export interface ConsumerOptions<DB extends ConsumerTables> {
  kafka: Kafka;
  db: Kysely<DB>;
  log: Logger;
  /** `<service>.<purpose>`, e.g. `analytics-svc.rollups`; also the processed_event ledger key. */
  groupId: string;
  topics: string[];
  /** Handlers by CloudEvent type; other types on the topics are acknowledged and skipped. */
  handlers: Record<string, EventHandler<DB>>;
  maxAttempts?: number;
}

/**
 * Idempotent consumer: the handler and the `processed_event` insert share one transaction, so a
 * redelivered event is a no-op. After maxAttempts the message goes to `<topic>.dlq`.
 */
export class EventConsumer<DB extends ConsumerTables> {
  private consumer: Consumer;
  private dlqProducer: Producer;
  private connected = false;

  constructor(private readonly opts: ConsumerOptions<DB>) {
    this.consumer = opts.kafka.consumer({
      groupId: opts.groupId,
      sessionTimeout: 30_000,
      allowAutoTopicCreation: false,
    });
    this.dlqProducer = opts.kafka.producer({
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    this.consumer.on(this.consumer.events.CONNECT, () => (this.connected = true));
    this.consumer.on(this.consumer.events.DISCONNECT, () => (this.connected = false));
    this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
      this.connected = false;
      opts.log.error({ err: payload.error, groupId: opts.groupId }, 'consumer crashed');
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    await this.dlqProducer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: this.opts.topics, fromBeginning: true });
    await this.consumer.run({
      autoCommit: true,
      eachMessage: async ({ topic, message }) => this.handle(topic, message),
    });
    this.opts.log.info({ groupId: this.opts.groupId, topics: this.opts.topics }, 'consumer started');
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
    await this.dlqProducer.disconnect();
  }

  private async handle(topic: string, message: KafkaMessage): Promise<void> {
    let event: CloudEvent<never>;
    try {
      event = JSON.parse(message.value?.toString() ?? '') as CloudEvent<never>;
    } catch (err) {
      await this.toDlq(topic, message, err);
      return;
    }
    const handler = this.opts.handlers[event.type];
    this.opts.log.debug({ topic, type: event.type, eventId: event.id, subject: event.subject }, 'event received');
    if (!handler) {
      eventsProcessed.inc({ topic, type: event.type, outcome: 'skipped' });
      this.opts.log.debug({ type: event.type, eventId: event.id }, 'event skipped – no handler');
      return;
    }
    const maxAttempts = this.opts.maxAttempts ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.process(topic, event, handler);
        return;
      } catch (err) {
        if (attempt >= maxAttempts) {
          this.opts.log.error({ err, eventId: event.id, type: event.type }, 'event failed; sent to DLQ');
          await this.toDlq(topic, message, err);
          return;
        }
        this.opts.log.warn({ err, eventId: event.id, type: event.type, attempt }, 'event failed – retrying');
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }

  private async process(topic: string, event: CloudEvent<never>, handler: EventHandler<DB>): Promise<void> {
    const started = Date.now();
    const outcome = await this.opts.db.transaction().execute(async (trx) => {
      // Kysely's generic table typing cannot see ConsumerTables through DB, hence the raw insert.
      const inserted = await sql<{ eventId: string }>`
        INSERT INTO processed_event (event_id, consumer) VALUES (${event.id}, ${this.opts.groupId})
        ON CONFLICT DO NOTHING RETURNING event_id`.execute(trx);
      if (inserted.rows.length === 0) return 'duplicate';
      await handler(event, trx);
      return 'ok';
    });
    eventsProcessed.inc({ topic, type: event.type, outcome });
    this.opts.log.info(
      { type: event.type, eventId: event.id, subject: event.subject, outcome, ms: Date.now() - started },
      outcome === 'duplicate' ? 'event already handled – ignored' : 'event handled',
    );
  }

  private async toDlq(topic: string, message: KafkaMessage, err: unknown): Promise<void> {
    eventsProcessed.inc({ topic, type: 'unknown', outcome: 'dlq' });
    await this.dlqProducer.send({
      topic: dlqTopic(topic),
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            ...message.headers,
            'x-error': String((err as Error)?.message ?? err).slice(0, 500),
            'x-consumer': this.opts.groupId,
          },
        },
      ],
    });
  }
}
