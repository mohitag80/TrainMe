interface PgError {
  code?: string;
  constraint?: string;
}

const asPg = (err: unknown): PgError => (typeof err === 'object' && err !== null ? (err as PgError) : {});

/** True when the error is a unique violation, optionally of one named constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = asPg(err);
  return (
    e.code === '23505' &&
    (constraint === undefined || e.constraint === constraint || e.constraint?.endsWith(constraint) === true)
  );
}

/** True when PostgreSQL cancelled the statement because of statement_timeout. */
export function isQueryTimeout(err: unknown): boolean {
  return asPg(err).code === '57014';
}

export function isForeignKeyViolation(err: unknown): boolean {
  return asPg(err).code === '23503';
}
