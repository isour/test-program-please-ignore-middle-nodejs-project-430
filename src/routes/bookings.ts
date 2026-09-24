import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import { bookings, flights, passengers } from '../db/schema.ts';
import { ApiError, ValidationError } from '../errors.ts';
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

/** Строка bookings, как её отдаёт drizzle (SELECT/RETURNING). */
type BookingRow = typeof bookings.$inferSelect;

/** Строка passengers (без применения к ответу — id serial клиенту не нужен). */
type PassengerRow = typeof passengers.$inferSelect;

/**
 * ЕДИНЫЙ текст отказа lookup/cancel: неверный code, неверная фамилия,
 * отсутствующий/пустой lastName — всегда это же тело {code:'not_found',
 * message:…} (антипереборное требование контракта).
 */
const BOOKING_NOT_FOUND_MESSAGE = 'Бронирование не найдено';

function toPassengerDto(row: PassengerRow): PassengerDto {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    documentNumber: row.documentNumber,
  };
}

/**
 * ЕДИНСТВЕННАЯ точка сборки Booking-JSON (create/lookup/cancel обязаны
 * отдавать идентичную форму): flight — через общий toFlightDto, createdAt —
 * через общий toIsoUtc, пассажиры — без serial id, contact/totalPrice —
 * из самой строки брони (в create возвращённой INSERT … RETURNING).
 */
function toBookingDto(
  row: BookingRow,
  flight: FlightDto,
  passengerDtos: PassengerDto[],
): BookingDto {
  return {
    code: row.code,
    status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
    flight,
    passengers: passengerDtos,
    contact: { email: row.email, phone: row.phone },
    totalPrice: { amount: row.totalPrice, currency: 'RUB' },
    createdAt: toIsoUtc(row.createdAt),
  };
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

/**
 * Вставка брони + всех пассажиров одной транзакцией (drizzle + postgres.js:
 * client.begin — при throw внутри колбэка postgres.js делает ROLLBACK, что
 * подтверждено пробой). Уникальность кода гарантирует БД: при 23505 код
 * регенерируем и повторяем вставку (до 5 раз); коллизия происходит на первом
 * INSERT, пассажиры ещё не записаны — повторный tx безопасен.
 * Возвращает полную строку bookings (RETURNING) — её отдаёт toBookingDto.
 */
async function insertBookingWithUniqueCode(
  body: CreateBookingBody,
  totalPrice: number,
): Promise<BookingRow> {
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
          .returning();
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

/* ————————————————— Lookup и отмена (ШАГ 8) ————————————————— */

/**
 * Тело cancel: lastName — мягкая схема БЕЗ min/required. Любая zod-ошибка
 * (нет поля, не строка, тело не объект) ПРЕОБРАЗУЕТСЯ в тот же 404, что и
 * пустая строка — контракт запрещает 400 на этих отказах. Битый JSON и
 * пустое тело с content-type ловит фреймворк (FST_ERR_CTP_* → 400) ДО
 * хендлера — это неотделимо от парсинга и разрешено заданием.
 */
const cancelBodySchema = z.object({ lastName: z.string().trim() });

/** Отсутствующее/пустое/нестроковое lastName в теле cancel → единый 404. */
function parseCancelSurname(body: unknown): string {
  const parsed = cancelBodySchema.safeParse(body);
  const surname = parsed.success ? parsed.data.lastName.trim() : '';
  if (!surname) {
    throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
  }
  return surname;
}

/**
 * Дешёвый отказ ДО любых запросов к БД: отсутствующий/пустой lastName в
 * query GET → та же 404-строка (работает и без DATABASE_URL — тесты без
 * skipIf). zod-required тут запрещён: это «антипереборный» отказ, не 400.
 */
function requireSurname(raw: unknown): string {
  const surname = typeof raw === 'string' ? raw.trim() : '';
  if (!surname) {
    throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
  }
  return surname;
}

/**
 * Общий загрузчик брони для GET и cancel.
 * - код нормализуется к хранимому виду (A-Z0-9): trim + upper (`ab1234` → `AB1234`);
 * - фамилия сравнивается lower() НА СТОРОНЕ БД с любым пассажиром
 *   (в базе значения уже trim'нуты zod-ом create — trim нужен только входу,
 *   подтверждено: create вставляет passenger.lastName после .trim().min(1));
 * - все отказы — идентичный ApiError.notFound с единой строкой.
 */
async function loadBookingForClient(
  rawCode: string,
  surname: string,
): Promise<{
  row: BookingRow;
  flight: FlightDto;
  passengerDtos: PassengerDto[];
}> {
  const code = rawCode.trim().toUpperCase();
  const [row] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.code, code))
    .limit(1);
  if (!row) {
    throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
  }

  // Проверка фамилии — подсказка задания: lower(колонка) = lower(вход).
  const matches = await db
    .select({ one: sql`1` })
    .from(passengers)
    .where(
      and(
        eq(passengers.bookingId, row.code),
        sql`lower(${passengers.lastName}) = lower(${surname})`,
      ),
    )
    .limit(1);
  if (matches.length === 0) {
    throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
  }

  const [flightRow] = await flightsQuery()
    .where(eq(flights.id, row.flightId))
    .limit(1);
  if (!flightRow) {
    // FK гарантирует существование рейса; на случай гонки — тот же 404, не 500.
    throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
  }

  // id serial растёт по порядку вставки — тот же порядок, что в create.
  const paxRows = await db
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, row.code))
    .orderBy(passengers.id);

  return {
    row,
    flight: toFlightDto(flightRow),
    passengerDtos: paxRows.map(toPassengerDto),
  };
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
    // Эхо проверенного тела: порядок пассажиров детерминирован, без serial id;
    // contact/totalPrice/createdAt берутся из RETURNING-строки (общий маппер).
    return toBookingDto(inserted, flight, body.passengers);
  });

  // Просмотр: GET /api/bookings/:code?lastName= → 200 Booking | идентичный 404.
  app.get('/api/bookings/:code', async (request) => {
    const { code } = request.params as { code: string };
    const { lastName } = request.query as { lastName?: unknown };

    // Дешёвый 404-ДО-БД: без фамилии (нет параметра / пустая после trim)
    // не ходим в базу — тесты без DATABASE_URL проходят без skipIf.
    const surname = requireSurname(lastName);

    const { row, flight, passengerDtos } = await loadBookingForClient(
      code,
      surname,
    );
    // Отменённая бронь тоже находится — статус cancelled отдаётся как есть.
    return toBookingDto(row, flight, passengerDtos);
  });

  // Отмена: POST /api/bookings/:code/cancel {lastName} → 200 cancelled | идентичный 404.
  // «Нет поля lastName» в валидном JSON → наш код → 404 (не 400); битый JSON
  // остаётся фреймворковым 400 validation_error. Один UPDATE — транзакция не
  // нужна; идемпотентно: повторная отмена уже cancelled снова 200 cancelled.
  app.post('/api/bookings/:code/cancel', async (request) => {
    const { code } = request.params as { code: string };
    // До БД: отсутствующее/пустое lastName в теле → тот же 404.
    const surname = parseCancelSurname(request.body);

    // Сначала читаем бронь и проверяем фамилию — при неверной фамилии
    // UPDATE НЕ выполняется (статус не меняется).
    const loaded = await loadBookingForClient(code, surname);

    const [updated] = await db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(eq(bookings.code, loaded.row.code))
      .returning();
    if (!updated) {
      // Строку удалили между чтением и UPDATE — тот же 404.
      throw ApiError.notFound(BOOKING_NOT_FOUND_MESSAGE);
    }

    return toBookingDto(updated, loaded.flight, loaded.passengerDtos);
  });
}
