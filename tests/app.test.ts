import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';

// Фикстура public/index.html: тесты не flaky — работают и до `make build`,
// и после (собранная статика не трогается).
const publicDir = path.join(process.cwd(), 'public');
const indexPath = path.join(publicDir, 'index.html');
let createdDir = false;
let createdIndex = false;
let app: FastifyInstance;

before(async () => {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    createdDir = true;
  }
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      '<!doctype html><html><body>fixture index</body></html>',
    );
    createdIndex = true;
  }
  app = await buildApp();
});

after(async () => {
  await app.close();
  if (createdIndex && fs.existsSync(indexPath)) {
    fs.rmSync(indexPath);
  }
  if (createdDir && fs.existsSync(publicDir)) {
    try {
      fs.rmdirSync(publicDir); // пустой — удаляем; собранная статика остаётся
    } catch {
      // не пустой — оставляем
    }
  }
});

test('GET /api/cities returns empty array', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/cities' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);
});

test('unknown /api/... returns JSON 404', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/nope' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    code: 'not_found',
    message: 'Unknown endpoint',
  });
});

test('GET / serves index.html', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/html/);
  assert.match(response.body, /<html/i);
});

test('SPA-fallback: GET /booking/1 serves index.html', async () => {
  const response = await app.inject({ method: 'GET', url: '/booking/1' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /text\/html/);
});

test('GET /api/health returns ok', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});
