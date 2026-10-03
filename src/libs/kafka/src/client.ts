import { Kafka, logLevel, type LogEntry } from 'kafkajs';
import type { Logger } from '@trainme/observability';

/** KafkaJS client whose internal logs go through pino (warn and above). */
export function createKafka(opts: { brokers: string[]; clientId: string; log: Logger }): Kafka {
  const toPino =
    () =>
    ({ level, log }: LogEntry) => {
      const { message, ...extra } = log;
      if (level === logLevel.ERROR) opts.log.error({ kafka: extra }, message);
      else if (level === logLevel.WARN) opts.log.warn({ kafka: extra }, message);
    };
  return new Kafka({
    clientId: opts.clientId,
    brokers: opts.brokers,
    logLevel: logLevel.WARN,
    logCreator: toPino,
    retry: { initialRetryTime: 300, retries: 8 },
  });
}
