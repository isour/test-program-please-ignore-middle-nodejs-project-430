import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Независимый от ApiError класс ошибок валидации (по образцу задания):
 * класс объявлен здесь ровно один раз и импортируется отсюда и обработчиком,
 * и будущими валидаторами — иначе `instanceof` не сработает.
 */
export class ValidationError extends Error {
  readonly status = 400;
  readonly code = 'validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Ошибка контракта API: понятный статус и машинный код в ответе. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, 'not_found', message);
  }
}

/** Коды контракта для ошибок, сгенерированных фреймворком/статикой. */
export const FRAMEWORK_CODES: Record<number, string> = {
  400: 'validation_error',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  415: 'validation_error',
};

/**
 * Единственный обработчик ошибок Fastify (try/catch в маршрутах не нужен),
 * четыре ветки контракта: ValidationError → ApiError → 4xx фреймворка → 5xx.
 */
export function apiErrorHandler(
  error: FastifyError | ValidationError | ApiError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ValidationError) {
    reply.code(400).send({ code: 'validation_error', message: error.message });
    return;
  }

  if (error instanceof ApiError) {
    reply.code(error.status).send({ code: error.code, message: error.message });
    return;
  }

  const status = error.statusCode;
  if (typeof status === 'number' && status >= 400 && status <= 499) {
    reply.code(status).send({
      code: FRAMEWORK_CODES[status] ?? 'bad_request',
      message: error.message,
    });
    return;
  }

  request.log.error(error);
  reply.code(500).send({
    code: 'internal_error',
    message: 'Внутренняя ошибка сервера',
  });
}
