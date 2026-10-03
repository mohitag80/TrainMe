import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { metricsRegistry } from '@trainme/observability';
import { ProblemError } from '@trainme/errors';
import { Public } from './auth.guard.js';

type Check = () => Promise<unknown>;

/** Modules register dependency checks (DB, Kafka, Redis); readiness fails if any check fails. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, Check>();

  register(name: string, check: Check): void {
    this.checks.set(name, check);
  }

  async run(timeoutMs = 2_000): Promise<Record<string, 'up' | 'down'>> {
    const entries = await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
          ]);
          return [name, 'up'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}

@Public()
@Controller()
export class HealthController {
  constructor(private readonly registry: HealthRegistry) {}

  @Get('health/live')
  live() {
    return { status: 'up' };
  }

  @Get('health/ready')
  async ready() {
    const checks = await this.registry.run();
    if (Object.values(checks).includes('down')) {
      throw new ProblemError(503, 'not-ready', 'Service unavailable', 'A dependency is down', { checks });
    }
    return { status: 'up', checks };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  metrics() {
    return metricsRegistry.metrics();
  }
}
