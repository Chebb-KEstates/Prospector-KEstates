import { transaction, Row } from '../db/pool';
import { CallLog, CallOutcome, Property, Lead, PropertyState, kOrgId } from '../../../src/types/models';
import { applyOutcome, sweepCooldowns } from '../../../src/logic/dispositions';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';
import { toProperty, saveProperties } from '../repositories/propertyRepo';
import { toLead, saveLeads } from '../repositories/leadRepo';
import { insertCall } from '../repositories/callRepo';
import { loadSettings } from '../repositories/settingsRepo';
import { writeAudit } from '../repositories/auditRepo';
import { newCallId } from '../domain/ids';
import { notFound, forbidden } from '../http/errors';

/**
 * Logging a call.
 *
 * The state transition itself is NOT reimplemented here: `applyOutcome` is
 * imported from the frontend's own logic layer, so the cooldown windows, the
 * auto-return to pool after `maxNoAnswerAttempts`, and the DNC rule are the
 * exact same code the UI ran. This file only adds what the client couldn't:
 * a transaction, a real timestamp, and an ownership check.
 */

const PROP_COLS = `
  id, org_id, dataset_id, state, unit_key, community, cluster, building,
  unit_number, plot_number, property_type, beds, size_sqft, plot_sqft,
  last_transaction_date, last_transaction_value, tx_count,
  rent_start, rent_end, rent_amount,
  owner_name, owner_phone, owner_phones, owners, owner_nationality, extra,
  created_at, updated_at, assigned_to, assigned_at, assignment_note,
  cooldown_until, portfolio_since, last_outcome, last_called_at,
  call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;

const LEAD_COLS = `
  id, org_id, dataset_id, state, lead_key, enquiry_date, name, phone, email,
  project, source, extra, created_at, updated_at, assigned_to, assigned_at,
  assignment_note, cooldown_until, portfolio_since, last_outcome,
  last_called_at, call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;

export interface LogCallInput {
  propertyIds: string[];
  brokerId: string;
  isManager: boolean;
  outcome: CallOutcome;
  note?: string;
  followUpAt?: string;
  /** Which co-owner this call was about, for a multi-owner unit. */
  ownerName?: string;
  /**
   * Manager-only: record the outcome WITHOUT the disposition — the unit keeps its
   * current state and assignment (e.g. an interested owner logged but left in the
   * pool). Used by the manager handoff dialog's "keep in pool" choice.
   */
  keepInPool?: boolean;
}

export async function logCall(input: LogCallInput): Promise<CallLog> {
  if (input.propertyIds.length === 0) throw notFound('No units to log against.');

  const settings = await loadSettings();

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${PROP_COLS} FROM properties
       WHERE id IN (${input.propertyIds.map(() => '?').join(', ')}) FOR UPDATE`,
      input.propertyIds,
    );
    const properties = rows.map(toProperty);
    if (properties.length === 0) throw notFound('Those units no longer exist.');

    // A broker may only log against units assigned to them. The client never
    // checked — it simply didn't show other brokers' units.
    if (!input.isManager) {
      const foreign = properties.filter(p => p.assignedTo !== input.brokerId);
      if (foreign.length > 0) {
        throw forbidden('Those units are not assigned to you.');
      }
    }

    // One server-side timestamp for the whole batch, so a grouped owner call
    // doesn't end up with rows milliseconds apart.
    const now = new Date().toISOString();
    const call = new CallLog(
      newCallId(), kOrgId, properties.map(p => p.id), [],
      input.brokerId, now, input.outcome,
      (input.note?.trim().length ?? 0) > 0 ? input.note!.trim() : undefined,
      input.followUpAt,
      (input.ownerName?.trim().length ?? 0) > 0 ? input.ownerName!.trim() : undefined,
    );

    for (const p of properties) {
      if (input.keepInPool && input.isManager) {
        // Record the outcome only — no state/assignment change.
        p.lastOutcome = input.outcome;
        p.lastCalledAt = now;
        p.updatedAt = now;
      } else {
        applyOutcome(p, input.outcome, now, input.followUpAt, settings);
      }
    }

    const skipCohesion = !!(input.keepInPool && input.isManager);

    // Owner-in-area cohesion. The worked units belong to one owner+area group;
    // apply the group rules to that owner's OTHER same-area units:
    //   • Do not call → the OWNER asked not to be contacted, so mark every
    //     same-area unit DNC (pooled or held — no one should call them again).
    //   • Any other outcome that keeps the unit → extend the group's clock so a
    //     sibling isn't shown as expiring while the broker is working the owner.
    const ownerKeys = Array.from(new Set(properties.map(ownerKeyOf)));
    const ownerCommunity = new Set(properties.map(p => `${ownerKeyOf(p)}|${p.community}`));
    const workedIds = new Set(properties.map(p => p.id));
    const siblingsToSave: Property[] = [];
    if (!skipCohesion && ownerKeys.length > 0) {
      if (input.outcome === CallOutcome.dnc) {
        const [sibRows] = await cx.query<Row[]>(
          `SELECT ${PROP_COLS} FROM properties
           WHERE org_id = ? AND state <> 'dnc'
             AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
           FOR UPDATE`,
          [kOrgId, ...ownerKeys],
        );
        for (const s of sibRows.map(toProperty)) {
          if (workedIds.has(s.id) || !ownerCommunity.has(`${ownerKeyOf(s)}|${s.community}`)) continue;
          s.state = PropertyState.dnc;
          s.dncAt = now;
          s.cooldownUntil = undefined;
          s.portfolioSince = undefined;
          s.assignmentExpiresAt = undefined;
          s.nextFollowUpAt = undefined;
          s.updatedAt = now;
          siblingsToSave.push(s);
        }
      } else {
        // Extend held same-area siblings to the freshest deadline among the worked
        // units, so working one unit keeps the whole group on the clock.
        const holder = properties.find(p => p.assignedTo)?.assignedTo;
        const maxDeadline = properties
          .map(p => p.assignmentExpiresAt)
          .filter((d): d is string => !!d)
          .sort()
          .pop();
        if (holder && maxDeadline) {
          const [sibRows] = await cx.query<Row[]>(
            `SELECT ${PROP_COLS} FROM properties
             WHERE org_id = ? AND assigned_to = ? AND state IN ('assigned', 'portfolio')
               AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
             FOR UPDATE`,
            [kOrgId, holder, ...ownerKeys],
          );
          for (const s of sibRows.map(toProperty)) {
            if (workedIds.has(s.id) || !ownerCommunity.has(`${ownerKeyOf(s)}|${s.community}`)) continue;
            if (!s.assignmentExpiresAt || new Date(s.assignmentExpiresAt) < new Date(maxDeadline)) {
              s.assignmentExpiresAt = maxDeadline;
              s.updatedAt = now;
              siblingsToSave.push(s);
            }
          }
        }
      }
    }

    await insertCall(call, cx);
    await saveProperties([...properties, ...siblingsToSave], cx);
    await writeAudit({
      actorId: input.brokerId,
      action: 'call',
      detail: `${input.outcome} — ${properties.length} unit(s)`,
    }, cx);

    return call;
  });
}

export interface LogLeadCallInput {
  leadId: string;
  brokerId: string;
  isManager: boolean;
  outcome: CallOutcome;
  note?: string;
  followUpAt?: string;
}

export async function logLeadCall(input: LogLeadCallInput): Promise<CallLog> {
  const settings = await loadSettings();

  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${LEAD_COLS} FROM leads WHERE id = ? FOR UPDATE`, [input.leadId],
    );
    if (rows.length === 0) throw notFound('That lead no longer exists.');
    const lead = toLead(rows[0]);

    if (!input.isManager && lead.assignedTo !== input.brokerId) {
      throw forbidden('That lead is not assigned to you.');
    }

    const now = new Date().toISOString();
    const call = new CallLog(
      newCallId(), kOrgId, [], [lead.id],
      input.brokerId, now, input.outcome,
      (input.note?.trim().length ?? 0) > 0 ? input.note!.trim() : undefined,
      input.followUpAt,
    );

    applyOutcome(lead, input.outcome, now, input.followUpAt, settings);

    await insertCall(call, cx);
    await saveLeads([lead], cx);
    await writeAudit({
      actorId: input.brokerId, action: 'call', detail: `${input.outcome} — lead`,
    }, cx);

    return call;
  });
}

/**
 * Manager override: lift a Do-Not-Call.
 *
 * DNC is permanent and only a manager can undo it — the route enforces the
 * role, this enforces the state reset and the audit trail.
 */
export async function undoDnc(propertyId: string, actorId: string): Promise<Property> {
  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${PROP_COLS} FROM properties WHERE id = ? FOR UPDATE`, [propertyId],
    );
    if (rows.length === 0) throw notFound('That unit no longer exists.');
    const p = toProperty(rows[0]);

    p.state = PropertyState.pool;
    p.dncAt = undefined;
    p.lastOutcome = undefined;
    p.assignedAt = undefined;
    p.assignmentNote = undefined;
    p.updatedAt = new Date().toISOString();

    await saveProperties([p], cx);
    await writeAudit({
      actorId, action: 'dnc-undo',
      detail: 'Do-Not-Call removed (manager override)',
      propertyIds: [p.id],
    }, cx);
    return p;
  });
}

export async function undoDncLead(leadId: string, actorId: string): Promise<Lead> {
  return transaction(async (cx) => {
    const [rows] = await cx.query<Row[]>(
      `SELECT ${LEAD_COLS} FROM leads WHERE id = ? FOR UPDATE`, [leadId],
    );
    if (rows.length === 0) throw notFound('That lead no longer exists.');
    const l = toLead(rows[0]);

    l.state = PropertyState.pool;
    l.dncAt = undefined;
    l.lastOutcome = undefined;
    l.assignedAt = undefined;
    l.assignmentNote = undefined;
    l.updatedAt = new Date().toISOString();

    await saveLeads([l], cx);
    await writeAudit({
      actorId, action: 'dnc-undo',
      detail: 'Do-Not-Call removed on lead (manager override)',
    }, cx);
    return l;
  });
}

/**
 * Cooldown / assignment-expiry sweep.
 *
 * Runs on a timer and on demand. LEADS recycle per-lead (`sweepCooldowns`, the
 * shared function — one lead is one person). PROPERTIES recycle at the
 * OWNER-IN-AREA GROUP level: a neglected unit never returns to the pool alone.
 * An owner's same-area group returns together, and only once the broker has
 * stopped working the WHOLE owner (no unit still on the clock). While any unit
 * is active, lapsed siblings are kept — their clock re-synced to the group's
 * freshest deadline, and cooled siblings left dormant with the broker.
 */
export async function sweepLapsed(): Promise<{ properties: number; leads: number }> {
  const settings = await loadSettings();
  const now = new Date().toISOString();

  return transaction(async (cx) => {
    // Candidates: any held/cooled unit whose own timer has passed.
    const [candRows] = await cx.query<Row[]>(
      `SELECT ${PROP_COLS} FROM properties
       WHERE org_id = ?
         AND ((state = 'cooling' AND cooldown_until IS NOT NULL AND cooldown_until < UTC_TIMESTAMP(3))
           OR (state IN ('assigned', 'portfolio')
               AND assignment_expires_at IS NOT NULL
               AND assignment_expires_at < UTC_TIMESTAMP(3)))
       FOR UPDATE`,
      [kOrgId],
    );
    const candidates = candRows.map(toProperty);
    const changedProps: Property[] = [];
    if (candidates.length > 0) {
      const ownerKeys = Array.from(new Set(candidates.map(ownerKeyOf)));
      const brokers = Array.from(new Set(candidates.map(p => p.assignedTo).filter((b): b is string => !!b)));
      const candidateGroups = new Set(candidates.map(p => `${ownerKeyOf(p)}|${p.community}|${p.assignedTo}`));

      // Load each candidate's FULL owner-in-area group (held units only).
      const [groupRows] = await cx.query<Row[]>(
        `SELECT ${PROP_COLS} FROM properties
         WHERE org_id = ? AND state IN ('assigned', 'portfolio', 'cooling')
           AND assigned_to IN (${brokers.map(() => '?').join(', ')})
           AND owner_key IN (${ownerKeys.map(() => '?').join(', ')})
         FOR UPDATE`,
        [kOrgId, ...brokers, ...ownerKeys],
      );
      const groups = new Map<string, Property[]>();
      for (const p of groupRows.map(toProperty)) {
        const key = `${ownerKeyOf(p)}|${p.community}|${p.assignedTo}`;
        if (!candidateGroups.has(key)) continue;
        const list = groups.get(key) ?? [];
        list.push(p);
        groups.set(key, list);
      }

      const nowDate = new Date(now);
      const future = (d?: string) => d != null && new Date(d) > nowDate;
      for (const units of groups.values()) {
        const active = units.some(p =>
          (p.state === PropertyState.assigned || p.state === PropertyState.portfolio) && future(p.assignmentExpiresAt));
        if (active) {
          const maxDeadline = units
            .filter(p => p.state === PropertyState.assigned || p.state === PropertyState.portfolio)
            .map(p => p.assignmentExpiresAt)
            .filter((d): d is string => !!d)
            .sort()
            .pop();
          for (const p of units) {
            if ((p.state === PropertyState.assigned || p.state === PropertyState.portfolio)
                && !future(p.assignmentExpiresAt) && maxDeadline) {
              p.assignmentExpiresAt = maxDeadline; p.updatedAt = now; changedProps.push(p);
            } else if (p.state === PropertyState.cooling && p.cooldownUntil != null && !future(p.cooldownUntil)) {
              p.cooldownUntil = undefined; p.updatedAt = now; changedProps.push(p);
            }
          }
        } else {
          // Owner abandoned — recycle the WHOLE group to the pool, together.
          for (const p of units) {
            p.state = PropertyState.pool;
            p.assignedTo = undefined; p.assignedAt = undefined; p.assignmentNote = undefined;
            p.cooldownUntil = undefined; p.nextFollowUpAt = undefined;
            p.portfolioSince = undefined; p.assignmentExpiresAt = undefined; p.callAttempts = 0;
            p.updatedAt = now; changedProps.push(p);
          }
        }
      }
      if (changedProps.length > 0) await saveProperties(changedProps, cx);
    }

    const [leadRows] = await cx.query<Row[]>(
      `SELECT ${LEAD_COLS} FROM leads
       WHERE org_id = ?
         AND ((state = 'cooling' AND cooldown_until IS NOT NULL AND cooldown_until < UTC_TIMESTAMP(3))
           OR (state IN ('assigned', 'portfolio')
               AND assignment_expires_at IS NOT NULL
               AND assignment_expires_at < UTC_TIMESTAMP(3)))
       FOR UPDATE`,
      [kOrgId],
    );
    const leads = leadRows.map(toLead);
    const changedLeads = sweepCooldowns(leads, now, settings);
    if (changedLeads.length > 0) await saveLeads(changedLeads, cx);

    return { properties: changedProps.length, leads: changedLeads.length };
  });
}
