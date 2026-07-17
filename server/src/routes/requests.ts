import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { BatchRequest, RequestStatus, kOrgId } from '../../../src/types/models';
import { insertRequest, listRequests, countPending } from '../repositories/requestRepo';
import { approveRequest, denyRequest } from '../services/assignmentService';
import { writeAudit } from '../repositories/auditRepo';
import { serializeRequest } from '../http/serializers';
import { newRequestId } from '../domain/ids';
import { forbidden } from '../http/errors';

/**
 * Broker requests for pool data.
 *
 * Worth knowing: this flow was dead in the reference implementation for most of
 * its life — `submitRequest` existed but nothing ever called it, so the
 * manager's Requests tab could never populate. PoolTab was built late to close
 * the loop.
 */
export default async function requestRoutes(app: FastifyInstance) {
  app.post('/api/requests', {
    preHandler: [app.authenticate, app.requirePermission(Permission.requestData)],
    schema: {
      body: {
        type: 'object', required: ['community', 'count'], additionalProperties: false,
        properties: {
          community: { type: 'string', maxLength: 255 },
          cluster: { type: 'string', maxLength: 255 },
          count: { type: 'integer', minimum: 1, maximum: 5000 },
          unitIds: {
            type: 'array', maxItems: 5000, items: { type: 'string', maxLength: 64 },
          },
          note: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as {
      community: string; cluster?: string; count: number;
      unitIds?: string[]; note?: string;
    };
    const me = req.currentUser!;

    const request = new BatchRequest(
      newRequestId(), kOrgId, me.id, body.community, body.cluster,
      body.count, body.unitIds ?? [], body.note, new Date().toISOString(),
    );

    await insertRequest(request);
    await writeAudit({
      actorId: me.id, action: 'request', detail: `${request.summary} requested`,
    });

    return serializeRequest(request);
  });

  app.get('/api/requests', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: Object.values(RequestStatus) },
          brokerId: { type: 'string', maxLength: 64 },
        },
      },
    },
  }, async (req) => {
    const q = req.query as { status?: RequestStatus; brokerId?: string };
    const me = req.currentUser!;

    // A broker sees only their own requests — the Pool tab shows "your pending
    // requests", never the team's.
    const brokerId = me.isManager ? q.brokerId : me.id;
    if (!me.isManager && q.brokerId && q.brokerId !== me.id) {
      throw forbidden('You can only see your own requests.');
    }

    const rows = await listRequests({ status: q.status, brokerId });
    return rows.map(serializeRequest);
  });

  /** Drives the pending badge on the manager's Assignments tab. */
  app.get('/api/requests/pending-count', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
  }, async () => ({ count: await countPending() }));

  app.post('/api/requests/:id/approve', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const result = await approveRequest(id, req.currentUser!.id);
    return { granted: result.granted, request: serializeRequest(result.request) };
  });

  app.post('/api/requests/:id/deny', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return serializeRequest(await denyRequest(id, req.currentUser!.id));
  });
}
