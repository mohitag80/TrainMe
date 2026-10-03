import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { newId, sql, type Kysely } from '@trainme/db';
import { ProblemError, type FieldError } from '@trainme/errors';
import { DATABASE } from '@trainme/service-kit';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';
import { SessionEvents } from './session-events.js';
import { SessionService } from './session.service.js';

export const MAX_ENTRIES_PER_BATCH = 100;

export interface EntryInput {
  clientEntryId: string;
  activity: string;
  seq: number;
  group?: number | null;
  recordedAt: string;
  values: Record<string, unknown>;
  rowVersion?: number;
}

export interface BatchInput {
  batchSeq: number;
  schemaVersion: number;
  entries: EntryInput[];
  deletes: string[];
}

/**
 * Checkpoint sync (FR-REC-10/11, LLD §4.5): validates each entry against the pinned schema, upserts valid
 * ones idempotently by client_entry_id (newer rowVersion wins), tombstones deletes. Partial success.
 */
@Injectable()
export class CheckpointService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    private readonly sessions: SessionService,
    private readonly trackers: TrackerClient,
    private readonly events: SessionEvents,
  ) {}

  async apply(user: AuthUser, sessionId: string, ifMatch: number | undefined, batch: BatchInput) {
    if (batch.entries.length > MAX_ENTRIES_PER_BATCH)
      throw ProblemError.badRequest('batch-too-large', `At most ${MAX_ENTRIES_PER_BATCH} entries per batch`);
    const pre = await this.sessions.loadOwned(this.db, user, sessionId);
    if (batch.schemaVersion !== pre.schemaVersion) {
      throw ProblemError.conflict('schema-version-mismatch', `Session is pinned to schema v${pre.schemaVersion}`, {
        schemaVersion: pre.schemaVersion,
      });
    }
    const validator = await this.trackers.validator(pre.trackerId, pre.schemaVersion, user);

    const rejected: { clientEntryId: string; errors: FieldError[] }[] = [];
    const valid: EntryInput[] = [];
    for (const e of batch.entries) {
      const issues = validator.validate(e.activity, e.values);
      if (issues.length) rejected.push({ clientEntryId: e.clientEntryId, errors: issues });
      else valid.push(e);
    }

    return this.db.transaction().execute(async (trx) => {
      const s = await this.sessions.lockOwned(trx, user, sessionId, undefined);
      if (s.status === 'DISCARDED') throw ProblemError.conflict('not-in-progress', 'Session was discarded');
      if (s.status === 'COMPLETED' && ifMatch === undefined) {
        throw ProblemError.conflict(
          'session-completed',
          'Editing a completed session needs If-Match with its row version',
        );
      }
      if (ifMatch !== undefined && ifMatch !== s.rowVersion) throw ProblemError.preconditionFailed();

      const maxEntries = (code: string) => validator.activity(code)?.maxEntries ?? 500;
      if (valid.length) {
        await trx
          .insertInto('activityEntry')
          .values(
            valid.map((e) => ({
              id: newId(),
              userId: user.id,
              sessionId,
              sessionDate: s.sessionDate,
              clientEntryId: e.clientEntryId,
              activityCode: e.activity,
              seqNo: e.seq,
              groupNo: e.group ?? null,
              recordedAt: new Date(e.recordedAt),
              values: JSON.stringify(e.values),
              rowVersion: e.rowVersion ?? 1,
              deletedAt: null,
            })),
          )
          .onConflict((oc) =>
            oc
              .columns(['sessionId', 'clientEntryId', 'sessionDate'])
              .doUpdateSet((eb) => ({
                activityCode: eb.ref('excluded.activityCode'),
                seqNo: eb.ref('excluded.seqNo'),
                groupNo: eb.ref('excluded.groupNo'),
                recordedAt: eb.ref('excluded.recordedAt'),
                values: eb.ref('excluded.values'),
                rowVersion: eb.ref('excluded.rowVersion'),
                deletedAt: null,
              }))
              // Replays (same rowVersion) are no-ops; only newer edits replace values.
              .where('activityEntry.rowVersion', '<', (eb) => eb.ref('excluded.rowVersion')),
          )
          .execute();
      }
      if (batch.deletes.length) {
        await trx
          .updateTable('activityEntry')
          .set({ deletedAt: new Date() })
          .where('sessionId', '=', sessionId)
          .where('sessionDate', '=', s.sessionDate)
          .where('clientEntryId', 'in', batch.deletes)
          .where('deletedAt', 'is', null)
          .execute();
      }
      const counts = await trx
        .selectFrom('activityEntry')
        .select(['activityCode', (eb) => eb.fn.countAll<number>().as('n')])
        .where('sessionId', '=', sessionId)
        .where('sessionDate', '=', s.sessionDate)
        .where('deletedAt', 'is', null)
        .groupBy('activityCode')
        .execute();
      const over = counts.find((c) => Number(c.n) > maxEntries(c.activityCode));
      if (over)
        throw ProblemError.badRequest(
          'too-many-entries',
          `At most ${maxEntries(over.activityCode)} entries for ${over.activityCode}`,
        );
      const entryCount = counts.reduce((n, c) => n + Number(c.n), 0);
      await trx
        .updateTable('activitySession')
        .set({
          entryCount,
          lastBatchSeq: sql<number>`greatest(last_batch_seq, ${batch.batchSeq})`,
          lastSyncedAt: new Date(),
          rowVersion: s.status === 'COMPLETED' ? s.rowVersion + 1 : s.rowVersion,
          updatedAt: new Date(),
        })
        .where('id', '=', sessionId)
        .where('sessionDate', '=', s.sessionDate)
        .execute();
      if (s.status === 'COMPLETED') {
        const updated = await this.sessions.loadOwned(trx, user, sessionId);
        await this.events.updated(trx, updated);
      }
      return { acceptedThrough: batch.batchSeq, entryCount, replay: batch.batchSeq <= s.lastBatchSeq, rejected };
    });
  }
}
