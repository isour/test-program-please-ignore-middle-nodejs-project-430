import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Явный include: тесты лежат в tests/ и находятся надёжно, не полагаясь на дефолты Vitest
    include: ['tests/**/*.test.ts'],
    // Тест-файлы выполняются по очереди: два файла с runMigrations в beforeAll
    // на свежей БД (CI) гонялись бы за CREATE TABLE — drizzle migrate не берёт
    // advisory-lock. Последовательно вторая миграция видит committed-строку и no-op.
    fileParallelism: false,
  },
});
