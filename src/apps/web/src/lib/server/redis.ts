import 'server-only';
import { Redis } from 'ioredis';
import { webConfig } from './config';

const g = globalThis as unknown as { trainmeRedis?: Redis };

/** One connection per server process (survives dev hot reloads). */
export function redis(): Redis {
  g.trainmeRedis ??= new Redis(webConfig().redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 2_000 });
  return g.trainmeRedis;
}
