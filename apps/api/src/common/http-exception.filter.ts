import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Catches everything Nest's default handler would otherwise leak straight to
 * the client (stack traces, Prisma error internals, etc.) and returns a
 * consistent { statusCode, message } shape instead. Known HttpExceptions
 * keep their own status/message; anything else becomes a generic 500 with
 * the real error logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const suppliedCorrelationId = request.headers['x-correlation-id'];
    const correlationId =
      typeof suppliedCorrelationId === 'string' &&
      /^[a-zA-Z0-9._-]{8,128}$/.test(suppliedCorrelationId)
        ? suppliedCorrelationId
        : randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = this.publicMessage(body, status);
      this.log(exception, request, correlationId, status);
      response.status(status).json({ statusCode: status, message, correlationId });
      return;
    }

    this.log(exception, request, correlationId, HttpStatus.INTERNAL_SERVER_ERROR);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      correlationId,
    });
  }

  private publicMessage(body: string | object, status: number): string | string[] {
    if (status >= 500) return 'Internal server error';
    if (typeof body === 'string') return body;
    if ('message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return message;
      }
    }
    return 'Request failed';
  }

  private log(
    exception: unknown,
    request: Request,
    correlationId: string,
    status: number,
  ): void {
    const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
    this.logger.error(
      JSON.stringify({
        correlationId,
        status,
        method: request.method,
        path: request.originalUrl,
        detail,
      }),
    );
  }
}
