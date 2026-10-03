import 'reflect-metadata';
import { Global, Module, type DynamicModule, type LoggerService, type Type } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createTokenVerifier, type TokenVerifierOptions } from '@trainme/auth';
import { createLogger, httpRequestDuration, type Logger } from '@trainme/observability';
import { AuthGuard, TOKEN_VERIFIER } from './auth.guard.js';
import { HealthController, HealthRegistry } from './health.js';
import { ProblemExceptionFilter } from './problem.filter.js';

export const LOGGER = Symbol('LOGGER');

export interface ServiceOptions {
  name: string;
  port: number;
  logLevel: string;
  auth: TokenVerifierOptions;
  /** Max request body; checkpoint batches are ≤ 256 KB (LLD §4.5). */
  bodyLimitBytes?: number;
}

/** Provides the logger, health registry and the global auth guard to every module. */
@Global()
@Module({})
export class ServiceKitModule {
  static forRoot(log: Logger, auth: TokenVerifierOptions): DynamicModule {
    const verifier = createTokenVerifier(auth);
    return {
      module: ServiceKitModule,
      controllers: [HealthController],
      providers: [
        { provide: LOGGER, useValue: log },
        { provide: TOKEN_VERIFIER, useValue: verifier },
        HealthRegistry,
        { provide: APP_GUARD, useFactory: (r: Reflector) => new AuthGuard(r, verifier), inject: [Reflector] },
      ],
      exports: [LOGGER, HealthRegistry, TOKEN_VERIFIER],
    };
  }
}

class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}
  log(message: unknown, context?: string) {
    this.pino.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.pino.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.pino.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.pino.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.pino.trace({ context }, String(message));
  }
}

/**
 * Starts a TrainMe service: Fastify, `/api/v1` prefix, problem+json errors, request logging,
 * latency metrics, request ids and graceful shutdown (SIGTERM drains in-flight requests).
 */
export async function bootstrapService(
  appModule: Type<unknown> | DynamicModule,
  opts: ServiceOptions,
): Promise<{ app: NestFastifyApplication; log: Logger }> {
  const log = createLogger(opts.name, opts.logLevel);
  const adapter = new FastifyAdapter({
    bodyLimit: opts.bodyLimitBytes ?? 262_144,
    trustProxy: true,
    genReqId: (req: IncomingMessage) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    disableRequestLogging: true,
  });
  const rootModule: DynamicModule = {
    module: class RootModule {},
    imports: [ServiceKitModule.forRoot(log, opts.auth), appModule],
  };
  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    logger: new PinoNestLogger(log),
    bufferLogs: false,
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.useGlobalFilters(new ProblemExceptionFilter(log));
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  // Accept an empty body sent with Content-Type: application/json (common for action POSTs such as /discard).
  fastify.addHook('onRequest', async (req) => {
    const len = req.headers['content-length'];
    if ((len === undefined || len === '0') && !req.headers['transfer-encoding']) delete req.headers['content-type'];
  });
  fastify.addHook('onSend', async (req, reply) => {
    void reply.header('x-request-id', req.id);
  });
  fastify.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const seconds = reply.elapsedTime / 1000;
    httpRequestDuration.observe({ method: req.method, route, status: String(reply.statusCode) }, seconds);
    if (!route.startsWith('/health') && route !== '/metrics') {
      log.info(
        { requestId: req.id, method: req.method, route, status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
        'request',
      );
    }
  });

  await app.listen(opts.port, '0.0.0.0');
  log.info({ port: opts.port }, 'service started');
  return { app, log };
}
