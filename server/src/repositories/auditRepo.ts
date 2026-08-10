import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, fromDb } from '../db/pool';
import { AuditEntry, kOrgId } from '../../../src/types/models';
import { newAuditId } from '../domain/ids';

/**
 * The audit trail — append-only, and now actually trustworthy.
 *
 * Client-side, a caller could simply decline to write an entry; the trail was
 * advisory. Server-side it is written in the same transaction as the thing it
 * records, so "revealed a number" and "was allowed to reveal a number" cannot
 * come apart.
 */

export interface WriteAuditInput {
  actorId: string | null;
  action: string;
  detail: string;
  propertyIds?: string[];
  at?: Date;
}

export async function writeAudit(
  input: WriteAuditInput,
  cx?: PoolConnection,
): Promise<AuditEntry> {
  const db = cx ?? pool;
  const id = newAuditId();
  const at = input.at ?? new Date();

  await db.query(
    'INSERT INTO audit (id, org_id, at, actor_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [id, kOrgId, at, input.actorId, input.action, input.detail],
  );

  const ids = input.propertyIds ?? [];
  if (ids.length > 0) {
    await db.query(
      `INSERT INTO audit_properties (audit_id, property_id) VALUES ${ids.map(() => '(?, ?)').join(', ')}`,
      ids.flatMap(pid => [id, pid]),
    );
  }

  return new AuditEntry(id, kOrgId, at.toISOString(), input.actorId ?? '', input.action, input.detail, ids);
}


export interface AuditPage {
  entries: AuditEntry[];
  total: number;
}

export interface PropertyAuditRow {
  at: string;
  actorId: string | null;
  action: string;
  detail: string;
}

/**
 * Every audit event linked to one property (assign / reclaim / reveal / …),
 * newest first — the record's slice of the trail, for the popup history journal.
 * Joins through `audit_properties`, so only events that named this property show.
 */
export async function listAuditForProperty(propertyId: string, limit = 200): Promise<PropertyAuditRow[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT a.at, a.actor_id, a.action, a.detail
     FROM audit a
     JOIN audit_properties ap ON ap.audit_id = a.id
     WHERE a.org_id = ? AND ap.property_id = ?
     ORDER BY a.at DESC, a.id DESC
     LIMIT ?`,
    [kOrgId, propertyId, limit],
  );
  return rows.map(r => ({
    at: fromDb(r.at)!,
    actorId: (r.actor_id as string) ?? null,
    action: r.action as string,
    detail: r.detail as string,
  }));
}

export async function listAudit(opts: {
  limit: number;
  offset: number;
  actorId?: string;
  action?: string;
}): Promise<AuditPage> {
  const where: string[] = ['org_id = ?'];
  const params: unknown[] = [kOrgId];
  if (opts.actorId) { where.push('actor_id = ?'); params.push(opts.actorId); }
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  const whereSql = where.join(' AND ');

  const [countRows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM audit WHERE ${whereSql}`,
    params,
  );

  const [rows] = await pool.query<Row[]>(
    `SELECT id, org_id, at, actor_id, action, detail
     FROM audit WHERE ${whereSql}
     ORDER BY at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );

  const ids = rows.map(r => r.id as string);
  const propsById = new Map<string, string[]>();
  if (ids.length > 0) {
    const [links] = await pool.query<Row[]>(
      `SELECT audit_id, property_id FROM audit_properties
       WHERE audit_id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    for (const l of links) {
      const k = l.audit_id as string;
      if (!propsById.has(k)) propsById.set(k, []);
      propsById.get(k)!.push(l.property_id as string);
    }
  }

  return {
    total: Number(countRows[0].n),
    entries: rows.map(r => new AuditEntry(
      r.id as string,
      r.org_id as string,
      fromDb(r.at)!,
      (r.actor_id as string) ?? '',
      r.action as string,
      r.detail as string,
      propsById.get(r.id as string) ?? [],
    )),
  };
}
