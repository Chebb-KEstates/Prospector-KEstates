import type { PoolConnection } from 'mysql2/promise';
import { pool, transaction, Row, fromDb } from '../db/pool';
import { PropertyStage, PropertyStageLabel, VaultSettings, kOrgId } from '../../../src/types/models';
import { loadSettings } from '../repositories/settingsRepo';
import { findUserById } from '../repositories/userRepo';
import { reclaimPropertiesTx } from './assignmentService';
import { findPropertyById } from '../repositories/propertyRepo';
import { insertNotification, NotificationKind } from '../repositories/notificationRepo';

/**
 * Stage follow-up — keeps brokers working the units they move through stages.
 *
 * An ASSIGNED unit in Prospecting, Market appraisal or Listed offline goes back
 * to the pool (unassigned) when its broker hasn't logged a call on it for longer
 * than that stage's limit (Settings → Stage follow-up; 30 / 14 / 7 days by
 * default, 0 = that stage's rule is off). None and Listed online have no rule.
 *
 * "Logged a call" = any call result the broker saved (with or without feedback
 * text) on this unit OR on any of that owner's units in the same area — reclaim
 * always moves the owner's whole same-area group, so working one of them keeps
 * all of them.
 *
 * The clock runs from the LATEST of: that last call, the moment the unit entered
 * its current stage, and when it was assigned to this broker — so a fresh stage
 * or a fresh assignment always gets a full window.
 *
 * Notice first: 24 hours before the deadline the broker gets an in-app
 * notification (the bell in their sidebar). A unit is only reclaimed once that
 * warning is at least 24 hours old — so a unit that is already overdue when it is
 * first seen (the first run after deploying, a limit lowered in Settings) is
 * warned now and goes back 24 hours later, never without notice. Any call, stage
 * change or new assignment starts a fresh idle period, and with it a fresh
 * warning if it lapses again.
 *
 * Runs on the server's housekeeping timer. Each unit is re-checked under a row
 * lock just before it is reclaimed, so a call logged a moment earlier wins.
 */

/** The stages with a follow-up rule, in journey order. */
export const TIMED_STAGES = [
  PropertyStage.prospecting, PropertyStage.marketAppraisal, PropertyStage.listedOffline,
] as const;

const EPOCH = `'1970-01-01 00:00:00.000'`;

/**
 * The unit's last activity date: the latest of its assignment, its entry into
 * the current stage (the newest 'stage' journal row), and the broker's newest
 * call on the owner's same-area units.
 */
const LAST_ACTIVITY = `GREATEST(
    COALESCE(p.assigned_at, ${EPOCH}),
    COALESCE((SELECT MAX(a.at) FROM audit a
               JOIN audit_properties ap ON ap.audit_id = a.id
              WHERE ap.property_id = p.id AND a.action = 'stage'), ${EPOCH}),
    COALESCE((SELECT MAX(c.at) FROM calls c
               JOIN call_properties cp ON cp.call_id = c.id
               JOIN properties q ON q.id = cp.property_id
              WHERE c.broker_id = p.assigned_to
                AND q.org_id = p.org_id AND q.owner_key = p.owner_key
                AND q.community <=> p.community), ${EPOCH}))`;

/** How long before a reclaim its broker is warned — and the least notice they get. */
export const WARNING_HOURS = 24;
const WARNING_MS = WARNING_HOURS * 3_600_000;

export interface StageFollowUpUnit {
  id: string;
  stage: PropertyStage;
  assignedTo: string;
  /** Latest of: the broker's last call, the stage entry, the assignment. */
  lastActivity: string;
  idleDays: number;
  /** lastActivity + idleDays — when the unit is overdue. */
  deadline: string;
  /** When the broker was warned in THIS idle period (after lastActivity), if at all. */
  warnedAt?: string;
}

/**
 * Every assigned unit in a timed stage whose deadline falls within the next
 * WARNING_HOURS (or has passed). Read-only. `onlyId` narrows to one unit and,
 * with `cx`, locks it first — the re-check right before acting on it.
 */
export async function scanStageFollowUp(
  settings: VaultSettings, opts: { onlyId?: string; cx?: PoolConnection } = {},
): Promise<StageFollowUpUnit[]> {
  const days = TIMED_STAGES.map(s => settings.stageIdleDays(s));
  if (days.every(d => d <= 0)) return []; // every rule off
  const db = opts.cx ?? pool;
  // The re-check locks the unit first (a plain row lock — MySQL won't take a
  // locking read inside the derived table below).
  if (opts.cx && opts.onlyId) {
    await opts.cx.query('SELECT id FROM properties WHERE id = ? FOR UPDATE', [opts.onlyId]);
  }
  const params: unknown[] = [...days, kOrgId];
  let only = '';
  if (opts.onlyId) { only = 'AND p.id = ?'; params.push(opts.onlyId); }
  params.push(WARNING_HOURS);
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.stage, t.assigned_to, t.last_activity, t.idle_days,
            DATE_ADD(t.last_activity, INTERVAL t.idle_days DAY) AS deadline,
            -- A warning only counts for the CURRENT idle period: one sent before
            -- the latest call / stage change / assignment is history.
            (SELECT MIN(n.created_at) FROM notifications n
              WHERE n.user_id = t.assigned_to AND n.property_id = t.id
                AND n.kind = '${NotificationKind.stageReclaimWarning}'
                AND n.created_at >= t.last_activity) AS warned_at
       FROM (
         SELECT p.id, p.stage, p.assigned_to,
                ${LAST_ACTIVITY} AS last_activity,
                CASE p.stage
                  WHEN '${PropertyStage.prospecting}' THEN ?
                  WHEN '${PropertyStage.marketAppraisal}' THEN ?
                  WHEN '${PropertyStage.listedOffline}' THEN ?
                  ELSE 0 END AS idle_days
           FROM properties p
          WHERE p.org_id = ? ${only}
            AND p.assigned_to IS NOT NULL
            AND p.state IN ('assigned', 'portfolio', 'cooling')
            AND p.stage IN (${TIMED_STAGES.map(s => `'${s}'`).join(', ')})
       ) t
      WHERE t.idle_days > 0
        AND DATE_ADD(t.last_activity, INTERVAL t.idle_days DAY) <= UTC_TIMESTAMP(3) + INTERVAL ? HOUR
      ORDER BY t.last_activity`,
    params,
  );
  return rows.map(r => ({
    id: r.id as string,
    stage: r.stage as PropertyStage,
    assignedTo: r.assigned_to as string,
    lastActivity: fromDb(r.last_activity)!,
    idleDays: Number(r.idle_days),
    deadline: fromDb(r.deadline)!,
    warnedAt: fromDb(r.warned_at),
  }));
}

/** Needs its warning now: within WARNING_HOURS of the deadline, not yet warned this period. */
export function needsWarning(u: StageFollowUpUnit): boolean {
  return !u.warnedAt;
}

/**
 * Due to be reclaimed now: overdue AND its broker was warned at least
 * WARNING_HOURS ago in this idle period. A unit that became overdue without a
 * warning (e.g. the first run after deploying, or a limit lowered in Settings)
 * gets its warning first and goes back a full WARNING_HOURS later.
 */
export function isDue(u: StageFollowUpUnit, now = Date.now()): boolean {
  return new Date(u.deadline).getTime() <= now
    && !!u.warnedAt && new Date(u.warnedAt).getTime() <= now - WARNING_MS;
}

/** When the unit will actually go back: the later of its deadline and warning + 24 h. */
export function reclaimAt(u: StageFollowUpUnit, warnedAt = u.warnedAt ?? new Date().toISOString()): string {
  const t = Math.max(new Date(u.deadline).getTime(), new Date(warnedAt).getTime() + WARNING_MS);
  return new Date(t).toISOString();
}

/** Units the next sweep would reclaim (read-only) — the preview's "reclaim" list. */
export async function findStaleStageUnits(
  settings: VaultSettings, opts: { onlyId?: string; cx?: PoolConnection } = {},
): Promise<StageFollowUpUnit[]> {
  return (await scanStageFollowUp(settings, opts)).filter(u => isDue(u));
}

/** The broker-facing reminder: which unit, why, and what to do. */
async function sendWarning(u: StageFollowUpUnit, cx?: PoolConnection): Promise<boolean> {
  const p = await findPropertyById(u.id, cx);
  const label = p?.unitLabel ?? 'A unit';
  const quiet = Math.max(0, Math.floor((Date.now() - new Date(u.lastActivity).getTime()) / 86_400_000));
  return insertNotification({
    userId: u.assignedTo,
    kind: NotificationKind.stageReclaimWarning,
    propertyId: u.id,
    title: `${label} goes back to the pool in 24 hours`,
    body: `No call logged on it for ${quiet} day${quiet === 1 ? '' : 's'} in ${PropertyStageLabel[u.stage]} `
      + `(the limit is ${u.idleDays}). Log a call on it within 24 hours to keep it — `
      + 'otherwise it is unassigned, together with this owner’s other units in the area.',
    // One reminder per unit per idle period: a call / stage change / new owner
    // moves lastActivity and so allows the next one.
    dedupeKey: `stage-warn:${u.id}:${u.lastActivity}`,
  }, cx);
}

/**
 * The stage follow-up sweep: warn every broker whose unit is within 24 hours of
 * its deadline, then reclaim every unit that is overdue AND was warned at least
 * 24 hours ago. Returns how many reminders went out and how many units went back
 * to the pool (owner-group siblings included).
 */
export async function sweepStaleStages(): Promise<{ reclaimed: number; warned: number }> {
  const settings = await loadSettings();
  const scan = await scanStageFollowUp(settings);

  let warned = 0;
  for (const u of scan.filter(needsWarning)) {
    if (await sendWarning(u)) warned += 1;
  }

  let reclaimed = 0;
  for (const u of scan.filter(x => isDue(x))) {
    reclaimed += await transaction(async (cx) => {
      // Re-check under the lock: a call logged a moment ago, a stage change or a
      // reassignment since the scan all win; a sibling already reclaimed with an
      // earlier unit's group simply no longer matches.
      const [still] = await scanStageFollowUp(settings, { onlyId: u.id, cx });
      if (!still || !isDue(still)) return 0;
      const broker = await findUserById(still.assignedTo);
      const detail = `Auto Reclaimed — no call logged by ${broker?.name ?? 'the broker'} for `
        + `${still.idleDays} days in ${PropertyStageLabel[still.stage]}`;
      return reclaimPropertiesTx(cx, [still.id], null, detail);
    });
  }
  return { reclaimed, warned };
}
