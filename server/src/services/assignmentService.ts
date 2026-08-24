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
}

/**
 * Assign properties to a broker.
 *
 * Preserves the reference behaviour exactly, including the part that surprises
 * people: the batch silently EXPANDS to every pool unit sharing owner+community
 * with a selected unit. One owner is never split across two brokers, so
 * assigning 1 unit can assign 4. The audit line says "(incl. N owner-linked)".
 */
export async function assignProperties(
  propertyIds: string[],
  brokerId: string,
  actorId: string,
  note?: string,
): Promise<AssignResult> {
  if (propertyIds.length === 0) return { assigned: 0, ownerLinkedExtra: 0 };

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

    // 2. Expand to owner-linked pool units, under the same lock. `ownerKeyOf`
    //    is the shared function, and owner_key is the column written from it.
    const ownerCommunity = new Set(chosen.map(p => `${ownerKeyOf(p)}|${p.community}`));
    const ownerKeys = Array.from(new Set(chosen.map(p => ownerKeyOf(p))));
    const chosenIds = new Set(chosen.map(p => p.id));

    // Guard: an owner's units in ONE area belong to ONE broker. If any of these
    // owners is already HELD (assigned / portfolio / cooling) by a DIFFERENT
    // broker in the same community, refuse — two brokers must never work the same
    // owner in the same area. Locked FOR UPDATE so a concurrent assign serialises.
    const [heldRows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE org_id = ? AND assigned_to IS NOT NULL AND assigned_to <> ?
         AND state IN ('assigned', 'portfolio', 'cooling')
         AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
       FOR UPDATE`,
      [kOrgId, brokerId, ...ownerKeys],
    );
    const clash = heldRows.map(toProperty)
      .find(p => ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`));
    if (clash) {
      const holder = await findUserById(clash.assignedTo!);
      throw conflict(
        `${clash.owner.name || 'That owner'} is already assigned to ${holder?.name ?? 'another broker'} ` +
        `in ${clash.community}. An owner's units in one area stay with one broker — reclaim them first, ` +
        `or assign to ${holder?.name ?? 'that broker'}.`,
        { community: clash.community, heldBy: clash.assignedTo },
      );
    }

    const [linkedRows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE org_id = ? AND state = 'pool'
         AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
       FOR UPDATE`,
      [kOrgId, ...ownerKeys],
    );
    const linked = linkedRows
      .map(toProperty)
      .filter(p => !chosenIds.has(p.id) && ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`));

    const expanded = [...chosen, ...linked];

    // 3. Mutate + persist. Same field-by-field writes as VaultContext.assign.
    const now = new Date().toISOString();
    for (const p of expanded) {
      p.state = PropertyState.assigned;
      p.assignedTo = brokerId;
      p.assignedAt = now;
      p.assignmentNote = note;
      p.callAttempts = 0;
      p.nextFollowUpAt = undefined;
      p.assignmentExpiresAt = assignmentDeadlineOnAssign(now, settings);
      p.updatedAt = now;
    }
    await saveProperties(expanded, cx);

    const extra = expanded.length - chosen.length;
    await writeAudit({
      actorId,
      action: 'assign',
      detail: `Assigned to ${broker.name}` + (extra > 0 ? ` (incl. ${extra} owner-linked)` : ''),
      propertyIds: expanded.map(p => p.id),
    }, cx);

    return { assigned: expanded.length, ownerLinkedExtra: extra };
  });
}

export async function reclaimProperties(propertyIds: string[], actorId: string): Promise<number> {
  if (propertyIds.length === 0) return 0;

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${ASSIGNABLE_COLS} FROM properties
       WHERE id IN (${propertyIds.map(() => '?').join(', ')}) FOR UPDATE`,
      propertyIds,
    );
    const batch = rows.map(toProperty);
    if (batch.length === 0) return 0;

    const now = new Date().toISOString();
    for (const p of batch) {
      p.state = PropertyState.pool;
      p.assignedTo = undefined;
      p.assignedAt = undefined;
      p.assignmentNote = undefined;
      p.nextFollowUpAt = undefined;
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = undefined;
      p.updatedAt = now;
    }
    await saveProperties(batch, cx);

    await writeAudit({
      actorId, action: 'reclaim', detail: 'Reclaimed to the pool',
      propertyIds: batch.map(p => p.id),
    }, cx);

    return batch.length;
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
