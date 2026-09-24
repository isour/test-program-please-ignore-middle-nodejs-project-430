import { closeDb, db, type Db } from '../db.ts';
import { airlines, cities, flights } from './schema.ts';

/** Справочник городов: порядок выдачи = sort_order (1..7). */
const CITY_SEED: Array<{ code: string; name: string; country: string }> = [
  { code: 'MOW', name: 'Москва', country: 'Россия' },
  { code: 'LED', name: 'Санкт-Петербург', country: 'Россия' },
  { code: 'AER', name: 'Сочи', country: 'Россия' },
  { code: 'KZN', name: 'Казань', country: 'Россия' },
  { code: 'SVX', name: 'Екатеринбург', country: 'Россия' },
  { code: 'OVB', name: 'Новосибирск', country: 'Россия' },
  { code: 'KGD', name: 'Калининград', country: 'Россия' },
];

const AIRLINE_SEED: Array<{ code: string; name: string }> = [
  { code: 'SU', name: 'Аэрофлот' },
  { code: 'DP', name: 'Победа' },
  { code: 'S7', name: 'S7 Airlines' },
  { code: 'U6', name: 'Уральские авиалинии' },
];

const DAYS_IN_WINDOW = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Детерминированный PRNG. Никаких Math.random и соли от времени:
 * один и тот же ключ всегда даёт одну и ту же последовательность.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-битный хэш строки (FNV-1a) — превращает ключ в сид PRNG. */
function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Целое из [min, max] включительно. */
function intInRange(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Начало окна заливки — сегодняшний день 00:00 UTC. */
function windowStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

type FlightRow = typeof flights.$inferInsert;

/**
 * Заливка справочников и рейсов. Идемпотентна: все INSERT ... ON CONFLICT DO NOTHING,
 * поэтому повторный запуск не создаёт дубли и ничего не удаляет. Окно «скользит»:
 * вчерашние строки остаются, новые досеиваются по (origin,destination,дата).
 */
export async function seed(database: Db = db): Promise<void> {
  const cityRows = CITY_SEED.map((city, index) => ({
    ...city,
    sortOrder: index + 1,
  }));

  await database.insert(cities).values(cityRows).onConflictDoNothing();
  await database.insert(airlines).values(AIRLINE_SEED).onConflictDoNothing();

  const start = windowStart();
  const pairs: Array<[string, string]> = [];
  for (const origin of CITY_SEED) {
    for (const destination of CITY_SEED) {
      if (origin.code !== destination.code) {
        pairs.push([origin.code, destination.code]);
      }
    }
  }

  const rows: FlightRow[] = [];
  for (const [origin, destination] of pairs) {
    for (let day = 0; day < DAYS_IN_WINDOW; day++) {
      const date = new Date(start.getTime() + day * DAY_MS);
      const ymd = formatYmd(date);

      // Количество рейсов в день — детерминировано от (пара, день).
      const count = intInRange(
        mulberry32(hashString(`${origin}|${destination}|${ymd}|count`)),
        2,
        3,
      );

      for (let i = 0; i < count; i++) {
        const rng = mulberry32(hashString(`${origin}|${destination}|${ymd}|${i}`));
        const airline = AIRLINE_SEED[intInRange(rng, 0, AIRLINE_SEED.length - 1)]!;
        const flightNumber = `${airline.code}${intInRange(rng, 100, 999)}`;

        // Вылет в интервале 05:00–21:59 UTC.
        const departure = new Date(
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            intInRange(rng, 5, 21),
            intInRange(rng, 0, 59),
          ),
        );
        const durationMinutes = intInRange(rng, 80, 280);
        const arrival = new Date(departure.getTime() + durationMinutes * 60 * 1000);

        rows.push({
          id: `${flightNumber}-${origin}-${destination}-${ymd}-${i + 1}`,
          airlineCode: airline.code,
          flightNumber,
          originCode: origin,
          destinationCode: destination,
          departureAt: departure.toISOString(),
          arrivalAt: arrival.toISOString(),
          durationMinutes,
          price: intInRange(rng, 3000, 8500),
          seatsAvailable: intInRange(rng, 10, 90),
        });
      }
    }
  }

  await database.insert(flights).values(rows).onConflictDoNothing();
}

// CLI: `npm run db:seed`
if (import.meta.main) {
  await import('dotenv/config');
  try {
    await seed();
    console.log('Seed complete');
  } finally {
    await closeDb();
  }
}
