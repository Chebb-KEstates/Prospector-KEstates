import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { PropertyState } from '../../../src/types/models';
import {
  countByState, countCallable, countTotal, listCommunities,
  countDistinctOwners, countStalePortfolio, countExpiringSoon,
  assignedCountByBroker, workedByDataset, heldByBrokerAndState, countCallableWorked,
  callableCoverageByBroker, followUpsDueByBroker,
} from '../repositories/propertyRepo';
import { countLeadsByState, countLeadsTotal } from '../repositories/leadRepo';
import {
  brokerCallStats, brokerStatsBetween, statsBetween, rollingStats,
  callsPerDay, countCallsTotal, lifetimeStats, brokerFunnelWindow,
  newInterestedUnitsByBroker,
  newInterestedUnitsByArea,
  newInterestedUnitsCount,
} from '../repositories/callRepo';
import { countPending } from '../repositories/requestRepo';
import { listUsers } from '../repositories/userRepo';
import { listAudit } from '../repositories/auditRepo';
import { listDatasets } from '../repositories/datasetRepo';
import { assignmentMatrix, areaBreakdown, areaAssignmentMatrix } from '../repositories/statsRepo';
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
    const soon = new Date(Date.now() + 60_000);
    const last7d = new Date(Date.now() - 7 * 24 * 3600_000);
    const last30d = new Date(Date.now() - 30 * 24 * 3600_000);
    const settings = await loadSettings();

    const [
      propertyStates, leadStates, callable, totalProperties, totalLeads,
      totalCalls, owners, pending, communities, datasets,
      todayStats, todayByBroker, rolling, momentum,
      allBrokerStats, assignedCounts, worked,
      stale, expiringSoon, users, audit,
      weekStats, monthStats,
      todayUnits, weekUnits, monthUnits, rollingUnits, todayUnitsByBroker,
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
      statsBetween(last7d, soon),
      statsBetween(last30d, soon),
      // Interested is now distinct units that BECAME interested in each window
      // (counted once each), not interested call events — one meaning app-wide.
      newInterestedUnitsCount(today.from, today.to),
      newInterestedUnitsCount(last7d, soon),
      newInterestedUnitsCount(last30d, soon),
      newInterestedUnitsCount(since, soon),
      newInterestedUnitsByBroker(today.from, today.to),
    ]);

    // The calling funnel per period — calls → reached → interested, plus the
    // no-answer count (from each window's outcome breakdown). `interested` is the
    // distinct units that became interested in the window (a transition), passed
    // in separately, so it means the same as everywhere else — not a call count.
    const funnelOf = (w: { calls: number; reached: number; outcomes: Record<string, number> }, interestedUnits: number) => ({
      calls: w.calls, reached: w.reached, interested: interestedUnits, noAnswer: w.outcomes['noAnswer'] ?? 0,
    });

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
        // Distinct units this broker turned interested today (once each), matching
        // the report's "New interested" — not interested call events.
        interestedToday: todayUnitsByBroker.get(b.id) ?? 0,
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
      today: { ...todayStats, interested: todayUnits },
      funnel: {
        today: funnelOf(todayStats, todayUnits),
        week: funnelOf(weekStats, weekUnits),
        month: funnelOf(monthStats, monthUnits),
      },
      rolling: {
        days,
        calls: rolling.calls,
        reached: rolling.reached,
        interested: rollingUnits,
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
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          // Report date range for the per-broker CALL columns (attempts, answered,
          // interested, rates). ISO bounds, [from, to). Omit both for all-time.
          from: { type: 'string', maxLength: 40 },
          to: { type: 'string', maxLength: 40 },
        },
      },
    },
  }, async (req) => {
    const { from: fromISO, to: toISO } = req.query as { from?: string; to?: string };
    const from = fromISO ? new Date(fromISO) : undefined;
    const to = toISO ? new Date(toISO) : undefined;
    const ranged = !!(from && !isNaN(from.getTime()) && to && !isNaN(to.getTime()));

    const [
      users, stats, held, datasets, totalProperties, callable, callableWorked, lifetime,
      windowStats, coverage, followUps, matrix, areaStats, areaMatrix, interestedUnits,
      areaInterested, roiInterestedUnits,
    ] = await Promise.all([
      listUsers(),
      brokerCallStats(),
      heldByBrokerAndState(),
      listDatasets(),
      countTotal(),
      countCallable(),
      countCallableWorked(),
      lifetimeStats(),
      // Windowed per-broker call stats when a range is given; otherwise all-time
      // comes from `stats` (brokerCallStats) below, so this stays empty.
      ranged ? brokerStatsBetween(from!, to!) : Promise.resolve(new Map()),
      callableCoverageByBroker(),
      followUpsDueByBroker(),
      assignmentMatrix(),
      areaBreakdown(),
      areaAssignmentMatrix(),
      // Interested = distinct NEW interested units generated in the range — units
      // that transitioned into interested (not just any interested call).
      ranged ? newInterestedUnitsByBroker(from!, to!) : newInterestedUnitsByBroker(),
      // Per-AREA new interested units — same transition rule, grouped by area,
      // driven by the same range as the broker columns.
      ranged ? newInterestedUnitsByArea(from!, to!) : newInterestedUnitsByArea(),
      // ROI is all-time and org-wide: distinct units the vault ever turned
      // interested, so "cost per interested" is cost per interested PROPERTY.
      newInterestedUnitsCount(),
    ]);

    const statsById = new Map(stats.map(s => [s.brokerId, s]));
    const totalCost = datasets.reduce((sum, d) => sum + (d.cost ?? 0), 0);

    // Which data sets each broker holds (name + unit count), for the broker
    // table's "Data assigned" column. Sorted biggest-first; a set that no longer
    // exists is skipped.
    const brokerName = new Map(users.map(u => [u.id, u.name]));
    const setName = new Map(datasets.map(d => [d.id, d.name]));
    const brokerHoldings = new Map<string, { name: string; units: number }[]>();
    for (const c of matrix) {
      const dName = setName.get(c.datasetId);
      if (dName) {
        const list = brokerHoldings.get(c.brokerId) ?? [];
        list.push({ name: dName, units: c.units });
        brokerHoldings.set(c.brokerId, list);
      }
    }
    const byUnits = (a: { units: number }, b: { units: number }) => b.units - a.units;

    // Which brokers hold how many units in each AREA (community + sub-community).
    const areaKey = (community: string, cluster: string) => `${community}${cluster}`;
    const areaLabelOf = (community: string, cluster: string) => {
      const c = community || '(no community)';
      return cluster ? `${c} · ${cluster}` : c;
    };
    // New-interested-units-in-range per area, keyed the same way as the rows.
    const areaInterestedByKey = new Map(
      areaInterested.map(a => [areaKey(a.community, a.cluster), a.n]),
    );
    const areaBrokers = new Map<string, { name: string; units: number }[]>();
    // Which areas each broker holds — the broker table's "Areas held" column.
    const brokerAreas = new Map<string, { name: string; units: number }[]>();
    for (const c of areaMatrix) {
      const bName = brokerName.get(c.brokerId);
      if (!bName) continue;
      const key = areaKey(c.community, c.cluster);
      const list = areaBrokers.get(key) ?? [];
      list.push({ name: bName, units: c.units });
      areaBrokers.set(key, list);

      const bList = brokerAreas.get(c.brokerId) ?? [];
      bList.push({ name: areaLabelOf(c.community, c.cluster), units: c.units });
      brokerAreas.set(c.brokerId, bList);
    }

    return {
      brokers: users.filter(u => !u.isManager && u.active).map(b => {
        const s = statsById.get(b.id);
        const h = held.get(b.id) ?? { assigned: 0, portfolio: 0 };
        // Call columns follow the selected range when one is given; otherwise
        // they're the broker's all-time totals. `lastAt` is always all-time — an
        // "is this broker still active" recency signal, not a windowed figure.
        const w = ranged ? windowStats.get(b.id) : undefined;
        const calls = ranged ? (w?.calls ?? 0) : (s?.calls ?? 0);
        const reached = ranged ? (w?.reached ?? 0) : (s?.reached ?? 0);
        // Interested = distinct NEW interested units the broker generated in the
        // range (a transition into interested), not interested call events.
        const interested = interestedUnits.get(b.id) ?? 0;
        const cov = coverage.get(b.id) ?? { callable: 0, worked: 0 };
        return {
          id: b.id,
          name: b.name,
          team: b.team,
          assigned: h.assigned,
          portfolio: h.portfolio,
          calls,
          reached,
          interested,
          // No answer = attempts that didn't connect (no-answer + unreachable),
          // so Answered + No answer always reconciles to attempts.
          noAnswer: Math.max(0, calls - reached),
          lastAt: s?.lastAt,
          callableAssigned: cov.callable,
          callableWorked: cov.worked,
          followUpsDue: followUps.get(b.id) ?? 0,
          areas: (brokerAreas.get(b.id) ?? []).slice().sort(byUnits),
          datasets: (brokerHoldings.get(b.id) ?? []).slice().sort(byUnits),
        };
      }),
      // Per-AREA breakdown (community + sub-community), with the brokers holding
      // units in each. Independent of which upload a unit came from, so an area
      // split across several data sets still reads as one row.
      areas: areaStats.map(a => ({
        id: areaKey(a.community, a.cluster),
        community: a.community,
        cluster: a.cluster,
        properties: a.properties,
        callable: a.callable,
        assigned: a.assigned,
        pool: a.pool,
        untouched: a.untouched,
        // Interested = distinct NEW interested units generated in the range for
        // this area (a transition into interested), not a snapshot of units whose
        // last outcome is currently interested. Mirrors the broker table.
        interested: areaInterestedByKey.get(areaKey(a.community, a.cluster)) ?? 0,
        brokers: (areaBrokers.get(areaKey(a.community, a.cluster)) ?? []).slice().sort(byUnits),
      })),
      roi: {
        totalCost,
        datasets: datasets.length,
        properties: totalProperties,
        callable,
        callableWorked,
        calls: lifetime.calls,
        reached: lifetime.reached,
        // Interested = distinct units the vault ever turned interested (counted
        // once each), not interested call events — so it matches the report
        // tables and never double-counts a re-called unit.
        interested: roiInterestedUnits,
        // Undefined rather than Infinity/0 when nothing is interested yet —
        // "no data" and "costs nothing per lead" are very different claims.
        costPerInterested: roiInterestedUnits > 0 ? totalCost / roiInterestedUnits : undefined,
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
    const soon = new Date(Date.now() + 60_000);
    const last7d = new Date(Date.now() - 7 * 24 * 3600_000);
    const last30d = new Date(Date.now() - 30 * 24 * 3600_000);
    const settings = await loadSettings();

    const [
      propertyStates, allStats, assignedCounts, pending, myExpiringSoon,
      todayFunnel, weekFunnel, monthFunnel,
    ] = await Promise.all([
      countByState(),
      brokerCallStats(),
      assignedCountByBroker(),
      countPending(),
      countExpiringSoon(settings.expiringSoonHours, me.id),
      brokerFunnelWindow(me.id, today.from, today.to),
      brokerFunnelWindow(me.id, last7d, soon),
      brokerFunnelWindow(me.id, last30d, soon),
    ]);

    // Interested = distinct units this broker turned interested (once each), for
    // each window and all-time — the same meaning as the manager report.
    const [myTodayUnits, myWeekUnits, myMonthUnits, myAllTimeUnits] = await Promise.all([
      newInterestedUnitsCount(today.from, today.to, me.id),
      newInterestedUnitsCount(last7d, soon, me.id),
      newInterestedUnitsCount(last30d, soon, me.id),
      newInterestedUnitsCount(undefined, undefined, me.id),
    ]);

    const mine = allStats.find(s => s.brokerId === me.id);
    const others = allStats.filter(s => s.brokerId !== me.id);
    const teamAverage = others.length > 0
      ? Math.round(others.reduce((n, s) => n + s.calls, 0) / others.length)
      : 0;

    return {
      myCalls: mine?.calls ?? 0,
      myInterested: myAllTimeUnits,
      myLastAt: mine?.lastAt,
      myCallsToday: todayFunnel.calls,
      myReachedToday: todayFunnel.reached,
      myInterestedToday: myTodayUnits,
      myOnList: assignedCounts.get(me.id) ?? 0,
      myExpiringSoon,
      teamAverageCalls: teamAverage,
      poolAvailable: propertyStates[PropertyState.pool],
      myPendingRequests: pending,
      byState: propertyStates,
      funnel: {
        today: { ...todayFunnel, interested: myTodayUnits },
        week: { ...weekFunnel, interested: myWeekUnits },
        month: { ...monthFunnel, interested: myMonthUnits },
      },
    };
  });
}
