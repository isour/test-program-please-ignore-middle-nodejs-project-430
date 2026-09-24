import { defineConfig } from 'drizzle-kit';

/**
 * Конфигурация drizzle-kit для генерации миграций (dev-only).
 * `generate` сравнивает src/db/schema.ts с журналом в drizzle/ и пишет SQL;
 * соединение с БД для generate не требуется — url нужен только для push/introspect.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/flights',
  },
});
