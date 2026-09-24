import { expect, it } from 'vitest';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { apiErrorHandler, ApiError, ValidationError } from '../src/errors.ts';

interface StubReply {
  code(status: number): StubReply;
  send(payload: unknown): StubReply;
}

function callHandler(error: unknown) {
  const state = { statusCode: 0, body: undefined as unknown };
  let logged = false;
  const reply: StubReply = {
    code(status) {
      state.statusCode = status;
      return reply;
    },
    send(payload) {
      state.body = payload;
      return reply;
    },
  };
  const request = {
    log: {
      error() {
        logged = true;
      },
    },
  } as unknown as FastifyRequest;

  apiErrorHandler(error as FastifyError, request, reply as unknown as FastifyReply);
  return { ...state, logged };
}

it('ValidationError → 400 validation_error', () => {
  const result = callHandler(new ValidationError('bad payload'));

  expect(result.statusCode).toBe(400);
  expect(result.body).toEqual({ code: 'validation_error', message: 'bad payload' });
});

it('ApiError.notFound → 404 not_found', () => {
  const result = callHandler(ApiError.notFound('City not found'));

  expect(result.statusCode).toBe(404);
  expect(result.body).toEqual({ code: 'not_found', message: 'City not found' });
});

it('framework 4xx keeps status and maps code from table', () => {
  const badRequest = callHandler(
    Object.assign(new Error('Malformed JSON'), { statusCode: 400 }),
  );
  expect(badRequest.statusCode).toBe(400);
  expect(badRequest.body).toEqual({
    code: 'validation_error',
    message: 'Malformed JSON',
  });

  const forbidden = callHandler(
    Object.assign(new Error('Forbidden path'), { statusCode: 403 }),
  );
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.body).toEqual({ code: 'forbidden', message: 'Forbidden path' });

  const methodNotAllowed = callHandler(
    Object.assign(new Error('Method'), { statusCode: 405 }),
  );
  expect(methodNotAllowed.statusCode).toBe(405);
  expect((methodNotAllowed.body as { code: string }).code).toBe('method_not_allowed');
});

it('5xx → internal_error without details, full error goes to log', () => {
  const boom = new Error('secret connection string leaked');
  const result = callHandler(boom);

  expect(result.statusCode).toBe(500);
  expect(result.body).toEqual({
    code: 'internal_error',
    message: 'Внутренняя ошибка сервера',
  });
  expect(result.logged).toBe(true);
  expect(JSON.stringify(result.body)).not.toContain('secret');
});
