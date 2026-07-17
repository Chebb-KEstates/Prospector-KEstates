import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { CallLog, CallOutcome, kOrgId } from '../../../src/types/models';

/**
 * Call logs.
 *
 * `propertyIds` / `leadIds` were JSON arrays on the client; here they're the
 * `call_properties` / `call_leads` junction tables. That's what turns
 * `callsFor(ids)` — which the dialer runs for every card to build its history —
 * from a scan of every call in the vault into an indexed join.
 */

function toCall(r: Row, propertyIds: string[], leadIds: string[]): CallLog {
  return new CallLog(
    r.id as string,
    r.org_id as string,
    propertyIds,
    leadIds,
    r.broker_id as string,
    fromDb(r.at)!,
    r.outcome as CallOutcome,
    (r.note as string) ?? undefined,
    fromDb(r.follow_up_at),
  );
}

const COLS = 'id, org_id, broker_id, at, outcome, note, follow_up_at';
const C_COLS = 'c.id, c.org_id, c.broker_id, c.at, c.outcome, c.note, c.follow_up_at';

function groupLinks(rows: Row[], keyCol: string, valueCol: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const key = r[keyCol] as string;
    let list = out.get(key);
    if (!list) {
      list = [];
      out.set(key, list);
    }
    list.push(r[valueCol] as string);
  }
  return out;
}

/** Attach the junction rows to a set of calls in two queries, not N. */
async function hydrate(rows: Row[], db: PoolConnection | typeof pool): Promise<CallLog[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id as string);
  const inList = ids.map(() => '?').join(', ');

  const [propLinks] = await db.query<Row[]>(
    `SELECT call_id, property_id FROM call_properties WHERE call_id IN (${inList})`, ids,
  );
  const [leadLinks] = await db.query<Row[]>(
    `SELECT call_id, lead_id FROM call_leads WHERE call_id IN (${inList})`, ids,
  );

  const props = groupLinks(propLinks, 'call_id', 'property_id');
  const leads = groupLinks(leadLinks, 'call_id', 'lead_id');

  return rows.map(r => toCall(r, props.get(r.id as string) ?? [], leads.get(r.id as string) ?? []));
}

export async function insertCall(call: CallLog, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `INSERT INTO calls (id, org_id, broker_id, at, outcome, note, follow_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      call.id, kOrgId, call.brokerId, toDb(call.at), call.outcome,
      call.note ?? null, toDb(call.followUpAt),
    ],
  );

  if (call.propertyIds.length > 0) {
    await db.query(
      `INSERT INTO call_properties (call_id, property_id)
       VALUES ${call.propertyIds.map(() => '(?, ?)').join(', ')}`,
      call.propertyIds.flatMap(pid => [call.id, pid]),
    );
  }
  if (call.leadIds.length > 0) {
    await db.query(
      `INSERT INTO call_leads (call_id, lead_id)
       VALUES ${call.leadIds.map(() => '(?, ?)').join(', ')}`,
      call.leadIds.flatMap(lid => [call.id, lid]),
    );
  }
}

/** Calls touching any of these properties — mirrors VaultContext.callsFor. */
export async function callsForProperties(propertyIds: string[]): Promise<CallLog[]> {
  if (propertyIds.length === 0) return [];
  const [rows] = await pool.query<Row[]>(
    `SELECT DISTINCT ${C_COLS}
     FROM calls c
     JOIN call_properties cp ON cp.call_id = c.id
     WHERE cp.property_id IN (${propertyIds.map(() => '?').join(', ')})
     ORDER BY c.at DESC`,
    propertyIds,
  );
  return hydrate(rows, pool);
}

export async function callsForLead(leadId: string): Promise<CallLog[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${C_COLS}
     FROM calls c
     JOIN call_leads cl ON cl.call_id = c.id
     WHERE cl.lead_id = ?
     ORDER BY c.at DESC`,
    [leadId],
  );
  return hydrate(rows, pool);
}

export async function callsBy(brokerId: string, limit = 5000): Promise<CallLog[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM calls WHERE broker_id = ? ORDER BY at DESC LIMIT ?`,
    [brokerId, limit],
  );
  return hydrate(rows, pool);
}

export async function listCalls(limit: number, offset: number): Promise<{ rows: CallLog[]; total: number }> {
  const [countRows] = await pool.query<Row[]>(
    'SELECT COUNT(*) AS n FROM calls WHERE org_id = ?', [kOrgId],
  );
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM calls WHERE org_id = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
    [kOrgId, limit, offset],
  );
  return { rows: await hydrate(rows, pool), total: Number(countRows[0].n) };
}

// ── Aggregates for the dashboards ──────────────────────────────────────────

export interface BrokerCallStats {
  brokerId: string;
  calls: number;
  interested: number;
  lastAt?: string;
}

/**
 * Per-broker call totals. The Team screen and the Users activity summary used to
 * compute this by filtering the whole in-memory call array per broker; this is
 * the same numbers in one grouped query.
 */
export async function brokerCallStats(): Promise<BrokerCallStats[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT broker_id,
            COUNT(*) AS calls,
            SUM(outcome IN ('interestedSell', 'interestedRent')) AS interested,
            MAX(at) AS last_at
     FROM calls WHERE org_id = ?
     GROUP BY broker_id`,
    [kOrgId],
  );
  return rows.map(r => ({
    brokerId: r.broker_id as string,
    calls: Number(r.calls),
    interested: Number(r.interested ?? 0),
    lastAt: fromDb(r.last_at),
  }));
}

/** Outcome mix over a window — the manager home's outcomes panel. */
export async function outcomeCounts(since: Date): Promise<Record<string, number>> {
  const [rows] = await pool.query<Row[]>(
    'SELECT outcome, COUNT(*) AS n FROM calls WHERE org_id = ? AND at >= ? GROUP BY outcome',
    [kOrgId, since],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.outcome as string] = Number(r.n);
  return out;
}

/** Calls per day over a window — the 14-day momentum chart. */
export async function callsPerDay(since: Date): Promise<{ day: string; n: number }[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT DATE(at) AS day, COUNT(*) AS n
     FROM calls WHERE org_id = ? AND at >= ?
     GROUP BY DATE(at) ORDER BY day`,
    [kOrgId, since],
  );
  return rows.map(r => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    n: Number(r.n),
  }));
}

export async function countCallsTotal(): Promise<number> {
  const [rows] = await pool.query<Row[]>('SELECT COUNT(*) AS n FROM calls WHERE org_id = ?', [kOrgId]);
  return Number(rows[0].n);
}
