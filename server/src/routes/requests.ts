import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { BatchRequest, RequestArea, RequestStatus, kOrgId } from '../../../src/types/models';
import { insertRequest, listRequests, countPending, findRequestById } from '../repositories/requestRepo';
import { findPropertiesByIds } from '../repositories/propertyRepo';
import { approveRequest, denyRequest } from '../services/assignmentService';
import { writeAudit } from '../repositories/auditRepo';
import { serializeRequest, serializeProperty } from '../http/serializers';
import { newRequestId } from '../domain/ids';
import { forbidden, notFound } from '../http/errors';

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

    // Resolve each request's hand-picked units into a per-area breakdown
    // (community · sub-community + count). One query for every unit across the
    // page; bulk requests (no unitIds) fall back to their single stated area.
    const allIds = Array.from(new Set(rows.flatMap(r => r.unitIds)));
    const areaById = new Map<string, { community: string; cluster: string }>();
    if (allIds.length > 0) {
      const props = await findPropertiesByIds(allIds);
      for (const p of props) areaById.set(p.id, { community: p.community, cluster: p.cluster ?? '' });
    }
    for (const r of rows) {
      if (r.unitIds.length > 0) {
        const m = new Map<string, RequestArea>();
        for (const id of r.unitIds) {
          const a = areaById.get(id);
          if (!a) continue; // unit no longer exists
          const key = `${a.community}${a.cluster}`;
          const e = m.get(key) ?? { community: a.community, cluster: a.cluster, count: 0 };
          e.count += 1;
          m.set(key, e);
        }
        r.areas = Array.from(m.values()).sort((x, y) => y.count - x.count);
      } else {
        r.areas = [{ community: r.community, cluster: r.cluster ?? '', count: r.count }];
      }
    }

    return rows.map(serializeRequest);
  });

  /** The individual units of one request — the manager's "view units" popup. */
  app.get('/api/requests/:id/units', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const request = await findRequestById(id);
    if (!request) throw notFound('That request no longer exists.');
    if (request.unitIds.length === 0) return [];
    const props = await findPropertiesByIds(request.unitIds);
    return props.map(serializeProperty);
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
