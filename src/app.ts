import Fastify, { type FastifyInstance } from 'fastify';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
