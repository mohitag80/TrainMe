import { join } from 'node:path';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { collectDefaultMetrics, Histogram, Counter, Registry } from 'prom-client';

export type { Logger };

/** JSON logger with the service name on every line; redacts tokens and contact data. */
export function createLogger(
  service: string,
  level = 'info',
  options: LoggerOptions = {},
  stream?: DestinationStream,
): Logger {
  const opts: LoggerOptions = {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.email', '*.pushToken', '*.password'],
      censor: '[redacted]',
    },
    formatters: { level: (label) => ({ level: label }) },
    ...options,
  };
  return stream ? pino(opts, stream) : pino(opts);
}

/**
 * Same logger, also written to `<logDir>/<service>/app.<yyyy-MM-dd>.<n>.log` (daily files, 14 kept, `current.log`
 * points at today's). Without `logDir` it logs to stdout only, which is what Kubernetes collects.
 */
export async function createServiceLogger(service: string, level = 'info', logDir?: string): Promise<Logger> {
  if (!logDir) return createLogger(service, level);
  try {
    const { default: roll } = await import('pino-roll');
    const file = await roll({
      file: join(logDir, service, 'app'),
      extension: '.log',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      limit: { count: 14 },
      mkdir: true,
      symlink: true,
    });
    const streams = pino.multistream([
      { level: level as pino.Level, stream: process.stdout },
      { level: level as pino.Level, stream: file },
    ]);
    const log = createLogger(service, level, {}, streams);
    log.info({ logDir: join(logDir, service) }, 'writing logs to file');
    return log;
  } catch (err) {
    // A log folder that cannot be written must never stop the service.
    const log = createLogger(service, level);
    log.warn({ err, logDir }, 'cannot write log files – logging to stdout only');
    return log;
  }
}

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP request latency by route and status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const eventsProcessed = new Counter({
  name: 'events_processed_total',
  help: 'Kafka events handled by outcome',
  labelNames: ['topic', 'type', 'outcome'] as const,
  registers: [metricsRegistry],
});

export const outboxPublished = new Counter({
  name: 'outbox_events_published_total',
  help: 'Outbox rows published to Kafka',
  labelNames: ['topic'] as const,
  registers: [metricsRegistry],
});
