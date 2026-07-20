import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Permission } from '../../../src/types/user';
import { PropertyState } from '../../../src/types/models';
import {
  queryProperties, propertyFacets, findPropertyById, findAssignedTo,
  updatePropertyNotes,
} from '../repositories/propertyRepo';
import { callsForProperties } from '../repositories/callRepo';
import {
  assignProperties, reclaimProperties,
} from '../services/assignmentService';
import { undoDnc } from '../services/callService';
import { revealOwnerPhone, recordView, ownerUnitsFor } from '../services/revealService';
import { serializeProperty, serializeCall } from '../http/serializers';
import { forbidden, notFound, badRequest } from '../http/errors';

/**
 * Properties.
 *
 * Two rules run through every route here:
 *
 *  - Nothing returns a real phone number. `serializeProperty` can't emit one;
 *    /reveal is the only door, and it's single-record and audited.
 *
 *  - A broker's scope is enforced server-side, not by hiding UI. Where the
 *    client simply didn't render other brokers' units, `scopeFor()` narrows the
 *    query, so asking for them directly returns nothing rather than everything.
 */

const MAX_PAGE = 200;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'string', maxLength: 200 },
    community: { type: 'string', maxLength: 255 },
    cluster: { type: 'string', maxLength: 255 },
    state: { type: 'string', enum: [...Object.values(PropertyState), ''] },
    beds: { type: 'integer', minimum: 0, maximum: 99 },
    nationality: { type: 'string', maxLength: 128 },
    outcome: { type: 'string', maxLength: 32 },
    txFrom: { type: 'string', maxLength: 40 },
    txTo: { type: 'string', maxLength: 40 },
    callableOnly: { type: 'boolean' },
    dueOnly: { type: 'boolean' },
    interestedOnly: { type: 'boolean' },
    assignedTo: { type: 'string', maxLength: 64 },
    datasetId: { type: 'string', maxLength: 64 },
    scope: { type: 'string', enum: ['all', 'mine', 'pool'] },
    sortKey: { type: 'string', maxLength: 64 },
    asc: { type: 'boolean' },
    page: { type: 'integer', minimum: 0 },
    pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE },
    tz: { type: 'string', maxLength: 8 },
  },
} as const;

interface ListQuery {
  search?: string; community?: string; cluster?: string;
  state?: PropertyState | ''; beds?: number; nationality?: string;
  outcome?: string; txFrom?: string; txTo?: string; callableOnly?: boolean;
  dueOnly?: boolean; interestedOnly?: boolean;
  assignedTo?: string; datasetId?: string;
  scope?: 'all' | 'mine' | 'pool';
  sortKey?: string; asc?: boolean; page?: number; pageSize?: number;
}

export default async function propertyRoutes(app: FastifyInstance) {
  /**
   * Resolve the caller's data scope.
   *
   * `scope=mine` is a broker's assigned/portfolio set. `scope=pool` is the
   * teaser pool — the reference implementation showed brokers pool units with
   * owner data stripped, so `ownerHidden` is forced on and owner-derived
   * filters are refused rather than silently ignored.
   */
  function scopeFor(req: FastifyRequest, q: ListQuery) {
    const me = req.currentUser!;
    const scope = q.scope ?? (me.isManager ? 'all' : 'mine');

    if (scope === 'mine') {
      return {
        assignedTo: me.id,
        states: [PropertyState.assigned, PropertyState.portfolio],
        ownerHidden: false,
      };
    }

    if (scope === 'pool') {
      return {
        states: [PropertyState.pool],
        // Brokers browse the pool as a teaser: no owner names, no numbers.
        ownerHidden: !me.isManager,
      };
    }

    // scope=all is manager-only; a broker asking for it gets their own data.
    if (!me.isManager) {
      return {
        assignedTo: me.id,
        states: [PropertyState.assigned, PropertyState.portfolio],
        ownerHidden: false,
      };
    }
    return { assignedTo: q.assignedTo, ownerHidden: false };
  }

  app.get('/api/properties', {
    preHandler: [app.authenticate],
    schema: { querystring: listQuerySchema },
  }, async (req) => {
    const q = req.query as ListQuery;
    const scope = scopeFor(req, q);

    // A broker in the teaser pool must not filter by owner nationality — that
    // would let them probe hidden owner data one query at a time.
    if (scope.ownerHidden && q.nationality) {
      throw forbidden('Owner details are not available in the pool view.');
    }

    const pageSize = Math.min(q.pageSize ?? 50, MAX_PAGE);
    const page = q.page ?? 0;

    const result = await queryProperties({
      search: q.search,
      community: q.community,
      cluster: q.cluster,
      state: q.state,
      beds: q.beds,
      nationality: scope.ownerHidden ? undefined : q.nationality,
      outcome: q.outcome,
      txFrom: q.txFrom,
      txTo: q.txTo,
      callableOnly: q.callableOnly,
      dueOnly: q.dueOnly,
      interestedOnly: q.interestedOnly,
      datasetId: q.datasetId,
      assignedTo: scope.assignedTo,
      states: scope.states,
      ownerHidden: scope.ownerHidden,
      sortKey: q.sortKey,
      asc: q.asc,
      limit: pageSize,
      offset: page * pageSize,
    });

    return {
      rows: result.rows.map(p => {
        const s = serializeProperty(p);
        // Belt and braces: strip owner identity entirely in teaser mode rather
        // than relying on the client to not render the column.
        if (scope.ownerHidden) {
          return { ...s, owner: { name: '', phone: undefined, nationality: undefined } };
        }
        return s;
      }),
      total: result.total,
      page,
      pageSize,
    };
  });

  /** Dropdown options — over the whole scope, not the current page. */
  app.get('/api/properties/facets', {
    preHandler: [app.authenticate],
    schema: { querystring: listQuerySchema },
  }, async (req) => {
    const q = req.query as ListQuery;
    const scope = scopeFor(req, q);
    const facets = await propertyFacets({
      assignedTo: scope.assignedTo,
      states: scope.states,
      datasetId: q.datasetId,
      community: q.community,
    });
    if (scope.ownerHidden) {
      return { ...facets, nationalities: [] };
    }
    return facets;
  });

  app.get('/api/properties/:id', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await findPropertyById(id);
    if (!p) throw notFound('That unit no longer exists.');

    const me = req.currentUser!;
    if (!me.isManager && p.assignedTo !== me.id) {
      throw forbidden('That unit is not assigned to you.');
    }
    return serializeProperty(p);
  });

  /** Every unit of this unit's owner — the dialer's grouped card. */
  app.get('/api/properties/:id/owner-units', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const me = req.currentUser!;
    const units = await ownerUnitsFor(id);

    if (!me.isManager) {
      const mine = units.filter(u => u.assignedTo === me.id);
      if (mine.length === 0) throw forbidden('That owner is not assigned to you.');
      return mine.map(serializeProperty);
    }
    return units.map(serializeProperty);
  });

  app.get('/api/properties/:id/calls', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await findPropertyById(id);
    if (!p) throw notFound('That unit no longer exists.');
    const me = req.currentUser!;
    if (!me.isManager && p.assignedTo !== me.id) {
      throw forbidden('That unit is not assigned to you.');
    }
    const calls = await callsForProperties([id]);
    return calls.map(serializeCall);
  });

  /**
   * The sanctioned reveal. Single record. Counts against the daily cap and is
   * audited in the same transaction — see services/revealService.
   */
  app.post('/api/properties/:id/reveal', {
    preHandler: [app.authenticate, app.requirePermission(Permission.callOwners)],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          tzOffsetMinutes: { type: 'integer', minimum: -840, maximum: 840 },
          // The dialer's in-call reveal doesn't spend cap (the view was already
          // counted when the session opened) — mirrors recordView(enforceCap:false).
          enforceCap: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { tzOffsetMinutes?: number; enforceCap?: boolean };
    const me = req.currentUser!;

    const p = await findPropertyById(id);
    if (!p) throw notFound('That unit no longer exists.');
    if (!me.isManager && p.assignedTo !== me.id) {
      throw forbidden('That unit is not assigned to you.');
    }

    return revealOwnerPhone(id, {
      user: me,
      tzOffsetMinutes: body.tzOffsetMinutes ?? 0,
      enforceCap: body.enforceCap ?? false,
    });
  });

  /** A non-phone view (opening an owner's detail): audited, counts against cap. */
  app.post('/api/properties/:id/view', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          what: { type: 'string', maxLength: 200 },
          tzOffsetMinutes: { type: 'integer', minimum: -840, maximum: 840 },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { what?: string; tzOffsetMinutes?: number };
    const me = req.currentUser!;

    const p = await findPropertyById(id);
    if (!p) throw notFound('That unit no longer exists.');

    return recordView({
      user: me,
      tzOffsetMinutes: body.tzOffsetMinutes ?? 0,
      enforceCap: true,
      what: body.what ?? `Viewed owner detail ${id}`,
    });
  });

  /**
   * Edit the free-text notes on a property record. A broker may annotate a unit
   * that's assigned to them; a manager, any unit. Not gated by the reveal cap —
   * this is writing text, not seeing a number.
   */
  app.patch('/api/properties/:id/notes', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
      body: {
        type: 'object', required: ['notes'], additionalProperties: false,
        properties: { notes: { type: 'string', maxLength: 4000 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { notes } = req.body as { notes: string };
    const me = req.currentUser!;

    const p = await findPropertyById(id);
    if (!p) throw notFound('That unit no longer exists.');
    if (!me.isManager && p.assignedTo !== me.id) {
      throw forbidden('You can only add notes to a unit assigned to you.');
    }

    await updatePropertyNotes(id, notes.trim());
    const updated = await findPropertyById(id);
    return serializeProperty(updated!);
  });

  app.post('/api/properties/assign', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      body: {
        type: 'object', required: ['propertyIds', 'brokerId'],
        additionalProperties: false,
        properties: {
          propertyIds: {
            type: 'array', minItems: 1, maxItems: 5000,
            items: { type: 'string', maxLength: 64 },
          },
          brokerId: { type: 'string', maxLength: 64 },
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as { propertyIds: string[]; brokerId: string; note?: string };
    return assignProperties(body.propertyIds, body.brokerId, req.currentUser!.id, body.note);
  });

  app.post('/api/properties/reclaim', {
    preHandler: [app.authenticate, app.requirePermission(Permission.assignData)],
    schema: {
      body: {
        type: 'object', required: ['propertyIds'], additionalProperties: false,
        properties: {
          propertyIds: {
            type: 'array', minItems: 1, maxItems: 5000,
            items: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
  }, async (req) => {
    const body = req.body as { propertyIds: string[] };
    const reclaimed = await reclaimProperties(body.propertyIds, req.currentUser!.id);
    return { reclaimed };
  });

  /** DNC is permanent; only a manager may lift it. */
  app.post('/api/properties/:id/undo-dnc', {
    preHandler: [app.authenticate, app.requireManager],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const p = await undoDnc(id, req.currentUser!.id);
    return serializeProperty(p);
  });

  /** A broker's own assigned set, unpaginated — the dialer builds its stops from this. */
  app.get('/api/properties/mine', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const me = req.currentUser!;
    const units = await findAssignedTo(me.id);
    return units.map(serializeProperty);
  });
}
