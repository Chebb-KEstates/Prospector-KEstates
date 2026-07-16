import { FastifyInstance } from 'fastify';
import { loadSnapshot, getRev } from '../store';

export async function vaultRoutes(app: FastifyInstance): Promise<void> {
  // Full snapshot — the server-side equivalent of VaultRepository.load().
  app.get('/api/vault', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const snap = await loadSnapshot();
    return reply.send({ ...snap, rev: await getRev() });
  });

  // Lightweight revision probe for cross-device change detection (polled).
  app.get('/api/vault/rev', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ rev: await getRev() });
  });
}
