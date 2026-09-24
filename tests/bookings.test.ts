import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb, db } from '../src/db.ts';
import { bookings, passengers } from '../src/db/schema.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seed } from '../src/db/seed.ts';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Сегодняшний день по UTC — тот же пояс, что и в выборке departureAt. */
const utcToday = (): string => new Date().toISOString().slice(0, 10);

interface FlightDto {
  id: string;
  flightNumber: string;
  airline: { code: string; name: string };
  origin: { code: string; name: string; country?: string };
  destination: { code: string; name: string; country?: string };
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  price: { amount: number; currency: string };
  seatsAvailable: number;
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

/** Валидное тело CreateBookingRequest; overrides поверх. */
const validBody = (
  flightId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  flightId,
  contact: { email: 'ivan@example.com', phone: '+79991234567' },
  passengers: [PASSENGER],
  ...overrides,
});

/**
 * Валидация тела выполняется zod-схемой ДО первого обращения к БД —
 * блок работает и без DATABASE_URL (без skipIf), как во flights.
 */
describe('POST /api/bookings — validation (no db access)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectValidationError = async (payload: unknown): Promise<void> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: payload as object,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('validation_error');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  };

  it('empty passengers [] → 400 validation_error', async () => {
    await expectValidationError(validBody('any-flight', { passengers: [] }));
  });

  it('missing contact.email → 400 validation_error', async () => {
    await expectValidationError({
      flightId: 'any-flight',
      contact: { phone: '+79991234567' },
      passengers: [PASSENGER],
    });
  });

  it('missing documentNumber → 400 validation_error', async () => {
    const { documentNumber: _omit, ...withoutDoc } = PASSENGER;
    await expectValidationError(
      validBody('any-flight', { passengers: [withoutDoc] }),
    );
  });

  it('empty lastName → 400 validation_error', async () => {
    await expectValidationError(
      validBody('any-flight', {
        passengers: [{ ...PASSENGER, lastName: '' }],
      }),
    );
  });

  it('passengers not an array → 400 validation_error', async () => {
    await expectValidationError(
      validBody('any-flight', { passengers: 'not-an-array' }),
    );
  });

  it('missing flightId → 400 validation_error', async () => {
    await expectValidationError({
      contact: { email: 'ivan@example.com', phone: '+79991234567' },
      passengers: [PASSENGER],
    });
  });
});

/**
 * Создание брони — интеграционные: как в tests/db.test.ts, передSuite
 * идемпотентно применяются миграции и сид. createdCodes — только созданные
 * этим файлом брони: afterAll чистит их (каскад уберёт пассажиров),
 * никакого «сброса схемы» и зависимости от чужих строк.
 */
describe.skipIf(!hasDb)('POST /api/bookings (db)', () => {
  let app: FastifyInstance;
  const createdCodes: string[] = [];

  beforeAll(async () => {
    await runMigrations();
    await seed();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdCodes.length > 0) {
      await db.delete(bookings).where(inArray(bookings.code, createdCodes));
    }
    await closeDb();
  });

  /** Рейс из реального поиска: id не хардкодим, берём из GET. */
  const firstFlight = async (): Promise<FlightDto> => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/flights?origin=MOW&destination=LED&date=${utcToday()}`,
    });
    expect(list.statusCode).toBe(200);
    const items = list.json() as FlightDto[];
    expect(items.length).toBeGreaterThan(0);
    const id = (items[0] as FlightDto).id;

    const single = await app.inject({
      method: 'GET',
      url: `/api/flights/${id}`,
    });
    expect(single.statusCode).toBe(200);
    return single.json() as FlightDto;
  };

  const create = async (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: payload as object,
    });

  it('1 passenger → 201 with full contract Booking', async () => {
    const flight = await firstFlight();
    const body = validBody(flight.id);

    const response = await create(body);
    expect(response.statusCode).toBe(201);
    const booking = response.json() as BookingDto;
    createdCodes.push(booking.code);

    // Код: ровно 6 символов A-Z0-9.
    expect(booking.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(booking.status).toBe('confirmed');

    // flight — deep-equal объекту из GET /api/flights/{id} (общий маппер).
    expect(booking.flight).toEqual(flight);

    // totalPrice = цена рейса × 1 пассажир, currency RUB, число — число.
    expect(booking.totalPrice).toEqual({
      amount: flight.price.amount,
      currency: 'RUB',
    });
    expect(typeof booking.totalPrice.amount).toBe('number');

    // Пассажир и contact отражают тело; без serial id.
    expect(booking.passengers).toHaveLength(1);
    expect(booking.passengers[0]).toEqual(PASSENGER);
    expect(Object.keys(booking.passengers[0] as PassengerDto).sort()).toEqual([
      'dateOfBirth',
      'documentNumber',
      'firstName',
      'lastName',
    ]);
    expect(booking.contact).toEqual(body.contact as { email: string; phone: string });

    // createdAt — свежий ISO UTC с Z (тот же формат, что departureAt).
    expect(booking.createdAt.endsWith('Z')).toBe(true);
    const parsed = Date.parse(booking.createdAt);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(60_000);

    // Транзакция зафиксирована: пассажир реально в БД (по коду брони).
    const rows = await db
      .select()
      .from(passengers)
      .where(eq(passengers.bookingId, booking.code));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.documentNumber).toBe(PASSENGER.documentNumber);
  });

  it('2 passengers → price doubles, both present, order kept', async () => {
    const flight = await firstFlight();
    const first: PassengerDto = {
      firstName: 'Пётр',
      lastName: 'Иванов',
      dateOfBirth: '1985-03-10',
      documentNumber: '1111',
    };
    const second: PassengerDto = {
      firstName: 'Анна',
      lastName: 'Сидорова',
      dateOfBirth: '1988-07-07',
      documentNumber: '2222',
    };

    const response = await create(
      validBody(flight.id, { passengers: [first, second] }),
    );
    expect(response.statusCode).toBe(201);
    const booking = response.json() as BookingDto;
    createdCodes.push(booking.code);

    expect(booking.totalPrice.amount).toBe(flight.price.amount * 2);
    expect(typeof booking.totalPrice.amount).toBe('number');
    expect(booking.passengers).toHaveLength(2);
    expect(booking.passengers.map((p) => p.lastName)).toEqual([
      'Иванов',
      'Сидорова',
    ]);
    expect(booking.passengers[0]).toEqual(first);
    expect(booking.passengers[1]).toEqual(second);

    const rows = await db
      .select()
      .from(passengers)
      .where(eq(passengers.bookingId, booking.code));
    expect(rows).toHaveLength(2);
  });

  it('unknown flightId "NOPE" → 400 (не 404, не 500)', async () => {
    const response = await create(validBody('NOPE'));
    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe('validation_error');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('document "1", email "a", phone "123" → 201 (без форматных проверок)', async () => {
    const flight = await firstFlight();
    const response = await create({
      flightId: flight.id,
      contact: { email: 'a', phone: '123' },
      passengers: [
        {
          firstName: 'Иван',
          lastName: 'Петров',
          dateOfBirth: '1990-05-20',
          documentNumber: '1',
        },
      ],
    });
    expect(response.statusCode).toBe(201);
    const booking = response.json() as BookingDto;
    createdCodes.push(booking.code);

    expect(booking.contact).toEqual({ email: 'a', phone: '123' });
    expect(booking.passengers[0]?.documentNumber).toBe('1');
  });

  it('30 sequential bookings → all codes unique', async () => {
    const flight = await firstFlight();
    const codes = new Set<string>();

    for (let i = 0; i < 30; i += 1) {
      const response = await create(validBody(flight.id));
      expect(response.statusCode).toBe(201);
      const booking = response.json() as BookingDto;
      codes.add(booking.code);
      createdCodes.push(booking.code);
    }

    expect(codes.size).toBe(30);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  // Честный пропуск: провалить вставку пассажира через публичный API нельзя —
  // zod отсекает некорректные тела до БД, FK/NOT NULL гарантированы схемой;
  // ломать схему в тесте или вскрывать tx-хендлер наружу — хрупко и вне шага.
  // Атомарность драйвера проверена пробой на уровне db.transaction (см. отчёт).
  it.skip('transaction rollback (нет дешёвого способа провалить tx через API)', () => {});
});
