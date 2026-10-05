import type { Logger } from '@trainme/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '@trainme/db';
import { EVENT_TYPES, TOPICS, type SessionRefPayload, type SessionSnapshotPayload } from '@trainme/events';
import type { OutboxWriter } from '@trainme/kafka';
import { LOGGER, OUTBOX } from '@trainme/service-kit';
import type { ActivitySessionTable, RecordsDatabase } from '../infrastructure/records.database.js';

type Trx = Transaction<RecordsDatabase>;
type SessionRow = Pick<
  ActivitySessionTable,
  | 'id'
  | 'userId'
  | 'trackerId'
  | 'name'
  | 'sessionDate'
  | 'timezone'
  | 'schemaVersion'
  | 'status'
  | 'isAutoClosed'
  | 'startedAt'
  | 'endedAt'
  | 'entryCount'
  | 'trainerId'
>;

/** Snapshots above this size carry only ids; analytics then fetches entries via the API (LLD §5). */
const MAX_SNAPSHOT_BYTES = 512 * 1024;

/** Writes record.session.* events to the outbox in the caller's transaction. */
@Injectable()
export class SessionEvents {
  constructor(
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(LOGGER) private readonly log: Logger,
  ) {}

  started(trx: Trx, s: SessionRow) {
    return this.ref(trx, EVENT_TYPES.sessionStarted, s);
  }

  discarded(trx: Trx, s: SessionRow) {
    return this.ref(trx, EVENT_TYPES.sessionDiscarded, s);
  }

  reopened(trx: Trx, s: SessionRow) {
    return this.ref(trx, EVENT_TYPES.sessionReopened, s);
  }

  deleted(trx: Trx, s: SessionRow) {
    return this.ref(trx, EVENT_TYPES.sessionDeleted, s);
  }

  completed(trx: Trx, s: SessionRow) {
    return this.snapshot(trx, EVENT_TYPES.sessionCompleted, s);
  }

  updated(trx: Trx, s: SessionRow) {
    return this.snapshot(trx, EVENT_TYPES.sessionUpdated, s);
  }

  private async ref(trx: Trx, type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES], s: SessionRow) {
    this.log.info(
      {
        event: type,
        sessionId: s.id,
        userId: s.userId,
        trackerId: s.trackerId,
        sessionDate: s.sessionDate,
        name: s.name,
        status: s.status,
      },
      type.replace('record.', '').replace('.', ' '),
    );
    await this.outbox.enqueue<SessionRefPayload>(trx, TOPICS.record, {
      type,
      userId: s.userId,
      subject: `session/${s.id}`,
      data: {
        sessionId: s.id,
        userId: s.userId,
        trackerId: s.trackerId,
        name: s.name,
        sessionDate: s.sessionDate,
        trainerId: s.trainerId ?? null,
      },
    });
  }

  /** Full snapshot (all live entries) so analytics can recompute without calling back (LLD §5). */
  private async snapshot(trx: Trx, type: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES], s: SessionRow) {
    const entries = await trx
      .selectFrom('activityEntry')
      .select(['id', 'clientEntryId', 'activityCode', 'seqNo', 'groupNo', 'recordedAt', 'values'])
      .where('sessionId', '=', s.id)
      .where('sessionDate', '=', s.sessionDate)
      .where('deletedAt', 'is', null)
      .orderBy('seqNo')
      .execute();
    const data: SessionSnapshotPayload = {
      sessionId: s.id,
      userId: s.userId,
      trackerId: s.trackerId,
      name: s.name,
      sessionDate: s.sessionDate,
      timezone: s.timezone,
      schemaVersion: s.schemaVersion,
      status: s.status,
      trainerId: s.trainerId ?? null,
      isAutoClosed: s.isAutoClosed,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      entryCount: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        clientEntryId: e.clientEntryId,
        activity: e.activityCode,
        seq: e.seqNo,
        group: e.groupNo,
        recordedAt: e.recordedAt.toISOString(),
        values: e.values,
      })),
    };
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > MAX_SNAPSHOT_BYTES) {
      data.entries = [];
      data.entriesOmitted = true;
      this.log.warn({ sessionId: s.id, bytes }, 'session snapshot too large – entries omitted from the event');
    }
    this.log.info(
      {
        event: type,
        sessionId: s.id,
        userId: s.userId,
        trackerId: s.trackerId,
        sessionDate: s.sessionDate,
        name: s.name,
        entries: entries.length,
        autoClosed: s.isAutoClosed,
      },
      type.replace('record.', '').replace('.', ' '),
    );
    this.log.debug({ sessionId: s.id, bytes }, 'session snapshot built');
    await this.outbox.enqueue(trx, TOPICS.record, { type, userId: s.userId, subject: `session/${s.id}`, data });
  }
}
