import { v7 } from 'uuid';

/** Time-ordered UUIDv7: better B-tree locality than v4 and still safe to expose (LLD §10). */
export function newId(): string {
  return v7();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
