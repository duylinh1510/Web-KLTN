import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Lỗi máy chủ nội bộ';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const m = (body as any).message;
        message = Array.isArray(m) ? m : (m ?? exception.message);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logger.error(
      `[${statusCode}] ${Array.isArray(message) ? message.join('; ') : message}`,
    );

    response.status(statusCode).json({
      status: 'error',
      message,
      statusCode,
    });
  }
}
