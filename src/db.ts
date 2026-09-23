import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

type Db = PostgresJsDatabase<Record<string, unknown>>;

let client: postgres.Sql | undefined;
let instance: Db | undefined;

/**
 * Явное чтение конфигурации: тихий fallback на localhost маскировал бы
 * ошибку конфигурации, поэтому без DATABASE_URL работаем нельзя.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

/**
 * Клиент и drizzle создаются лениво при первом обращении к `db`:
 * импорт модуля и старт сервера не выполняют ни одного вызова к PostgreSQL,
 * поэтому БД не нужна ни тестам приложения, ни серверу до реальных запросов к БД.
 */
function getDb(): Db {
  client ??= postgres(requireDatabaseUrl(), { max: 10 });
  instance ??= drizzle(client);
  return instance;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = Reflect.get(getDb(), prop);
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});

/** Закрытие пула соединений (graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    instance = undefined;
  }
}
