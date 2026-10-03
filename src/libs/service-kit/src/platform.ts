import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createRedis, JsonCache, type Redis } from '@trainme/cache';
import { createDatabase, pingDatabase, type Kysely } from '@trainme/db';
import { createKafka, OutboxRelay, OutboxWriter, type Kafka, type OutboxTables } from '@trainme/kafka';
import type { Logger } from '@trainme/observability';
import { LOGGER } from './bootstrap.js';
import { HealthRegistry } from './health.js';

export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');
export const CACHE = Symbol('CACHE');
export const KAFKA = Symbol('KAFKA');
export const OUTBOX = Symbol('OUTBOX');
export const OUTBOX_RELAY = Symbol('OUTBOX_RELAY');
export const SERVICE_CONFIG = Symbol('SERVICE_CONFIG');

export interface PlatformOptions {
  serviceName: string;
  databaseUrl: string;
  redisUrl: string;
  kafkaBrokers: string[];
  /** Publish outbox rows to Kafka from this process (true in every service replica). */
  runOutboxRelay: boolean;
  dbPoolSize?: number;
  /** The service's validated config object, injectable as SERVICE_CONFIG. */
  config: unknown;
}

@Injectable()
class PlatformLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<unknown>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OUTBOX_RELAY) private readonly relay: OutboxRelay,
    @Inject('PLATFORM_OPTIONS') private readonly opts: PlatformOptions,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly health: HealthRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.health.register('postgres', () => pingDatabase(this.db));
    this.health.register('redis', () => this.redis.ping());
    if (this.opts.runOutboxRelay) {
      await this.relay.start();
      this.health.register('outbox-relay', async () => {
        if (!this.relay.isRunning) throw new Error('relay stopped');
      });
    }
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.info({ signal }, 'shutting down');
    if (this.relay.isRunning) await this.relay.stop().catch((err) => this.log.warn({ err }, 'relay stop failed'));
    this.redis.disconnect();
    await this.db.destroy();
  }
}

/**
 * Database (Kysely), Valkey cache, Kafka client, transactional outbox and its relay,
 * with readiness checks and orderly shutdown. Imported once by each service's AppModule.
 */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(opts: PlatformOptions): DynamicModule {
    return {
      module: PlatformModule,
      providers: [
        { provide: 'PLATFORM_OPTIONS', useValue: opts },
        { provide: SERVICE_CONFIG, useValue: opts.config },
        {
          provide: DATABASE,
          useFactory: () =>
            createDatabase({
              url: opts.databaseUrl,
              applicationName: opts.serviceName,
              maxConnections: opts.dbPoolSize ?? 10,
            }),
        },
        { provide: REDIS, useFactory: () => createRedis(opts.redisUrl) },
        {
          provide: CACHE,
          useFactory: (redis: Redis, log: Logger) => new JsonCache(redis, log),
          inject: [REDIS, LOGGER],
        },
        {
          provide: KAFKA,
          useFactory: (log: Logger) => createKafka({ brokers: opts.kafkaBrokers, clientId: opts.serviceName, log }),
          inject: [LOGGER],
        },
        { provide: OUTBOX, useValue: new OutboxWriter(`trainme/${opts.serviceName}`) },
        {
          provide: OUTBOX_RELAY,
          useFactory: (kafka: Kafka, db: Kysely<OutboxTables>, log: Logger) => new OutboxRelay(kafka, db, log),
          inject: [KAFKA, DATABASE, LOGGER],
        },
        PlatformLifecycle,
      ],
      exports: [SERVICE_CONFIG, DATABASE, REDIS, CACHE, KAFKA, OUTBOX, OUTBOX_RELAY],
    };
  }
}
