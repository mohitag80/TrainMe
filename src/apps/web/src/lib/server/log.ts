import 'server-only';
import { join } from 'node:path';
import { pino, type Logger, type LoggerOptions } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const options: LoggerOptions = {
  level,
  base: { service: 'trainme-web' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  // Tokens, cookies and contact data never reach the log.
  redact: {
    paths: ['*.accessToken', '*.refreshToken', '*.idToken', '*.token', '*.cookie', '*.email', '*.authorization'],
    censor: '[redacted]',
  },
};

async function build(): Promise<Logger> {
  const dir = process.env.LOG_DIR;
  if (!dir) return pino(options);
  try {
    const { default: roll } = await import('pino-roll');
    const file = await roll({
      file: join(dir, 'trainme-web', 'app'),
      extension: '.log',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      limit: { count: 14 },
      mkdir: true,
      symlink: true,
    });
    const lvl = level as pino.Level;
    return pino(
      options,
      pino.multistream([
        { level: lvl, stream: process.stdout },
        { level: lvl, stream: file },
      ]),
    );
  } catch (err) {
    const log = pino(options);
    log.warn({ err, dir }, 'cannot write log files – logging to stdout only');
    return log;
  }
}

let instance: Promise<Logger> | undefined;

/** Web server logger: stdout, plus daily files under LOG_DIR/trainme-web when set (same format as the services). */
export function logger(): Promise<Logger> {
  return (instance ??= build());
}
