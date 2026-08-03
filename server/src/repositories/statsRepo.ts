import { pool, Row } from '../db/pool';
import { kOrgId } from '../../../src/types/models';

/**
 * Analytics aggregates for the manager's Team screen.
 *
 * Like the dashboard aggregates, these exist because the tables are paginated —
 * there's no in-memory snapshot to fold. Each figure is computed where the data
 * lives and arrives pre-summed. All grouped by `dataset_id`, so a per-set row
 * is one lookup in the returned Map.
 */

export interface DatasetStat {
  /** How many property rows belong to the set. */
  properties: number;
  /** Rows with at least one number (can be dialled). */
  callable: number;
  /** Total contactable numbers (primary owner; Mobile 1/2/3…). */
  numbers: number;
  /** Distinct brokers holding at least one of the set's units. */
  agents: number;
  /** Units currently assigned to a broker. */
  assigned: number;
  /** Units in a broker's portfolio. */
  portfolio: number;
  /** Callable units never called yet (call_attempts = 0). */
  untouched: number;
  /** Units whose last outcome was "interested". */
  interested: number;
  /** Total calls made on the set's units. */
  calls: number;
  /** Calls that went unanswered. */
  noAnswer: number;
  /** Calls that connected (anything but no-answer / unreachable). */
  reached: number;
}

function emptyStat(): DatasetStat {
  return {
    properties: 0, callable: 0, numbers: 0, agents: 0, assigned: 0,
    portfolio: 0, untouched: 0, interested: 0, calls: 0, noAnswer: 0, reached: 0,
  };
}

/**
 * Per-data-set breakdown, keyed by dataset_id. Two grouped queries — one over
 * `properties` (cheap, no join), one over `calls` joined through
 * `call_properties` to reach each call's data set — merged in JS. Units with no
 * data set (orphans) are excluded; they have no set to report against.
 */
export async function datasetBreakdown(): Promise<Map<string, DatasetStat>> {
  const [propRows] = await pool.query<Row[]>(
    `SELECT dataset_id,
            COUNT(*)                                                   AS properties,
            SUM(callable)                                              AS callable,
            SUM(GREATEST(COALESCE(JSON_LENGTH(owner_phones), 0), callable)) AS numbers,
            COUNT(DISTINCT assigned_to)                                AS agents,
            SUM(assigned_to IS NOT NULL)                               AS assigned,
            SUM(state = 'portfolio')                                   AS portfolio,
            SUM(callable = 1 AND call_attempts = 0)                    AS untouched,
            SUM(last_outcome IN ('interestedSell', 'interestedRent'))  AS interested
     FROM properties
     WHERE org_id = ? AND dataset_id IS NOT NULL
     GROUP BY dataset_id`,
    [kOrgId],
  );

  const [callRows] = await pool.query<Row[]>(
    `SELECT p.dataset_id                                            AS dataset_id,
            COUNT(*)                                                AS calls,
            SUM(c.outcome = 'noAnswer')                             AS no_answer,
            SUM(c.outcome NOT IN ('noAnswer', 'unreachable'))       AS reached
     FROM calls c
     JOIN call_properties cp ON cp.call_id = c.id
     JOIN properties p       ON p.id = cp.property_id
     WHERE c.org_id = ? AND p.dataset_id IS NOT NULL
     GROUP BY p.dataset_id`,
    [kOrgId],
  );

  const out = new Map<string, DatasetStat>();
  const at = (id: string): DatasetStat => {
    let s = out.get(id);
    if (!s) { s = emptyStat(); out.set(id, s); }
    return s;
  };

  for (const r of propRows) {
    const s = at(r.dataset_id as string);
    s.properties = Number(r.properties ?? 0);
    s.callable = Number(r.callable ?? 0);
    s.numbers = Number(r.numbers ?? 0);
    s.agents = Number(r.agents ?? 0);
    s.assigned = Number(r.assigned ?? 0);
    s.portfolio = Number(r.portfolio ?? 0);
    s.untouched = Number(r.untouched ?? 0);
    s.interested = Number(r.interested ?? 0);
  }
  for (const r of callRows) {
    const s = at(r.dataset_id as string);
    s.calls = Number(r.calls ?? 0);
    s.noAnswer = Number(r.no_answer ?? 0);
    s.reached = Number(r.reached ?? 0);
  }
  return out;
}
