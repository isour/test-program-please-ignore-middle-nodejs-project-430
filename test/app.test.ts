import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';

test('GET /api/health returns ok', async () => {
  const app = await buildApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});
