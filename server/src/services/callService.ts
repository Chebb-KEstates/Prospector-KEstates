import { transaction, Row } from '../db/pool';
import { CallLog, CallOutcome, Property, Lead, PropertyState, kOrgId } from '../../../src/types/models';
import { applyOutcome, sweepCooldowns } from '../../../src/logic/dispositions';
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
      applyOutcome(p, input.outcome, now, input.followUpAt, settings);
    }

    await insertCall(call, cx);
    await saveProperties(properties, cx);
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
 * The client ran this on every vault load. Server-side it runs on a timer and
 * on demand: `sweepCooldowns` is the shared function, so a unit leaves cooling
 * at exactly the moment it would have before — the difference is that it now
 * happens for everyone at once instead of whenever someone opened the app.
 */
export async function sweepLapsed(): Promise<{ properties: number; leads: number }> {
  const settings = await loadSettings();
  const now = new Date().toISOString();

  return transaction(async (cx) => {
    const [propRows] = await cx.query<Row[]>(
      `SELECT ${PROP_COLS} FROM properties
       WHERE org_id = ?
         AND ((state = 'cooling' AND cooldown_until IS NOT NULL AND cooldown_until < UTC_TIMESTAMP(3))
           OR (state IN ('assigned', 'portfolio')
               AND assignment_expires_at IS NOT NULL
               AND assignment_expires_at < UTC_TIMESTAMP(3)))
       FOR UPDATE`,
      [kOrgId],
    );
    const properties = propRows.map(toProperty);
    const changedProps = sweepCooldowns(properties, now, settings);
    if (changedProps.length > 0) await saveProperties(changedProps, cx);

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
