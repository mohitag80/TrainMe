export const PROBLEM_BASE_URL = 'https://trainme.app/problems/';

export interface FieldError {
  pointer: string;
  code: string;
  message: string;
}

/** RFC 9457 problem document returned by every TrainMe API on error. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
  [extension: string]: unknown;
}

/**
 * Error carrying an HTTP status and a stable problem `slug`.
 * Services throw it; the service kit renders it as `application/problem+json`.
 */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = 'ProblemError';
  }

  static badRequest(slug: string, detail?: string, ext?: Record<string, unknown>) {
    return new ProblemError(400, slug, 'Bad request', detail, ext);
  }
  static unauthorized(detail = 'A valid access token is required') {
    return new ProblemError(401, 'unauthorized', 'Unauthorized', detail);
  }
  static forbidden(detail = 'You are not allowed to perform this action') {
    return new ProblemError(403, 'forbidden', 'Forbidden', detail);
  }
  static notFound(what: string) {
    return new ProblemError(404, 'not-found', 'Not found', `${what} was not found`);
  }
  static conflict(slug: string, detail: string, ext?: Record<string, unknown>) {
    return new ProblemError(409, slug, 'Conflict', detail, ext);
  }
  static preconditionFailed(detail = 'The resource was changed by someone else; reload and retry') {
    return new ProblemError(412, 'stale-version', 'Precondition failed', detail);
  }
  static validation(errors: FieldError[], detail = 'One or more fields are invalid') {
    return new ProblemError(422, 'validation-failed', 'Validation failed', detail, { errors });
  }
  static tooManyRequests(detail: string) {
    return new ProblemError(429, 'too-many-requests', 'Too many requests', detail);
  }
  static timeout(detail = 'The query took too long; narrow the date range or filters') {
    return new ProblemError(504, 'search-timeout', 'Gateway timeout', detail);
  }
  static upstream(service: string) {
    return new ProblemError(503, 'upstream-unavailable', 'Service unavailable', `${service} is not reachable`);
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: PROBLEM_BASE_URL + this.slug,
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      ...this.extensions,
    };
  }
}

/** Converts any thrown value into a problem document; unknown errors become an opaque 500. */
export function toProblemDetails(err: unknown, instance?: string): ProblemDetails {
  if (err instanceof ProblemError) return err.toProblem(instance);
  return {
    type: PROBLEM_BASE_URL + 'internal',
    title: 'Internal error',
    status: 500,
    ...(instance ? { instance } : {}),
  };
}
