import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { apiErrorHandler } from './errors.ts';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  app.setErrorHandler(apiErrorHandler);

  // Раздача собранного фронтенда из public/ (цель `make build`).
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/cities', async () => []);

  // SPA-fallback: неизвестный путь внутри /api/ → JSON-404,
  // любой другой путь → index.html (прямые ссылки /booking/<id>, /lookup).
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ code: 'not_found', message: 'Unknown endpoint' });
      return;
    }
    reply.sendFile('index.html');
  });

  return app;
}
