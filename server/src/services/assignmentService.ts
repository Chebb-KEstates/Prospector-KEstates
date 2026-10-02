import type { PoolConnection } from 'mysql2/promise';
import { transaction, pool, Row } from '../db/pool';
import {
  Property, Lead, PropertyState, BatchRequest, RequestStatus, UnitDecision, kOrgId,
} from '../../../src/types/models';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';
import { assignmentDeadlineOnAssign } from '../../../src/logic/dispositions';
import { toProperty, saveProperties } from '../repositories/propertyRepo';
import { toLead, saveLeads } from '../repositories/leadRepo';
import { lockRequestForDecision, markDecided, setUnitDecisions } from '../repositories/requestRepo';
import { loadSettings } from '../repositories/settingsRepo';
import { writeAudit } from '../repositories/auditRepo';
import { findUserById } from '../repositories/userRepo';
import { badRequest, conflict, notFound } from '../http/errors';

/**
 * Assignment — the transactional heart of the app.
 *
 * Two races existed client-side, both reachable with two managers in the app at
 * once, and both invisible until they corrupt something:
 *
 *  1. `assign()` read the local snapshot to expand a batch to owner-linked
 *     units. Two managers assigning overlapping owners would each compute their
 *     expansion against stale state and clobber each other — one broker silently
 *     losing units they'd been given.
 *
 *  2. `approveRequest()` picked pool units from the local snapshot. Two managers
 *     approving different requests could grant the *same* units twice, breaking
 *     the guarantee that one owner belongs to one broker.
 *
 * Both are fixed the same way: select the candidate rows `FOR UPDATE` inside a
 * transaction, re-check their state under the lock, and only then write. A
 * concurrent caller blocks, then sees the updated state and acts on reality.
 */

const ASSIGNABLE_COLS = `
  id, org_id, dataset_id, state, unit_key, community, cluster, building,
  unit_number, plot_number, property_type, beds, size_sqft, plot_sqft,
  last_transaction_date, last_transaction_value, tx_count,
  rent_start, rent_end, rent_amount,
  owner_name, owner_phone, owner_phones, owners, owner_nationality, extra,
  created_at, updated_at, assigned_to, assigned_at, assignment_note,
  cooldown_until, portfolio_since, last_outcome, last_called_at,
  call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;

export interface AssignResult {
  assigned: number;
  ownerLinkedExtra: number;
  /** Owners left untouched because they're being worked in another broker's portfolio. */
  skippedOwners: number;
  skippedUnits: number;
}

/**
 * The units that make a reassignment a CONFLICT: owners in the selection who
 * currently have a unit in `portfolio` (interested, being worked) held by a
 * broker OTHER than the target. Reassigning would either move that live deal or
 * split the owner, so the manager is warned first. Read-only (no lock) — the
 * actual assign re-checks under a lock.
 */
export async function previewAssignConflicts(
  propertyIds: string[], brokerId: string,
): Promise<{ conflictUnits: Property[]; conflictOwners: number }> {
  if (propertyIds.length === 0) return { conflictUnits: [], conflictOwners: 0 };
  const [chosenRows] = await pool.query<Row[]>(
    `SELECT ${ASSIGNABLE_COLS} FROM properties WHERE id IN (${propertyIds.map(() => '?').join(', ')})`,
    propertyIds,
  );
  const ownerKeys = Array.from(new Set(chosenRows.map(toProperty).map(ownerKeyOf)));
  if (ownerKeys.length === 0) return { conflictUnits: [], conflictOwners: 0 };
  const [rows] = await pool.query<Row[]>(
    `SELECT ${ASSIGNABLE_COLS} FROM properties
      WHERE org_id = ? AND state = 'portfolio' AND assigned_to IS NOT NULL AND assigned_to <> ?
        AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})`,
    [kOrgId, brokerId, ...ownerKeys],
  );
  const conflictUnits = rows.map(toProperty);
  const conflictOwners = new Set(conflictUnits.map(ownerKeyOf)).size;
  return { conflictUnits, conflictOwners };
}

/**
 * Assign properties to a broker.
 *
 * An owner's units in ONE area are indivisible. Assigning any of them EXPANDS to
 * the whole same-area group — from the pool AND from any other broker — and moves
 * the lot to this broker. So assigning one unit can assign four, and **reassigning
 * one unit reassigns the whole group** (the manager's deliberate move; two brokers
 * are never left working the same owner in the same area). Do-not-call units are
 * left untouched. The audit line says "(incl. N owner-linked)".
 */
export async function assignProperties(
  propertyIds: string[],
  brokerId: string,
  actorId: string,
  note?: string,
  skipConflictOwners = false,
): Promise<AssignResult> {
  if (propertyIds.length === 0) return { assigned: 0, ownerLinkedExtra: 0, skippedOwners: 0, skippedUnits: 0 };

  const broker = await findUserById(brokerId);
  if (!broker || !broker.active) {
    throw notFound('That broker no longer has an active account.');
  }
  const settings = await loadSettings();

  return transaction(async (cx) => {
    // 1. Lock the explicitly chosen rows.
    const [chosenRows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE id IN (${propertyIds.map(() => '?').join(', ')}) FOR UPDATE`,
      propertyIds,
    );
    const chosen = chosenRows.map(toProperty);
    if (chosen.length === 0) throw notFound('Those units no longer exist.');

    // 2. Expand to the WHOLE owner-in-area group under the same lock — every
    //    same-area unit of these owners, whether pooled or held by another broker
    //    (do-not-call excluded). `ownerKeyOf` is the shared function; `owner_key`
    //    is the column written from it.
    const ownerCommunity = new Set(chosen.map(p => `${ownerKeyOf(p)}|${p.community}`));
    const ownerKeys = Array.from(new Set(chosen.map(p => ownerKeyOf(p))));
    const chosenIds = new Set(chosen.map(p => p.id));

    const [groupRows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE org_id = ? AND state <> 'dnc'
         AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
       FOR UPDATE`,
      [kOrgId, ...ownerKeys],
    );
    const linked = groupRows
      .map(toProperty)
      .filter(p => !chosenIds.has(p.id) && ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`));

    let expanded = [...chosen, ...linked];

    // 2b. Conflict owners: those with a unit in another broker's portfolio (a live
    //     deal being worked). Re-checked here under the lock, not trusted from the
    //     client. When `skipConflictOwners`, drop every unit of those owners so the
    //     other broker keeps the whole owner untouched.
    const [portRows] = await cx.query<Row[]>(
      `SELECT owner_key FROM properties
        WHERE org_id = ? AND state = 'portfolio' AND assigned_to IS NOT NULL AND assigned_to <> ?
          AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})`,
      [kOrgId, brokerId, ...ownerKeys],
    );
    const conflictOwnerKeys = new Set(portRows.map(r => r.owner_key as string));
    let skippedOwners = 0, skippedUnits = 0;
    if (skipConflictOwners && conflictOwnerKeys.size > 0) {
      const before = expanded.length;
      expanded = expanded.filter(p => !conflictOwnerKeys.has(ownerKeyOf(p)));
      skippedOwners = conflictOwnerKeys.size;
      skippedUnits = before - expanded.length;
    }
    if (expanded.length === 0) {
      return { assigned: 0, ownerLinkedExtra: 0, skippedOwners, skippedUnits };
    }

    // 3. Mutate + persist — a fresh assignment of the whole group to this broker.
    const now = new Date().toISOString();
    const movedFromAnother = expanded.some(p => p.assignedTo && p.assignedTo !== brokerId);
    for (const p of expanded) {
      p.state = PropertyState.assigned;
      p.assignedTo = brokerId;
      p.assignedAt = now;
      p.assignmentNote = note;
      p.callAttempts = 0;
      p.nextFollowUpAt = undefined;
      p.cooldownUntil = undefined;
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = assignmentDeadlineOnAssign(now, settings);
      p.updatedAt = now;
    }
    await saveProperties(expanded, cx);

    const extra = Math.max(0, expanded.length - chosen.length);
    await writeAudit({
      actorId,
      action: 'assign',
      detail: `Assigned to ${broker.name}` +
        (extra > 0 ? ` (incl. ${extra} owner-linked)` : '') +
        (skippedUnits > 0 ? ` — skipped ${skippedUnits} unit(s) for ${skippedOwners} owner(s) held in another portfolio` : '') +
        (movedFromAnother ? ' — owner group reassigned' : ''),
      propertyIds: expanded.map(p => p.id),
    }, cx);

    return { assigned: expanded.length, ownerLinkedExtra: extra, skippedOwners, skippedUnits };
  });
}

/**
 * Reclaim to the pool. Like assignment, this acts on the WHOLE owner-in-area
 * group: reclaiming one unit reclaims every same-area unit of that owner held by
 * the broker, so the group stays together (do-not-call units are left terminal).
 */
export async function reclaimProperties(propertyIds: string[], actorId: string): Promise<number> {
  if (propertyIds.length === 0) return 0;

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE id IN (${propertyIds.map(() => '?').join(', ')}) FOR UPDATE`,
      propertyIds,
    );
    const chosen = rows.map(toProperty);
    if (chosen.length === 0) return 0;

    // Expand to the whole same-area owner group (held units only).
    const ownerCommunity = new Set(chosen.map(p => `${ownerKeyOf(p)}|${p.community}`));
    const ownerKeys = Array.from(new Set(chosen.map(p => ownerKeyOf(p))));
    const chosenIds = new Set(chosen.map(p => p.id));
    const [groupRows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE org_id = ? AND state IN ('assigned', 'portfolio', 'cooling')
         AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
       FOR UPDATE`,
      [kOrgId, ...ownerKeys],
    );
    const linked = groupRows.map(toProperty)
      .filter(p => !chosenIds.has(p.id) && ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`));

    const now = new Date().toISOString();
    const changed: typeof chosen = [];
    for (const p of [...chosen, ...linked]) {
      if (p.state === PropertyState.dnc || p.state === PropertyState.pool) continue;
      p.state = PropertyState.pool;
      p.assignedTo = undefined;
      p.assignedAt = undefined;
      p.assignmentNote = undefined;
      p.nextFollowUpAt = undefined;
      p.portfolioSince = undefined;
      p.cooldownUntil = undefined;
      p.assignmentExpiresAt = undefined;
      p.callAttempts = 0;
      p.updatedAt = now;
      changed.push(p);
    }
    if (changed.length === 0) return 0;
    await saveProperties(changed, cx);

    await writeAudit({
      actorId, action: 'reclaim', detail: 'Reclaimed owner group to the pool',
      propertyIds: changed.map(p => p.id),
    }, cx);

    return changed.length;
  });
}

const LEAD_COLS = `
  id, org_id, dataset_id, state, lead_key, enquiry_date, name, phone, email,
  project, source, extra, created_at, updated_at, assigned_to, assigned_at,
  assignment_note, cooldown_until, portfolio_since, last_outcome,
  last_called_at, call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;

/** Leads have no owner-linked expansion — one lead is one person. */
export async function assignLeads(
  leadIds: string[], brokerId: string, actorId: string, note?: string,
): Promise<number> {
  if (leadIds.length === 0) return 0;

  const broker = await findUserById(brokerId);
  if (!broker || !broker.active) {
    throw notFound('That broker no longer has an active account.');
  }
  const settings = await loadSettings();

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${LEAD_COLS} FROM leads WHERE id IN (${leadIds.map(() => '?').join(', ')}) FOR UPDATE`,
      leadIds,
    );
    const batch = rows.map(toLead);
    if (batch.length === 0) return 0;

    const now = new Date().toISOString();
    for (const l of batch) {
      l.state = PropertyState.assigned;
      l.assignedTo = brokerId;
      l.assignedAt = now;
      l.assignmentNote = note;
      l.callAttempts = 0;
      l.nextFollowUpAt = undefined;
      l.assignmentExpiresAt = assignmentDeadlineOnAssign(now, settings);
      l.updatedAt = now;
    }
    await saveLeads(batch, cx);

    await writeAudit({
      actorId, action: 'assign',
      detail: `Assigned ${batch.length} lead${batch.length === 1 ? '' : 's'} to ${broker.name}`,
      propertyIds: [],
    }, cx);

    return batch.length;
  });
}

export async function reclaimLeads(leadIds: string[], actorId: string): Promise<number> {
  if (leadIds.length === 0) return 0;

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${LEAD_COLS} FROM leads WHERE id IN (${leadIds.map(() => '?').join(', ')}) FOR UPDATE`,
      leadIds,
    );
    const batch = rows.map(toLead);
    if (batch.length === 0) return 0;

    const now = new Date().toISOString();
    for (const l of batch) {
      l.state = PropertyState.pool;
      l.assignedTo = undefined;
      l.assignedAt = undefined;
      l.assignmentNote = undefined;
      l.nextFollowUpAt = undefined;
      l.portfolioSince = undefined;
      l.assignmentExpiresAt = undefined;
      l.updatedAt = now;
    }
    await saveLeads(batch, cx);

    await writeAudit({
      actorId, action: 'reclaim', detail: 'Leads reclaimed to the pool',
    }, cx);
    return batch.length;
  });
}

/**
 * Grant already-locked pool units to a broker: the owner-split guard, then the
 * owner-linked expansion, persisted and audited. Shared by the whole-request
 * approval and the per-unit decision so both follow the same owner rules.
 *
 * Returns `grant` (the requested units that survived the guard) and `expanded`
 * (those plus the owner-linked pool units that came with them).
 */
async function grantToBroker(
  cx: PoolConnection, candidates: Property[], brokerId: string, actorId: string,
  settings: Awaited<ReturnType<typeof loadSettings>>,
): Promise<{ grant: Property[]; expanded: Property[] }> {
  let grant = candidates;

  // Guard: never split an owner's same-area units across brokers. Drop any
  // granted unit whose owner is already held by a DIFFERENT broker in that
  // community — the requester still receives everything else.
  if (grant.length > 0) {
    const gOwnerKeys = Array.from(new Set(grant.map(p => ownerKeyOf(p))));
    const [heldRows] = await cx.query<Row[]>(
      `SELECT owner_key, community FROM properties
       WHERE org_id = ? AND assigned_to IS NOT NULL AND assigned_to <> ?
         AND state IN ('assigned', 'portfolio', 'cooling')
         AND owner_key IN (${gOwnerKeys.map(() => '?').join(', ')})
       FOR UPDATE`,
      [kOrgId, brokerId, ...gOwnerKeys],
    );
    const taken = new Set(heldRows.map(r => `${r.owner_key as string}|${r.community as string}`));
    grant = grant.filter(p => !taken.has(`${ownerKeyOf(p)}|${p.community}`));
  }
  if (grant.length === 0) return { grant, expanded: [] };

  const broker = await findUserById(brokerId);
  const now = new Date().toISOString();

  // Expand to owner-linked pool units, same rule as a manual assign.
  const ownerCommunity = new Set(grant.map(p => `${ownerKeyOf(p)}|${p.community}`));
  const ownerKeys = Array.from(new Set(grant.map(p => ownerKeyOf(p))));
  const grantIds = new Set(grant.map(p => p.id));

  const [linkedRows] = await cx.query<Row[]>(
    `SELECT ${ASSIGNABLE_COLS} FROM properties
     WHERE org_id = ? AND state = 'pool'
       AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
     FOR UPDATE`,
    [kOrgId, ...ownerKeys],
  );
  const linked = linkedRows
    .map(toProperty)
    .filter(p => !grantIds.has(p.id) && ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`));

  const expanded = [...grant, ...linked];
  for (const p of expanded) {
    p.state = PropertyState.assigned;
    p.assignedTo = brokerId;
    p.assignedAt = now;
    p.assignmentNote = 'Requested batch';
    p.callAttempts = 0;
    p.nextFollowUpAt = undefined;
    p.assignmentExpiresAt = assignmentDeadlineOnAssign(now, settings);
    p.updatedAt = now;
  }
  await saveProperties(expanded, cx);

  const extra = expanded.length - grant.length;
  await writeAudit({
    actorId, action: 'assign',
    detail: `Assigned to ${broker?.name ?? brokerId}` +
      (extra > 0 ? ` (incl. ${extra} owner-linked)` : ''),
    propertyIds: expanded.map(p => p.id),
  }, cx);

  return { grant, expanded };
}

/** What one approve/deny of a hand-picked request's units did. */
export interface UnitDecisionResult {
  request: BatchRequest;
  /** Units the manager decided in this call. */
  decided: number;
  /** Of those: granted to the broker. */
  granted: number;
  /** Of those: approved but not grantable (left the pool / owner held by another broker). */
  unavailable: number;
  /** Of those: denied. */
  denied: number;
  /** OTHER units of this request granted along with them (same owner, same area). */
  linkedInRequest: number;
  /** Units outside the request assigned along with them (same owner, same area, in the pool). */
  ownerLinkedExtra: number;
}

/**
 * Decide some of a LOCKED hand-picked request's undecided units, then update the
 * request: it stays `pending` while any unit is undecided and closes once the
 * last one is decided — `approved` if anything was granted, else `denied`.
 * The caller has validated `unitIds` (undecided units of this request).
 */
async function decideUnitsLocked(
  cx: PoolConnection, req: BatchRequest, unitIds: string[], action: 'approve' | 'deny',
  actorId: string, settings: Awaited<ReturnType<typeof loadSettings>>,
): Promise<UnitDecisionResult> {
  const out = { decided: unitIds.length, granted: 0, unavailable: 0, denied: 0, linkedInRequest: 0, ownerLinkedExtra: 0 };

  if (unitIds.length > 0 && action === 'deny') {
    await setUnitDecisions(req.id, unitIds, UnitDecision.denied, cx);
    for (const id of unitIds) req.unitDecisions[id] = UnitDecision.denied;
    out.denied = unitIds.length;
  } else if (unitIds.length > 0) {
    // Lock the selected units; only those still in the pool can be granted.
    const [rows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE id IN (${unitIds.map(() => '?').join(', ')}) AND state = 'pool'
       FOR UPDATE`,
      unitIds,
    );
    const { expanded } = await grantToBroker(cx, rows.map(toProperty), req.brokerId, actorId, settings);
    const expandedIds = new Set(expanded.map(p => p.id));
    const selected = new Set(unitIds);
    const inRequest = new Set(req.unitIds);

    const grantedSel = unitIds.filter(id => expandedIds.has(id));
    const unavailableSel = unitIds.filter(id => !expandedIds.has(id));
    // Other units of THIS request that came along by the owner rule are now the
    // broker's — record them as granted so the request reflects reality.
    const linked = req.unitIds.filter(id =>
      !selected.has(id) && expandedIds.has(id) && req.unitDecisions[id] !== UnitDecision.granted);

    await setUnitDecisions(req.id, [...grantedSel, ...linked], UnitDecision.granted, cx);
    await setUnitDecisions(req.id, unavailableSel, UnitDecision.unavailable, cx);
    for (const id of [...grantedSel, ...linked]) req.unitDecisions[id] = UnitDecision.granted;
    for (const id of unavailableSel) req.unitDecisions[id] = UnitDecision.unavailable;

    out.granted = grantedSel.length;
    out.unavailable = unavailableSel.length;
    out.linkedInRequest = linked.length;
    out.ownerLinkedExtra = expanded.filter(p => !inRequest.has(p.id)).length;
  }

  const grantedCount = req.unitCountWith(UnitDecision.granted);
  const remaining = req.pendingUnitIds.length;
  const closed = remaining === 0;
  const next = req.decided(
    closed ? (grantedCount > 0 ? RequestStatus.approved : RequestStatus.denied) : RequestStatus.pending,
    grantedCount,
  );
  if (!closed) next.decidedAt = undefined;
  await markDecided(next, closed ? actorId : null, cx);

  const tail = closed ? ' — request closed' : ` — ${remaining} still pending`;
  await writeAudit(action === 'approve'
    ? {
        actorId, action: 'approve',
        detail: `Request ${req.id}: granted ${out.granted} of ${out.decided} selected` +
          (out.linkedInRequest > 0 ? ` (+${out.linkedInRequest} owner-linked from the same request)` : '') + tail,
      }
    : { actorId, action: 'deny', detail: `Request ${req.id}: denied ${out.denied} unit(s)` + tail },
  cx);

  return { request: next, ...out };
}

/**
 * Approve or deny SOME units of a hand-picked request. The request row is locked
 * first, so two managers deciding the same request are serialised, and a unit
 * that was decided meanwhile is rejected rather than decided twice.
 */
export async function decideRequestUnits(
  requestId: string, unitIds: string[], action: 'approve' | 'deny', actorId: string,
): Promise<UnitDecisionResult> {
  const ids = Array.from(new Set(unitIds));
  if (ids.length === 0) throw badRequest('Select at least one unit.');
  const settings = await loadSettings();
  return transaction(async (cx) => {
    const req = await lockRequestForDecision(requestId, cx);
    if (!req) throw notFound('That request no longer exists.');
    if (req.status !== RequestStatus.pending) {
      throw conflict('That request has already been decided.', { status: req.status });
    }
    if (!req.isHandPicked) {
      throw badRequest('This request has no individual units — approve or deny it as a whole.');
    }
    const inRequest = new Set(req.unitIds);
    if (ids.some(id => !inRequest.has(id))) {
      throw conflict('Some of the selected units are no longer part of this request. The list has been refreshed.');
    }
    if (ids.some(id => req.unitDecisions[id])) {
      throw conflict('Some of the selected units were already decided. The list has been refreshed.');
    }
    return decideUnitsLocked(cx, req, ids, action, actorId, settings);
  });
}

/**
 * Approve a request and grant the units, atomically.
 *
 * Hand-picked: approves every still-undecided unit (earlier per-unit decisions
 * stand). Otherwise the community/cluster slice, callable-first, capped at
 * `count`. Candidates are locked before selection, so two concurrent approvals
 * cannot grant the same unit twice. `considered` is how many units this
 * approval acted on — what `granted` should be read against.
 */
export async function approveRequest(
  requestId: string, actorId: string,
): Promise<{ granted: number; considered: number; request: BatchRequest }> {
  const settings = await loadSettings();
  return transaction(async (cx) => {
    const req = await lockRequestForDecision(requestId, cx);
    if (!req) throw notFound('That request no longer exists.');
    if (req.status !== RequestStatus.pending) {
      throw conflict('That request has already been decided.', { status: req.status });
    }

    if (req.isHandPicked) {
      const pending = req.pendingUnitIds;
      const r = await decideUnitsLocked(cx, req, pending, 'approve', actorId, settings);
      return { granted: r.granted, considered: pending.length, request: r.request };
    }

    // callable-first, then capped — the client sorted callable to the front
    // and sliced to `count`.
    const params: unknown[] = [kOrgId, req.community];
    let clusterSql = '';
    if (req.cluster != null) { clusterSql = 'AND cluster = ?'; params.push(req.cluster); }
    const [rows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE org_id = ? AND state = 'pool' AND community = ? ${clusterSql}
       ORDER BY callable DESC
       LIMIT ?
       FOR UPDATE`,
      [...params, req.count],
    );
    const { grant } = await grantToBroker(cx, rows.map(toProperty), req.brokerId, actorId, settings);

    // `grant.length` (not the expanded total) is what the reference reported:
    // units granted against the request, excluding the owner-linked spillover.
    const decided = req.decided(RequestStatus.approved, grant.length);
    await markDecided(decided, actorId, cx);

    await writeAudit({
      actorId, action: 'approve',
      detail: `Request ${req.id}: granted ${grant.length} of ${req.count}`,
    }, cx);

    return { granted: grant.length, considered: req.count, request: decided };
  });
}

/**
 * Deny a request. Hand-picked: denies every still-undecided unit — units already
 * granted stay granted, so the request then closes as `approved` if any were.
 */
export async function denyRequest(
  requestId: string, actorId: string,
): Promise<BatchRequest> {
  const settings = await loadSettings();
  return transaction(async (cx) => {
    const req = await lockRequestForDecision(requestId, cx);
    if (!req) throw notFound('That request no longer exists.');
    if (req.status !== RequestStatus.pending) {
      throw conflict('That request has already been decided.', { status: req.status });
    }
    if (req.isHandPicked) {
      return (await decideUnitsLocked(cx, req, req.pendingUnitIds, 'deny', actorId, settings)).request;
    }
    const decided = req.decided(RequestStatus.denied);
    await markDecided(decided, actorId, cx);
    await writeAudit({ actorId, action: 'deny', detail: `Request ${req.id} denied` }, cx);
    return decided;
  });
}
