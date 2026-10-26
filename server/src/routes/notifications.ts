import type { FastifyInstance } from 'fastify';
import { listNotifications, markNotificationsRead } from '../repositories/notificationRepo';

/**
 * The signed-in user's own in-app notifications (the sidebar bell). Nobody can
 * read or mark anyone else's: every query is scoped to `currentUser`.
 */
export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', {
    preHandler: [app.authenticate],
  }, async (req) => listNotifications(req.currentUser!.id));

  /** Mark some (`ids`) or all (no `ids`) of my notifications read. */
  app.post('/api/notifications/read', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          ids: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 64 } },
        },
      },
    },
  }, async (req) => {
    const { ids } = (req.body ?? {}) as { ids?: string[] };
    return { marked: await markNotificationsRead(req.currentUser!.id, ids) };
  });
}
