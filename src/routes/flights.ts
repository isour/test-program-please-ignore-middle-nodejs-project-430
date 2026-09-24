import { and, eq, gte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import { airlines, cities, flights } from '../db/schema.ts';
import { ApiError, ValidationError } from '../errors.ts';

/** Город в ответе (контракт): code/name обязательны, country опционален. */
interface CityDto {
  code: string;
  name: string;
  country?: string | undefined;
}

/** Flight по contract/main.tsp: числа — числа, моменты — ISO UTC с Z. */
interface FlightDto {
  id: string;
  flightNumber: string;
  airline: { code: string; name: string };
  origin: CityDto;
  destination: CityDto;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  price: { amount: number; currency: 'RUB' };
  seatsAvailable: number;
}

/** Два алиаса cities — origin и destination в одном запросе, без N+1. */
const originCities = alias(cities, 'origin_city');
const destinationCities = alias(cities, 'destination_city');

const flightSelect = {
  id: flights.id,
  flightNumber: flights.flightNumber,
  departureAt: flights.departureAt,
  arrivalAt: flights.arrivalAt,
  durationMinutes: flights.durationMinutes,
  price: flights.price,
  seatsAvailable: flights.seatsAvailable,
  airlineCode: airlines.code,
  airlineName: airlines.name,
  originCode: originCities.code,
  originName: originCities.name,
  originCountry: originCities.country,
  destinationCode: destinationCities.code,
  destinationName: destinationCities.name,
  destinationCountry: destinationCities.country,
};

/** Строка выборки: drizzle маппит integer → number, timestamptz(mode string) → string. */
interface FlightRow {
  id: string;
  flightNumber: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  price: number;
  seatsAvailable: number;
  airlineCode: string;
  airlineName: string;
  originCode: string;
  originName: string;
  originCountry: string | null;
  destinationCode: string;
  destinationName: string;
  destinationCountry: string | null;
}

function cityDto(code: string, name: string, country: string | null): CityDto {
  return { code, name, country: country ?? undefined };
}

/**
 * timestamptz из postgres.js приходит строкой вида '2026-09-24 17:14:00+00'
 * (с явным смещением — день не «уезжает») либо объектом Date —
 * и то и другое нормализуем к ISO UTC как в сиде: 2026-09-24T17:14:00.000Z.
 */
function toIsoUtc(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** Единственный маппер — одинаковая сборка ответа для поиска и GET по id. */
function toFlightDto(row: FlightRow): FlightDto {
  return {
    id: row.id,
    flightNumber: row.flightNumber,
    airline: { code: row.airlineCode, name: row.airlineName },
    origin: cityDto(row.originCode, row.originName, row.originCountry),
    destination: cityDto(
      row.destinationCode,
      row.destinationName,
      row.destinationCountry,
    ),
    departureAt: toIsoUtc(row.departureAt),
    arrivalAt: toIsoUtc(row.arrivalAt),
    durationMinutes: row.durationMinutes,
    price: { amount: row.price, currency: 'RUB' },
    seatsAvailable: row.seatsAvailable,
  };
}

/** YYYY-MM-DD и реально существующая дата (2026-02-30 → false). */
function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Валидация query. Падает ДО первого обращения к БД, поэтому тесты
 * валидации проходят и без DATABASE_URL. Класс ошибки — только ValidationError
 * из src/errors.ts (иначе instanceof в apiErrorHandler не сработает → 500).
 */
const searchParamsSchema = z.object({
  origin: z
    .string({ error: 'origin обязателен (код города)' })
    .min(1, 'origin не должен быть пустым'),
  destination: z
    .string({ error: 'destination обязателен (код города)' })
    .min(1, 'destination не должен быть пустым'),
  date: z
    .string({ error: 'date обязателен (YYYY-MM-DD)' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date должен быть в формате YYYY-MM-DD')
    .refine(isCalendarDate, 'date должен быть корректной датой (YYYY-MM-DD)'),
  passengers: z.coerce
    .number({ error: 'passengers должен быть числом' })
    .int('passengers должен быть целым числом')
    .min(1, 'passengers должен быть не меньше 1')
    .default(1),
});

type SearchParams = z.infer<typeof searchParamsSchema>;

function parseSearchParams(query: unknown): SearchParams {
  const parsed = searchParamsSchema.safeParse(query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(
      issue?.message ?? 'Некорректные параметры запроса',
    );
  }
  return parsed.data;
}

/** Общий join: рейс + авиакомпания + два города (origin/destination). */
function flightsQuery() {
  return db
    .select(flightSelect)
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineCode, airlines.code))
    .innerJoin(originCities, eq(flights.originCode, originCities.code))
    .innerJoin(
      destinationCities,
      eq(flights.destinationCode, destinationCities.code),
    );
}

export function registerFlightRoutes(app: FastifyInstance): void {
  // Поиск: GET /api/flights?origin&destination&date&passengers
  app.get('/api/flights', async (request) => {
    const { origin, destination, date, passengers } = parseSearchParams(
      request.query,
    );

    const rows = await flightsQuery()
      .where(
        and(
          eq(flights.originCode, origin),
          eq(flights.destinationCode, destination),
          // День вылета — строго по UTC: тот же пояс, в котором отдаём
          // departureAt, иначе утренние рейсы уедут в соседний день.
          sql`date(${flights.departureAt} at time zone 'UTC') = ${date}::date`,
          gte(flights.seatsAvailable, passengers),
        ),
      )
      // Стабильный порядок для фронтенда: время вылета, при равенстве — id.
      .orderBy(flights.departureAt, flights.id);

    // Пусто (origin==destination, неизвестный код города, нет мест) — это 200 [].
    return rows.map(toFlightDto);
  });

  // Один рейс: GET /api/flights/{id} (в OpenAPI путь с фигурными скобками,
  // а Fastify/find-my-way 9 параметры объявляет двоеточием — :id).
  app.get('/api/flights/:id', async (request) => {
    const { id } = request.params as { id: string };

    const rows = await flightsQuery().where(eq(flights.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      // Сырой throw Error уехал бы в 500 — только ApiError/notFound.
      throw ApiError.notFound('Рейс не найден');
    }
    return toFlightDto(row);
  });
}
