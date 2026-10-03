import { Partitioners, type Kafka, type Producer } from 'kafkajs';
import { sql, type Kysely } from 'kysely';
import { outboxPublished, type Logger } from '@trainme/observability';
import type { OutboxTables } from './tables.js';

export interface RelayOptions {
  batchSize?: number;
  idleDelayMs?: number;
  /** Published rows older than this are deleted by the relay's housekeeping. */
  retentionDays?: number;
}

/**
 * Polls `outbox_event` (FOR UPDATE SKIP LOCKED, so replicas share the work) and publishes rows
 * to Kafka in creation order with the user id as key. Delivery is at-least-once.
 */
export class OutboxRelay {
  private producer: Producer;
  private running = false;
  private loop?: Promise<void>;
  private lastCleanup = 0;

  constructor(
    kafka: Kafka,
    private readonly db: Kysely<OutboxTables>,
    private readonly log: Logger,
    private readonly opts: RelayOptions = {},
  ) {
    // At-least-once (consumers de-duplicate via processed_event); one in-flight request keeps per-key order.
    this.producer = kafka.producer({
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  async start(): Promise<void> {
    await this.producer.connect();
    this.running = true;
    this.loop = this.run();
    this.log.info('outbox relay started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    await this.producer.disconnect();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.publishBatch();
        await this.cleanup();
      } catch (err) {
        this.log.error({ err }, 'outbox relay batch failed');
        await sleep(2_000);
      }
      if (published === 0) await sleep(this.opts.idleDelayMs ?? 250);
    }
  }

  private async publishBatch(): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outboxEvent')
        .select(['id', 'topic', 'messageKey', 'eventType', 'payload'])
        .where('publishedAt', 'is', null)
        .orderBy('createdAt')
        .limit(this.opts.batchSize ?? 200)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) return 0;
      const byTopic = new Map<string, typeof rows>();
      for (const r of rows) byTopic.set(r.topic, [...(byTopic.get(r.topic) ?? []), r]);
      await this.producer.sendBatch({
        topicMessages: [...byTopic].map(([topic, msgs]) => ({
          topic,
          messages: msgs.map((m) => ({
            key: m.messageKey,
            value: typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload),
            headers: { ce_type: m.eventType, ce_id: m.id, 'content-type': 'application/cloudevents+json' },
          })),
        })),
      });
      await trx
        .updateTable('outboxEvent')
        .set({ publishedAt: new Date(), attempts: sql`attempts + 1` })
        .where(
          'id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
      for (const [topic, msgs] of byTopic) outboxPublished.inc({ topic }, msgs.length);
      return rows.length;
    });
  }

  private async cleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < 3_600_000) return;
    this.lastCleanup = Date.now();
    const days = this.opts.retentionDays ?? 7;
    await this.db
      .deleteFrom('outboxEvent')
      .where('publishedAt', '<', sql<Date>`now() - make_interval(days => ${days})`)
      .execute();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
