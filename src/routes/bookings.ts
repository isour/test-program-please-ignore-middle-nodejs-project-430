import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import { bookings, flights, passengers } from '../db/schema.ts';
import { ValidationError } from '../errors.ts';
import {
  flightsQuery,
  toFlightDto,
  toIsoUtc,
  type FlightDto,
} from './flights.ts';

/**
 * Пассажир в ответе (контракт): ровно модель, без serial id из БД.
 * Порядок в ответе = порядок вставки (эхо из проверенного тела).
 */
interface PassengerDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentNumber: string;
}

/** Booking по contract/main.tsp. */
interface BookingDto {
  code: string;
  status: 'confirmed' | 'cancelled';
  flight: FlightDto;
  passengers: PassengerDto[];
  contact: { email: string; phone: string };
  totalPrice: { amount: number; currency: 'RUB' };
  createdAt: string;
}

/* ————————————————————————— Валидация тела ————————————————————————— */

/**
 * Непустая строка после trim. Формат НЕ проверяется: документ "1",
 * email "a" и телефон "123" обязаны проходить (контракт — только «присутствует
 * и не пусто»). Никаких regex на паспорт/телефон/email.
 */
const nonEmptyTrimmed = (field: string) =>
  z
    .string({ error: `${field} обязателен` })
    .trim()
    .min(1, `${field} не должен быть пустым`);

const passengerSchema = z.object({
  firstName: nonEmptyTrimmed('passengers[].firstName'),
  lastName: nonEmptyTrimmed('passengers[].lastName'),
  // Формат даты контрактом не проверяется — только непустота (trim — не формат).
  dateOfBirth: nonEmptyTrimmed('passengers[].dateOfBirth'),
  documentNumber: nonEmptyTrimmed('passengers[].documentNumber'),
});

const createBookingSchema = z.object({
  flightId: nonEmptyTrimmed('flightId'),
  contact: z.object({
    email: nonEmptyTrimmed('contact.email'),
    phone: nonEmptyTrimmed('contact.phone'),
  }),
  passengers: z
    .array(passengerSchema, { error: 'passengers должен быть массивом' })
    .min(1, 'passengers: минимум один пассажир'),
});

type CreateBookingBody = z.infer<typeof createBookingSchema>;

/**
 * Валидация тела выполняется zod'ом ДО первого обращения к БД — тесты
 * 400-кейсов проходят и без DATABASE_URL. Бросаем только ValidationError
 * из src/errors.ts (иначе instanceof в apiErrorHandler не сработает → 500).
 */
function parseCreateBookingBody(body: unknown): CreateBookingBody {
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(issue?.message ?? 'Некорректное тело запроса');
  }
  return parsed.data;
}

/* ————————————————————————— Код брони ————————————————————————— */

const BOOKING_CODE_LENGTH = 6;
/** Контракт: ровно [A-Z0-9]; алфавит не сокращаем (подсказка про 0O1I — не требование). */
const BOOKING_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Повторов вставки при unique_violation (гонку SELECT-проверка не закрывает). */
const CODE_INSERT_ATTEMPTS = 5;
const UNIQUE_VIOLATION = '23505';

/** Крипто-стойкий код: node:crypto randomInt, без Math.random. */
function generateBookingCode(): string {
  let code = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i += 1) {
    code += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * SQLSTATE драйвера. drizzle оборачивает PostgresError в DrizzleQueryError,
 * код SQLSTATE живёт в error.cause.code; прямой code — подстраховка на случай
 * проброса ошибки без обёртки.
 */
function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
}

interface InsertedBooking {
  code: string;
  createdAt: string;
}

/**
 * Вставка брони + всех пассажиров одной транзакцией (drizzle + postgres.js:
 * client.begin — при throw внутри колбэка postgres.js делает ROLLBACK, что
 * подтверждено пробой). Уникальность кода гарантирует БД: при 23505 код
 * регенерируем и повторяем вставку (до 5 раз); коллизия происходит на первом
 * INSERT, пассажиры ещё не записаны — повторный tx безопасен.
 */
async function insertBookingWithUniqueCode(
  body: CreateBookingBody,
  totalPrice: number,
): Promise<InsertedBooking> {
  let lastCollision: unknown;
  for (let attempt = 0; attempt < CODE_INSERT_ATTEMPTS; attempt += 1) {
    const code = generateBookingCode();
    try {
      return await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(bookings)
          .values({
            code,
            status: 'confirmed',
            flightId: body.flightId,
            totalPrice,
            email: body.contact.email,
            phone: body.contact.phone,
            // Вставляем момент создания явно: RETURNING отдаёт его в формате
            // 'YYYY-MM-DD HH:MM:SS.mmm+00', toIsoUtc нормализует к …Z.
            createdAt: new Date().toISOString(),
          })
          .returning({
            code: bookings.code,
            createdAt: bookings.createdAt,
          });
        if (!inserted) {
          throw new Error('insert into bookings returned no row');
        }

        await tx.insert(passengers).values(
          body.passengers.map((passenger) => ({
            bookingId: code,
            firstName: passenger.firstName,
            lastName: passenger.lastName,
            dateOfBirth: passenger.dateOfBirth,
            documentNumber: passenger.documentNumber,
          })),
        );

        return inserted;
      });
    } catch (error) {
      if (postgresErrorCode(error) !== UNIQUE_VIOLATION) {
        throw error;
      }
      lastCollision = error;
    }
  }
  throw lastCollision;
}

/* ————————————————————————— Маршрут ————————————————————————— */

export function registerBookingRoutes(app: FastifyInstance): void {
  // Оформление брони: POST /api/bookings → 201 Booking | 400 validation_error.
  // Неизвестный flightId — 400 (в отличие от GET /api/flights/{id}, где 404).
  app.post('/api/bookings', async (request, reply) => {
    const body = parseCreateBookingBody(request.body);

    // Явный SELECT до вставки: existence-проверка И цена для ответа — один запрос
    // (тот же shared join, что и в поиске; второй маппер рейса запрещён).
    const [flightRow] = await flightsQuery()
      .where(eq(flights.id, body.flightId))
      .limit(1);
    if (!flightRow) {
      throw new ValidationError('flightId не указывает на существующий рейс');
    }
    const flight = toFlightDto(flightRow);

    // Цена на момент создания: цена рейса × число пассажиров (integer).
    const totalPrice = flight.price.amount * body.passengers.length;

    const inserted = await insertBookingWithUniqueCode(body, totalPrice);

    reply.code(201);
    const booking: BookingDto = {
      code: inserted.code,
      status: 'confirmed',
      flight,
      // Эхо проверенного тела: порядок вставки детерминирован, без serial id.
      passengers: body.passengers,
      contact: { email: body.contact.email, phone: body.contact.phone },
      totalPrice: { amount: totalPrice, currency: 'RUB' },
      createdAt: toIsoUtc(inserted.createdAt),
    };
    return booking;
  });
}
