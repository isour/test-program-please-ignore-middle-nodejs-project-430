import { afterAll, beforeAll, expect, it } from 'vitest';
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

beforeAll(async () => {
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

afterAll(async () => {
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

it('GET /api/cities returns empty array', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/cities' });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual([]);
});

it('unknown /api/... returns JSON 404', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/nope' });

  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({
    code: 'not_found',
    message: 'Unknown endpoint',
  });
});

it('GET / serves index.html', async () => {
  const response = await app.inject({ method: 'GET', url: '/' });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/text\/html/);
  expect(response.body).toMatch(/<html/i);
});

it('SPA-fallback: GET /booking/1 serves index.html', async () => {
  const response = await app.inject({ method: 'GET', url: '/booking/1' });

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type'] ?? '').toMatch(/text\/html/);
});

it('GET /api/health returns ok', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok' });
});
