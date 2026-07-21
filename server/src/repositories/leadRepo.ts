import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { Lead, PropertyState, CallOutcome, kOrgId } from '../../../src/types/models';

/**
 * Leads (buyer enquiries).
 *
 * Deliberately parallel to propertyRepo: `Lead` and `Property` both implement
 * ProspectFields and share one disposition machine, so the two repositories
 * stay shaped the same on purpose. If you change the lifecycle handling in one,
 * the other almost certainly needs the same change.
 */

export function toLead(r: Row): Lead {
  const l = new Lead(
    r.id as string,
    r.org_id as string,
    (r.dataset_id as string) ?? '',
    fromDb(r.enquiry_date),
    (r.name as string) ?? '',
    (r.phone as string) ?? undefined,
    (r.email as string) ?? undefined,
    (r.project as string) ?? undefined,
    (r.source as string) ?? undefined,
    parseExtra(r.extra),
    fromDb(r.created_at)!,
    r.state as PropertyState,
    fromDb(r.updated_at),
  );
  l.assignedTo = (r.assigned_to as string) ?? undefined;
  l.assignedAt = fromDb(r.assigned_at);
  l.assignmentNote = (r.assignment_note as string) ?? undefined;
  l.cooldownUntil = fromDb(r.cooldown_until);
  l.portfolioSince = fromDb(r.portfolio_since);
  l.lastOutcome = (r.last_outcome as CallOutcome) ?? undefined;
  l.lastCalledAt = fromDb(r.last_called_at);
  l.callAttempts = Number(r.call_attempts ?? 0);
  l.nextFollowUpAt = fromDb(r.next_follow_up_at);
  l.dncAt = fromDb(r.dnc_at);
  l.assignmentExpiresAt = fromDb(r.assignment_expires_at);
  return l;
}

function parseExtra(v: unknown): Record<string, string> {
  if (v == null) return {};
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (obj == null || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, val]) => [k, String(val)]),
  );
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

const COLS = `
  id, org_id, dataset_id, state, lead_key, enquiry_date, name, phone, email,
  project, source, extra, created_at, updated_at, assigned_to, assigned_at,
  assignment_note, cooldown_until, portfolio_since, last_outcome,
  last_called_at, call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;

const WRITE_COLS = `
  id, org_id, dataset_id, state, lead_key, enquiry_date, name, phone, email,
  project, source, extra, created_at, updated_at, assigned_to, assigned_at,
  assignment_note, cooldown_until, portfolio_since, last_outcome,
  last_called_at, call_attempts, next_follow_up_at, dnc_at, assignment_expires_at`;
const PLACEHOLDERS = `(${new Array(25).fill('?').join(', ')})`;

function writeParams(l: Lead): unknown[] {
  return [
    l.id, kOrgId, l.datasetId || null, l.state,
    // leadKey is the shared getter: phone → email → name.
    l.leadKey,
    toDb(l.enquiryDate), l.name, l.phone ?? null, l.email ?? null,
    l.project ?? null, l.source ?? null,
    JSON.stringify(l.extra ?? {}),
    toDb(l.createdAt), toDb(l.updatedAt),
    l.assignedTo ?? null, toDb(l.assignedAt), l.assignmentNote ?? null,
    toDb(l.cooldownUntil), toDb(l.portfolioSince),
    l.lastOutcome ?? null, toDb(l.lastCalledAt), l.callAttempts,
    toDb(l.nextFollowUpAt), toDb(l.dncAt), toDb(l.assignmentExpiresAt),
  ];
}

const CHUNK = 500;

export async function saveLeads(
  leads: Lead[],
  cx?: PoolConnection,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (leads.length === 0) return;
  const db = cx ?? pool;
  for (let i = 0; i < leads.length; i += CHUNK) {
    const chunk = leads.slice(i, i + CHUNK);
    await db.query(
      `INSERT INTO leads (${WRITE_COLS}) VALUES ${chunk.map(() => PLACEHOLDERS).join(', ')}
       ON DUPLICATE KEY UPDATE
         dataset_id = VALUES(dataset_id), state = VALUES(state),
         enquiry_date = VALUES(enquiry_date), name = VALUES(name), phone = VALUES(phone),
         email = VALUES(email), project = VALUES(project), source = VALUES(source),
         extra = VALUES(extra), updated_at = VALUES(updated_at),
         assigned_to = VALUES(assigned_to), assigned_at = VALUES(assigned_at),
         assignment_note = VALUES(assignment_note), cooldown_until = VALUES(cooldown_until),
         portfolio_since = VALUES(portfolio_since), last_outcome = VALUES(last_outcome),
         last_called_at = VALUES(last_called_at), call_attempts = VALUES(call_attempts),
         next_follow_up_at = VALUES(next_follow_up_at), dnc_at = VALUES(dnc_at),
         assignment_expires_at = VALUES(assignment_expires_at)`,
      chunk.flatMap(writeParams),
    );
    onProgress?.(Math.min(i + CHUNK, leads.length), leads.length);
  }
}

export async function findLeadById(id: string, cx?: PoolConnection): Promise<Lead | null> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(`SELECT ${COLS} FROM leads WHERE id = ? LIMIT 1`, [id]);
  return rows.length ? toLead(rows[0]) : null;
}

export async function findLeadsByIds(ids: string[], cx?: PoolConnection): Promise<Lead[]> {
  if (ids.length === 0) return [];
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    `SELECT ${COLS} FROM leads WHERE id IN (${ids.map(() => '?').join(', ')})`, ids,
  );
  return rows.map(toLead);
}

export async function findByLeadKeys(keys: string[]): Promise<Map<string, Lead>> {
  const out = new Map<string, Lead>();
  if (keys.length === 0) return out;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const [rows] = await pool.query<Row[]>(
      `SELECT ${COLS} FROM leads
       WHERE org_id = ? AND lead_key_hash IN (${chunk.map(() => 'UNHEX(SHA2(?, 256))').join(', ')})`,
      [kOrgId, ...chunk],
    );
    for (const r of rows) {
      const l = toLead(r);
      out.set(l.leadKey, l);
    }
  }
  return out;
}

/** Mirrors VaultContext.leadsOf — every lead held by a broker, any state. */
export async function findLeadsOf(brokerId: string): Promise<Lead[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM leads WHERE assigned_to = ?`, [brokerId],
  );
  return rows.map(toLead);
}

// ── Query ──────────────────────────────────────────────────────────────────

export interface LeadFilter {
  search?: string;
  state?: PropertyState | '';
  states?: PropertyState[];
  project?: string;
  source?: string;
  outcome?: string;
  callableOnly?: boolean;
  assignedTo?: string;
  datasetId?: string;
  enquiryFrom?: string;
  enquiryTo?: string;
  ownerHidden?: boolean;
}

export interface LeadQuery extends LeadFilter {
  sortKey?: string;
  asc?: boolean;
  limit: number;
  offset: number;
}

const SORTABLE: Record<string, string> = {
  name: 'LOWER(name)',
  phone: 'LOWER(phone)',
  email: 'LOWER(email)',
  project: 'LOWER(project)',
  source: 'LOWER(source)',
  enquiry: 'enquiry_date',
  outcome: 'last_outcome',
  calledAt: 'last_called_at',
  followUp: 'next_follow_up_at',
  state: 'state',
};

const NAME_SORT = 'LOWER(name)';

function buildWhere(f: LeadFilter): { sql: string; params: unknown[] } {
  const where: string[] = ['org_id = ?'];
  const params: unknown[] = [kOrgId];

  if (f.state) { where.push('state = ?'); params.push(f.state); }
  if (f.states && f.states.length > 0) {
    where.push(`state IN (${f.states.map(() => '?').join(', ')})`);
    params.push(...f.states);
  }
  if (f.project) { where.push('project = ?'); params.push(f.project); }
  if (f.source) { where.push('source = ?'); params.push(f.source); }
  if (f.assignedTo) { where.push('assigned_to = ?'); params.push(f.assignedTo); }
  if (f.datasetId) { where.push('dataset_id = ?'); params.push(f.datasetId); }
  if (f.outcome) {
    if (f.outcome === 'none') where.push('last_outcome IS NULL');
    else { where.push('last_outcome = ?'); params.push(f.outcome); }
  }
  if (f.callableOnly) where.push('callable = 1');

  if (f.enquiryFrom) {
    const d = new Date(f.enquiryFrom);
    if (!isNaN(d.getTime())) { where.push('enquiry_date >= ?'); params.push(d); }
  }
  if (f.enquiryTo) {
    const d = new Date(f.enquiryTo);
    if (!isNaN(d.getTime())) {
      where.push('enquiry_date < ?');
      params.push(new Date(d.getTime() + 24 * 3600_000));
    }
  }

  if (f.search && f.search.trim().length > 0) {
    const q = `%${f.search.trim().replace(/[\\%_]/g, m => '\\' + m)}%`;
    const fields = ["IFNULL(project, '')", "IFNULL(source, '')"];
    // A lead IS the person — hiding "owner data" means hiding name/email here.
    if (!f.ownerHidden) fields.unshift('name', "IFNULL(email, '')");
    where.push(`LOWER(CONCAT_WS(' ', ${fields.join(', ')})) LIKE LOWER(?)`);
    params.push(q);
  }

  return { sql: where.join(' AND '), params };
}

export interface LeadPage { rows: Lead[]; total: number; }

export async function queryLeads(q: LeadQuery): Promise<LeadPage> {
  const { sql: whereSql, params } = buildWhere(q);

  const [countRows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM leads WHERE ${whereSql}`, params,
  );
  const total = Number(countRows[0].n);
  const dir = q.asc === false ? 'DESC' : 'ASC';

  if (q.sortKey && q.sortKey.startsWith('extra:')) {
    const header = q.sortKey.slice('extra:'.length);
    const [rows] = await pool.query<Row[]>(
      `SELECT ${COLS} FROM leads WHERE ${whereSql}
       ORDER BY LOWER(JSON_UNQUOTE(JSON_EXTRACT(extra, CONCAT('$.', ?)))) ${dir}, ${NAME_SORT} ASC
       LIMIT ? OFFSET ?`,
      [...params, header, q.limit, q.offset],
    );
    return { rows: rows.map(toLead), total };
  }

  const mapped = q.sortKey ? SORTABLE[q.sortKey] : undefined;
  const orderBy = mapped ? `${mapped} ${dir}, ${NAME_SORT} ASC` : `${NAME_SORT} ${dir}`;

  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM leads WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, q.limit, q.offset],
  );
  return { rows: rows.map(toLead), total };
}

export interface LeadFacets {
  states: PropertyState[];
  projects: string[];
  sources: string[];
  outcomes: CallOutcome[];
  extraKeys: string[];
}

export async function leadFacets(f: LeadFilter): Promise<LeadFacets> {
  const scope: LeadFilter = {
    assignedTo: f.assignedTo, datasetId: f.datasetId, states: f.states,
  };
  const { sql, params } = buildWhere(scope);

  const distinct = async (col: string) => {
    const [rows] = await pool.query<Row[]>(
      `SELECT DISTINCT ${col} AS v FROM leads WHERE ${sql} AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY v`,
      params,
    );
    return rows.map(r => String(r.v));
  };

  const [projects, sources] = await Promise.all([distinct('project'), distinct('source')]);

  const [stateRows] = await pool.query<Row[]>(
    `SELECT DISTINCT state AS v FROM leads WHERE ${sql}`, params);
  const [outcomeRows] = await pool.query<Row[]>(
    `SELECT DISTINCT last_outcome AS v FROM leads WHERE ${sql} AND last_outcome IS NOT NULL`, params);
  const [extraRows] = await pool.query<Row[]>(
    `SELECT DISTINCT JSON_KEYS(extra) AS ks FROM leads
     WHERE ${sql} AND extra IS NOT NULL AND JSON_LENGTH(extra) > 0`, params);

  const extraKeys = new Set<string>();
  for (const r of extraRows) {
    const ks = typeof r.ks === 'string' ? safeParse(r.ks) : r.ks;
    if (Array.isArray(ks)) for (const k of ks) extraKeys.add(String(k));
  }

  return {
    states: stateRows.map(r => r.v as PropertyState),
    projects,
    sources,
    outcomes: outcomeRows.map(r => r.v as CallOutcome),
    extraKeys: Array.from(extraKeys).sort(),
  };
}

export async function countLeadsByState(): Promise<Record<PropertyState, number>> {
  const [rows] = await pool.query<Row[]>(
    'SELECT state, COUNT(*) AS n FROM leads WHERE org_id = ? GROUP BY state', [kOrgId],
  );
  const out = Object.fromEntries(
    Object.values(PropertyState).map(s => [s, 0]),
  ) as Record<PropertyState, number>;
  for (const r of rows) out[r.state as PropertyState] = Number(r.n);
  return out;
}

export async function countLeadsTotal(): Promise<number> {
  const [rows] = await pool.query<Row[]>('SELECT COUNT(*) AS n FROM leads WHERE org_id = ?', [kOrgId]);
  return Number(rows[0].n);
}

export async function deleteLeadsByDataset(datasetId: string, cx?: PoolConnection): Promise<number> {
  const db = cx ?? pool;
  const [res] = await db.query('DELETE FROM leads WHERE dataset_id = ?', [datasetId]);
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

export async function countLeadsByDataset(datasetId: string, cx?: PoolConnection): Promise<number> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    'SELECT COUNT(*) AS n FROM leads WHERE dataset_id = ?', [datasetId],
  );
  return Number(rows[0].n);
}
