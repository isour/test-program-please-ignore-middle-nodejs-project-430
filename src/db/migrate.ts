import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, db, type Db } from '../db.ts';

/**
 * Каталог сгенерированных миграций. Резолвим от файла модуля (а не от cwd),
 * чтобы `npm run db:migrate` работал из любой рабочей директории.
 */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Применяет накопленные миграции (идемпотентно: повторный запуск — no-op). */
export async function runMigrations(database: Db = db): Promise<void> {
  await migrate(database, { migrationsFolder });
}

// CLI: `npm run db:migrate`
if (import.meta.main) {
  await import('dotenv/config');
  try {
    await runMigrations();
    console.log('Migrations applied');
  } finally {
    await closeDb();
  }
}
