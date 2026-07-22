import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Permission } from '../../../src/types/user';
import { PropertyState } from '../../../src/types/models';
import { queryLeads, leadFacets, findLeadById, findLeadsOf } from '../repositories/leadRepo';
import { callsForLead } from '../repositories/callRepo';
import { assignLeads, reclaimLeads } from '../services/assignmentService';
import { undoDncLead } from '../services/callService';
import { revealLeadPhone } from '../services/revealService';
import { serializeLead, serializeCall } from '../http/serializers';
import { forbidden, notFound } from '../http/errors';

/** Buyer leads. Mirrors properties.ts — same scoping and masking rules. */

// Matches the table's largest page-size option; see the note in properties.ts.
const MAX_PAGE = 250;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'string', maxLength: 200 },
    state: { type: 'string', enum: [...Object.values(PropertyState), ''] },
    project: { type: 'string', maxLength: 255 },
    source: { type: 'string', maxLength: 255 },
    outcome: { type: 'string', maxLength: 32 },
    callableOnly: { type: 'boolean' },
    assignedTo: { type: 'string', maxLength: 64 },
    datasetId: { type: 'string', maxLength: 64 },
    enquiryFrom: { type: 'string', maxLength: 40 },
    enquiryTo: { type: 'string', maxLength: 40 },
    scope: { type: 'string', enum: ['all', 'mine', 'pool'] },
    sortKey: { type: 'string', maxLength: 64 },
    asc: { type: 'boolean' },
    page: { type: 'integer', minimum: 0 },
    pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE },
  },
} as const;

interface ListQuery {
  search?: string; state?: PropertyState | ''; project?: string; source?: string;
  outcome?: string; callableOnly?: boolean; assignedTo?: string; datasetId?: string;
  enquiryFrom?: string; enquiryTo?: string;
  scope?: 'all' | 'mine' | 'pool';
  sortKey?: string; asc?: boolean; page?: number; pageSize?: number;
}

export default async function leadRoutes(app: FastifyInstance) {
  function scopeFor(req: FastifyRequest, q: ListQuery) {
    const me = req.currentUser!;
    const scope = q.scope ?? (me.isManager ? 'all' : 'mine');

    if (scope === 'mine' || !me.isManager) {
      if (scope === 'pool' && !me.isManager) {
        return { states: [PropertyState.pool], ownerHidden: true };
      }
      return { assignedTo: me.id, ownerHidden: false };
    }
    if (scope === 'pool') return { states: [PropertyState.pool], ownerHidden: false };
    return { assignedTo: q.assignedTo, ownerHidden: false };
  }

  app.get('/api/leads', {
    preHandler: [app.authenticate],
    schema: { querystring: listQuerySchema },
  }, async (req) => {
    const q = req.query as ListQuery;
    const scope = scopeFor(req, q);
    const pageSize = Math.min(q.pageSize ?? 50, MAX_PAGE);
    const page = q.page ?? 0;

    const result = await queryLeads({
      search: q.search, state: q.state, project: q.project, source: q.source,
      outcome: q.outcome, callableOnly: q.callableOnly, datasetId: q.datasetId,
      enquiryFrom: q.enquiryFrom, enquiryTo: q.enquiryTo,
      assignedTo: scope.assignedTo, states: scope.states,
      ownerHidden: scope.ownerHidden,
      sortKey: q.sortKey, asc: q.asc,
      limit: pageSize, offset: page * pageSize,
    });

    return {
      rows: result.rows.map(l => {
        const s = serializeLead(l);
        // A lead IS the person — a teaser pool must not carry their identity.
        if (scope.ownerHidden) {
          return { ...s, name: '', phone: undefined, email: undefined };
        }
        return s;
      }),
      total: result.total,
      page,
      pageSize,
    };
  });

  app.get('/api/leads/facets', {
    preHandler: [app.authenticate],
    schema: { querystring: listQuerySchema },
  }, async (req) => {
    const q = req.query as ListQuery;
    const scope = scopeFor(req, q);
    return leadFacets({
      assignedTo: scope.assignedTo, states: scope.states, datasetId: q.datasetId,
    });
  });

  app.get('/api/leads/mine', { preHandler: [app.authenticate] }, async (req) => {
    const leads = await findLeadsOf(req.currentUser!.id);
    return leads.map(serializeLead);
  });

  app.get('/api/leads/:id', {
    preHandler: [app.authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const l = await findLeadById(id);
    if (!l) throw notFound('That lead no longer exists.');
    const me = req.currentUser!;
    if (!me.isManager && l.assignedTo !== me.id) {
      throw forbidden('That lead is not assigned to you.');
    }
    return serializeLead(l);
  });

  app.get('/api/leads/:id/calls', {
    preHandler: [app.authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const l = await findLeadById(id);
    if (!l) throw notFound('That lead no longer exists.');
    const me = req.currentUser!;
    if (!me.isManager && l.assignedTo !== me.id) {
      throw forbidden('That lead is not assigned to you.');
    }
    return (await callsForLead(id)).map(serializeCall);
  });

  app.post('/api/leads/:id/reveal', {
    preHandler: [app.authenticate, app.requirePermission(Permission.callOwners)],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          tzOffsetMinutes: { type: 'integer', minimum: -840, maximum: 840 },
          enforceCap: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { tzOffsetMinutes?: number; enforceCap?: boolean };
    const me = req.currentUser!;

    const l = await findLeadById(id);
    if (!l) throw notFound('That lead no longer exists.');
    if (!me.isManager && l.assignedTo !== me.id) {
      throw forbidden('That lead is not assigned to you.');
    }

    return revealLeadPhone(id, {
      user: me,
      tzOffsetMinutes: body.tzOffsetMinutes ?? 0,
      enforceCap: body.enforceCap ?? false,
    });
  });

  app.post('/api/leads/assign', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      body: {
        type: 'object', required: ['leadIds', 'brokerId'], additionalProperties: false,
        properties: {
          leadIds: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'string', maxLength: 64 } },
          brokerId: { type: 'string', maxLength: 64 },
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as { leadIds: string[]; brokerId: string; note?: string };
    const assigned = await assignLeads(body.leadIds, body.brokerId, req.currentUser!.id, body.note);
    return { assigned };
  });

  app.post('/api/leads/reclaim', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      body: {
        type: 'object', required: ['leadIds'], additionalProperties: false,
        properties: {
          leadIds: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'string', maxLength: 64 } },
        },
      },
    },
  }, async (req) => {
    const body = req.body as { leadIds: string[] };
    const reclaimed = await reclaimLeads(body.leadIds, req.currentUser!.id);
    return { reclaimed };
  });

  app.post('/api/leads/:id/undo-dnc', {
    preHandler: [app.authenticate, app.requireManager],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return serializeLead(await undoDncLead(id, req.currentUser!.id));
  });
}
