import 'dotenv/config';
import { buildApp } from './app.ts';
import { closeDb, requireDatabaseUrl } from './db.ts';

const port = Number(process.env.PORT ?? 8080);
const host = '0.0.0.0';

const app = await buildApp();

// ШАГ 2, проверка 6: сервер обязан стартовать и без DATABASE_URL —
// подключение к БД ленивое (см. db.ts), здесь лишь предупреждаем.
try {
  requireDatabaseUrl();
} catch (err) {
  app.log.warn(err instanceof Error ? err.message : String(err));
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
