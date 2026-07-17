import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { PropertyState } from '../../../src/types/models';
import {
  countByState, countCallable, countTotal, listCommunities,
} from '../repositories/propertyRepo';
import { countLeadsByState, countLeadsTotal } from '../repositories/leadRepo';
import {
  brokerCallStats, outcomeCounts, callsPerDay, countCallsTotal,
} from '../repositories/callRepo';
import { countPending } from '../repositories/requestRepo';
import { listUsers } from '../repositories/userRepo';
import { listAudit } from '../repositories/auditRepo';
import { serializeAudit } from '../http/serializers';

/**
 * Dashboard aggregates.
 *
 * These exist because of the pagination decision. The client used to compute
 * every dashboard number by mapping and filtering the full in-memory snapshot —
 * `countIn(state)`, `callable`, the broker board, the 14-day momentum chart.
 * With the tables paginated there is no full snapshot to fold over any more, so
 * the aggregates get computed where the data is, in grouped SQL, and arrive
 * pre-summed.
 *
 * One round trip per dashboard, not one per widget.
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  /** Manager mission control. */
  app.get('/api/dashboard/manager', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { days: { type: 'integer', minimum: 1, maximum: 90 } },
      },
    },
  }, async (req) => {
    const { days = 14 } = req.query as { days?: number };
    const since = new Date(Date.now() - days * 24 * 3600_000);

    const [
      propertyStates, leadStates, callable, totalProperties, totalLeads,
      totalCalls, pending, communities, brokerStats, outcomes, momentum, users, audit,
    ] = await Promise.all([
      countByState(),
      countLeadsByState(),
      countCallable(),
      countTotal(),
      countLeadsTotal(),
      countCallsTotal(),
      countPending(),
      listCommunities(),
      brokerCallStats(),
      outcomeCounts(since),
      callsPerDay(since),
      listUsers(),
      listAudit({ limit: 20, offset: 0 }),
    ]);

    const brokers = users.filter(u => !u.isManager);
    const statsById = new Map(brokerStats.map(s => [s.brokerId, s]));

    return {
      properties: {
        total: totalProperties,
        callable,
        byState: propertyStates,
      },
      leads: { total: totalLeads, byState: leadStates },
      calls: { total: totalCalls, outcomes, momentum },
      pendingRequests: pending,
      communities,
      // The broker board: every active broker, zero-filled if they haven't called.
      board: brokers.map(b => {
        const s = statsById.get(b.id);
        return {
          id: b.id,
          name: b.name,
          team: b.team,
          active: b.active,
          calls: s?.calls ?? 0,
          interested: s?.interested ?? 0,
          lastAt: s?.lastAt,
        };
      }),
      recentAudit: audit.entries.map(serializeAudit),
    };
  });

  /** A broker's own home: their pipeline, and how they compare to the team. */
  app.get('/api/dashboard/broker', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const me = req.currentUser!;
    const [propertyStates, brokerStats, pending, poolCounts] = await Promise.all([
      countByState(),
      brokerCallStats(),
      countPending(),
      countByState(),
    ]);

    const mine = brokerStats.find(s => s.brokerId === me.id);
    const others = brokerStats.filter(s => s.brokerId !== me.id);
    const teamAverage = others.length > 0
      ? Math.round(others.reduce((n, s) => n + s.calls, 0) / others.length)
      : 0;

    return {
      myCalls: mine?.calls ?? 0,
      myInterested: mine?.interested ?? 0,
      myLastAt: mine?.lastAt,
      teamAverageCalls: teamAverage,
      poolAvailable: poolCounts[PropertyState.pool],
      myPendingRequests: pending,
      byState: propertyStates,
    };
  });
}
