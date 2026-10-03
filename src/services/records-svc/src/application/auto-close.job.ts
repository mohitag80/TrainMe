import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { sql, type Kysely } from '@trainme/db';
import type { Logger } from '@trainme/observability';
import { DATABASE, LOGGER, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { SESSION_COLUMNS } from './session.service.js';
import { SessionEvents } from './session-events.js';

/**
 * FR-REC-13: closes forgotten sessions (idle > AUTO_CLOSE_IDLE_HOURS, or past local midnight + 2 h).
 * With entries → COMPLETED (auto-closed, charts include it); empty → DISCARDED. One replica at a time
 * (transaction-level advisory lock), scanning only the partial index of in-progress sessions.
 */
@Injectable()
export class AutoCloseJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    @Inject(SERVICE_CONFIG) private readonly config: RecordsConfig,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly events: SessionEvents,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.run().catch((err) => this.log.error({ err }, 'auto-close failed')),
      this.config.AUTO_CLOSE_INTERVAL_SECONDS * 1000,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const { rows } = await sql<{
        locked: boolean;
      }>`SELECT pg_try_advisory_xact_lock(hashtext('records-auto-close')) AS locked`.execute(trx);
      if (!rows[0]?.locked) return 0;
      const stale = await trx
        .selectFrom('activitySession')
        .select([...SESSION_COLUMNS])
        .where('status', '=', 'IN_PROGRESS')
        .where('deletedAt', 'is', null)
        // Open sessions are always recent; the bound prunes the scan to the last one or two partitions.
        .where('sessionDate', '>=', sql<string>`current_date - 7`)
        .where((eb) =>
          eb.or([
            eb('lastSyncedAt', '<', sql<Date>`now() - make_interval(hours => ${this.config.AUTO_CLOSE_IDLE_HOURS})`),
            eb(sql`((session_date + 1)::timestamp + interval '2 hours') AT TIME ZONE timezone`, '<', sql`now()`),
          ]),
        )
        .limit(500)
        .forUpdate()
        .skipLocked()
        .execute();
      for (const s of stale) {
        const status = s.entryCount > 0 ? 'COMPLETED' : 'DISCARDED';
        await trx
          .updateTable('activitySession')
          .set({
            status,
            endedAt: s.lastSyncedAt ?? new Date(),
            isAutoClosed: true,
            rowVersion: s.rowVersion + 1,
            updatedAt: new Date(),
          })
          .where('id', '=', s.id)
          .where('sessionDate', '=', s.sessionDate)
          .execute();
        const closed = { ...s, status, isAutoClosed: true, endedAt: s.lastSyncedAt ?? new Date() } as const;
        if (status === 'COMPLETED') await this.events.completed(trx, closed);
        else await this.events.discarded(trx, closed);
      }
      if (stale.length) this.log.info({ closed: stale.length }, 'auto-closed sessions');
      return stale.length;
    });
  }
}
