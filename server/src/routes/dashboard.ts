import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { PropertyState } from '../../../src/types/models';
import {
  countByState, countCallable, countTotal, listCommunities,
  countDistinctOwners, countStalePortfolio, countExpiringSoon,
  assignedCountByBroker, workedByDataset, heldByBrokerAndState, countCallableWorked,
} from '../repositories/propertyRepo';
import { countLeadsByState, countLeadsTotal } from '../repositories/leadRepo';
import {
  brokerCallStats, brokerStatsBetween, statsBetween, rollingStats,
  callsPerDay, countCallsTotal, lifetimeStats,
} from '../repositories/callRepo';
import { countPending } from '../repositories/requestRepo';
import { listUsers } from '../repositories/userRepo';
import { listAudit } from '../repositories/auditRepo';
import { listDatasets } from '../repositories/datasetRepo';
import { datasetBreakdown } from '../repositories/statsRepo';
import { loadSettings } from '../repositories/settingsRepo';
import { serializeAudit } from '../http/serializers';

/**
 * Dashboard aggregates.
 *
 * These exist because of the pagination decision. The manager home used to
 * compute every number by folding the full in-memory snapshot — distinct owners,
 * state counts, stale portfolios, the 14-day series, per-broker totals. With the
 * tables paginated there's no snapshot left to fold, so each number is computed
 * where the data is and arrives pre-summed.
 *
 * One round trip per dashboard, not one per widget.
 *
 * "Today" is the CALLER's day: the client sends its UTC offset, because a Dubai
 * broker's today must not depend on where the server happens to run.
 */

/** Local-day bounds for a caller `tzOffsetMinutes` from UTC. */
function dayBounds(tzOffsetMinutes: number): { from: Date; to: Date } {
  const now = new Date();
  const shifted = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const startShifted = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
  );
  const from = new Date(startShifted - tzOffsetMinutes * 60_000);
  return { from, to: new Date(from.getTime() + 24 * 3600_000) };
}

const tzSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    days: { type: 'integer', minimum: 1, maximum: 90 },
    tzOffsetMinutes: { type: 'integer', minimum: -840, maximum: 840 },
  },
} as const;

export default async function dashboardRoutes(app: FastifyInstance) {
  /** Manager mission control — everything the home screen renders. */
  app.get('/api/dashboard/manager', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
    schema: { querystring: tzSchema },
  }, async (req) => {
    const { days = 14, tzOffsetMinutes = 0 } = req.query as {
      days?: number; tzOffsetMinutes?: number;
    };
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const today = dayBounds(tzOffsetMinutes);
    const settings = await loadSettings();

    const [
      propertyStates, leadStates, callable, totalProperties, totalLeads,
      totalCalls, owners, pending, communities, datasets,
      todayStats, todayByBroker, rolling, momentum,
      allBrokerStats, assignedCounts, worked,
      stale, expiringSoon, users, audit,
    ] = await Promise.all([
      countByState(),
      countLeadsByState(),
      countCallable(),
      countTotal(),
      countLeadsTotal(),
      countCallsTotal(),
      countDistinctOwners(),
      countPending(),
      listCommunities(),
      listDatasets(),
      statsBetween(today.from, today.to),
      brokerStatsBetween(today.from, today.to),
      rollingStats(since),
      callsPerDay(since),
      brokerCallStats(),
      assignedCountByBroker(),
      workedByDataset(),
      countStalePortfolio(settings.portfolioStaleDays),
      countExpiringSoon(settings.expiringSoonHours),
      listUsers(),
      listAudit({ limit: 8, offset: 0 }),
    ]);

    const brokers = users.filter(u => !u.isManager && u.active);
    const lifetimeById = new Map(allBrokerStats.map(s => [s.brokerId, s]));

    const board = brokers.map(b => {
      const t = todayByBroker.get(b.id);
      const lifetime = lifetimeById.get(b.id);
      const onList = assignedCounts.get(b.id) ?? 0;
      return {
        id: b.id,
        name: b.name,
        team: b.team,
        onList,
        callsToday: t?.calls ?? 0,
        reachedToday: t?.reached ?? 0,
        interestedToday: t?.interested ?? 0,
        lastAt: lifetime?.lastAt,
        // "Has data but hasn't called today" — the board's amber dot and the
        // idle-broker alert are the same condition, computed once.
        quiet: onList > 0 && (t?.calls ?? 0) === 0,
      };
    });

    return {
      properties: { total: totalProperties, callable, owners, byState: propertyStates },
      leads: { total: totalLeads, byState: leadStates },
      datasets: datasets.map(d => ({
        id: d.id,
        name: d.name,
        callableUnits: d.callableUnits,
        worked: worked.get(d.id) ?? 0,
      })),
      today: todayStats,
      rolling: {
        days,
        calls: rolling.calls,
        reached: rolling.reached,
        interested: rolling.interested,
        momentum,
      },
      alerts: {
        pendingRequests: pending,
        idleBrokers: board.filter(b => b.quiet).map(b => b.name),
        staleCount: stale,
        expiringSoon,
      },
      communities,
      board,
      recentAudit: audit.entries.map(serializeAudit),
    };
  });

  /**
   * Team & Data ROI.
   *
   * Lifetime per-broker performance plus the spend-versus-return figures. The
   * cost numbers come from the data sets' `cost`, so this is the one screen that
   * puts a price on the vault — manager-only, behind viewReports.
   */
  app.get('/api/dashboard/team', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
  }, async () => {
    const now = Date.now();
    const last7d = new Date(now - 7 * 24 * 3600_000);
    const last24h = new Date(now - 24 * 3600_000);
    const soon = new Date(now + 60_000);

    const [
      users, stats, held, datasets, totalProperties, callable, callableWorked, lifetime,
      by7d, by24h, dsStats,
    ] = await Promise.all([
      listUsers(),
      brokerCallStats(),
      heldByBrokerAndState(),
      listDatasets(),
      countTotal(),
      countCallable(),
      countCallableWorked(),
      lifetimeStats(),
      brokerStatsBetween(last7d, soon),
      brokerStatsBetween(last24h, soon),
      datasetBreakdown(),
    ]);

    const statsById = new Map(stats.map(s => [s.brokerId, s]));
    const totalCost = datasets.reduce((sum, d) => sum + (d.cost ?? 0), 0);

    return {
      brokers: users.filter(u => !u.isManager && u.active).map(b => {
        const s = statsById.get(b.id);
        const h = held.get(b.id) ?? { assigned: 0, portfolio: 0 };
        return {
          id: b.id,
          name: b.name,
          team: b.team,
          assigned: h.assigned,
          portfolio: h.portfolio,
          calls: s?.calls ?? 0,
          calls7d: by7d.get(b.id)?.calls ?? 0,
          calls24h: by24h.get(b.id)?.calls ?? 0,
          reached: s?.reached ?? 0,
          interested: s?.interested ?? 0,
          noAnswer: s?.noAnswer ?? 0,
          lastAt: s?.lastAt,
        };
      }),
      // Per-data-set breakdown, joined with each set's identity/dates. Counts
      // are LIVE (computed from the rows that currently belong to the set), not
      // the stored total — so a set whose units were merged elsewhere reads 0,
      // which is the truth, rather than a stale stored count.
      datasetStats: datasets.map(d => {
        const st = dsStats.get(d.id);
        return {
          id: d.id,
          name: d.name,
          module: d.module,
          properties: st?.properties ?? 0,
          callable: st?.callable ?? 0,
          numbers: st?.numbers ?? 0,
          agents: st?.agents ?? 0,
          assigned: st?.assigned ?? 0,
          untouched: st?.untouched ?? 0,
          calls: st?.calls ?? 0,
          noAnswer: st?.noAnswer ?? 0,
          interested: st?.interested ?? 0,
          cost: d.cost,
          importedAt: d.importedAt,
          lastUpdatedAt: d.lastUpdatedAt,
        };
      }),
      roi: {
        totalCost,
        datasets: datasets.length,
        properties: totalProperties,
        callable,
        callableWorked,
        calls: lifetime.calls,
        reached: lifetime.reached,
        interested: lifetime.interested,
        // Undefined rather than Infinity/0 when nothing is interested yet —
        // "no data" and "costs nothing per lead" are very different claims.
        costPerInterested: lifetime.interested > 0 ? totalCost / lifetime.interested : undefined,
      },
    };
  });

  /** A broker's own home: their pipeline, and how they compare to the team. */
  app.get('/api/dashboard/broker', {
    preHandler: [app.authenticate],
    schema: { querystring: tzSchema },
  }, async (req) => {
    const { tzOffsetMinutes = 0 } = req.query as { tzOffsetMinutes?: number };
    const me = req.currentUser!;
    const today = dayBounds(tzOffsetMinutes);
    const settings = await loadSettings();

    const [propertyStates, allStats, todayByBroker, assignedCounts, pending, myExpiringSoon] =
      await Promise.all([
        countByState(),
        brokerCallStats(),
        brokerStatsBetween(today.from, today.to),
        assignedCountByBroker(),
        countPending(),
        countExpiringSoon(settings.expiringSoonHours, me.id),
      ]);

    const mine = allStats.find(s => s.brokerId === me.id);
    const mineToday = todayByBroker.get(me.id);
    const others = allStats.filter(s => s.brokerId !== me.id);
    const teamAverage = others.length > 0
      ? Math.round(others.reduce((n, s) => n + s.calls, 0) / others.length)
      : 0;

    return {
      myCalls: mine?.calls ?? 0,
      myInterested: mine?.interested ?? 0,
      myLastAt: mine?.lastAt,
      myCallsToday: mineToday?.calls ?? 0,
      myReachedToday: mineToday?.reached ?? 0,
      myInterestedToday: mineToday?.interested ?? 0,
      myOnList: assignedCounts.get(me.id) ?? 0,
      myExpiringSoon,
      teamAverageCalls: teamAverage,
      poolAvailable: propertyStates[PropertyState.pool],
      myPendingRequests: pending,
      byState: propertyStates,
    };
  });
}
