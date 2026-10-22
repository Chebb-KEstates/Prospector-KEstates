import type { PoolConnection } from 'mysql2/promise';
import { pool, transaction, Row, fromDb } from '../db/pool';
import { PropertyStage, PropertyStageLabel, VaultSettings, kOrgId } from '../../../src/types/models';
import { loadSettings } from '../repositories/settingsRepo';
import { findUserById } from '../repositories/userRepo';
import { reclaimPropertiesTx } from './assignmentService';

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

export interface StaleStageUnit {
  id: string;
  stage: PropertyStage;
  assignedTo: string;
  lastActivity: string;
  idleDays: number;
}

/**
 * Units due to be reclaimed right now (read-only). `onlyId` narrows to one unit
 * and, with `cx`, locks it — the re-check right before reclaiming.
 */
export async function findStaleStageUnits(
  settings: VaultSettings, opts: { onlyId?: string; cx?: PoolConnection } = {},
): Promise<StaleStageUnit[]> {
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
  const [rows] = await db.query<Row[]>(
    `SELECT id, stage, assigned_to, last_activity, idle_days FROM (
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
       AND t.last_activity < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL t.idle_days DAY)
     ORDER BY t.last_activity`,
    params,
  );
  return rows.map(r => ({
    id: r.id as string,
    stage: r.stage as PropertyStage,
    assignedTo: r.assigned_to as string,
    lastActivity: fromDb(r.last_activity)!,
    idleDays: Number(r.idle_days),
  }));
}

/**
 * Reclaim every unit whose stage follow-up has lapsed. Returns how many units
 * went back to the pool (owner-group siblings included).
 */
export async function sweepStaleStages(): Promise<{ reclaimed: number }> {
  const settings = await loadSettings();
  const due = await findStaleStageUnits(settings);
  let reclaimed = 0;
  for (const u of due) {
    reclaimed += await transaction(async (cx) => {
      // Re-check under the lock: a call logged a moment ago, a stage change or a
      // reassignment since the scan all win; a sibling already reclaimed with an
      // earlier unit's group simply no longer matches.
      const [still] = await findStaleStageUnits(settings, { onlyId: u.id, cx });
      if (!still) return 0;
      const broker = await findUserById(still.assignedTo);
      const detail = `Auto Reclaimed — no call logged by ${broker?.name ?? 'the broker'} for `
        + `${still.idleDays} days in ${PropertyStageLabel[still.stage]}`;
      return reclaimPropertiesTx(cx, [still.id], null, detail);
    });
  }
  return { reclaimed };
}
