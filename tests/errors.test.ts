import test from 'node:test';
import assert from 'node:assert/strict';
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

test('ValidationError → 400 validation_error', () => {
  const result = callHandler(new ValidationError('bad payload'));

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { code: 'validation_error', message: 'bad payload' });
});

test('ApiError.notFound → 404 not_found', () => {
  const result = callHandler(ApiError.notFound('City not found'));

  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, { code: 'not_found', message: 'City not found' });
});

test('framework 4xx keeps status and maps code from table', () => {
  const badRequest = callHandler(
    Object.assign(new Error('Malformed JSON'), { statusCode: 400 }),
  );
  assert.equal(badRequest.statusCode, 400);
  assert.deepEqual(badRequest.body, { code: 'validation_error', message: 'Malformed JSON' });

  const forbidden = callHandler(
    Object.assign(new Error('Forbidden path'), { statusCode: 403 }),
  );
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(forbidden.body, { code: 'forbidden', message: 'Forbidden path' });

  const methodNotAllowed = callHandler(
    Object.assign(new Error('Method'), { statusCode: 405 }),
  );
  assert.equal(methodNotAllowed.statusCode, 405);
  assert.equal(
    (methodNotAllowed.body as { code: string }).code,
    'method_not_allowed',
  );
});

test('5xx → internal_error without details, full error goes to log', () => {
  const boom = new Error('secret connection string leaked');
  const result = callHandler(boom);

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, {
    code: 'internal_error',
    message: 'Внутренняя ошибка сервера',
  });
  assert.equal(result.logged, true);
  assert.ok(!(JSON.stringify(result.body) as string).includes('secret'));
});
