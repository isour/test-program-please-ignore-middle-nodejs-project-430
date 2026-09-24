import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Схема БД (Drizzle). Имена таблиц и колонок — snake_case в PostgreSQL,
 * свойства в JS — camelCase (drizzle маппит автоматически).
 */

/** Справочник городов. Порядок выдачи задаётся sort_order. */
export const cities = pgTable('cities', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  country: text('country'),
  sortOrder: integer('sort_order').notNull(),
});

/** Справочник авиакомпаний. */
export const airlines = pgTable('airlines', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
});

/** Рейсы. id — детерминированный естественный ключ (без пробелов/слешей). */
export const flights = pgTable(
  'flights',
  {
    id: text('id').primaryKey(),
    airlineCode: text('airline_code')
      .notNull()
      .references(() => airlines.code),
    flightNumber: text('flight_number').notNull(),
    originCode: text('origin_code')
      .notNull()
      .references(() => cities.code),
    destinationCode: text('destination_code')
      .notNull()
      .references(() => cities.code),
    departureAt: timestamp('departure_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    arrivalAt: timestamp('arrival_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    price: integer('price').notNull(),
    seatsAvailable: integer('seats_available').notNull(),
  },
  (table) => [
    // Рейс «город в свой же город» исключён на уровне БД.
    check(
      'flights_origin_ne_destination',
      sql`${table.originCode} <> ${table.destinationCode}`,
    ),
    // Индекс под поиск по маршруту и дате вылета.
    index('flights_search_idx').on(
      table.originCode,
      table.destinationCode,
      table.departureAt,
    ),
  ],
);

/** Брони. code — естественный уникальный ключ (6 символов [A-Z0-9]). */
export const bookings = pgTable(
  'bookings',
  {
    code: text('code').notNull().unique(),
    status: text('status').notNull(),
    flightId: text('flight_id')
      .notNull()
      .references(() => flights.id),
    // Цена на момент создания брони (рубли, целое).
    totalPrice: integer('total_price').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'bookings_status_check',
      sql`${table.status} in ('confirmed', 'cancelled')`,
    ),
  ],
);

/**
 * Пассажиры. date_of_birth — text (контракт требует YYYY-MM-DD;
 * date-колонка драйвер превращает в Date и в поясе UTC+3 «гуляет» день).
 */
export const passengers = pgTable('passengers', {
  id: serial('id').primaryKey(),
  bookingId: text('booking_id')
    .notNull()
    .references(() => bookings.code, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: text('date_of_birth').notNull(),
  documentNumber: text('document_number').notNull(),
});
