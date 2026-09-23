import 'dotenv/config';
import { buildApp } from './app.ts';
import { closeDb, requireDatabaseUrl } from './db.ts';

requireDatabaseUrl();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildApp();

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
