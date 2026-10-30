import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ERROR_CODES, ProblemSchema, type ApiErrorCode, type Problem } from '@fayda/contracts';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

const TITLES: Record<number, string> = { 400: 'Bad request', 401: 'Unauthenticated', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 422: 'Unprocessable', 429: 'Too many requests', 503: 'Service unavailable' };
const CODE_FOR_STATUS: Record<number, ApiErrorCode> = { 400: 'VALIDATION', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' };

/** Turns every failure into an application/problem+json body with a stable code. Internal details are only logged. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(err: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let code: ApiErrorCode = 'INTERNAL';
    let detail: string | undefined;
    let fields: Record<string, string> | undefined;

    if (err instanceof AppError) {
      ({ status, code, fields } = err);
      detail = err.message;
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION';
      fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message]));
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = CODE_FOR_STATUS[status] ?? 'INTERNAL';
      if (status < 500) detail = err.message;
    } else {
      this.log.error(err instanceof Error ? (err.stack ?? err.message) : 'non-error thrown');
    }
    if (status >= 500) detail = undefined;

    const body: Problem = ProblemSchema.parse({
      title: TITLES[status] ?? 'Error',
      status,
      code: ERROR_CODES.includes(code) ? code : 'INTERNAL',
      ...(detail ? { detail } : {}),
      ...(fields ? { fields } : {}),
    });
    void reply.code(status).header('content-type', 'application/problem+json').send(body);
  }
}
