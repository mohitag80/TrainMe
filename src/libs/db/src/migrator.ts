import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { Logger } from '@trainme/observability';

const FILE_RE = /^V(\d+)__([a-z0-9_]+)\.sql$/;
const NO_TX_MARKER = '-- migrate:no-transaction';
const LOCK_KEY = 72_616_101; // arbitrary, shared by every TrainMe migrator

interface MigrationFile {
  version: number;
  description: string;
  file: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const file of names) {
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`Migration file name must look like V001__snake_case.sql: ${file}`);
    const text = await readFile(join(dir, file), 'utf8');
    files.push({
      version: Number(m[1]),
      description: m[2]!.replaceAll('_', ' '),
      file,
      sql: text,
      checksum: createHash('sha256').update(text).digest('hex'),
    });
  }
  const versions = new Set<number>();
  for (const f of files) {
    if (versions.has(f.version)) throw new Error(`Duplicate migration version V${f.version}`);
    versions.add(f.version);
  }
  return files.sort((a, b) => a.version - b.version);
}

/**
 * Applies pending `V<NNN>__name.sql` files in order under an advisory lock, one transaction per file
 * (unless marked `-- migrate:no-transaction`). Edited, already-applied files fail fast by checksum.
 */
export async function runMigrations(opts: { databaseUrl: string; dir: string; log: Logger }): Promise<number> {
  const migrations = await loadMigrations(opts.dir);
  const client = new pg.Client({ connectionString: opts.databaseUrl, application_name: 'migrator' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version      INT PRIMARY KEY,
      description  TEXT NOT NULL,
      checksum     CHAR(64) NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_ms INT NOT NULL)`);
    const { rows } = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migration',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    let count = 0;
    for (const m of migrations) {
      const known = applied.get(m.version);
      if (known !== undefined) {
        if (known !== m.checksum) throw new Error(`Applied migration ${m.file} was modified (checksum mismatch)`);
        continue;
      }
      const started = Date.now();
      const transactional = !m.sql.includes(NO_TX_MARKER);
      try {
        if (transactional) await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migration (version, description, checksum, execution_ms) VALUES ($1, $2, $3, $4)',
          [m.version, m.description, m.checksum, Date.now() - started],
        );
        if (transactional) await client.query('COMMIT');
      } catch (err) {
        if (transactional) await client.query('ROLLBACK');
        throw new Error(`Migration ${m.file} failed: ${(err as Error).message}`, { cause: err });
      }
      opts.log.info({ migration: m.file, ms: Date.now() - started }, 'migration applied');
      count++;
    }
    opts.log.info({ applied: count, total: migrations.length }, 'database is up to date');
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
