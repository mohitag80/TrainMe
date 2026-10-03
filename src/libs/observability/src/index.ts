import { pino, type Logger, type LoggerOptions } from 'pino';
import { collectDefaultMetrics, Histogram, Counter, Registry } from 'prom-client';

export type { Logger };

/** JSON logger with the service name on every line; redacts tokens and contact data. */
export function createLogger(service: string, level = 'info', options: LoggerOptions = {}): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.email', '*.pushToken', '*.password'],
      censor: '[redacted]',
    },
    formatters: { level: (label) => ({ level: label }) },
    ...options,
  });
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
