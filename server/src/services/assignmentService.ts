import type { PoolConnection } from 'mysql2/promise';
import { transaction, pool, Row } from '../db/pool';
import {
  Property, Lead, PropertyState, BatchRequest, RequestStatus, kOrgId,
} from '../../../src/types/models';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';
import { assignmentDeadlineOnAssign } from '../../../src/logic/dispositions';
import { toProperty, saveProperties } from '../repositories/propertyRepo';
import { toLead, saveLeads } from '../repositories/leadRepo';
import { lockRequestForDecision, markDecided } from '../repositories/requestRepo';
import { loadSettings } from '../repositories/settingsRepo';
import { writeAudit } from '../repositories/auditRepo';
import { findUserById } from '../repositories/userRepo';
import { conflict, notFound } from '../http/errors';

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
 * Approve a request and grant the units, atomically.
 *
 * The grant selection (hand-picked vs community/cluster slice, callable-first,
 * capped at `count`) mirrors VaultContext.approveRequest exactly — but the
 * candidates are locked before selection, so two concurrent approvals cannot
 * grant the same unit twice.
 */
export async function approveRequest(
  requestId: string, actorId: string,
): Promise<{ granted: number; request: BatchRequest }> {
  const settings = await loadSettings();
  return transaction(async (cx) => {
    const req = await lockRequestForDecision(requestId, cx);
    if (!req) throw notFound('That request no longer exists.');
    if (req.status !== RequestStatus.pending) {
      throw conflict('That request has already been decided.', { status: req.status });
    }

    let grant: Property[];
    if (req.isHandPicked) {
      const [rows] = await cx.query<Row[]>(
        `SELECT ${ASSIGNABLE_COLS} FROM properties
         WHERE id IN (${req.unitIds.map(() => '?').join(', ')}) AND state = 'pool'
         FOR UPDATE`,
        req.unitIds,
      );
      grant = rows.map(toProperty);
    } else {
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
      grant = rows.map(toProperty);
    }

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
        [kOrgId, req.brokerId, ...gOwnerKeys],
      );
      const taken = new Set(heldRows.map(r => `${r.owner_key as string}|${r.community as string}`));
      grant = grant.filter(p => !taken.has(`${ownerKeyOf(p)}|${p.community}`));
    }

    let granted = 0;
    if (grant.length > 0) {
      const broker = await findUserById(req.brokerId);
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
        p.assignedTo = req.brokerId;
        p.assignedAt = now;
        p.assignmentNote = 'Requested batch';
        p.callAttempts = 0;
        p.nextFollowUpAt = undefined;
        p.assignmentExpiresAt = assignmentDeadlineOnAssign(now, settings);
        p.updatedAt = now;
      }
      await saveProperties(expanded, cx);
      granted = expanded.length;

      const extra = expanded.length - grant.length;
      await writeAudit({
        actorId, action: 'assign',
        detail: `Assigned to ${broker?.name ?? req.brokerId}` +
          (extra > 0 ? ` (incl. ${extra} owner-linked)` : ''),
        propertyIds: expanded.map(p => p.id),
      }, cx);
    }

    // `grant.length` (not `granted`) is what the reference reported: units
    // granted against the request, excluding the owner-linked spillover.
    const decided = req.decided(RequestStatus.approved, grant.length);
    await markDecided(decided, actorId, cx);

    await writeAudit({
      actorId, action: 'approve',
      detail: `Request ${req.id}: granted ${grant.length} of ${req.count}`,
    }, cx);

    return { granted: grant.length, request: decided };
  });
}

export async function denyRequest(
  requestId: string, actorId: string,
): Promise<BatchRequest> {
  return transaction(async (cx) => {
    const req = await lockRequestForDecision(requestId, cx);
    if (!req) throw notFound('That request no longer exists.');
    if (req.status !== RequestStatus.pending) {
      throw conflict('That request has already been decided.', { status: req.status });
    }
    const decided = req.decided(RequestStatus.denied);
    await markDecided(decided, actorId, cx);
    await writeAudit({ actorId, action: 'deny', detail: `Request ${req.id} denied` }, cx);
    return decided;
  });
}
