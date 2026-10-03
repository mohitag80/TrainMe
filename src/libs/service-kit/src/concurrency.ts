import { ProblemError } from '@trainme/errors';

/** Parses `If-Match: "7"` (or `W/"7"`) into a row version; absent header → undefined. */
export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw.replace(/^W\//, '').replaceAll('"', ''));
  if (!Number.isInteger(n) || n < 0)
    throw ProblemError.badRequest('invalid-if-match', 'If-Match must be a quoted row version');
  return n;
}

export const etag = (version: number) => `"${version}"`;
