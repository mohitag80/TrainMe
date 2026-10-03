import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@trainme/auth';
import { isQueryTimeout, setLocalStatementTimeout, sql, type Kysely, type Transaction } from '@trainme/db';
import { ProblemError } from '@trainme/errors';
import { DATABASE, SERVICE_CONFIG } from '@trainme/service-kit';
import type { RecordsConfig } from '../config/records.config.js';
import type { RecordsDatabase } from '../infrastructure/records.database.js';
import { TrackerClient } from '../infrastructure/tracker.client.js';
import { SESSION_COLUMNS } from './session.service.js';

export type FilterOp = 'eq' | 'ne' | 'gte' | 'lte' | 'in';
export interface EntryFilter {
  key: string;
  op: FilterOp;
  value: string;
}

const MAX_RANGE_DAYS = 366; // older raw entries are searched through async exports (08 §9)

/** History search within the caller's own data (FR-REC-16; 08 §3 S5 and S7), bounded by SEARCH_TIMEOUT_MS. */
@Injectable()
export class HistorySearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<RecordsDatabase>,
    @Inject(SERVICE_CONFIG) private readonly config: RecordsConfig,
    private readonly trackers: TrackerClient,
  ) {}

  /** S5: sessions whose name, notes or tags match (GIN on user_id + tsvector), within a date range (default 12 months). */
  async sessions(user: AuthUser, q: string, limit: number, range: { from?: string; to?: string } = {}) {
    const to = range.to ?? new Date().toISOString().slice(0, 10);
    const from = range.from ?? new Date(Date.parse(to) - 365 * 86_400_000).toISOString().slice(0, 10);
    if (Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) {
      throw ProblemError.badRequest('range-too-large', `Session search covers at most ${MAX_RANGE_DAYS} days`);
    }
    return this.withTimeout(async (trx) =>
      trx
        .selectFrom('activitySession')
        .select([...SESSION_COLUMNS])
        .where('userId', '=', user.id)
        .where('sessionDate', '>=', from)
        .where('sessionDate', '<=', to)
        .where('deletedAt', 'is', null)
        .where(sql<boolean>`search_tsv @@ websearch_to_tsquery('simple', f_unaccent(${q}))`)
        .orderBy('sessionDate', 'desc')
        .limit(limit)
        .execute(),
    );
  }

  /**
   * S7: entries of one activity filtered by parameter values, e.g. speed_kmph ≥ 140. Filters are built only
   * from the tracker's schema (known keys, typed casts, fixed operators) – never free SQL.
   */
  async entries(
    user: AuthUser,
    p: { trackerId: string; activity: string; from: string; to: string; filters: EntryFilter[]; limit: number },
  ) {
    if (Date.parse(p.to) - Date.parse(p.from) > MAX_RANGE_DAYS * 86_400_000) {
      throw ProblemError.badRequest('range-too-large', `Entry search covers at most ${MAX_RANGE_DAYS} days`);
    }
    const schema = await this.trackers.schema(p.trackerId, undefined, user); // also proves ownership
    const params = schema.activities.find((a) => a.code === p.activity)?.parameters;
    if (!params) throw ProblemError.notFound(`Activity ${p.activity} in this tracker`);
    const conditions = p.filters.map((f, i) => {
      const def = params.find((x) => x.key === f.key);
      const pointer = `/query/where/${i}`;
      if (!def)
        throw ProblemError.validation([
          { pointer, code: 'unknown-parameter', message: `${f.key} is not a parameter of ${p.activity}` },
        ]);
      const field = sql`values ->> ${f.key}`;
      const numeric = def.type === 'INT' || def.type === 'DECIMAL' || def.type === 'DURATION';
      if (f.op === 'in') return sql`${field} = ANY (${f.value.split('|')}::text[])`;
      if (numeric) {
        const v = Number(f.value);
        if (!Number.isFinite(v))
          throw ProblemError.validation([{ pointer, code: 'not-a-number', message: `${f.key} needs a number` }]);
        const op = { eq: sql`=`, ne: sql`<>`, gte: sql`>=`, lte: sql`<=` }[f.op];
        return sql`(${field})::numeric ${op} ${v}`;
      }
      if (f.op !== 'eq' && f.op !== 'ne')
        throw ProblemError.validation([
          { pointer, code: 'invalid-operator', message: `${f.op} needs a numeric parameter` },
        ]);
      if (def.type === 'BOOL' && f.value !== 'true' && f.value !== 'false')
        throw ProblemError.validation([{ pointer, code: 'not-a-boolean', message: `${f.key} is true or false` }]);
      return f.op === 'eq' ? sql`${field} = ${f.value}` : sql`${field} IS DISTINCT FROM ${f.value}`;
    });
    return this.withTimeout(async (trx) => {
      let q = trx
        .selectFrom('activityEntry as e')
        .innerJoin('activitySession as s', (j) =>
          j.onRef('s.id', '=', 'e.sessionId').onRef('s.sessionDate', '=', 'e.sessionDate'),
        )
        .select([
          'e.id',
          'e.sessionId',
          'e.sessionDate',
          'e.seqNo',
          'e.groupNo',
          'e.recordedAt',
          'e.values',
          's.name as sessionName',
        ])
        .where('e.userId', '=', user.id)
        .where('e.activityCode', '=', p.activity)
        .where('e.sessionDate', '>=', p.from)
        .where('e.sessionDate', '<=', p.to)
        .where('e.deletedAt', 'is', null)
        .where('s.trackerId', '=', p.trackerId)
        .where('s.deletedAt', 'is', null);
      for (const c of conditions) q = q.where(c as never);
      return q.orderBy('e.sessionDate', 'desc').orderBy('e.seqNo').limit(p.limit).execute();
    });
  }

  private async withTimeout<T>(fn: (trx: Transaction<RecordsDatabase>) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        await setLocalStatementTimeout(trx, this.config.SEARCH_TIMEOUT_MS);
        return fn(trx);
      });
    } catch (err) {
      if (isQueryTimeout(err)) throw ProblemError.timeout();
      throw err;
    }
  }
}
