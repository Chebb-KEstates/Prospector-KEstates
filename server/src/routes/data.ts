import { FastifyInstance } from 'fastify';
import {
  upsertProperties, upsertLeads, commitPropertyImport, commitLeadImport,
  insertCall, upsertRequest, upsertSettings, insertAudit, deleteDataset, bumpRev,
} from '../store';

// A permissive-but-typed array of records that each carry a string `id`.
const entityArray = {
  type: 'array',
  maxItems: 100000,
  items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
} as const;

const withId = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } as const;

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  // ---- bulk property / lead saves (assign, reclaim, call outcomes, sweeps) ----
  app.put('/api/properties', {
    preHandler: [app.authenticate],
    schema: { body: { type: 'object', required: ['properties'], properties: { properties: entityArray } } },
  }, async (req, reply) => {
    const { properties } = req.body as { properties: Record<string, any>[] };
    if (properties.length === 0) return reply.send({ ok: true, count: 0 });
    await upsertProperties(properties);
    const rev = await bumpRev();
    return reply.send({ ok: true, count: properties.length, rev });
  });

  app.put('/api/leads', {
    preHandler: [app.authenticate],
    schema: { body: { type: 'object', required: ['leads'], properties: { leads: entityArray } } },
  }, async (req, reply) => {
    const { leads } = req.body as { leads: Record<string, any>[] };
    if (leads.length === 0) return reply.send({ ok: true, count: 0 });
    await upsertLeads(leads);
    const rev = await bumpRev();
    return reply.send({ ok: true, count: leads.length, rev });
  });

  // ---- imports (dataset + rows), gated on manageData ----
  app.post('/api/imports/properties', {
    preHandler: [app.authenticate, app.requirePermission('manageData')],
    schema: {
      body: {
        type: 'object', required: ['dataset', 'properties'],
        properties: { dataset: withId, properties: entityArray },
      },
    },
  }, async (req, reply) => {
    const { dataset, properties } = req.body as { dataset: Record<string, any>; properties: Record<string, any>[] };
    const rev = await commitPropertyImport(dataset, properties);
    return reply.code(201).send({ ok: true, count: properties.length, rev });
  });

  app.post('/api/imports/leads', {
    preHandler: [app.authenticate, app.requirePermission('manageData')],
    schema: {
      body: {
        type: 'object', required: ['dataset', 'leads'],
        properties: { dataset: withId, leads: entityArray },
      },
    },
  }, async (req, reply) => {
    const { dataset, leads } = req.body as { dataset: Record<string, any>; leads: Record<string, any>[] };
    const rev = await commitLeadImport(dataset, leads);
    return reply.code(201).send({ ok: true, count: leads.length, rev });
  });

  // ---- calls ----
  app.post('/api/calls', {
    preHandler: [app.authenticate],
    schema: { body: withId },
  }, async (req, reply) => {
    const rev = await insertCall(req.body as Record<string, any>);
    return reply.code(201).send({ ok: true, rev });
  });

  // ---- requests ----
  app.post('/api/requests', {
    preHandler: [app.authenticate, app.requirePermission('requestData')],
    schema: { body: withId },
  }, async (req, reply) => {
    const rev = await upsertRequest(req.body as Record<string, any>);
    return reply.code(201).send({ ok: true, rev });
  });

  // approve / deny (decision update) — managers with assignData
  app.put('/api/requests/:id', {
    preHandler: [app.authenticate, app.requirePermission('assignData')],
    schema: { body: withId },
  }, async (req, reply) => {
    const rev = await upsertRequest(req.body as Record<string, any>);
    return reply.send({ ok: true, rev });
  });

  // ---- settings ----
  app.put('/api/settings', {
    preHandler: [app.authenticate, app.requirePermission('editSettings')],
    schema: { body: { type: 'object' } },
  }, async (req, reply) => {
    const rev = await upsertSettings(req.body as Record<string, any>);
    return reply.send({ ok: true, rev });
  });

  // ---- audit (append-only) ----
  app.post('/api/audit', {
    preHandler: [app.authenticate],
    schema: { body: withId },
  }, async (req, reply) => {
    await insertAudit(req.body as Record<string, any>);
    return reply.code(201).send({ ok: true });
  });

  // ---- dataset delete (cascade) ----
  app.delete('/api/datasets/:id', {
    preHandler: [app.authenticate, app.requirePermission('manageData')],
    schema: {
      body: {
        type: 'object',
        properties: {
          propertyIds: { type: 'array', items: { type: 'string' } },
          leadIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { propertyIds?: string[]; leadIds?: string[] };
    const rev = await deleteDataset(id, body.propertyIds ?? [], body.leadIds ?? []);
    return reply.send({ ok: true, rev });
  });
}
