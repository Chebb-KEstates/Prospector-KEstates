import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { listAudit } from '../repositories/auditRepo';
import { serializeAudit } from '../http/serializers';

/**
 * The audit trail. Read-only over HTTP by design — there is no route that
 * writes or edits an entry, because entries are written as a side effect of the
 * thing they record, inside its transaction.
 */
export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          actorId: { type: 'string', maxLength: 64 },
          action: { type: 'string', maxLength: 64 },
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (req) => {
    const q = req.query as {
      actorId?: string; action?: string; page?: number; pageSize?: number;
    };
    const pageSize = q.pageSize ?? 100;
    const page = q.page ?? 0;

    const result = await listAudit({
      limit: pageSize,
      offset: page * pageSize,
      actorId: q.actorId,
      action: q.action,
    });

    return {
      rows: result.entries.map(serializeAudit),
      total: result.total,
      page,
      pageSize,
    };
  });
}
