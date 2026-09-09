import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, fromDb } from '../db/pool';
import { AuditEntry, kOrgId } from '../../../src/types/models';
import { newAuditId } from '../domain/ids';
import { maskPhone } from '../domain/masking';

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

// ── Rich activity feed ───────────────────────────────────────────────────────
// One readable row per event, resolving unit IDs to owner + unit labels and
// merging the calls table in (so the outcome and note the broker actually chose
// show up, retroactively). Phone numbers are only ever surfaced MASKED.

/** One enriched activity row for the audit screen / export. */
export interface ActivityRow {
  id: string;
  at: string;
  actorId: string | null;
  /** Raw action for filtering (call, view, assign, import, …). */
  action: string;
  /** Display action — 'reveal' is split out of 'view' for readability. */
  displayAction: string;
  outcome?: string;
  ownerName?: string;
  /** Readable unit (community · cluster · #unit); "+N more" when several. */
  unitLabel?: string;
  unitCount: number;
  /** First linked property that still exists — lets the log open its detail. */
  propertyId?: string;
  note?: string;
  /** The owner's number, MASKED (••••1234) — never the real number. */
  numberMasked?: string;
  detail: string;
}

export interface ActivityPage { rows: ActivityRow[]; total: number; }

export interface ActivityQuery {
  limit: number;
  offset: number;
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  search?: string;
  sort?: 'at' | 'actor' | 'action';
  dir?: 'asc' | 'desc';
}

/** A readable unit label from a property row (blank-building safe — the tower
 *  lives in community/cluster on real data, so those lead). */
function unitLabelFromRow(p: Row): string {
  const loc = [p.community, p.cluster, p.building]
    .map(s => String(s ?? '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const uniq = loc.filter(s => (seen.has(s.toLowerCase()) ? false : (seen.add(s.toLowerCase()), true)));
  const unit = String(p.unit_number ?? '').trim();
  const plot = String(p.plot_number ?? '').trim();
  const num = unit ? `#${unit}` : plot ? `Plot ${plot}` : '';
  return [uniq.join(' · '), num].filter(Boolean).join(' · ') || '(unit)';
}

export async function listActivity(q: ActivityQuery): Promise<ActivityPage> {
  const includeCalls = !q.action || q.action === 'call';
  const includeAudit = !q.action || q.action !== 'call';
  const like = q.search && q.search.trim() ? `%${q.search.trim()}%` : null;

  const branches: string[] = [];
  const params: unknown[] = [];

  if (includeCalls) {
    const w: string[] = ['c.org_id = ?']; params.push(kOrgId);
    if (q.actorId) { w.push('c.broker_id = ?'); params.push(q.actorId); }
    if (q.from) { w.push('c.at >= ?'); params.push(q.from); }
    if (q.to) { w.push('c.at < ?'); params.push(q.to); }
    if (like) { w.push('(c.owner_name LIKE ? OR c.note LIKE ?)'); params.push(like, like); }
    branches.push(
      `SELECT 'call' AS src, c.id AS id, c.at AS at, c.broker_id AS actor_id,
              'call' AS action, c.outcome AS outcome, c.note AS note,
              c.owner_name AS owner_name, NULL AS detail
       FROM calls c WHERE ${w.join(' AND ')}`,
    );
  }
  if (includeAudit) {
    const w: string[] = ['a.org_id = ?', "a.action <> 'call'"]; params.push(kOrgId);
    if (q.action && q.action !== 'call') { w.push('a.action = ?'); params.push(q.action); }
    if (q.actorId) { w.push('a.actor_id = ?'); params.push(q.actorId); }
    if (q.from) { w.push('a.at >= ?'); params.push(q.from); }
    if (q.to) { w.push('a.at < ?'); params.push(q.to); }
    if (like) { w.push('a.detail LIKE ?'); params.push(like); }
    branches.push(
      `SELECT 'audit' AS src, a.id AS id, a.at AS at, a.actor_id AS actor_id,
              a.action AS action, NULL AS outcome, NULL AS note,
              NULL AS owner_name, a.detail AS detail
       FROM audit a WHERE ${w.join(' AND ')}`,
    );
  }
  if (branches.length === 0) return { rows: [], total: 0 };

  const union = branches.join('\n      UNION ALL\n');

  const [countRows] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM (${union}) feed`, params);
  const total = Number(countRows[0].n);

  // Whitelisted sort — never interpolate user text into the ORDER BY.
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol = q.sort === 'actor' ? 'actor_id' : q.sort === 'action' ? 'action' : 'at';
  const [rows] = await pool.query<Row[]>(
    `SELECT * FROM (${union}) feed
     ORDER BY ${sortCol} ${dir}, at ${dir}, id ${dir}
     LIMIT ? OFFSET ?`,
    [...params, q.limit, q.offset],
  );

  // ── Resolve the units/owners for this page in a couple of batched lookups ──
  const callIds = rows.filter(r => r.src === 'call').map(r => r.id as string);
  const auditRows = rows.filter(r => r.src === 'audit');
  const auditIds = auditRows.map(r => r.id as string);

  // Plain "Viewed owner detail <id>" rows carry the id in their text, not a link.
  const parsedByAudit = new Map<string, string>();
  for (const r of auditRows) {
    const m = /owner detail\s+(\S+)/.exec(String(r.detail ?? ''));
    if (m) parsedByAudit.set(r.id as string, m[1]);
  }

  const callUnits = await linkMap(
    callIds.length
      ? `SELECT cp.call_id AS k, cp.property_id AS pid FROM call_properties cp
         WHERE cp.call_id IN (${callIds.map(() => '?').join(', ')})`
      : null,
    callIds,
  );
  const auditUnits = await linkMap(
    auditIds.length
      ? `SELECT ap.audit_id AS k, ap.property_id AS pid FROM audit_properties ap
         WHERE ap.audit_id IN (${auditIds.map(() => '?').join(', ')})`
      : null,
    auditIds,
  );

  const allPropIds = new Set<string>();
  callUnits.forEach(ids => ids.forEach(id => allPropIds.add(id)));
  auditUnits.forEach(ids => ids.forEach(id => allPropIds.add(id)));
  parsedByAudit.forEach(id => allPropIds.add(id));

  const propInfo = new Map<string, { label: string; ownerName: string; numberMasked: string }>();
  if (allPropIds.size > 0) {
    const ids = [...allPropIds];
    const [pRows] = await pool.query<Row[]>(
      `SELECT id, community, cluster, building, unit_number, plot_number, owner_name, owner_phone
       FROM properties WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    for (const p of pRows) {
      propInfo.set(p.id as string, {
        label: unitLabelFromRow(p),
        ownerName: String(p.owner_name ?? '').trim(),
        numberMasked: maskPhone(p.owner_phone as string | null).masked,
      });
    }
  }

  const labelFor = (propIds: string[]): { unitLabel?: string; unitCount: number; propertyId?: string } => {
    // Only properties that still exist resolve — a deleted unit can't be opened.
    const resolved = propIds.filter(id => propInfo.has(id));
    if (resolved.length === 0) return { unitLabel: undefined, unitCount: propIds.length, propertyId: undefined };
    const first = propInfo.get(resolved[0])!.label;
    return {
      unitLabel: resolved.length > 1 ? `${first} +${resolved.length - 1} more` : first,
      unitCount: resolved.length,
      propertyId: resolved[0],
    };
  };

  const out: ActivityRow[] = rows.map(r => {
    const id = r.id as string;
    const at = fromDb(r.at)!;
    const actorId = (r.actor_id as string) ?? null;

    if (r.src === 'call') {
      const propIds = callUnits.get(id) ?? [];
      const { unitLabel, unitCount, propertyId } = labelFor(propIds);
      const owner = String(r.owner_name ?? '').trim() || (propIds[0] ? propInfo.get(propIds[0])?.ownerName : '') || undefined;
      return {
        id, at, actorId,
        action: 'call', displayAction: 'call',
        outcome: (r.outcome as string) ?? undefined,
        ownerName: owner,
        unitLabel, unitCount, propertyId,
        note: (r.note as string) ?? undefined,
        detail: '',
      };
    }

    // audit row
    const action = r.action as string;
    const detail = String(r.detail ?? '');
    const linked = auditUnits.get(id) ?? (parsedByAudit.has(id) ? [parsedByAudit.get(id)!] : []);
    const { unitLabel, unitCount, propertyId } = labelFor(linked);
    const isReveal = action === 'view' && /^Revealed/i.test(detail);
    const primary = linked[0] ? propInfo.get(linked[0]) : undefined;
    const ownerName = primary?.ownerName
      || (isReveal ? detail.replace(/^Revealed[^—]*—\s*/i, '').trim() : undefined)
      || undefined;
    // Once owner + unit are resolved, the raw "Viewed owner detail <id>" /
    // "Revealed number — <name>" text is just noise — those columns carry it.
    const resolved = !!(ownerName || unitLabel);
    const cleanDetail = isReveal ? '' : (action === 'view' && resolved ? '' : detail);
    return {
      id, at, actorId,
      action,
      displayAction: isReveal ? 'reveal' : action,
      ownerName,
      unitLabel, unitCount, propertyId,
      numberMasked: isReveal ? primary?.numberMasked : undefined,
      detail: cleanDetail,
    };
  });

  return { rows: out, total };
}

/** Build a map key → [ids] from a two-column (k, pid) query. */
async function linkMap(sql: string | null, params: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!sql) return map;
  const [rows] = await pool.query<Row[]>(sql, params);
  for (const r of rows) {
    const k = r.k as string;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r.pid as string);
  }
  return map;
}
