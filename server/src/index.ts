import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { prisma, disconnectDb } from './db';
import { registerAuth } from './auth/plugin';
import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vault';
import { dataRoutes } from './routes/data';
import { userRoutes } from './routes/users';

async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: config.isProd ? undefined : { target: 'pino-pretty' },
    },
    // Imports can send large arrays of parsed rows in one request.
    bodyLimit: 64 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  if (config.corsOrigins.length > 0) {
    await app.register(cors, { origin: config.corsOrigins, credentials: true });
  }

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health' || req.url === '/api/health',
  });

  await registerAuth(app);

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(vaultRoutes);
  await app.register(dataRoutes);
  await app.register(userRoutes);

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}

async function main() {
  const app = await build();

  // Fail fast if the database is unreachable.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    app.log.error({ err: e }, 'Database connection failed');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down…`);
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
