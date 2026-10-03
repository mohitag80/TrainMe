import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ProblemError, type FieldError } from '@trainme/errors';

/** Maps zod issues to RFC 9457 field errors with JSON pointers. */
export function zodFieldErrors(error: z.ZodError, prefix = ''): FieldError[] {
  return error.issues.map((i) => ({
    pointer: `${prefix}/${i.path.map(String).join('/')}`,
    code: i.code,
    message: i.message,
  }));
}

/** Validates and coerces a body/query/param with a zod schema; failures become 422 problems. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(
    private readonly schema: T,
    private readonly pointerPrefix = '',
  ) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw ProblemError.validation(zodFieldErrors(parsed.error, this.pointerPrefix));
    return parsed.data;
  }
}
