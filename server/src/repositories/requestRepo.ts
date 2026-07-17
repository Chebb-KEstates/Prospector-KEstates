import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { BatchRequest, RequestStatus, kOrgId } from '../../../src/types/models';

/**
 * Broker requests for pool data.
 *
 * `unitIds` (the hand-picked case) lives in `request_units`. Note the whole
 * request flow was dead in the reference implementation until late: submitRequest
 * existed but nothing called it, so the manager's Requests tab could never
 * populate.
 */

function toRequest(r: Row, unitIds: string[]): BatchRequest {
  return new BatchRequest(
    r.id as string,
    r.org_id as string,
    r.broker_id as string,
    (r.community as string) ?? '',
    (r.cluster as string) ?? undefined,
    Number(r.count ?? 0),
    unitIds,
    (r.note as string) ?? undefined,
    fromDb(r.at)!,
    r.status as RequestStatus,
    fromDb(r.decided_at),
    Number(r.granted_count ?? 0),
  );
}

const COLS = `
  id, org_id, broker_id, community, cluster, \`count\`, note, at,
  status, decided_at, granted_count`;

async function hydrate(rows: Row[], db: PoolConnection | typeof pool): Promise<BatchRequest[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id as string);
  const [links] = await db.query<Row[]>(
    `SELECT request_id, property_id FROM request_units
     WHERE request_id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const byRequest = new Map<string, string[]>();
  for (const l of links) {
    const key = l.request_id as string;
    let list = byRequest.get(key);
    if (!list) { list = []; byRequest.set(key, list); }
    list.push(l.property_id as string);
  }
  return rows.map(r => toRequest(r, byRequest.get(r.id as string) ?? []));
}

export async function insertRequest(req: BatchRequest, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `INSERT INTO requests
       (id, org_id, broker_id, community, cluster, \`count\`, note, at, status,
        decided_at, decided_by, granted_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.id, kOrgId, req.brokerId, req.community, req.cluster ?? null,
      req.count, req.note ?? null, toDb(req.at), req.status,
      toDb(req.decidedAt), null, req.grantedCount,
    ],
  );
  if (req.unitIds.length > 0) {
    await db.query(
      `INSERT INTO request_units (request_id, property_id)
       VALUES ${req.unitIds.map(() => '(?, ?)').join(', ')}`,
      req.unitIds.flatMap(id => [req.id, id]),
    );
  }
}

/**
 * Lock a pending request for decision.
 *
 * `FOR UPDATE` is the point: two managers hitting Approve on the same request
 * concurrently would otherwise both read it as pending and both grant units.
 * The second waits here, then sees status != 'pending' and is rejected.
 */
export async function lockRequestForDecision(
  id: string, cx: PoolConnection,
): Promise<BatchRequest | null> {
  const [rows] = await cx.query<Row[]>(
    `SELECT ${COLS} FROM requests WHERE id = ? FOR UPDATE`, [id],
  );
  if (rows.length === 0) return null;
  const hydrated = await hydrate(rows, cx);
  return hydrated[0];
}

export async function markDecided(
  req: BatchRequest, decidedBy: string, cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `UPDATE requests SET status = ?, decided_at = ?, decided_by = ?, granted_count = ?
     WHERE id = ?`,
    [req.status, toDb(req.decidedAt), decidedBy, req.grantedCount, req.id],
  );
}

export async function listRequests(opts: {
  status?: RequestStatus; brokerId?: string; limit?: number;
} = {}): Promise<BatchRequest[]> {
  const where: string[] = ['org_id = ?'];
  const params: unknown[] = [kOrgId];
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.brokerId) { where.push('broker_id = ?'); params.push(opts.brokerId); }

  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM requests WHERE ${where.join(' AND ')}
     ORDER BY at DESC LIMIT ?`,
    [...params, opts.limit ?? 500],
  );
  return hydrate(rows, pool);
}

export async function countPending(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM requests WHERE org_id = ? AND status = 'pending'`, [kOrgId],
  );
  return Number(rows[0].n);
}
