import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { ApiError } from './http/errors';
import authPlugin from './plugins/auth';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import propertyRoutes from './routes/properties';
import leadRoutes from './routes/leads';
import callRoutes from './routes/calls';
import requestRoutes from './routes/requests';
import datasetRoutes from './routes/datasets';
import settingsRoutes from './routes/settings';
import auditRoutes from './routes/audit';
import importRoutes from './routes/imports';
import dashboardRoutes from './routes/dashboard';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProd
      ? {
          level: 'info',
          // Owner data must never reach the logs — this app exists to protect it.
          redact: {
            paths: [
              'req.headers.cookie', 'req.headers.authorization',
              'req.headers["x-csrf-token"]',
              'req.body.password', 'req.body.newPassword',
              'req.body.currentPassword', 'req.body.initialPassword',
            ],
            remove: true,
          },
        }
      : {
          level: 'info',
          transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
        },
    // Trust the proxy in production so req.ip is the real client for rate limits.
    trustProxy: env.isProd,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    // The API serves JSON only; CSP belongs to whatever serves the SPA.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    // Credentialed CORS cannot use a wildcard — the browser refuses it, and a
    // reflected-origin wildcard would let any site read owner data.
    origin: env.corsOrigin.split(',').map(s => s.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Per-user where we know them, per-IP otherwise: a shared office NAT
    // shouldn't let one busy broker rate-limit the whole team.
    keyGenerator: (req) => req.currentUser?.id ?? req.ip,
    errorResponseBuilder: () => ({
      error: { code: 'too_many_requests', message: 'Too many requests. Slow down and try again.' },
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: env.maxUploadBytes,
      files: 1,
      fields: 20,
    },
  });

  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      if (err.statusCode >= 500) req.log.error({ err }, 'api error');
      return reply.status(err.statusCode).send(err.toPayload());
    }

    // Fastify's schema validation → 400 with the same envelope.
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'That request was not valid.',
          details: (err as { validation?: unknown }).validation,
        },
      });
    }

    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({
        error: {
          code: 'payload_too_large',
          message: `That file is larger than the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit.`,
        },
      });
    }

    // Anything unrecognised is a bug: log it in full, tell the client nothing.
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal', message: 'Something went wrong. Please try again.' },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({
    ok: true,
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(propertyRoutes);
  await app.register(leadRoutes);
  await app.register(callRoutes);
  await app.register(requestRoutes);
  await app.register(datasetRoutes);
  await app.register(settingsRoutes);
  await app.register(auditRoutes);
  await app.register(importRoutes);
  await app.register(dashboardRoutes);

  return app;
}
