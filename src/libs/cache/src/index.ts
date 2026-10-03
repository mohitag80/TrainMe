import { Redis } from 'ioredis';
import type { Logger } from '@trainme/observability';

/** Redis client tuned for caching: fail fast (50 ms) so callers fall through to the database. */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    commandTimeout: 50,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
}

/**
 * Cache-aside JSON store. Every Redis failure is logged and treated as a miss,
 * because the cache is never the source of truth (LLD §7).
 */
export class JsonCache {
  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.log.warn({ err, key }, 'cache get failed');
      return undefined;
    }
  }

  /** ttlSeconds = 0 stores without expiry (immutable values such as a schema version). */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (ttlSeconds > 0) await this.redis.set(key, raw, 'EX', ttlSeconds);
      else await this.redis.set(key, raw);
    } catch (err) {
      this.log.warn({ err, key }, 'cache set failed');
    }
  }

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    if (value !== undefined && value !== null) await this.set(key, value, ttlSeconds);
    return value;
  }

  /** Adds a key to a tracking set so a group can be invalidated without KEYS/SCAN. */
  async setTracked(groupKey: string, key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.set(key, value, ttlSeconds);
    try {
      await this.redis.multi().sadd(groupKey, key).expire(groupKey, Math.max(ttlSeconds, 60)).exec();
    } catch (err) {
      this.log.warn({ err, groupKey }, 'cache group add failed');
    }
  }

  async invalidateGroup(groupKey: string): Promise<void> {
    try {
      const keys = await this.redis.smembers(groupKey);
      await this.redis.del(...keys, groupKey);
    } catch (err) {
      this.log.warn({ err, groupKey }, 'cache invalidation failed');
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.log.warn({ err, keys }, 'cache delete failed');
    }
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }
}

export type { Redis };
