import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_BASE_URL, ProblemError, toProblemDetails, type ProblemDetails } from '@trainme/errors';
import type { Logger } from '@trainme/observability';

/** Renders every error as RFC 9457 problem+json; 5xx are logged with the request id, details hidden. */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = this.toProblem(err, req.url);
    if (problem.status >= 500) this.log.error({ err, requestId: req.id, url: req.url }, 'request failed');
    else
      this.log.debug(
        { requestId: req.id, status: problem.status, type: problem.type, detail: problem.detail, errors: problem.errors },
        'request problem',
      );
    void reply.status(problem.status).header('content-type', 'application/problem+json').send(problem);
  }

  private toProblem(err: unknown, instance: string): ProblemDetails {
    if (err instanceof ProblemError) return err.toProblem(instance);
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const slug = status === 404 ? 'not-found' : status === 405 ? 'method-not-allowed' : 'http-error';
      return { type: PROBLEM_BASE_URL + slug, title: err.message, status, instance };
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      const slug = fastifyErr.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'payload-too-large' : 'bad-request';
      return {
        type: PROBLEM_BASE_URL + slug,
        title: fastifyErr.message ?? 'Bad request',
        status: fastifyErr.statusCode,
        instance,
      };
    }
    return toProblemDetails(err, instance);
  }
}
