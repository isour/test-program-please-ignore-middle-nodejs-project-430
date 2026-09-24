import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb } from '../src/db.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seed } from '../src/db/seed.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

interface CityDto {
  code: string;
  name: string;
  country?: string;
}

/**
 * Интеграционные тесты на БД. Без DATABASE_URL (локально по умолчанию)
 * блок целиком пропускается — `make test` остаётся зелёным.
 * С поднятым docker compose и DATABASE_URL проходят целиком.
 */
describe.skipIf(!hasDb)('database-backed endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Идемпотентно: повторный запуск миграций/сида не ломает тесты.
    await runMigrations();
    await seed();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('GET /api/cities returns cities from DB ordered by sort_order', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/cities' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as CityDto[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(7);

    // Фронтенд берёт первые два города в форму — они обязаны быть MOW и LED.
    expect(body[0]).toEqual({ code: 'MOW', name: 'Москва', country: 'Россия' });
    expect(body[1]).toEqual({ code: 'LED', name: 'Санкт-Петербург', country: 'Россия' });

    for (const city of body) {
      expect(typeof city.code).toBe('string');
      expect(typeof city.name).toBe('string');
      expect(typeof city.country).toBe('string');
    }
  });
});
