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

interface FlightDto {
  id: string;
  flightNumber: string;
  airline: { code: string; name: string };
  origin: CityDto;
  destination: CityDto;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  price: { amount: number; currency: string };
  seatsAvailable: number;
}

/** Сегодняшний день по UTC — тот же пояс, что и в выборке departureAt. */
const utcToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * Валидация query выполняется zod-схемой ДО первого обращения к БД,
 * поэтому блок работает и без DATABASE_URL (без skipIf).
 */
describe('GET /api/flights — validation (no db access)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectValidationError = async (query: string): Promise<void> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/flights?${query}`,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('validation_error');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  };

  it('missing date → 400 validation_error with non-empty message', async () => {
    await expectValidationError('origin=MOW&destination=LED');
  });

  it('garbage date → 400 (2026-13-99, abc)', async () => {
    await expectValidationError('origin=MOW&destination=LED&date=2026-13-99');
    await expectValidationError('origin=MOW&destination=LED&date=abc');
  });

  it('bad passengers → 400 (abc, 0, -2)', async () => {
    for (const passengers of ['abc', '0', '-2']) {
      await expectValidationError(
        `origin=MOW&destination=LED&date=${utcToday()}&passengers=${passengers}`,
      );
    }
  });
});

/**
 * Поиск и рейс по id — интеграционные: как в tests/db.test.ts,
 * передSuite идемпотентно применяются миграции и сид.
 */
describe.skipIf(!hasDb)('GET /api/flights — search (db)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    await seed();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  const search = async (params: string): Promise<FlightDto[]> => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/flights?${params}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json() as FlightDto[];
  };

  it('MOW→LED today: 200 with >=2 flights and full contract shape', async () => {
    const date = utcToday();
    const list = await search(`origin=MOW&destination=LED&date=${date}`);

    expect(list.length).toBeGreaterThanOrEqual(2);

    // Стабильный порядок — по времени вылета.
    const departures = list.map((flight) => flight.departureAt);
    expect([...departures].sort()).toEqual(departures);

    for (const flight of list) {
      expect(flight.origin).toEqual({
        code: 'MOW',
        name: 'Москва',
        country: 'Россия',
      });
      expect(flight.destination).toEqual({
        code: 'LED',
        name: 'Санкт-Петербург',
        country: 'Россия',
      });
      expect(typeof flight.airline.code).toBe('string');
      expect(flight.airline.name.length).toBeGreaterThan(0);
      expect(flight.flightNumber.length).toBeGreaterThan(0);
      expect(typeof flight.id).toBe('string');

      // День вылета в том же поясе, что и ответ (UTC): нет сдвига дня.
      expect(flight.departureAt.startsWith(date)).toBe(true);
      expect(flight.departureAt.endsWith('Z')).toBe(true);
      expect(flight.arrivalAt.endsWith('Z')).toBe(true);

      // Числа — числа, а не строки.
      expect(typeof flight.durationMinutes).toBe('number');
      expect(typeof flight.price.amount).toBe('number');
      expect(typeof flight.seatsAvailable).toBe('number');
      expect(flight.price.currency).toBe('RUB');
      expect(flight.durationMinutes).toBeGreaterThan(0);
      expect(flight.price.amount).toBeGreaterThan(0);
      expect(flight.seatsAvailable).toBeGreaterThanOrEqual(1);
    }
  });

  it('empty results are 200 []: origin==destination and unknown city', async () => {
    const date = utcToday();

    expect(await search(`origin=MOW&destination=MOW&date=${date}`)).toEqual([]);
    expect(await search(`origin=XXX&destination=LED&date=${date}`)).toEqual([]);
  });

  it('seats filter: passengers=50 non-empty subset of passengers=1', async () => {
    // Места в сиде 10..90 — ищем первый день, где на MOW→LED есть >= 50,
    // чтобы проверка была содержательной, а не пустым равенством [].
    let date = '';
    let all: FlightDto[] = [];
    for (let offset = 0; offset < 14; offset++) {
      const candidate = new Date(
        Date.now() + offset * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
      const list = await search(`origin=MOW&destination=LED&date=${candidate}`);
      if (list.some((flight) => flight.seatsAvailable >= 50)) {
        date = candidate;
        all = list;
        break;
      }
    }
    expect(date).not.toBe('');

    const filtered = await search(
      `origin=MOW&destination=LED&date=${date}&passengers=50`,
    );

    expect(filtered.length).toBeGreaterThan(0);
    for (const flight of filtered) {
      expect(flight.seatsAvailable).toBeGreaterThanOrEqual(50);
    }

    // Подмножество выборки без фильтра + порядок сохранён.
    const allIds = new Set(all.map((flight) => flight.id));
    for (const flight of filtered) {
      expect(allIds.has(flight.id)).toBe(true);
    }
    const filteredDepartures = filtered.map((flight) => flight.departureAt);
    expect([...filteredDepartures].sort()).toEqual(filteredDepartures);
  });

  it('GET /api/flights/{id}: 200, deep-equal to the search item', async () => {
    const date = utcToday();
    const list = await search(`origin=MOW&destination=LED&date=${date}`);
    const first = list[0] as FlightDto;
    expect(typeof first.id).toBe('string');

    const response = await app.inject({
      method: 'GET',
      url: `/api/flights/${first.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(first);
  });

  it('unknown flight id → 404 not_found «Рейс не найден»', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/flights/NOPE',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'not_found',
      message: 'Рейс не найден',
    });
  });
});
