import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb, db } from '../src/db.ts';
import { bookings } from '../src/db/schema.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seed } from '../src/db/seed.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Единый отказ lookup/cancel — сверяем байт-в-байт с эталоном из src. */
const NOT_FOUND_BODY = {
  code: 'not_found',
  message: 'Бронирование не найдено',
};

const utcToday = (): string => new Date().toISOString().slice(0, 10);

interface FlightDto {
  id: string;
  price: { amount: number; currency: string };
  [key: string]: unknown;
}

interface PassengerDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentNumber: string;
}

interface BookingDto {
  code: string;
  status: string;
  flight: FlightDto;
  passengers: PassengerDto[];
  contact: { email: string; phone: string };
  totalPrice: { amount: number; currency: string };
  createdAt: string;
}

const PASSENGER: PassengerDto = {
  firstName: 'Иван',
  lastName: 'Петров',
  dateOfBirth: '1990-05-20',
  documentNumber: '4509 123456',
};

const createBody = (flightId: string): Record<string, unknown> => ({
  flightId,
  contact: { email: 'ivan@example.com', phone: '+79991234567' },
  passengers: [PASSENGER],
});

/**
 * Дешёвые 404-ДО-БД: пустой/отсутствующий lastName проверяется до первого
 * запроса к базе — блок работает и без DATABASE_URL (без skipIf).
 */
describe('booking lookup/cancel — cheap 404 before db access', () => {
  let app: FastifyInstance;
  let getWithoutLastName: { statusCode: number; body: unknown };

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET without lastName → 404 not_found (не 500, без БД)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings/ABC123',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND_BODY);
    getWithoutLastName = {
      statusCode: response.statusCode,
      body: response.json(),
    };
  });

  it('GET with empty lastName= → 404, body identical to missing-param case', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings/ABC123?lastName=',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND_BODY);
    // Строгая идентичность: тот же code и та же строка message.
    expect(response.json()).toEqual(getWithoutLastName.body);
  });

  it('cancel without lastName field → 404, body identical to GET 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings/ABC123/cancel',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND_BODY);
    expect(response.json()).toEqual(getWithoutLastName.body);
  });

  it('cancel with whitespace-only lastName → 404, same body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings/ABC123/cancel',
      payload: { lastName: '   ' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND_BODY);
    expect(response.json()).toEqual(getWithoutLastName.body);
  });
});

/**
 * Lookup/cancel — интеграционные: паттерн tests/db.test.ts (skipIf +
 * migrate/seed в beforeAll). Брони создаются здесь и удаляются по кодам
 * в afterAll; мусор из ручных прогонов (~32 брони) не трогаем и на него
 * не завязываемся.
 */
describe.skipIf(!hasDb)('GET/POST /api/bookings/{code} (db)', () => {
  let app: FastifyInstance;
  const createdCodes: string[] = [];

  /** Бронь для lookup-цепочки (остаётся confirmed). */
  let lookupBooking: BookingDto;
  /** Бронь для cancel-цепочки (будет отменена). */
  let cancelBooking: BookingDto;
  /** Бронь для проверки «неверная фамилия не меняет статус». */
  let guardedBooking: BookingDto;

  const firstFlightId = async (): Promise<string> => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/flights?origin=MOW&destination=LED&date=${utcToday()}`,
    });
    expect(list.statusCode).toBe(200);
    const items = list.json() as FlightDto[];
    expect(items.length).toBeGreaterThan(0);
    return (items[0] as FlightDto).id as string;
  };

  const createBooking = async (flightId: string): Promise<BookingDto> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: createBody(flightId),
    });
    expect(response.statusCode).toBe(201);
    const booking = response.json() as BookingDto;
    createdCodes.push(booking.code);
    return booking;
  };

  const lookup = async (code: string, lastName?: string) =>
    app.inject({
      method: 'GET',
      url:
        lastName === undefined
          ? `/api/bookings/${code}`
          : `/api/bookings/${code}?lastName=${encodeURIComponent(lastName)}`,
    });

  const cancel = async (code: string, payload?: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/bookings/${code}/cancel`,
      payload: payload as object,
    });

  beforeAll(async () => {
    await runMigrations();
    await seed();
    app = await buildApp();

    const flightId = await firstFlightId();
    lookupBooking = await createBooking(flightId);
    cancelBooking = await createBooking(flightId);
    guardedBooking = await createBooking(flightId);
  });

  afterAll(async () => {
    await app.close();
    if (createdCodes.length > 0) {
      await db.delete(bookings).where(inArray(bookings.code, createdCodes));
    }
    await closeDb();
  });

  it('exact surname → 200, deep-equal to POST /api/bookings response', async () => {
    const response = await lookup(lookupBooking.code, 'Петров');

    expect(response.statusCode).toBe(200);
    const body = response.json() as BookingDto;
    expect(body).toEqual(lookupBooking);
    expect(body.status).toBe('confirmed');
    expect(typeof body.totalPrice.amount).toBe('number');
    expect(body.createdAt.endsWith('Z')).toBe(true);
  });

  it('surname in different case with outer spaces ("  пЕтРОВ ") → 200', async () => {
    const response = await lookup(lookupBooking.code, '  пЕтРОВ ');

    expect(response.statusCode).toBe(200);
    expect((response.json() as BookingDto).code).toBe(lookupBooking.code);
  });

  it('wrong code / wrong surname / missing lastName → identical 404 bodies', async () => {
    const wrongCode = await lookup('ZZZZZZ', 'Петров');
    const wrongSurname = await lookup(lookupBooking.code, 'Иванов');
    const noLastName = await lookup(lookupBooking.code);

    expect(wrongCode.statusCode).toBe(404);
    expect(wrongSurname.statusCode).toBe(404);
    expect(noLastName.statusCode).toBe(404);

    expect(wrongCode.json()).toEqual(NOT_FOUND_BODY);
    // Строгая идентичность трёх отказов: одинаковые code и message.
    expect(wrongSurname.json()).toEqual(wrongCode.json());
    expect(noLastName.json()).toEqual(wrongCode.json());
  });

  it('code in lowercase (abc… → ABC…) → 200', async () => {
    const response = await lookup(
      lookupBooking.code.toLowerCase(),
      'Петров',
    );

    expect(response.statusCode).toBe(200);
    expect((response.json() as BookingDto).code).toBe(lookupBooking.code);
  });

  it('cancel → 200 cancelled; GET afterwards → 200 cancelled', async () => {
    const cancelled = await cancel(cancelBooking.code, {
      lastName: 'Петров',
    });
    expect(cancelled.statusCode).toBe(200);
    const body = cancelled.json() as BookingDto;
    expect(body.status).toBe('cancelled');
    // Ответ собирается общим toBookingDto — форма как у create.
    expect(body.flight).toEqual(cancelBooking.flight);
    expect(body.totalPrice).toEqual(cancelBooking.totalPrice);
    expect(body.passengers).toEqual(cancelBooking.passengers);
    expect(body.contact).toEqual(cancelBooking.contact);
    expect(body.createdAt).toBe(cancelBooking.createdAt);

    const after = await lookup(cancelBooking.code, 'Петров');
    expect(after.statusCode).toBe(200);
    expect((after.json() as BookingDto).status).toBe('cancelled');
  });

  it('repeat cancel → 200 cancelled (идемпотентно)', async () => {
    const again = await cancel(cancelBooking.code, { lastName: 'Петров' });

    expect(again.statusCode).toBe(200);
    expect((again.json() as BookingDto).status).toBe('cancelled');
    expect((again.json() as BookingDto).code).toBe(cancelBooking.code);
  });

  it('cancel with wrong surname → 404 and status stays confirmed', async () => {
    const denied = await cancel(guardedBooking.code, { lastName: 'Иванов' });

    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toEqual(NOT_FOUND_BODY);

    const still = await lookup(guardedBooking.code, 'Петров');
    expect(still.statusCode).toBe(200);
    expect((still.json() as BookingDto).status).toBe('confirmed');
  });
});
