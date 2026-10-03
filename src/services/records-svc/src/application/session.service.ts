import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { isUniqueViolation, newId, sql, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import type { OutboxWriter } from '@trainme/kafka';
import { DATABASE, OUTBOX, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';
import {
  cleanName,
  defaultSessionName,
  isValidTimeZone,
  localDate,
  nameKey,
  nextFreeName,
} from '../domain/session-naming.js';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';
import { SessionEvents } from './session-events.js';

export type Trx = Transaction<RecordsDatabase>;

export interface StartSessionInput {
  clientSessionId: string;
  trackerId: string;
  name?: string;
  sessionDate?: string;
  schemaVersion?: number;
  startedAt: string;
  timezone: string;
  source?: 'MOBILE' | 'WEB' | 'IMPORT';
  onNameConflict: 'REJECT' | 'SUFFIX';
}

export interface PatchSessionInput {
  name?: string;
  sessionDate?: string;
  notes?: string | null;
  tags?: string[];
  startedAt?: string;
  endedAt?: string;
}

export const SESSION_COLUMNS = [
  'id',
  'userId',
  'trackerId',
  'sessionDate',
  'name',
  'status',
  'startedAt',
  'endedAt',
  'timezone',
  'schemaVersion',
  'clientSessionId',
  'lastBatchSeq',
  'entryCount',
  'lastSyncedAt',
  'isAutoClosed',
  'notes',
  'tags',
  'source',
  'rowVersion',
  'createdAt',
  'updatedAt',
] as const;

const UQ_NAME = 'uq_activity_session__user_date_name';

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    @Inject(OUTBOX) private readonly outbox: OutboxWriter,
    @Inject(SERVICE_CONFIG) private readonly config: RecordsConfig,
    private readonly trackers: TrackerClient,
    private readonly events: SessionEvents,
  ) {}

  /**
   * FR-REC-09/17..20: Start a named session. Idempotent on clientSessionId; ownership and the pinned schema
   * come from tracker-svc; (date, name) must be free (REJECT → 409 with a suggestion, SUFFIX → "(n)").
   */
  async start(user: AuthUser, input: StartSessionInput) {
    if (!isValidTimeZone(input.timezone))
      throw ProblemError.validation([
        { pointer: '/body/timezone', code: 'invalid', message: 'Unknown IANA time zone' },
      ]);
    const startedAt = new Date(input.startedAt);
    const sessionDate = input.sessionDate ?? localDate(startedAt, input.timezone);

    const replay = await this.findByClientId(user.id, input.clientSessionId);
    if (replay) return { session: replay, created: false };

    // Uncached call with the user's token: proves ownership and gives the latest version.
    const latest = await this.trackers.schema(input.trackerId, undefined, user);
    const schemaVersion = input.schemaVersion ?? latest.schemaVersion;
    if (schemaVersion > latest.schemaVersion)
      throw ProblemError.conflict('schema-version-unknown', `Tracker schema is at v${latest.schemaVersion}`);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.transaction().execute(async (trx) => {
          const taken = await this.takenNameKeys(trx, user.id, sessionDate);
          if (taken.size >= this.config.MAX_SESSIONS_PER_DAY) {
            throw ProblemError.tooManyRequests(`At most ${this.config.MAX_SESSIONS_PER_DAY} sessions per day`);
          }
          const wanted = cleanName(input.name ?? '') || defaultSessionName(startedAt, input.timezone);
          const free = nextFreeName(wanted, taken);
          if (free && input.onNameConflict === 'REJECT') {
            throw ProblemError.conflict('session-name-taken', `"${wanted}" already exists on ${sessionDate}`, {
              suggestedName: free,
            });
          }
          const id = newId();
          await trx
            .insertInto('activitySession')
            .values({
              id,
              userId: user.id,
              trackerId: input.trackerId,
              sessionDate,
              name: free ?? wanted,
              status: 'IN_PROGRESS',
              startedAt,
              endedAt: null,
              timezone: input.timezone,
              schemaVersion,
              clientSessionId: input.clientSessionId,
              lastBatchSeq: 0,
              entryCount: 0,
              lastSyncedAt: startedAt,
              isAutoClosed: false,
              notes: null,
              tags: [],
              source: input.source ?? 'MOBILE',
              rowVersion: 1,
              deletedAt: null,
            })
            .execute();
          await trx.insertInto('sessionLocator').values({ sessionId: id, userId: user.id, sessionDate }).execute();
          const session = await this.loadOwned(trx, user, id);
          await this.events.started(trx, session);
          return { session, created: true, nameAdjusted: free !== undefined };
        });
      } catch (err) {
        // Two devices raced for the same name or the same clientSessionId: re-read and decide again.
        if (isUniqueViolation(err, 'uq_activity_session__client_session')) {
          const s = await this.findByClientId(user.id, input.clientSessionId);
          if (s) return { session: s, created: false };
        }
        if (!isUniqueViolation(err, UQ_NAME) || attempt === 2) throw err;
      }
    }
    throw ProblemError.conflict('session-name-taken', 'Could not reserve a session name; retry');
  }

  async get(user: AuthUser, id: string, includeEntries: boolean) {
    const session = await this.loadOwned(this.db, user, id);
    if (!includeEntries) return session;
    const entries = await this.db
      .selectFrom('activityEntry')
      .select(['id', 'clientEntryId', 'activityCode', 'seqNo', 'groupNo', 'recordedAt', 'values', 'rowVersion'])
      .where('sessionId', '=', id)
      .where('sessionDate', '=', session.sessionDate)
      .where('deletedAt', 'is', null)
      .orderBy('seqNo')
      .execute();
    return { ...session, entries };
  }

  /**
   * S4/S4b: list with keyset pagination (session_date, id). `date` returns that day's sessions across trackers;
   * otherwise a tracker and/or date range (default: last 30 days, capped at 366 days).
   */
  async list(
    user: AuthUser,
    q: {
      date?: string;
      trackerId?: string;
      from?: string;
      to?: string;
      status?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    let from = q.date ?? q.from;
    let to = q.date ?? q.to;
    if (!from || !to) {
      to = to ?? new Date().toISOString().slice(0, 10);
      from = from ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString().slice(0, 10);
    }
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000)
      throw ProblemError.badRequest('range-too-large', 'Date range is limited to 366 days');
    let query = this.db
      .selectFrom('activitySession')
      .select([...SESSION_COLUMNS])
      .where('userId', '=', user.id)
      .where('sessionDate', '>=', from)
      .where('sessionDate', '<=', to)
      .where('deletedAt', 'is', null);
    if (q.trackerId) query = query.where('trackerId', '=', q.trackerId);
    if (q.status) query = query.where('status', '=', q.status as never);
    else query = query.where('status', '<>', 'DISCARDED');
    if (q.cursor) {
      const [cDate, cStarted, cId] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      query = query.where((eb) =>
        eb.or([
          eb('sessionDate', '<', cDate!),
          eb.and([eb('sessionDate', '=', cDate!), eb('startedAt', '<', new Date(cStarted!))]),
          eb.and([eb('sessionDate', '=', cDate!), eb('startedAt', '=', new Date(cStarted!)), eb('id', '<', cId!)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('sessionDate', 'desc')
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(q.limit + 1)
      .execute();
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > q.limit && last
        ? Buffer.from(`${last.sessionDate}|${last.startedAt.toISOString()}|${last.id}`).toString('base64url')
        : null;
    return { items, nextCursor };
  }

  /** Finds one session by its user-facing identity: date + name (case/space-insensitive). */
  async lookup(user: AuthUser, date: string, name: string) {
    const s = await this.db
      .selectFrom('activitySession')
      .select([...SESSION_COLUMNS])
      .where('userId', '=', user.id)
      .where('sessionDate', '=', date)
      .where('nameKey', '=', nameKey(name))
      .where('deletedAt', 'is', null)
      .where('status', '<>', 'DISCARDED')
      .executeTakeFirst();
    if (!s) throw ProblemError.notFound(`Session "${name}" on ${date}`);
    return s;
  }

  /** Rename, move date, notes/tags, times (If-Match). Name/date clashes → 409 with a suggestion. */
  async patch(user: AuthUser, id: string, ifMatch: number | undefined, p: PatchSessionInput) {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const s = await this.lockOwned(trx, user, id, ifMatch);
        const sessionDate = p.sessionDate ?? s.sessionDate;
        const name = p.name !== undefined ? cleanName(p.name) : s.name;
        if (sessionDate !== s.sessionDate || nameKey(name) !== nameKey(s.name)) {
          const taken = await this.takenNameKeys(trx, user.id, sessionDate, id);
          const free = nextFreeName(name, taken);
          if (free)
            throw ProblemError.conflict('session-name-taken', `"${name}" already exists on ${sessionDate}`, {
              suggestedName: free,
            });
        }
        await trx
          .updateTable('activitySession')
          .set({
            name,
            sessionDate,
            ...(p.notes !== undefined ? { notes: p.notes } : {}),
            ...(p.tags ? { tags: p.tags } : {}),
            ...(p.startedAt ? { startedAt: new Date(p.startedAt) } : {}),
            ...(p.endedAt ? { endedAt: new Date(p.endedAt) } : {}),
            rowVersion: s.rowVersion + 1,
            updatedAt: new Date(),
          })
          .where('id', '=', id)
          .where('sessionDate', '=', s.sessionDate)
          .execute();
        if (sessionDate !== s.sessionDate) {
          // The FK cascades the date to the entries (row movement across monthly partitions).
          await trx.updateTable('sessionLocator').set({ sessionDate }).where('sessionId', '=', id).execute();
        }
        const updated = await this.loadOwned(trx, user, id);
        if (updated.status === 'COMPLETED') await this.events.updated(trx, updated);
        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err, UQ_NAME))
        throw ProblemError.conflict('session-name-taken', 'That name was just taken on this date');
      throw err;
    }
  }

  async discard(user: AuthUser, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const s = await this.lockOwned(trx, user, id, undefined);
      if (s.status !== 'IN_PROGRESS') throw ProblemError.conflict('not-in-progress', `Session is ${s.status}`);
      await this.setStatus(trx, s, 'DISCARDED');
      const updated = await this.loadOwned(trx, user, id);
      await this.events.discarded(trx, updated);
      return updated;
    });
  }

  async remove(user: AuthUser, id: string, ifMatch: number | undefined): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const s = await this.lockOwned(trx, user, id, ifMatch);
      await trx
        .updateTable('activitySession')
        .set({ deletedAt: new Date(), rowVersion: s.rowVersion + 1, updatedAt: new Date() })
        .where('id', '=', id)
        .where('sessionDate', '=', s.sessionDate)
        .execute();
      await this.events.deleted(trx, s);
    });
  }

  /**
   * FR-REC-12: End/submit. Verifies the server holds every entry the device logged; on a mismatch returns
   * 409 with the missing client ids so the app resends them. Idempotent once COMPLETED.
   */
  async complete(
    user: AuthUser,
    id: string,
    input: { endedAt: string; entryCount: number; clientEntryIds?: string[] },
  ) {
    return this.db.transaction().execute(async (trx) => {
      const s = await this.lockOwned(trx, user, id, undefined);
      if (s.status === 'COMPLETED') return s;
      if (s.status !== 'IN_PROGRESS') throw ProblemError.conflict('not-in-progress', `Session is ${s.status}`);
      const live = await trx
        .selectFrom('activityEntry')
        .select('clientEntryId')
        .where('sessionId', '=', id)
        .where('sessionDate', '=', s.sessionDate)
        .where('deletedAt', 'is', null)
        .execute();
      if (live.length !== input.entryCount) {
        const have = new Set(live.map((r) => r.clientEntryId));
        const missing = (input.clientEntryIds ?? []).filter((c) => !have.has(c));
        throw ProblemError.conflict('entries-missing', `Server has ${live.length} of ${input.entryCount} entries`, {
          serverEntryCount: live.length,
          missingClientEntryIds: missing,
        });
      }
      await trx
        .updateTable('activitySession')
        .set({
          status: 'COMPLETED',
          endedAt: new Date(input.endedAt),
          entryCount: live.length,
          rowVersion: s.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .where('sessionDate', '=', s.sessionDate)
        .execute();
      const done = await this.loadOwned(trx, user, id);
      await this.events.completed(trx, done);
      return done;
    });
  }

  // ---------------------------------------------------------------- shared helpers (also used by checkpoints)

  async setStatus(
    trx: Trx,
    s: { id: string; sessionDate: string; rowVersion: number },
    status: 'COMPLETED' | 'DISCARDED',
    autoClosed = false,
  ) {
    await trx
      .updateTable('activitySession')
      .set({
        status,
        endedAt: new Date(),
        isAutoClosed: autoClosed,
        rowVersion: s.rowVersion + 1,
        updatedAt: new Date(),
      })
      .where('id', '=', s.id)
      .where('sessionDate', '=', s.sessionDate)
      .execute();
  }

  /** Reads the partition from session_locator, then the session (partition-pruned); 404 unless owned. */
  async loadOwned(db: Kysely<RecordsDatabase> | Trx, user: AuthUser, id: string) {
    const loc = await db
      .selectFrom('sessionLocator')
      .select(['userId', 'sessionDate'])
      .where('sessionId', '=', id)
      .executeTakeFirst();
    if (!loc || loc.userId !== user.id) throw ProblemError.notFound(`Session ${id}`);
    const s = await db
      .selectFrom('activitySession')
      .select([...SESSION_COLUMNS])
      .where('id', '=', id)
      .where('sessionDate', '=', loc.sessionDate)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!s) throw ProblemError.notFound(`Session ${id}`);
    return s;
  }

  async lockOwned(trx: Trx, user: AuthUser, id: string, ifMatch: number | undefined) {
    const s = await this.loadOwned(trx, user, id);
    await sql`SELECT 1 FROM activity_session WHERE id = ${id} AND session_date = ${s.sessionDate} FOR UPDATE`.execute(
      trx,
    );
    const fresh = await this.loadOwned(trx, user, id);
    if (ifMatch !== undefined && ifMatch !== fresh.rowVersion) throw ProblemError.preconditionFailed();
    return fresh;
  }

  private async findByClientId(userId: string, clientSessionId: string) {
    return this.db
      .selectFrom('activitySession')
      .select([...SESSION_COLUMNS])
      .where('userId', '=', userId)
      .where('clientSessionId', '=', clientSessionId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /** Name keys already used on a date (served by uq_activity_session__user_date_name). */
  private async takenNameKeys(trx: Trx, userId: string, sessionDate: string, exceptId?: string): Promise<Set<string>> {
    let q = trx
      .selectFrom('activitySession')
      .select('nameKey')
      .where('userId', '=', userId)
      .where('sessionDate', '=', sessionDate)
      .where('deletedAt', 'is', null)
      .where('status', '<>', 'DISCARDED');
    if (exceptId) q = q.where('id', '<>', exceptId);
    const rows = await q.execute();
    return new Set(rows.map((r) => r.nameKey));
  }
}
