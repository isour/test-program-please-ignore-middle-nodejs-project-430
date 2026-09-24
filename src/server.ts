import 'dotenv/config';
import { buildApp } from './app.ts';
import { closeDb, requireDatabaseUrl } from './db.ts';
import { runMigrations } from './db/migrate.ts';
import { seed } from './db/seed.ts';

const port = Number(process.env.PORT ?? 8080);
const host = '0.0.0.0';

const app = await buildApp();

// ШАГ 2, проверка 6: сервер обязан стартовать и без DATABASE_URL —
// подключение к БД ленивое, здесь лишь предупреждаем.
let hasDb = false;
try {
  requireDatabaseUrl();
  hasDb = true;
} catch (err) {
  app.log.warn(err instanceof Error ? err.message : String(err));
}

// ШАГ 5: при наличии DATABASE_URL перед listen применяем миграции и заливаем
// справочники/рейсы (идемпотентно). При сконфигурированной, но недоступной БД
// падаем сразу — это ошибка конфигурации, а не «живой без БД» сценарий.
if (hasDb) {
  try {
    await runMigrations();
    await seed();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
