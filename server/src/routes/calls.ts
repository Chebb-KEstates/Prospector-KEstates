import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { CallOutcome } from '../../../src/types/models';
import { logCall, logLeadCall } from '../services/callService';
import { listCalls, callsBy } from '../repositories/callRepo';
import { serializeCall } from '../http/serializers';
import { forbidden } from '../http/errors';

/** Call logging. The state machine itself lives in the shared dispositions.ts. */
export default async function callRoutes(app: FastifyInstance) {
  const outcomeEnum = Object.values(CallOutcome);

  app.post('/api/calls', {
    preHandler: [app.authenticate, app.requirePermission(Permission.callOwners)],
    schema: {
      body: {
        type: 'object', required: ['propertyIds', 'outcome'], additionalProperties: false,
        properties: {
          // An owner call covers every unit that owner holds — hence a list.
          propertyIds: {
            type: 'array', minItems: 1, maxItems: 200,
            items: { type: 'string', maxLength: 64 },
          },
          outcome: { type: 'string', enum: outcomeEnum },
          note: { type: 'string', maxLength: 2000 },
          followUpAt: { type: 'string', maxLength: 40 },
          ownerName: { type: 'string', maxLength: 255 },
          keepInPool: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const body = req.body as {
      propertyIds: string[]; outcome: CallOutcome; note?: string; followUpAt?: string; ownerName?: string; keepInPool?: boolean;
    };
    const me = req.currentUser!;
    const call = await logCall({
      propertyIds: body.propertyIds,
      brokerId: me.id,
      isManager: me.isManager,
      outcome: body.outcome,
      note: body.note,
      followUpAt: body.followUpAt,
      ownerName: body.ownerName,
      keepInPool: body.keepInPool,
    });
    return serializeCall(call);
  });

  app.post('/api/calls/lead', {
    preHandler: [app.authenticate, app.requirePermission(Permission.callOwners)],
    schema: {
      body: {
        type: 'object', required: ['leadId', 'outcome'], additionalProperties: false,
        properties: {
          leadId: { type: 'string', maxLength: 64 },
          outcome: { type: 'string', enum: outcomeEnum },
          note: { type: 'string', maxLength: 2000 },
          followUpAt: { type: 'string', maxLength: 40 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as {
      leadId: string; outcome: CallOutcome; note?: string; followUpAt?: string;
    };
    const me = req.currentUser!;
    const call = await logLeadCall({
      leadId: body.leadId,
      brokerId: me.id,
      isManager: me.isManager,
      outcome: body.outcome,
      note: body.note,
      followUpAt: body.followUpAt,
    });
    return serializeCall(call);
  });

  /** The audit/reports feed. Managers see everything; brokers see their own. */
  app.get('/api/calls', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          brokerId: { type: 'string', maxLength: 64 },
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
  }, async (req) => {
    const q = req.query as { brokerId?: string; page?: number; pageSize?: number };
    const me = req.currentUser!;

    if (!me.isManager) {
      if (q.brokerId && q.brokerId !== me.id) {
        throw forbidden('You can only see your own calls.');
      }
      return { rows: (await callsBy(me.id)).map(serializeCall), total: undefined };
    }
    if (q.brokerId) {
      return { rows: (await callsBy(q.brokerId)).map(serializeCall), total: undefined };
    }

    const pageSize = q.pageSize ?? 100;
    const page = q.page ?? 0;
    const result = await listCalls(pageSize, page * pageSize);
    return { rows: result.rows.map(serializeCall), total: result.total, page, pageSize };
  });
}
