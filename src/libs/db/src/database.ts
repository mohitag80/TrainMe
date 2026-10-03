import { CamelCasePlugin, Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';

// DATE columns stay 'YYYY-MM-DD' strings (local dates must not shift through JS Date/timezones).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// NUMERIC/BIGINT arrive as numbers; values used here are far below 2^53.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export interface DatabaseOptions {
  url: string;
  /** Pool size per replica; PgBouncer / RDS Proxy multiplex further. */
  maxConnections?: number;
  /** Default statement timeout in ms for every query on this pool. */
  statementTimeoutMs?: number;
  applicationName?: string;
}

/** Creates a Kysely instance with snake_case ↔ camelCase mapping over a pg pool. */
export function createDatabase<DB>(opts: DatabaseOptions): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString: opts.url,
    max: opts.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: opts.statementTimeoutMs ?? 10_000,
    application_name: opts.applicationName,
  });
  // maintainNestedObjectKeys: only column names are mapped; JSONB documents keep their keys
  // (parameter keys such as speed_kmph inside entry values and metric `where` clauses).
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });
}

/** Readiness probe: one round trip with a short timeout. */
export async function pingDatabase<DB>(db: Kysely<DB>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}

/** Lowers the statement timeout for the current transaction only (search queries, LLD 08 §6). */
export async function setLocalStatementTimeout<DB>(trx: Transaction<DB>, ms: number): Promise<void> {
  await sql`SELECT set_config('statement_timeout', ${String(Math.round(ms))}, true)`.execute(trx);
}

export type { Kysely, Transaction };
export { sql };
